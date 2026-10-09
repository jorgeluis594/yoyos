package connection

import (
	"context"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/whatsmeow/util/keys"
)

// These tests run the pinned client over real local websockets. The first-link
// device already carries an identity (as it does once pairing is stored), so the
// pinned client accepts login success; PairSuccess itself is injected through
// the client's event dispatch because pairing needs the phone's signatures.

type openAuthStore struct {
	store.PreKeyStore
	store.PrivacyTokenStore
}

func (openAuthStore) UploadedPreKeyCount(context.Context) (int, error) { return 100, nil }
func (openAuthStore) DeleteExpiredPrivacyTokens(context.Context, time.Time) (int64, error) {
	return 0, nil
}

type socketHarness struct {
	wa        *fakeWA
	transport *whatsmeowTransport
	clock     *testClock
	published chan Event
	c         *Controller
	created   int
	mu        sync.Mutex
	catCtx    chan context.Context
}

func newSocketHarness(t *testing.T, auth interface {
	store.PreKeyStore
	store.PrivacyTokenStore
}, paired bool) *socketHarness {
	t.Helper()
	h := &socketHarness{wa: newFakeWA(t), published: make(chan Event, 32), catCtx: make(chan context.Context, 4)}
	jid := types.NewJID("review", types.DefaultUserServer)
	h.transport = NewWhatsmeowTransport(&store.Device{ID: &jid, NoiseKey: keys.NewKeyPair(), PreKeys: auth, PrivacyTokens: auth}, nil).(*whatsmeowTransport)
	h.wa.point(h.transport.client)
	// RefreshCAT receives the exact context the pinned client hands to node
	// handlers of the connection that delivered the frame.
	h.transport.client.RefreshCAT = func(ctx context.Context) error { h.catCtx <- ctx; return nil }
	h.clock = &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 16)}
	h.c = New(func() (Transport, error) { h.mu.Lock(); h.created++; h.mu.Unlock(); return h.transport, nil }, func(event Event) { h.published <- event }, h.clock)
	t.Cleanup(func() { h.c.Close() })
	h.c.Prepare(paired)
	return h
}

func (h *socketHarness) connectFirstLink(t *testing.T) *fakeConn {
	t.Helper()
	if code := h.c.Connect(); code != "" {
		t.Fatal(code)
	}
	conn := h.wa.next()
	if event := receive(t, h.published); event.State != Connecting {
		t.Fatalf("connect did not start: %+v", event)
	}
	h.clock.WaitTimer(t)
	return conn
}

// pairOn marks the pairing socket authenticated by injecting PairSuccess as the
// pinned client would emit it on that socket.
func (h *socketHarness) pairOn(t *testing.T) {
	t.Helper()
	client := h.transport.client
	client.DangerousInternals().DispatchEvent(&events.PairSuccess{SocketID: client.CurrentSocketID()})
	h.clock.WaitTimer(t)
}

// oldContext captures the context the client gave this connection's handlers.
func (h *socketHarness) oldContext(t *testing.T, conn *fakeConn) context.Context {
	t.Helper()
	conn.streamError(t, "414")
	select {
	case ctx := <-h.catCtx:
		return ctx
	case <-time.After(5 * time.Second):
		t.Fatal("connection handler context not observed")
		return nil
	}
}

func (h *socketHarness) expectNothing(t *testing.T, why string) {
	t.Helper()
	select {
	case event := <-h.published:
		t.Fatalf("%s: %+v", why, event)
	case <-time.After(300 * time.Millisecond):
	}
}

func successNode() *binary.Node {
	return &binary.Node{Tag: "success", Attrs: binary.Attrs{"t": "1"}}
}

