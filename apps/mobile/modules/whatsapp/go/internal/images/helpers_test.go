package images

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"yoyos-whatsapp/internal/normalization"
)

const testAccount = "111@lid"

var jpegHead = []byte{0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 'J', 'F', 'I', 'F', 0}

// payload is a JPEG-looking plaintext of exactly n bytes (n >= len(jpegHead)).
func payload(n int) []byte {
	out := make([]byte, n)
	copy(out, jpegHead)
	for i := len(jpegHead); i < n; i++ {
		out[i] = byte(i)
	}
	return out
}

func messageID(t testing.TB, wid string) string {
	t.Helper()
	id, err := normalization.MessageID(testAccount, "222@lid", wid)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

type spec struct {
	wid        string
	plain      []byte
	omitHash   bool
	length     *string
	directPath string
}

// reference builds a valid wa-image:v1 reference for plain.
func reference(t testing.TB, s spec) (string, string, Descriptor) {
	t.Helper()
	id := messageID(t, s.wid)
	sum := sha256.Sum256(s.plain)
	enc := sha256.Sum256([]byte("enc" + s.wid))
	key := bytes.Repeat([]byte{7}, 32)
	fields := map[string]string{"accountId": testAccount, "messageId": id, "mimeType": "image/jpeg", "directPath": "/v/t62/abc?x=1"}
	fields["directPath"] = "/v/t62/abc"
	if s.directPath != "" {
		fields["directPath"] = s.directPath
	}
	fields["mediaKey"] = base64.StdEncoding.EncodeToString(key)
	fields["fileSha256"] = base64.StdEncoding.EncodeToString(sum[:])
	fields["fileEncSha256"] = base64.StdEncoding.EncodeToString(enc[:])
	length := ""
	if s.length != nil {
		length = *s.length
	} else {
		length = itoa(len(s.plain))
	}
	fields["fileLength"] = length
	if s.omitHash {
		delete(fields, "fileSha256")
	}
	return id, encode(t, fields), mustParse(t, id, encode(t, fields))
}

func itoa(n int) string { raw, _ := json.Marshal(n); return string(raw) }

func encode(t testing.TB, fields map[string]string) string {
	t.Helper()
	raw, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	return "wa-image:v1:" + base64.RawURLEncoding.EncodeToString(raw)
}

func mustParse(t testing.TB, id, ref string) Descriptor {
	t.Helper()
	d, err := ParseDescriptor(id, ref)
	if err != nil {
		t.Fatalf("descriptor rejected: %v", err)
	}
	return d
}

// simulate performs the file operations of the pinned downloader for plaintext: write the
// ciphertext and MAC, truncate the MAC, decrypt in place, truncate the padding.
func simulate(f File, plain []byte) error {
	encrypted := (len(plain)/aesBlock+1)*aesBlock + macLength
	if _, err := f.Write(bytes.Repeat([]byte{0xAA}, encrypted)); err != nil {
		return err
	}
	if err := f.Truncate(int64(encrypted - macLength)); err != nil {
		return err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if _, err := f.WriteAt(plain, 0); err != nil {
		return err
	}
	return f.Truncate(int64(len(plain)))
}

// fakeLease is one generation; download scripts the transfer.
type fakeLease struct {
	gen      int
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	retired  bool
	download func(ctx context.Context, d Descriptor, f File) error
}

func (l *fakeLease) Context() context.Context { return l.ctx }
func (l *fakeLease) Download(ctx context.Context, d Descriptor, f File) error {
	return l.download(ctx, d, f)
}
func (l *fakeLease) Publish(fn func() error) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.retired {
		return ErrRetired
	}
	return fn()
}
func (l *fakeLease) retire() {
	l.mu.Lock()
	l.retired = true
	l.mu.Unlock()
	l.cancel()
}

type admission struct {
	gen       int
	connected bool
}

type fakeNetwork struct {
	mu      sync.Mutex
	current *fakeLease
	gen     int
	calls   int
	account string
	script  func(ctx context.Context, d Descriptor, f File) error
}

func newNetwork(script func(ctx context.Context, d Descriptor, f File) error) *fakeNetwork {
	n := &fakeNetwork{account: testAccount, script: script}
	n.connect()
	return n
}

func (n *fakeNetwork) connect() *fakeLease {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.gen++
	ctx, cancel := context.WithCancel(context.Background())
	lease := &fakeLease{gen: n.gen, ctx: ctx, cancel: cancel}
	lease.download = func(ctx context.Context, d Descriptor, f File) error {
		n.mu.Lock()
		n.calls++
		script := n.script
		n.mu.Unlock()
		return script(ctx, d, f)
	}
	n.current = lease
	return lease
}

func (n *fakeNetwork) disconnect() {
	n.mu.Lock()
	lease := n.current
	n.current = nil
	n.mu.Unlock()
	if lease != nil {
		lease.retire()
	}
}

func (n *fakeNetwork) networkCalls() int { n.mu.Lock(); defer n.mu.Unlock(); return n.calls }

func (n *fakeNetwork) Admit() any {
	n.mu.Lock()
	defer n.mu.Unlock()
	return admission{gen: n.gen, connected: n.current != nil}
}

func (n *fakeNetwork) Acquire(admitted any, accountID string) (Lease, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.current == nil || accountID != n.account {
		return nil, ErrNotConnected
	}
	if a, ok := admitted.(admission); ok && a.connected && a.gen != n.current.gen {
		return nil, ErrNotConnected
	}
	return n.current, nil
}

// manualClock fires After timers only when advanced.
type manualClock struct {
	mu     sync.Mutex
	timers []chan time.Time
	asked  []time.Duration
	signal chan struct{}
}

func newClock() *manualClock { return &manualClock{signal: make(chan struct{}, 16)} }
func (c *manualClock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan time.Time, 1)
	c.timers = append(c.timers, ch)
	c.asked = append(c.asked, d)
	c.signal <- struct{}{}
	return ch
}
func (c *manualClock) fireAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, ch := range c.timers {
		select {
		case ch <- time.Time{}:
		default:
		}
	}
}
func (c *manualClock) waitTimer(t testing.TB) {
	t.Helper()
	select {
	case <-c.signal:
	case <-time.After(5 * time.Second):
		t.Fatal("no timer was scheduled")
	}
}

