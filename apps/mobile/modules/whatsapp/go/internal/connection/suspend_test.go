package connection

import (
	"sync"
	"testing"
	"time"
)

// IT-IOS-01 at the controller: suspending ends the generation and resuming starts exactly one new
// attempt with fresh deadlines; nothing late from the suspended generation is published.
type suspendRig struct {
	c       *Controller
	clock   *testClock
	events  chan Event
	mu      sync.Mutex
	made    []*testTransport
	creates int
}

func newSuspendRig(t *testing.T, paired bool) *suspendRig {
	t.Helper()
	r := &suspendRig{clock: &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 32)}, events: make(chan Event, 64)}
	r.c = New(func() (Transport, error) {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.creates++
		transport := newTransport()
		r.made = append(r.made, transport)
		return transport, nil
	}, func(e Event) { r.events <- e }, r.clock)
	t.Cleanup(func() { r.c.Close() })
	r.c.Prepare(paired)
	return r
}
func (r *suspendRig) transport(i int) *testTransport {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.made[i]
}
func (r *suspendRig) createCount() int { r.mu.Lock(); defer r.mu.Unlock(); return r.creates }
func (r *suspendRig) nextState(t *testing.T, want State) {
	t.Helper()
	for {
		if e := receive(t, r.events); e.State == want {
			return
		}
	}
}
func (r *suspendRig) noEvent(t *testing.T) {
	t.Helper()
	select {
	case e := <-r.events:
		t.Fatalf("unexpected event after suspension: %+v", e)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestITIOS01SuspendStopsTheGenerationAndLateResultsAreDiscarded(t *testing.T) {
	r := newSuspendRig(t, true)
	r.c.Connect()
	old := started(t, r.transport(0))
	old <- TransportEvent{Kind: "connected"}
	r.nextState(t, Connected)
	r.c.Suspend()
	r.nextState(t, Disconnected)
	select {
	case <-r.transport(0).stopped:
	case <-time.After(time.Second):
		t.Fatal("suspend left the socket open")
	}
	if lease := r.c.AdmitMedia(); lease.Connected {
		t.Fatal("a suspended controller admits downloads as connected")
	}
	// The suspended generation reports late: a connection, a QR and a failure.
	for _, late := range []TransportEvent{{Kind: "connected"}, {Kind: "qr", QR: "late", ExpiresAt: r.clock.Now().Add(time.Minute)}, {Kind: "networkFailure"}} {
		select {
		case old <- late:
		default:
		}
	}
	r.noEvent(t)
	if r.c.State() != Disconnected || r.createCount() != 1 {
		t.Fatalf("late result changed state %s or built a client (%d)", r.c.State(), r.createCount())
	}
}

func TestITIOS01ResumeStartsOneFreshAttemptAndIsIdempotent(t *testing.T) {
	r := newSuspendRig(t, true)
	r.c.Connect()
	started(t, r.transport(0)) <- TransportEvent{Kind: "connected"}
	r.nextState(t, Connected)
	r.c.Suspend()
	r.c.Suspend()
	r.nextState(t, Disconnected)
	r.clock.Advance(10 * time.Minute) // the app stayed suspended well past every old deadline
	if code := r.c.Resume(); code != "" {
		t.Fatal(code)
	}
	if code := r.c.Resume(); code != "" {
		t.Fatal(code)
	}
	r.nextState(t, Reconnecting)
	next := started(t, r.transport(1))
	if r.createCount() != 2 {
		t.Fatalf("clients built: %d", r.createCount())
	}
	if r.clock.LastDuration() != 30*time.Second {
		t.Fatalf("connection deadline not renewed: %v", r.clock.LastDuration())
	}
	next <- TransportEvent{Kind: "connected"}
	r.nextState(t, Connected)
}

func TestITIOS01SuspendedQRIsNotCurrentAndUnpairedResumeConnectsAgain(t *testing.T) {
	r := newSuspendRig(t, false)
	r.c.Connect()
	started(t, r.transport(0)) <- TransportEvent{Kind: "qr", QR: "first", ExpiresAt: r.clock.Now().Add(time.Minute)}
	r.nextState(t, AwaitingQR)
	r.c.Suspend()
	if _, ok := r.c.CurrentQR(); ok {
		t.Fatal("a suspended QR is still offered")
	}
	r.c.Resume()
	r.nextState(t, Connecting)
	started(t, r.transport(1)) <- TransportEvent{Kind: "qr", QR: "second", ExpiresAt: r.clock.Now().Add(time.Minute)}
	r.nextState(t, AwaitingQR)
	if qr, ok := r.c.CurrentQR(); !ok || qr.QR != "second" {
		t.Fatalf("new attempt did not offer its own QR: %+v", qr)
	}
}

func TestITIOS01ExpiredSuspendedQRIsNotRestored(t *testing.T) {
	r := newSuspendRig(t, false)
	r.c.Connect()
	started(t, r.transport(0)) <- TransportEvent{Kind: "qr", QR: "stale", ExpiresAt: r.clock.Now().Add(20 * time.Second)}
	r.nextState(t, AwaitingQR)
	r.c.Suspend()
	r.clock.Advance(time.Minute)
	r.c.Resume()
	if _, ok := r.c.CurrentQR(); ok {
		t.Fatal("an expired QR came back after resuming")
	}
}

func TestITIOS01DisconnectOrConnectWhileSuspendedCancelsResume(t *testing.T) {
	r := newSuspendRig(t, true)
	r.c.Connect()
	started(t, r.transport(0))
	r.c.Suspend()
	r.c.Disconnect()
	if code := r.c.Resume(); code != "" || r.createCount() != 1 || r.c.State() != Disconnected {
		t.Fatalf("resume after an explicit disconnect reconnected: %q creates=%d", code, r.createCount())
	}
	r.c.Connect()
	started(t, r.transport(1))
	r.c.Suspend()
	r.c.Connect() // the app asked again before resuming
	started(t, r.transport(2))
	if r.c.Resume() != "" || r.createCount() != 3 {
		t.Fatalf("resume duplicated the client: creates=%d", r.createCount())
	}
}

func TestITIOS01ResumeReplacedWhileBuildingDiscardsItsClient(t *testing.T) {
	building, release := make(chan struct{}), make(chan struct{})
	var mu sync.Mutex
	var made []*testTransport
	count := 0
	c := New(func() (Transport, error) {
		mu.Lock()
		count++
		n := count
		transport := newTransport()
		made = append(made, transport)
		mu.Unlock()
		if n == 2 { // the attempt built by Resume
			close(building)
			<-release
		}
		return transport, nil
	}, func(Event) {}, nil)
	defer c.Close()
	c.Prepare(true)
	c.Connect()
	started(t, made[0])
	c.Suspend()
	done := make(chan Code, 1)
	go func() { done <- c.Resume() }()
	<-building
	c.Disconnect()
	close(release)
	if code := <-done; code != "" {
		t.Fatal(code)
	}
	mu.Lock()
	late := made[1]
	mu.Unlock()
	select {
	case <-late.stopped:
	case <-time.After(time.Second):
		t.Fatal("the replaced attempt's client stays open")
	}
	if c.State() != Disconnected {
		t.Fatal(c.State())
	}
}

func TestITIOS01ResumeReportsRevokedSessionAndLocalFaults(t *testing.T) {
	r := newSuspendRig(t, true)
	r.c.Connect()
	started(t, r.transport(0))
	r.c.Suspend()
	r.c.MarkRevoked()
	if code := r.c.Resume(); code != SessionExpiredError || r.createCount() != 1 {
		t.Fatalf("revoked session resumed: %q", code)
	}
	r2 := newSuspendRig(t, true)
	r2.c.Connect()
	started(t, r2.transport(0))
	r2.c.Suspend()
	r2.c.FailLocal(SessionStorageFailed)
	// The fault was reported when it happened and ends the pending resume.
	if code := r2.c.Resume(); code != "" || r2.createCount() != 1 || r2.c.State() != Disconnected {
		t.Fatalf("local fault resumed: %q", code)
	}
	if code := r2.c.Connect(); code != SessionStorageFailed {
		t.Fatalf("fault not kept: %q", code)
	}
}

func TestITIOS01ResumeWithoutSuspendOrRequestDoesNothing(t *testing.T) {
	r := newSuspendRig(t, true)
	r.c.Suspend() // nothing was requested
	if r.c.Resume() != "" || r.createCount() != 0 || r.c.State() != Disconnected {
		t.Fatal("resume invented a connection")
	}
	r.c.Connect()
	started(t, r.transport(0))
	if r.c.Resume() != "" || r.createCount() != 1 {
		t.Fatal("resume without suspension rebuilt a live client")
	}
}

func TestITIOS01CapacityPausedConnectionResumesOncePerSuspension(t *testing.T) {
	r := newSuspendRig(t, true)
	r.c.Connect()
	started(t, r.transport(0))
	r.c.PauseForCapacity()
	r.c.Suspend()
	r.c.ResumeCapacity() // freeing space while suspended must not start a client
	if r.createCount() != 1 {
		t.Fatal("capacity resume started a client while suspended")
	}
	r.c.Resume()
	started(t, r.transport(1))
	if r.createCount() != 2 {
		t.Fatalf("creates=%d", r.createCount())
	}
}

func TestITIOS01SuspendDuringBackoffCancelsTheRetry(t *testing.T) {
	r := newSuspendRig(t, true)
	r.c.Connect()
	started(t, r.transport(0)) <- TransportEvent{Kind: "networkFailure"}
	r.nextState(t, Reconnecting)
	r.c.Suspend()
	r.nextState(t, Disconnected)
	r.clock.Advance(time.Minute)
	r.noEvent(t)
	if r.createCount() != 1 {
		t.Fatalf("backoff retry survived suspension: %d clients", r.createCount())
	}
}