// An old success whose handler only starts after the replacement socket is
// current must keep the identity of the connection that delivered its frame.
func TestQueuedOldSuccessCannotAuthenticateReplacementSocket(t *testing.T) {
	h := newSocketHarness(t, openAuthStore{}, false)
	first := h.connectFirstLink(t)
	h.pairOn(t)
	oldCtx := h.oldContext(t, first)
	first.streamError(t, "515")
	second := h.wa.next()
	if h.transport.client.CurrentSocketID() == 0 {
		t.Fatal("replacement socket is not current")
	}
	h.transport.client.DangerousInternals().HandleConnectSuccess(oldCtx, successNode())
	h.expectNothing(t, "old success authenticated the replacement socket")
	second.success(t)
	if event := receive(t, h.published); event.State != Connected {
		t.Fatalf("replacement success was not accepted: %+v", event)
	}
}

// gatedAuthStore blocks the first post-login store read until released.
type gatedAuthStore struct {
	openAuthStore
	once             sync.Once
	entered, release chan struct{}
}

func newGatedAuthStore() *gatedAuthStore {
	return &gatedAuthStore{entered: make(chan struct{}), release: make(chan struct{})}
}

func (s *gatedAuthStore) UploadedPreKeyCount(ctx context.Context) (int, error) {
	s.once.Do(func() {
		close(s.entered)
		<-s.release
	})
	return s.openAuthStore.UploadedPreKeyCount(ctx)
}

func (h *socketHarness) expectNoSocket(t *testing.T, why string) {
	t.Helper()
	select {
	case <-h.wa.conns:
		t.Fatal(why)
	case <-time.After(300 * time.Millisecond):
	}
}

func (h *socketHarness) expectFailureAndRetry(t *testing.T, why string) {
	t.Helper()
	if event := receive(t, h.published); event.Error != ConnectionFailed {
		t.Fatalf("%s: %+v", why, event)
	}
	if event := receive(t, h.published); event.State != Reconnecting {
		t.Fatalf("%s: no retry: %+v", why, event)
	}
}

func (h *socketHarness) clients() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.created
}

// pairAndHandOff takes the first-link socket through pairing and the 515
// handoff, returning the pairing socket, the replacement and the pairing
// socket's handler context.
func (h *socketHarness) pairAndHandOff(t *testing.T) (first, second *fakeConn, oldCtx context.Context) {
	t.Helper()
	first = h.connectFirstLink(t)
	h.pairOn(t)
	oldCtx = h.oldContext(t, first)
	first.streamError(t, "515")
	second = h.wa.next()
	// IsConnected waits for the client's connect to release the socket lock, so
	// a close injected next cannot race the dependency's own socket setup.
	h.transport.client.IsConnected()
	return first, second, oldCtx
}

func TestOldInFlightSuccessCannotAuthenticateReplacementSocket(t *testing.T) {
	auth := newGatedAuthStore()
	h := newSocketHarness(t, auth, false)
	first := h.connectFirstLink(t)
	h.pairOn(t)
	first.success(t)
	<-auth.entered
	first.streamError(t, "515")
	second := h.wa.next()
	h.transport.client.IsConnected()
	close(auth.release)
	h.expectNothing(t, "success started on the pairing socket authenticated its replacement")
	second.success(t)
	if event := receive(t, h.published); event.State != Connected {
		t.Fatalf("replacement success was not accepted: %+v", event)
	}
	if h.clients() != 1 {
		t.Fatal("handoff replaced the client")
	}
}

func TestOldLoginReconnectCannotRestartReplacementSocket(t *testing.T) {
	h := newSocketHarness(t, openAuthStore{}, false)
	_, second, oldCtx := h.pairAndHandOff(t)
	h.transport.client.DangerousInternals().HandleStreamError(oldCtx, &binary.Node{Tag: "stream:error", Attrs: binary.Attrs{"code": "515"}})
	h.expectNoSocket(t, "stale 515 redialed the replacement")
	second.success(t)
	if event := receive(t, h.published); event.State != Connected {
		t.Fatalf("replacement success was not accepted: %+v", event)
	}
}

