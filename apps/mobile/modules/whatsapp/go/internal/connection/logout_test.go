package connection

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"yoyos-whatsapp/internal/protocolstore"
)

// unlinkTransport is a controlled transport whose remote unlink the test decides.
type unlinkTransport struct {
	*testTransport
	calls  atomic.Int32
	logout func(context.Context) error
}

func (t *unlinkTransport) Logout(ctx context.Context) error {
	t.calls.Add(1)
	return t.logout(ctx)
}

func newUnlinkTransport(logout func(context.Context) error) *unlinkTransport {
	return &unlinkTransport{testTransport: newTransport(), logout: logout}
}

func connectedController(t *testing.T, transport Transport) (*Controller, *testClock, chan Event, chan<- TransportEvent) {
	t.Helper()
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 16)}
	events := make(chan Event, 32)
	c := New(func() (Transport, error) { return transport, nil }, func(e Event) { events <- e }, clock)
	t.Cleanup(func() { c.Close() })
	c.Prepare(true)
	if code := c.Connect(); code != "" {
		t.Fatal(code)
	}
	var channel chan<- TransportEvent
	switch tr := transport.(type) {
	case *unlinkTransport:
		channel = started(t, tr.testTransport)
	case *quietTransport:
		channel = started(t, tr.testTransport)
	case *testTransport:
		channel = started(t, tr)
	}
	channel <- TransportEvent{Kind: "connected"}
	for c.State() != Connected {
		time.Sleep(time.Millisecond)
	}
	return c, clock, events, channel
}

func logoutAsync(c *Controller, prepare func() error) <-chan LogoutResult {
	done := make(chan LogoutResult, 1)
	go func() { done <- c.Logout(prepare) }()
	return done
}

func resultOf(t *testing.T, done <-chan LogoutResult) LogoutResult {
	t.Helper()
	select {
	case result := <-done:
		return result
	case <-time.After(2 * time.Second):
		t.Fatal("logout did not finish")
		return LogoutResult{}
	}
}

// IT-OUT-01: reception stops before the unlink is requested, and the confirmed result is reported.
func TestITOUT01StopsGenerationThenRequestsUnlink(t *testing.T) {
	var transport *unlinkTransport
	transport = newUnlinkTransport(func(context.Context) error {
		select {
		case <-transport.stopped:
			t.Error("the socket was closed before the unlink was requested")
		default:
		}
		return nil
	})
	c, _, _, _ := connectedController(t, transport)
	result := resultOf(t, logoutAsync(c, nil))
	if result.Err != nil || !result.Confirmed || transport.calls.Load() != 1 {
		t.Fatalf("%+v calls=%d", result, transport.calls.Load())
	}
	select {
	case <-transport.stopped:
	case <-time.After(time.Second):
		t.Fatal("transport left open after the unlink")
	}
	if c.State() != Disconnected {
		t.Fatalf("state %s", c.State())
	}
}

// IT-OUT-02: without a remote answer within 15 s the local retirement proceeds as unconfirmed.
func TestITOUT02UnconfirmedAfterFifteenSecondsWithoutAnError(t *testing.T) {
	transport := newUnlinkTransport(func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() })
	c, clock, _, _ := connectedController(t, transport)
	done := logoutAsync(c, nil)
	for deadline := time.Now().Add(time.Second); !clock.hasWait(LogoutTimeout) && time.Now().Before(deadline); {
		time.Sleep(time.Millisecond)
	}
	if LogoutTimeout != 15*time.Second || !clock.hasWait(LogoutTimeout) {
		t.Fatal("no 15 second unlink deadline")
	}
	clock.Advance(LogoutTimeout)
	result := resultOf(t, done)
	if result.Err != nil || result.Confirmed {
		t.Fatalf("%+v", result)
	}
	select {
	case <-transport.stopped:
	case <-time.After(time.Second):
		t.Fatal("transport left open after the timeout")
	}
}

// IT-OUT-02: a refused unlink and a transport that cannot unlink are both unconfirmed, never confirmed.
func TestITOUT02RefusedOrUnsupportedUnlinkIsUnconfirmed(t *testing.T) {
	refused := newUnlinkTransport(func(context.Context) error { return errors.New("not connected") })
	c, _, _, _ := connectedController(t, refused)
	if result := resultOf(t, logoutAsync(c, nil)); result.Err != nil || result.Confirmed {
		t.Fatalf("refused: %+v", result)
	}
	plain := newTransport()
	c, _, _, _ = connectedController(t, plain)
	if result := resultOf(t, logoutAsync(c, nil)); result.Err != nil || result.Confirmed {
		t.Fatalf("unsupported: %+v", result)
	}
}

