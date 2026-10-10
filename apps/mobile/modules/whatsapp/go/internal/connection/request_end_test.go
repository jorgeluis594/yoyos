package connection

import (
	"errors"
	"testing"
	"time"
)

// WA-12 r1: every route that ends a connection request must leave RequestActive false by the time the
// consumer sees the error or the state that announces it, so the Android service never outlives the request.

// waitEnded reads events until one announces the end (a disconnected state or the given error) and checks
// the request is already inactive when it is seen.
func waitEnded(t *testing.T, c *Controller, events chan Event, want Code) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case e := <-events:
			if (want != "" && e.Error == want) || e.State == Disconnected || e.State == SessionExpired {
				if c.RequestActive() {
					t.Fatalf("event %+v seen while the request is still active", e)
				}
				if want == "" || e.Error == want {
					return
				}
			}
		case <-deadline:
			t.Fatalf("no end announced for %q", want)
		}
	}
}

func newEndController(paired bool, create func() (Transport, error)) (*Controller, chan Event) {
	events := make(chan Event, 32)
	c := New(create, func(e Event) { events <- e }, nil)
	c.Prepare(paired)
	return c, events
}

func TestWA12EndRouteResumeCapacityRebuildFailure(t *testing.T) {
	first := newTransport()
	calls := 0
	c, events := newEndController(true, func() (Transport, error) {
		calls++
		if calls == 1 {
			return first, nil
		}
		return nil, errors.New("rebuild failed")
	})
	c.Connect()
	started(t, first)
	c.PauseForCapacity()
	if !c.RequestActive() {
		t.Fatal("pause must keep the request")
	}
	c.ResumeCapacity()
	waitEnded(t, c, events, ConnectionFailed)
}

func TestWA12EndRouteRetryRebuildFailure(t *testing.T) {
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 8)}
	first := newTransport()
	calls := 0
	events := make(chan Event, 32)
	c := New(func() (Transport, error) {
		calls++
		if calls == 1 {
			return first, nil
		}
		return nil, errors.New("rebuild failed")
	}, func(e Event) { events <- e }, clock)
	c.Prepare(true)
	c.Connect()
	channel := started(t, first)
	clock.WaitTimer(t)
	channel <- TransportEvent{Kind: "networkFailure"}
	clock.WaitTimer(t)
	if !c.RequestActive() {
		t.Fatal("a pending retry keeps the request")
	}
	clock.Advance(time.Second)
	for {
		e := receive(t, events)
		if e.State == Disconnected {
			break
		}
	}
	if c.RequestActive() {
		t.Fatal("request active after the retry could not be rebuilt")
	}
}

func TestWA12EndRoutePermanentFailureAndQRFinishedAndUnpairedNetwork(t *testing.T) {
	for _, tc := range []struct {
		name   string
		paired bool
		kind   string
	}{
		{"permanent failure", true, "permanentFailure"},
		{"qr finished", false, "qrFinished"},
		{"unpaired network failure", false, "networkFailure"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transport := newTransport()
			c, events := newEndController(tc.paired, func() (Transport, error) { return transport, nil })
			c.Connect()
			channel := started(t, transport)
			channel <- TransportEvent{Kind: tc.kind}
			waitEnded(t, c, events, ConnectionFailed)
		})
	}
}

func TestWA12EndRouteLocalFault(t *testing.T) {
	transport := newTransport()
	c, events := newEndController(true, func() (Transport, error) { return transport, nil })
	c.Connect()
	started(t, transport)
	c.FailLocal(SessionStorageFailed)
	waitEnded(t, c, events, SessionStorageFailed)
}

func TestWA12EndRouteDisconnectAndRevocation(t *testing.T) {
	transport := newTransport()
	c, events := newEndController(true, func() (Transport, error) { return transport, nil })
	c.Connect()
	channel := started(t, transport)
	channel <- TransportEvent{Kind: "revoked"}
	waitEnded(t, c, events, "")
	if c.RequestActive() {
		t.Fatal("revoked request still active")
	}

	other := newTransport()
	d, devents := newEndController(true, func() (Transport, error) { return other, nil })
	d.Connect()
	started(t, other)
	d.Disconnect()
	waitEnded(t, d, devents, "")
}

func TestWA12EndRouteConnectRefusedLeavesNoRequest(t *testing.T) {
	c, _ := newEndController(true, func() (Transport, error) { return nil, errors.New("no transport") })
	if c.Connect() != ConnectionFailed || c.RequestActive() {
		t.Fatal("a refused connect must report the failure and request nothing")
	}
}
