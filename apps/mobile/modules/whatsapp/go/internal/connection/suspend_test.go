package connection

import (
	"errors"
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

// Minor 1: a Suspend that arrives while Resume builds its attempt wins; the app is not connected.
func TestITIOS01SuspendDuringResumeBuildKeepsTheAppSuspended(t *testing.T) {
	building, release := make(chan struct{}), make(chan struct{})
	var mu sync.Mutex
	var made []*testTransport
	c := New(func() (Transport, error) {
		mu.Lock()
		transport := newTransport()
		made = append(made, transport)
		n := len(made)
		mu.Unlock()
		if n == 2 {
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
	c.Suspend()
	close(release)
	<-done
	mu.Lock()
	late := made[1]
	mu.Unlock()
	select {
	case <-late.stopped:
	case <-time.After(time.Second):
		t.Fatal("the attempt built before the second suspension stays open")
	}
	if c.State() != Disconnected {
		t.Fatalf("a suspended app connected: %s", c.State())
	}
	if c.Resume() != "" {
		t.Fatal("the second suspension was not owed a resume")
	}
	started(t, made[2])
}

// Minor 2: a failed attempt is reported once, as an event; Resume itself returns no code.
func TestITIOS01ResumeCreateFailureIsReportedOnce(t *testing.T) {
	events := make(chan Event, 16)
	fail := false
	c := New(func() (Transport, error) {
		if fail {
			return nil, errors.New("build failed")
		}
		return newTransport(), nil
	}, func(e Event) { events <- e }, nil)
	defer c.Close()
	c.Prepare(true)
	c.Connect()
	c.Suspend()
	fail = true
	if code := c.Resume(); code != "" {
		t.Fatalf("resume returned %q besides publishing the event", code)
	}
	failures := 0
	for deadline := time.After(100 * time.Millisecond); ; {
		select {
		case e := <-events:
			if e.Error == ConnectionFailed {
				failures++
			}
			continue
		case <-deadline:
		}
		break
	}
	if failures != 1 {
		t.Fatalf("CONNECTION_FAILED published %d times", failures)
	}
}

// Minor 3: a pause for recovery capacity survives suspension and ends only when capacity returns.
func TestITIOS01ResumeRespectsTheCapacityPause(t *testing.T) {
	r := newSuspendRig(t, true)
	r.c.Connect()
	started(t, r.transport(0))
	r.c.PauseForCapacity()
	r.c.Suspend()
	if code := r.c.Resume(); code != "" || r.createCount() != 1 {
		t.Fatalf("resume connected while the buffer is still full: %q creates=%d", code, r.createCount())
	}
	r.c.ResumeCapacity()
	started(t, r.transport(1))
	if r.createCount() != 2 {
		t.Fatalf("creates=%d", r.createCount())
	}
}

// Minor 5: an attempt built by ResumeCapacity that lost its generation is stopped.
func TestResumeCapacityStopsADiscardedTransport(t *testing.T) {
	building, release := make(chan struct{}), make(chan struct{})
	var mu sync.Mutex
	var made []*testTransport
	c := New(func() (Transport, error) {
		mu.Lock()
		transport := newTransport()
		made = append(made, transport)
		n := len(made)
		mu.Unlock()
		if n == 2 {
			close(building)
			<-release
		}
		return transport, nil
	}, func(Event) {}, nil)
	defer c.Close()
	c.Prepare(true)
	c.Connect()
	started(t, made[0])
	c.PauseForCapacity()
	go c.ResumeCapacity()
	<-building
	c.Disconnect()
	close(release)
	mu.Lock()
	late := made[1]
	mu.Unlock()
	select {
	case <-late.stopped:
	case <-time.After(time.Second):
		t.Fatal("discarded transport left open")
	}
}

// Every interleaving of two lifecycle operations, from each starting state, keeps the machine
// coherent: at most one live client, a live client exactly while a connection is requested, and
// the machine is never wedged (Disconnect always ends it, then Connect starts one client again).
type modelOp string

const (
	opConnect    modelOp = "connect"
	opDisconnect modelOp = "disconnect"
	opSuspend    modelOp = "suspend"
	opResume     modelOp = "resume"
)

type modelRig struct {
	c       *Controller
	mu      sync.Mutex
	made    []*testTransport
	gate    chan struct{} // when set, create blocks on it (after registering the transport)
	entered chan struct{}
}

func (m *modelRig) live() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, transport := range m.made {
		select {
		case <-transport.stopped:
		default:
			n++
		}
	}
	return n
}

func (m *modelRig) apply(op modelOp) {
	switch op {
	case opConnect:
		m.c.Connect()
	case opDisconnect:
		m.c.Disconnect()
	case opSuspend:
		m.c.Suspend()
	case opResume:
		m.c.Resume()
	}
}

func (m *modelRig) requested() bool {
	m.c.mu.Lock()
	defer m.c.mu.Unlock()
	return m.c.requested
}

func newModelRig(t *testing.T) *modelRig {
	m := &modelRig{}
	m.c = New(func() (Transport, error) {
		transport := newTransport()
		m.mu.Lock()
		m.made = append(m.made, transport)
		gate, entered := m.gate, m.entered
		m.mu.Unlock()
		if gate != nil {
			entered <- struct{}{}
			<-gate
		}
		return transport, nil
	}, func(Event) {}, nil)
	t.Cleanup(func() { m.c.Close() })
	m.c.Prepare(true)
	return m
}

func (m *modelRig) check(t *testing.T, label string) {
	t.Helper()
	live, requested := m.live(), m.requested()
	if live > 1 || (live == 1) != requested {
		t.Fatalf("%s: live clients=%d requested=%v state=%s", label, live, requested, m.c.State())
	}
	m.c.Disconnect()
	if m.live() != 0 || m.c.State() != Disconnected {
		t.Fatalf("%s: disconnect did not end the machine (live=%d state=%s)", label, m.live(), m.c.State())
	}
	m.c.Connect()
	if m.live() != 1 || !m.requested() {
		t.Fatalf("%s: machine wedged, connect gives %d clients", label, m.live())
	}
}

func TestITIOS01EveryPairOfLifecycleOperationsStaysCoherent(t *testing.T) {
	ops := []modelOp{opConnect, opDisconnect, opSuspend, opResume}
	for _, start := range []string{"idle", "connected", "suspended", "building"} {
		for _, first := range ops {
			for _, second := range ops {
				label := start + "/" + string(first) + "+" + string(second)
				t.Run(label, func(t *testing.T) {
					m := newModelRig(t)
					var building chan struct{}
					switch start {
					case "connected":
						m.c.Connect()
					case "suspended":
						m.c.Connect()
						m.c.Suspend()
					case "building":
						m.c.Connect()
						m.c.Suspend()
						m.mu.Lock()
						m.gate, m.entered = make(chan struct{}), make(chan struct{}, 1)
						building = m.gate
						m.mu.Unlock()
						go m.c.Resume()
						<-m.entered
						m.mu.Lock()
						m.gate = nil // Resume holds its own copy; Connect builds under the controller lock
						m.mu.Unlock()
					}
					m.apply(first)
					m.apply(second)
					if building != nil {
						close(building)
						// Resume finishes after both operations; give its locked tail time to run.
						time.Sleep(20 * time.Millisecond)
					}
					m.check(t, label)
				})
			}
		}
	}
}

// The reported failure needs three operations (Resume building, Connect, Suspend): chain three.
func TestITIOS01EveryTripleStartingFromABuildingResumeStaysCoherent(t *testing.T) {
	ops := []modelOp{opConnect, opDisconnect, opSuspend, opResume}
	for _, first := range ops {
		for _, second := range ops {
			for _, third := range ops {
				label := "building/" + string(first) + "+" + string(second) + "+" + string(third)
				t.Run(label, func(t *testing.T) {
					m := newModelRig(t)
					m.c.Connect()
					m.c.Suspend()
					gate := make(chan struct{})
					m.mu.Lock()
					m.gate, m.entered = gate, make(chan struct{}, 1)
					m.mu.Unlock()
					go m.c.Resume()
					<-m.entered
					m.mu.Lock()
					m.gate = nil
					m.mu.Unlock()
					m.apply(first)
					m.apply(second)
					m.apply(third)
					close(gate)
					time.Sleep(20 * time.Millisecond)
					m.check(t, label)
				})
			}
		}
	}
}

// The reported case: Connect wins while Resume builds, then the app is suspended again.
func TestITIOS01ConnectDuringResumeBuildThenSuspendClosesTheSocket(t *testing.T) {
	m := newModelRig(t)
	m.c.Connect()
	m.c.Suspend()
	gate := make(chan struct{})
	m.mu.Lock()
	m.gate, m.entered = gate, make(chan struct{}, 1)
	m.mu.Unlock()
	go m.c.Resume()
	<-m.entered
	m.mu.Lock()
	m.gate = nil
	m.mu.Unlock()
	m.c.Connect()
	m.c.Suspend()
	close(gate)
	time.Sleep(20 * time.Millisecond)
	if m.live() != 0 || m.requested() || m.c.State() != Disconnected {
		t.Fatalf("socket left open in the background: live=%d state=%s", m.live(), m.c.State())
	}
	if m.c.Resume(); m.live() != 1 {
		t.Fatalf("resume after the second suspension gives %d clients", m.live())
	}
}