// IT-OUT-05: simultaneous calls share one unlink and one result; a repeat is a local success
// that certifies nothing remote and requests nothing.
func TestITOUT05ConcurrentLogoutSharesResultAndRepeatIsIdempotent(t *testing.T) {
	release := make(chan struct{})
	transport := newUnlinkTransport(func(context.Context) error { <-release; return nil })
	c, _, _, _ := connectedController(t, transport)
	first := logoutAsync(c, nil)
	for transport.calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	second := logoutAsync(c, nil)
	time.Sleep(20 * time.Millisecond)
	close(release)
	a, b := resultOf(t, first), resultOf(t, second)
	if a != b || !a.Confirmed || transport.calls.Load() != 1 {
		t.Fatalf("%+v %+v calls=%d", a, b, transport.calls.Load())
	}
	if again := c.Logout(nil); again.Err != nil || again.Confirmed || !again.Repeat || transport.calls.Load() != 1 {
		t.Fatalf("repeat: %+v calls=%d", again, transport.calls.Load())
	}
}

// UT-CON-10: connect, disconnect and logout are admitted in order; the generation retired by
// the logout drops late events, and nothing waits for a future consumer commit.
func TestUTCON10AdmissionOrderAndGenerationRetirement(t *testing.T) {
	release := make(chan struct{})
	transport := newUnlinkTransport(func(context.Context) error { <-release; return nil })
	c, _, events, channel := connectedController(t, transport)
	for len(events) > 0 {
		<-events
	}
	logout := logoutAsync(c, nil)
	for transport.calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	var order []string
	var mu sync.Mutex
	note := func(name string) { mu.Lock(); order = append(order, name); mu.Unlock() }
	var wg sync.WaitGroup
	wg.Add(2)
	var connectCode Code
	go func() { defer wg.Done(); connectCode = c.Connect(); note("connect") }()
	go func() { defer wg.Done(); c.Disconnect(); note("disconnect") }()
	time.Sleep(30 * time.Millisecond)
	mu.Lock()
	if len(order) != 0 {
		t.Fatalf("admissions did not wait for the logout: %v", order)
	}
	mu.Unlock()
	select { // a late event of the retired generation never reaches the app
	case channel <- TransportEvent{Kind: "qr", QR: "late", ExpiresAt: time.Unix(0, 0).Add(time.Minute)}:
	default:
	}
	close(release)
	wg.Wait()
	resultOf(t, logout)
	if connectCode != SessionStateInvalid {
		t.Fatalf("connect after logout returned %q", connectCode)
	}
	for len(events) > 0 {
		if event := <-events; event.QR != "" || event.State == AwaitingQR || event.State == Connecting {
			t.Fatalf("event of a retired generation: %+v", event)
		}
	}
}

// IT-OUT-03: when the identity mappings cannot be made durable, nothing is unlinked or
// retired; the stopped connection can be requested again.
func TestITOUT03FailedPreparationKeepsCredentialsAndNeverUnlinks(t *testing.T) {
	transport := newUnlinkTransport(func(context.Context) error { return nil })
	c, _, _, _ := connectedController(t, transport)
	failure := errors.New("storage failed")
	result := resultOf(t, logoutAsync(c, func() error { return failure }))
	if !errors.Is(result.Err, failure) || result.Confirmed || transport.calls.Load() != 0 {
		t.Fatalf("%+v calls=%d", result, transport.calls.Load())
	}
	if code := c.Connect(); code == SessionStateInvalid {
		t.Fatal("a failed logout must not retire the session")
	}
}

// Revocation by the server only reports sessionExpired: credentials are never removed by it.
func TestRevocationNeverRequestsUnlinkOrRetirement(t *testing.T) {
	transport := newUnlinkTransport(func(context.Context) error { return nil })
	c, _, events, channel := connectedController(t, transport)
	channel <- TransportEvent{Kind: "revoked"}
	for c.State() != SessionExpired {
		time.Sleep(time.Millisecond)
	}
	if transport.calls.Load() != 0 || c.Connect() != SessionExpiredError {
		t.Fatal("revocation touched the unlink path or allowed relinking")
	}
	_ = events
	if result := resultOf(t, logoutAsync(c, nil)); result.Err != nil || result.Confirmed || transport.calls.Load() != 0 {
		t.Fatalf("logout of a revoked session: %+v", result)
	}
}