func TestDelayedPairingSocketCloseDoesNotRetireReplacement(t *testing.T) {
	h := newSocketHarness(t, openAuthStore{}, false)
	first, second, _ := h.pairAndHandOff(t)
	first.drop()
	second.success(t)
	if event := receive(t, h.published); event.State != Connected {
		t.Fatalf("handoff did not authenticate: %+v", event)
	}
	h.transport.client.DangerousInternals().DispatchEvent(&events.Disconnected{SocketID: 1})
	h.expectNothing(t, "old socket close affected the replacement")
	if h.clients() != 1 || h.c.State() != Connected {
		t.Fatal("replacement authentication was retired")
	}
}

func TestPairingSocketCloseBeforeHandoffKeepsAttempt(t *testing.T) {
	h := newSocketHarness(t, openAuthStore{}, false)
	first := h.connectFirstLink(t)
	h.pairOn(t)
	first.drop()
	h.expectNothing(t, "pairing socket close retired the attempt")
	if h.c.State() != Connecting || h.clients() != 1 {
		t.Fatal("pairing attempt was not kept")
	}
}

func TestReplacementSocketCloseDuringAuthenticationFails(t *testing.T) {
	auth := newGatedAuthStore()
	h := newSocketHarness(t, auth, false)
	_, second, _ := h.pairAndHandOff(t)
	second.success(t)
	<-auth.entered
	second.drop()
	close(auth.release)
	h.expectFailureAndRetry(t, "replacement close was ignored")
	h.expectNothing(t, "closed socket was accepted after its close")
}

func TestReplacementSocketCloseBeforeLoginFails(t *testing.T) {
	h := newSocketHarness(t, openAuthStore{}, false)
	_, second, _ := h.pairAndHandOff(t)
	second.drop()
	h.expectFailureAndRetry(t, "replacement close was ignored")
}

func TestHandoffKeepsClientAndOriginalDeadline(t *testing.T) {
	for _, mode := range []string{"within deadline", "late success", "late 515"} {
		t.Run(mode, func(t *testing.T) {
			h := newSocketHarness(t, openAuthStore{}, false)
			first := h.connectFirstLink(t)
			h.pairOn(t)
			if mode == "late 515" {
				h.clock.Advance(31 * time.Second)
			} else {
				h.clock.Advance(29 * time.Second)
			}
			first.streamError(t, "515")
			if mode == "late 515" {
				h.expectFailureAndRetry(t, "expired 515 was accepted")
				h.expectNoSocket(t, "expired 515 started another dial")
				return
			}
			second := h.wa.next()
			if h.clients() != 1 || h.c.State() != Connecting {
				t.Fatal("515 created another client or reset state")
			}
			if mode == "late success" {
				h.clock.Advance(2 * time.Second)
				second.success(t)
				h.expectFailureAndRetry(t, "expired authentication was accepted")
				return
			}
			second.success(t)
			if event := receive(t, h.published); event.State != Connected {
				t.Fatalf("515 handoff did not authenticate: %+v", event)
			}
		})
	}
}

func TestCancelDuringHandoffClosesSocketsAndIgnoresLateSuccess(t *testing.T) {
	h := newSocketHarness(t, openAuthStore{}, false)
	first, second, _ := h.pairAndHandOff(t)
	h.c.Disconnect()
	second.waitClosed(t)
	first.waitClosed(t)
	for {
		select {
		case event := <-h.published:
			if event.State == Connected {
				t.Fatalf("cancelled attempt connected: %+v", event)
			}
			continue
		case <-time.After(100 * time.Millisecond):
		}
		break
	}
	_ = second.sendNode(context.Background(), binary.Node{Tag: "success", Attrs: binary.Attrs{"t": "1"}})
	h.expectNothing(t, "late success after cancellation")
	if h.c.State() == Connected {
		t.Fatal("cancelled attempt connected")
	}
}