// faultyFS wraps the real filesystem and fails selected operations.
type faultyFS struct {
	osFS
	mu          sync.Mutex
	removeError func(path string) error
	renameError error
	readError   error
	dirError    func(path string) error
}

func (f *faultyFS) ReadDir(path string) ([]fs.DirEntry, error) {
	if f.dirError != nil {
		if err := f.dirError(path); err != nil {
			return nil, err
		}
	}
	return f.osFS.ReadDir(path)
}

func (f *faultyFS) Remove(path string) error {
	f.mu.Lock()
	hook := f.removeError
	f.mu.Unlock()
	if hook != nil {
		if err := hook(path); err != nil {
			return err
		}
	}
	return f.osFS.Remove(path)
}
func (f *faultyFS) Rename(a, b string) error {
	if f.renameError != nil {
		return f.renameError
	}
	return f.osFS.Rename(a, b)
}
func (f *faultyFS) Open(path string) (io.ReadCloser, error) {
	if f.readError != nil {
		return nil, f.readError
	}
	return f.osFS.Open(path)
}
func (f *faultyFS) setRemove(hook func(string) error) {
	f.mu.Lock()
	f.removeError = hook
	f.mu.Unlock()
}

func permission(path string) error {
	return &fs.PathError{Op: "remove", Path: path, Err: fs.ErrPermission}
}

func openService(t testing.TB, dir string, limit int64, filesystem FS, clock Clock, network Network) *Service {
	t.Helper()
	service, err := Open(Options{Dir: dir, LimitBytes: limit, FS: filesystem, Clock: clock})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if network != nil {
		service.SetNetwork(network)
	}
	return service
}

func serving(plain []byte) func(context.Context, Descriptor, File) error {
	return func(_ context.Context, _ Descriptor, f File) error { return simulate(f, plain) }
}

func files(t testing.TB, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, filepath.Base(e.Name()))
	}
	return names
}