// IT-OUT-01/02 over the pinned client: Client.Logout deletes the device only after the server accepted
// the unlink, and the container refuses that deletion; only that refusal confirms the unlink.
func TestITOUT01ContainerRefusalAfterServerAcceptanceConfirms(t *testing.T) {
	refusal := &protocolstore.Error{Code: protocolstore.NativeLogoutRequired, Message: "native owns retirement"}
	for name, unlink := range map[string]error{
		"accepted":        nil,
		"refusal":         refusal,
		"wrapped refusal": fmt.Errorf("error deleting data from store: %w", refusal),
	} {
		if err := confirmedUnlink(unlink); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	for name, unlink := range map[string]error{
		"not connected":   errors.New("error sending logout request: websocket not connected"),
		"not logged in":   whatsmeow.ErrNotLoggedIn,
		"storage failure": &protocolstore.Error{Code: protocolstore.StorageFailed},
		"timeout":         context.DeadlineExceeded,
	} {
		if confirmedUnlink(unlink) == nil {
			t.Fatalf("%s was reported as confirmed", name)
		}
	}
	transport := &whatsmeowTransport{unlink: func(context.Context) error { return refusal }}
	if err := transport.Logout(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func (c *testClock) hasWait(d time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, wait := range c.waits {
		if wait.duration == d {
			return true
		}
	}
	return false
}

// M2: without a live socket (never connected, after a restart, backing off, after disconnect) the
// unlink is still requested, through a connection made for it within the same 15 seconds.
func TestM2UnlinkIsRequestedThroughAConnectionMadeForIt(t *testing.T) {
	transport := newUnlinkTransport(func(context.Context) error { return nil })
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 16)}
	c := New(func() (Transport, error) {
		t.Error("the receiving transport must not be built to unlink")
		return nil, errors.New("no")
	}, func(Event) {}, clock)
	t.Cleanup(func() { c.Close() })
	c.SetUnlinkTransport(func() (Transport, error) { return transport, nil })
	c.Prepare(true)
	result := c.Logout(nil)
	if result.Err != nil || !result.Confirmed || transport.calls.Load() != 1 {
		t.Fatalf("%+v calls=%d", result, transport.calls.Load())
	}
	select {
	case <-transport.stopped:
	default:
		t.Fatal("the unlink connection was left open")
	}
}

// M2: a connection that cannot be made or authenticated in time is unconfirmed, not an error.
func TestM2UnlinkConnectionFailureOrTimeoutIsUnconfirmed(t *testing.T) {
	c := New(func() (Transport, error) { return nil, errors.New("no") }, func(Event) {}, nil)
	t.Cleanup(func() { c.Close() })
	c.SetUnlinkTransport(func() (Transport, error) { return nil, errors.New("cannot build") })
	c.Prepare(true)
	if result := c.Logout(nil); result.Err != nil || result.Confirmed || result.Repeat {
		t.Fatalf("%+v", result)
	}
	hang := newUnlinkTransport(func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() })
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 16)}
	c = New(func() (Transport, error) { return nil, errors.New("no") }, func(Event) {}, clock)
	t.Cleanup(func() { c.Close() })
	c.SetUnlinkTransport(func() (Transport, error) { return hang, nil })
	c.Prepare(true)
	done := logoutAsync(c, nil)
	for !clock.hasWait(LogoutTimeout) {
		time.Sleep(time.Millisecond)
	}
	clock.Advance(LogoutTimeout)
	if result := resultOf(t, done); result.Err != nil || result.Confirmed {
		t.Fatalf("%+v", result)
	}
}

// M2: a session the server already revoked is not reconnected just to unlink it.
func TestM2RevokedSessionDoesNotReconnectToUnlink(t *testing.T) {
	transport := newUnlinkTransport(func(context.Context) error { return nil })
	c, _, _, channel := connectedController(t, transport)
	c.SetUnlinkTransport(func() (Transport, error) { t.Error("revoked session reconnected"); return nil, errors.New("no") })
	channel <- TransportEvent{Kind: "revoked"}
	for c.State() != SessionExpired {
		time.Sleep(time.Millisecond)
	}
	if result := c.Logout(nil); result.Confirmed || result.Err != nil {
		t.Fatalf("%+v", result)
	}
}

type quietTransport struct {
	*unlinkTransport
	quiesced atomic.Int32
}

func (q *quietTransport) Quiesce() { q.quiesced.Add(1) }

// m1: while the unlink is pending the live socket stops acknowledging; the transport is told first.
func TestM1LiveTransportIsQuiescedBeforeMappingsAndUnlink(t *testing.T) {
	var transport *quietTransport
	transport = &quietTransport{unlinkTransport: newUnlinkTransport(func(context.Context) error {
		if transport.quiesced.Load() != 1 {
			t.Error("unlink requested before the transport stopped acknowledging")
		}
		return nil
	})}
	c, _, _, _ := connectedController(t, transport)
	prepared := false
	result := c.Logout(func() error {
		prepared = transport.quiesced.Load() == 1
		return nil
	})
	if result.Err != nil || !prepared {
		t.Fatalf("%+v prepared=%v", result, prepared)
	}
}
