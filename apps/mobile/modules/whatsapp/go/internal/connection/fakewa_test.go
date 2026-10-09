package connection

import (
	"context"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"go.mau.fi/libsignal/ecc"
	"go.mau.fi/whatsmeow"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waCert"
	"go.mau.fi/whatsmeow/proto/waWa6"
	"go.mau.fi/whatsmeow/socket"
	"go.mau.fi/whatsmeow/util/gcmutil"
	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/hkdf"
	"google.golang.org/protobuf/proto"
)

// fakeWA is a local WhatsApp-protocol server: a real websocket listener that
// completes the pinned client's Noise handshake against a test certificate
// chain and then exchanges real encrypted binary frames.
type fakeWA struct {
	t      *testing.T
	server *httptest.Server
	conns  chan *fakeConn
	// holdHello, when set, is awaited before the n-th (1-based) server hello.
	holdHello func(n int) <-chan struct{}
	accepted  int
	mu        sync.Mutex
	staticPub [32]byte
	staticKey [32]byte
	cert      []byte
}

type fakeConn struct {
	ws       *websocket.Conn
	write    cipher.AEAD
	read     cipher.AEAD
	writeCtr uint32
	readCtr  uint32
	sendLock sync.Mutex
	nodes    chan *waBinary.Node
	closed   chan struct{}
}

