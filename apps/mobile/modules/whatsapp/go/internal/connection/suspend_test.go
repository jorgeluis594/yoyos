package connection

import (
	"errors"
	"fmt"
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

// Lifecycle matrices. A reference model (what the app asked for) is replayed next to the controller:
// connect and disconnect set/clear the request and the suspension, suspend marks a requested
// connection suspended, resume lifts the suspension. After every sequence the client is live IF AND
// ONLY IF a connection is requested and not suspended, the published state agrees, and the machine
// is not wedged: connect/resume bring a client back and suspend/disconnect always remove it.
type modelOp string

const (
	opConnect    modelOp = "connect"
	opDisconnect modelOp = "disconnect"
	opSuspend    modelOp = "suspend"
	opResume     modelOp = "resume"
)

var allOps = []modelOp{opConnect, opDisconnect, opSuspend, opResume}

type modelRig struct {
	c                 *Controller
	mu                sync.Mutex
	made              []*testTransport
	gate              chan struct{} // when set, create registers its transport, announces itself and blocks
	entered           chan struct{}
	wanted, suspended bool // the reference model
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

// apply runs op on the controller and on the model.
func (m *modelRig) apply(op modelOp) {
	switch op {
	case opConnect:
		m.c.Connect()
		m.wanted, m.suspended = true, false
	case opDisconnect:
		m.c.Disconnect()
		m.wanted, m.suspended = false, false
	case opSuspend:
		m.c.Suspend()
		if m.wanted {
			m.suspended = true
		}
	case opResume:
		m.c.Resume()
		m.suspended = false
	}
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

// startBuildingResume leaves the controller suspended with a Resume blocked inside create. The
// gate is cleared right after, because Resume holds its own copy and Connect builds under the lock.
func (m *modelRig) startBuildingResume() (release func() (wait func())) {
	m.apply(opConnect)
	m.apply(opSuspend)
	gate := make(chan struct{})
	m.mu.Lock()
	m.gate, m.entered = gate, make(chan struct{}, 1)
	m.mu.Unlock()
	done := make(chan struct{})
	go func() { m.c.Resume(); close(done) }()
	<-m.entered
	m.mu.Lock()
	m.gate = nil
	m.mu.Unlock()
	m.suspended = false // Resume lifted the suspension when it began
	var once sync.Once
	return func() func() {
		once.Do(func() { close(gate) })
		return func() { <-done }
	}
}

func (m *modelRig) check(t *testing.T, label string) {
	t.Helper()
	live := m.live()
	expected := 0
	if m.wanted && !m.suspended {
		expected = 1
	}
	state := m.c.State()
	if live != expected {
		t.Fatalf("%s: live clients=%d, want %d (requested=%v suspended=%v, state=%s)", label, live, expected, m.wanted, m.suspended, state)
	}
	if running := state == Connecting || state == Reconnecting || state == Connected; running != (expected == 1) {
		t.Fatalf("%s: published state %s disagrees with %d live clients", label, state, live)
	}
	// Not wedged: the one way back to a client works, and suspension/disconnect remove it again.
	switch {
	case expected == 1:
		m.c.Suspend()
		if m.live() != 0 || m.c.State() != Disconnected {
			t.Fatalf("%s: suspend left live=%d state=%s", label, m.live(), m.c.State())
		}
		m.c.Resume()
	case m.wanted: // suspended
		m.c.Resume()
	default:
		m.c.Connect()
	}
	if m.live() != 1 {
		t.Fatalf("%s: machine wedged, recovery gives %d clients", label, m.live())
	}
	m.c.Disconnect()
	if m.live() != 0 || m.c.State() != Disconnected {
		t.Fatalf("%s: disconnect left live=%d state=%s", label, m.live(), m.c.State())
	}
}

func startState(m *modelRig, start string) {
	switch start {
	case "connected":
		m.apply(opConnect)
	case "suspended":
		m.apply(opConnect)
		m.apply(opSuspend)
	}
}

func TestITIOS01EveryPairOfLifecycleOperationsStaysCoherent(t *testing.T) {
	for _, start := range []string{"idle", "connected", "suspended"} {
		for _, first := range allOps {
			for _, second := range allOps {
				label := start + "/" + string(first) + "+" + string(second)
				t.Run(label, func(t *testing.T) {
					m := newModelRig(t)
					startState(m, start)
					m.apply(first)
					m.apply(second)
					m.check(t, label)
				})
			}
		}
	}
}

// A Resume still building when the operations run, finished after 0, 1 or 2 of them.
func TestITIOS01EveryPairWhileAResumeIsBuildingStaysCoherent(t *testing.T) {
	for _, first := range allOps {
		for _, second := range allOps {
			for released := 0; released <= 2; released++ {
				label := fmt.Sprintf("building/%s+%s/release-after-%d", first, second, released)
				t.Run(label, func(t *testing.T) {
					m := newModelRig(t)
					release := m.startBuildingResume()
					// WA-14 (PR #53 m1): Resume finishes completely before the next operation, so the interleaving the
					// label names is the one that runs, not whatever the scheduler picks.
					for i, op := range []modelOp{first, second} {
						if i == released {
							release()()
						}
						m.apply(op)
					}
					if released == 2 {
						release()()
					}
					m.check(t, label)
				})
			}
		}
	}
}

// The reported failure needs three operations (Resume building, Connect, Suspend): chain three.
func TestITIOS01EveryTripleStartingFromABuildingResumeStaysCoherent(t *testing.T) {
	for _, first := range allOps {
		for _, second := range allOps {
			for _, third := range allOps {
				for released := 0; released <= 3; released++ {
					label := fmt.Sprintf("building/%s+%s+%s/release-after-%d", first, second, third, released)
					t.Run(label, func(t *testing.T) {
						m := newModelRig(t)
						release := m.startBuildingResume()
						for i, op := range []modelOp{first, second, third} {
							if i == released {
								release()() // Resume finishes completely before the next operation (PR #53 m1)
							}
							m.apply(op)
						}
						if released == 3 {
							release()()
						}
						m.check(t, label)
					})
				}
			}
		}
	}
}

// The reported case: Connect wins while Resume builds, then the app is suspended again.
func TestITIOS01ConnectDuringResumeBuildThenSuspendClosesTheSocket(t *testing.T) {
	m := newModelRig(t)
	release := m.startBuildingResume()
	m.apply(opConnect)
	m.apply(opSuspend)
	release()()
	if m.live() != 0 || m.c.State() != Disconnected {
		t.Fatalf("socket left open in the background: live=%d state=%s", m.live(), m.c.State())
	}
	m.apply(opResume)
	if m.live() != 1 {
		t.Fatalf("resume after the second suspension gives %d clients", m.live())
	}
}