func newFakeWA(t *testing.T) *fakeWA {
	t.Helper()
	root, err := ecc.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	inter, err := ecc.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeWA{t: t, conns: make(chan *fakeConn, 8)}
	f.staticKey = [32]byte{1, 2, 3}
	pub, err := curve25519.X25519(f.staticKey[:], curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}
	copy(f.staticPub[:], pub)
	now := time.Now()
	details := func(serial, issuer uint32, key []byte) []byte {
		raw, err := proto.Marshal(&waCert.CertChain_NoiseCertificate_Details{
			Serial: proto.Uint32(serial), IssuerSerial: proto.Uint32(issuer), Key: key,
			NotBefore: proto.Uint64(uint64(now.Add(-time.Hour).Unix())), NotAfter: proto.Uint64(uint64(now.Add(time.Hour).Unix())),
		})
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	interPub := inter.PublicKey().PublicKey()
	interDetails := details(1, whatsmeow.WACertIssuerSerial, interPub[:])
	leafDetails := details(2, 1, f.staticPub[:])
	interSig := ecc.CalculateSignature(root.PrivateKey(), interDetails)
	leafSig := ecc.CalculateSignature(inter.PrivateKey(), leafDetails)
	f.cert, err = proto.Marshal(&waCert.CertChain{
		Intermediate: &waCert.CertChain_NoiseCertificate{Details: interDetails, Signature: interSig[:]},
		Leaf:         &waCert.CertChain_NoiseCertificate{Details: leafDetails, Signature: leafSig[:]},
	})
	if err != nil {
		t.Fatal(err)
	}
	original := whatsmeow.WACertPubKey
	whatsmeow.WACertPubKey = root.PublicKey().PublicKey()
	t.Cleanup(func() { whatsmeow.WACertPubKey = original })
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeWA) url() string { return "ws" + strings.TrimPrefix(f.server.URL, "http") }

// point makes a pinned client dial this server instead of WhatsApp.
func (f *fakeWA) point(client *whatsmeow.Client) {
	client.MessengerConfig = &whatsmeow.MessengerConfig{BaseURL: socket.Origin, WebsocketURL: f.url()}
}

func (f *fakeWA) next() *fakeConn {
	f.t.Helper()
	select {
	case conn := <-f.conns:
		return conn
	case <-time.After(5 * time.Second):
		f.t.Fatal("client did not complete a handshake")
		return nil
	}
}

type noiseState struct {
	hash, salt []byte
	key        cipher.AEAD
	counter    uint32
}

func newNoiseState(header []byte) *noiseState {
	n := &noiseState{hash: []byte(socket.NoiseStartPattern)}
	n.salt = n.hash
	n.key, _ = gcmutil.Prepare(n.hash)
	n.authenticate(header)
	return n
}

func (n *noiseState) authenticate(data []byte) {
	sum := sha256.Sum256(append(append([]byte{}, n.hash...), data...))
	n.hash = sum[:]
}

func iv(counter uint32) []byte {
	out := make([]byte, 12)
	binary.BigEndian.PutUint32(out[8:], counter)
	return out
}

func (n *noiseState) encrypt(plain []byte) []byte {
	out := n.key.Seal(nil, iv(n.counter), plain, n.hash)
	n.counter++
	n.authenticate(out)
	return out
}

func (n *noiseState) decrypt(cipherText []byte) ([]byte, error) {
	out, err := n.key.Open(nil, iv(n.counter), cipherText, n.hash)
	n.counter++
	if err == nil {
		n.authenticate(cipherText)
	}
	return out, err
}

func expand(salt, data []byte) (first, second []byte) {
	reader := hkdf.New(sha256.New, data, salt, nil)
	first, second = make([]byte, 32), make([]byte, 32)
	_, _ = io.ReadFull(reader, first)
	_, _ = io.ReadFull(reader, second)
	return first, second
}

func (n *noiseState) mix(priv, pub []byte) {
	secret, err := curve25519.X25519(priv, pub)
	if err != nil {
		panic(err)
	}
	n.counter = 0
	write, read := expand(n.salt, secret)
	n.salt = write
	n.key, _ = gcmutil.Prepare(read)
}

type frameReader struct {
	ws     *websocket.Conn
	buffer []byte
	header bool
}

func (r *frameReader) next(ctx context.Context) ([]byte, error) {
	for {
		if !r.header && len(r.buffer) >= len(socket.WAConnHeader) {
			r.buffer = r.buffer[len(socket.WAConnHeader):]
			r.header = true
		}
		if r.header && len(r.buffer) >= socket.FrameLengthSize {
			length := int(r.buffer[0])<<16 | int(r.buffer[1])<<8 | int(r.buffer[2])
			if len(r.buffer) >= socket.FrameLengthSize+length {
				frame := append([]byte{}, r.buffer[socket.FrameLengthSize:socket.FrameLengthSize+length]...)
				r.buffer = r.buffer[socket.FrameLengthSize+length:]
				return frame, nil
			}
		}
		_, data, err := r.ws.Read(ctx)
		if err != nil {
			return nil, err
		}
		r.buffer = append(r.buffer, data...)
	}
}

func writeRawFrame(ctx context.Context, ws *websocket.Conn, data []byte) error {
	frame := append([]byte{byte(len(data) >> 16), byte(len(data) >> 8), byte(len(data))}, data...)
	return ws.Write(ctx, websocket.MessageBinary, frame)
}

func (f *fakeWA) serve(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
	if err != nil {
		return
	}
	ctx := context.Background()
	f.mu.Lock()
	f.accepted++
	n := f.accepted
	f.mu.Unlock()
	reader := &frameReader{ws: ws}
	hello, err := reader.next(ctx)
	if err != nil {
		return
	}
	var clientHello waWa6.HandshakeMessage
	if proto.Unmarshal(hello, &clientHello) != nil {
		return
	}
	clientEphemeral := clientHello.GetClientHello().GetEphemeral()
	if f.holdHello != nil {
		if gate := f.holdHello(n); gate != nil {
			select {
			case <-gate:
			case <-time.After(10 * time.Second):
				return
			}
		}
	}
	ephemeralKey := [32]byte{byte(n), 9, 9}
	ephemeralPub, _ := curve25519.X25519(ephemeralKey[:], curve25519.Basepoint)
	state := newNoiseState(socket.WAConnHeader)
	state.authenticate(clientEphemeral)
	state.authenticate(ephemeralPub)
	state.mix(ephemeralKey[:], clientEphemeral)
	staticCipher := state.encrypt(f.staticPub[:])
	state.mix(f.staticKey[:], clientEphemeral)
	certCipher := state.encrypt(f.cert)
	reply, _ := proto.Marshal(&waWa6.HandshakeMessage{ServerHello: &waWa6.HandshakeMessage_ServerHello{
		Ephemeral: ephemeralPub, Static: staticCipher, Payload: certCipher,
	}})
	if writeRawFrame(ctx, ws, reply) != nil {
		return
	}
	finishRaw, err := reader.next(ctx)
	if err != nil {
		return
	}
	var finish waWa6.HandshakeMessage
	if proto.Unmarshal(finishRaw, &finish) != nil {
		return
	}
	clientNoise, err := state.decrypt(finish.GetClientFinish().GetStatic())
	if err != nil {
		return
	}
	state.mix(ephemeralKey[:], clientNoise)
	if _, err = state.decrypt(finish.GetClientFinish().GetPayload()); err != nil {
		return
	}
	clientWrite, clientRead := expand(state.salt, nil)
	conn := &fakeConn{ws: ws, nodes: make(chan *waBinary.Node, 64), closed: make(chan struct{})}
	conn.write, _ = gcmutil.Prepare(clientRead)
	conn.read, _ = gcmutil.Prepare(clientWrite)
	f.conns <- conn
	defer close(conn.closed)
	for {
		frame, err := reader.next(ctx)
		if err != nil {
			return
		}
		plain, err := conn.read.Open(nil, iv(conn.readCtr), frame, nil)
		conn.readCtr++
		if err != nil {
			return
		}
		unpacked, err := waBinary.Unpack(plain)
		if err != nil {
			continue
		}
		node, err := waBinary.Unmarshal(unpacked)
		if err != nil {
			continue
		}
		conn.answer(ctx, node)
		select {
		case conn.nodes <- node:
		default:
		}
	}
}

// answer replies to the info queries a successful login performs.
func (c *fakeConn) answer(ctx context.Context, node *waBinary.Node) {
	id, _ := node.Attrs["id"].(string)
	if node.Tag != "iq" || id == "" {
		return
	}
	var children []waBinary.Node
	if node.GetChildByTag("count").Tag == "count" {
		children = []waBinary.Node{{Tag: "count", Attrs: waBinary.Attrs{"value": "100"}}}
	}
	_ = c.sendNode(ctx, waBinary.Node{Tag: "iq", Attrs: waBinary.Attrs{"id": id, "type": "result"}, Content: children})
}

func (c *fakeConn) sendNode(ctx context.Context, node waBinary.Node) error {
	payload, err := waBinary.Marshal(node)
	if err != nil {
		return err
	}
	c.sendLock.Lock()
	defer c.sendLock.Unlock()
	sealed := c.write.Seal(nil, iv(c.writeCtr), payload, nil)
	c.writeCtr++
	return writeRawFrame(ctx, c.ws, sealed)
}

func (c *fakeConn) send(t *testing.T, node waBinary.Node) {
	t.Helper()
	if err := c.sendNode(context.Background(), node); err != nil {
		t.Fatal(err)
	}
}

func (c *fakeConn) success(t *testing.T) {
	c.send(t, waBinary.Node{Tag: "success", Attrs: waBinary.Attrs{"t": "1"}})
}

func (c *fakeConn) streamError(t *testing.T, code string) {
	c.send(t, waBinary.Node{Tag: "stream:error", Attrs: waBinary.Attrs{"code": code}})
}

// drop closes the TCP connection without a websocket close handshake.
func (c *fakeConn) drop() { _ = c.ws.CloseNow() }

// closeOrderly sends a websocket close after every frame already written, so
// the client reads those frames before it sees the close.
func (c *fakeConn) closeOrderly() { _ = c.ws.Close(websocket.StatusNormalClosure, "") }

func (c *fakeConn) waitClosed(t *testing.T) {
	t.Helper()
	select {
	case <-c.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("client did not close the socket")
	}
}
