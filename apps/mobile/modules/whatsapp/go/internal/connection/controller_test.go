package connection

import (
	"context"
	"runtime"
	"sync"
	"testing"
	"time"
)

type testClock struct {
	mu      sync.Mutex
	now     time.Time
	waits   []clockWait
	created chan struct{}
}
type clockWait struct {
	at       time.Time
	ch       chan time.Time
	duration time.Duration
}

func (c *testClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *testClock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan time.Time, 1)
	c.waits = append(c.waits, clockWait{c.now.Add(d), ch, d})
	if c.created != nil {
		c.created <- struct{}{}
	}
	return ch
}
func (c *testClock) WaitTimer(t *testing.T) {
	t.Helper()
	select {
	case <-c.created:
	case <-time.After(time.Second):
		t.Fatal("timer not scheduled")
	}
}
func (c *testClock) LastDuration() time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.waits[len(c.waits)-1].duration
}
func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
	for _, wait := range c.waits {
		if !c.now.Before(wait.at) {
			select {
			case wait.ch <- c.now:
			default:
			}
		}
	}
}

type testTransport struct {
	started chan chan<- TransportEvent
	stopped chan struct{}
	once    sync.Once
}

func newTransport() *testTransport {
	return &testTransport{started: make(chan chan<- TransportEvent, 1), stopped: make(chan struct{})}
}
func (t *testTransport) Run(ctx context.Context, events chan<- TransportEvent) error {
	t.started <- events
	<-ctx.Done()
	return ctx.Err()
}
func (t *testTransport) Stop() { t.once.Do(func() { close(t.stopped) }) }
func receive(t *testing.T, events <-chan Event) Event {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(time.Second):
		t.Fatal("event not delivered")
		return Event{}
	}
}
func started(t *testing.T, transport *testTransport) chan<- TransportEvent {
	t.Helper()
	select {
	case ch := <-transport.started:
		return ch
	case <-time.After(time.Second):
		t.Fatal("transport did not start")
		return nil
	}
}

func TestConnectAcceptsBeforeQRAndDoesNotDuplicate(t *testing.T) {
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 8)}
	transport := newTransport()
	events := make(chan Event, 16)
	creates := 0
	c := New(func() (Transport, error) { creates++; return transport, nil }, func(e Event) { events <- e }, clock)
	c.Prepare(false)
	if code := c.Connect(); code != "" {
		t.Fatal(code)
	}
	if code := c.Connect(); code != "" {
		t.Fatal(code)
	}
	channel := started(t, transport)
	if creates != 1 || receive(t, events).State != Connecting {
		t.Fatal("not one connecting attempt")
	}
	channel <- TransportEvent{Kind: "qr", QR: "first", ExpiresAt: clock.Now().Add(time.Minute)}
	if receive(t, events).State != AwaitingQR || receive(t, events).QR != "first" {
		t.Fatal("QR not emitted")
	}
	channel <- TransportEvent{Kind: "qr", QR: "second", ExpiresAt: clock.Now().Add(2 * time.Minute)}
	if receive(t, events).QR != "second" {
		t.Fatal("replacement not emitted")
	}
	if qr, ok := c.CurrentQR(); !ok || qr.QR != "second" {
		t.Fatal("replacement not current")
	}
	clock.Advance(2 * time.Minute)
	if _, ok := c.CurrentQR(); ok {
		t.Fatal("expired QR still current")
	}
	c.Disconnect()
	if c.State() != Disconnected {
		t.Fatal("disconnect failed")
	}
}

func TestStopRejectsLateEventsAndRevocationBlocksRelink(t *testing.T) {
	transport := newTransport()
	events := make(chan Event, 16)
	c := New(func() (Transport, error) { return transport, nil }, func(e Event) { events <- e }, nil)
	c.Prepare(true)
	if c.Connect() != "" {
		t.Fatal("connect rejected")
	}
	channel := started(t, transport)
	receive(t, events)
	channel <- TransportEvent{Kind: "revoked"}
	if receive(t, events).State != SessionExpired {
		t.Fatal("session not expired")
	}
	if receive(t, events).Error != SessionExpiredError {
		t.Fatal("missing expiry error")
	}
	if c.CanUpdateOptions() {
		t.Fatal("revoked session admitted options")
	}
	if c.Connect() != SessionExpiredError {
		t.Fatal("revoked session restarted")
	}
	channel <- TransportEvent{Kind: "connected"}
	if c.State() != SessionExpired {
		t.Fatal("late result changed state")
	}
	c.RetiredSession()
	if c.State() != Disconnected {
		t.Fatal("retirement failed")
	}
}

func TestNetworkDeadlineRetriesAndLocalFaultWins(t *testing.T) {
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 8)}
	first, second := newTransport(), newTransport()
	events := make(chan Event, 16)
	count := 0
	c := New(func() (Transport, error) {
		count++
		if count == 1 {
			return first, nil
		}
		return second, nil
	}, func(e Event) { events <- e }, clock)
	c.Prepare(true)
	c.Connect()
	started(t, first)
	receive(t, events)
	clock.WaitTimer(t)
	clock.Advance(31 * time.Second)
	if receive(t, events).Error != ConnectionFailed || receive(t, events).State != Reconnecting {
		t.Fatal("deadline did not retry")
	}
	clock.WaitTimer(t)
	clock.Advance(time.Second)
	started(t, second)
	if count != 2 {
		t.Fatal("retry did not create one attempt")
	}
	c.FailLocal(SessionStorageFailed)
	if receive(t, events).Error != SessionStorageFailed || receive(t, events).State != Disconnected {
		t.Fatal("local failure not prioritized")
	}
	clock.Advance(time.Hour)
	if count != 2 {
		t.Fatal("local fault retried")
	}
}

func TestStopDoesNotWaitForEventConsumer(t *testing.T) {
	blocked := make(chan struct{})
	c := New(func() (Transport, error) { return newTransport(), nil }, func(Event) { <-blocked }, nil)
	c.Prepare(false)
	c.Connect()
	done := make(chan struct{})
	go func() { c.Disconnect(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("disconnect waited for consumer")
	}
	close(blocked)
}

func TestQRScanExcludesWaitFromAuthenticationDeadline(t *testing.T) {
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 8)}
	transport := newTransport()
	events := make(chan Event, 16)
	c := New(func() (Transport, error) { return transport, nil }, func(e Event) { events <- e }, clock)
	c.Prepare(false)
	c.Connect()
	channel := started(t, transport)
	receive(t, events)
	clock.WaitTimer(t)
	channel <- TransportEvent{Kind: "qr", QR: "code", ExpiresAt: clock.Now().Add(2 * time.Hour)}
	receive(t, events)
	receive(t, events)
	clock.Advance(time.Hour)
	if c.State() != AwaitingQR {
		t.Fatal("QR wait used network deadline")
	}
	channel <- TransportEvent{Kind: "authenticating"}
	if receive(t, events).State != Connecting {
		t.Fatal("authentication did not resume")
	}
	clock.WaitTimer(t)
	clock.Advance(31 * time.Second)
	if receive(t, events).Error != ConnectionFailed || receive(t, events).State != Disconnected {
		t.Fatal("authentication deadline not applied")
	}
}

func TestCapacityPauseResumesOnlyRequestedConnection(t *testing.T) {
	first, second := newTransport(), newTransport()
	events := make(chan Event, 16)
	count := 0
	c := New(func() (Transport, error) {
		count++
		if count == 1 {
			return first, nil
		}
		return second, nil
	}, func(e Event) { events <- e }, nil)
	c.Prepare(true)
	if !c.CanUpdateOptions() {
		t.Fatal("idle connection rejected options")
	}
	c.Connect()
	started(t, first)
	receive(t, events)
	c.PauseForCapacity()
	if receive(t, events).Error != RecoveryBufferFull || receive(t, events).State != Disconnected {
		t.Fatal("capacity was treated as network")
	}
	if c.CanUpdateOptions() {
		t.Fatal("paused request admitted options")
	}
	c.ResumeCapacity()
	started(t, second)
	if receive(t, events).State != Reconnecting || count != 2 {
		t.Fatal("resume did not start one attempt")
	}
	c.Disconnect()
	if !c.CanUpdateOptions() {
		t.Fatal("stopped connection rejected options")
	}
	c.ResumeCapacity()
	if count != 2 {
		t.Fatal("explicit stop resumed")
	}
}

func TestRepeatedPreparationAdoptsExistingConnection(t *testing.T) {
	transport := newTransport()
	events := make(chan Event, 16)
	c := New(func() (Transport, error) { return transport, nil }, func(e Event) { events <- e }, nil)
	c.Prepare(true)
	c.Connect()
	channel := started(t, transport)
	receive(t, events)
	channel <- TransportEvent{Kind: "connected"}
	if receive(t, events).State != Connected {
		t.Fatal("not connected")
	}
	c.Prepare(true)
	if c.State() != Connected {
		t.Fatal("repeated initialize reset live state")
	}
	c.PrepareInvalidSession()
	if c.State() != Disconnected || c.Connect() != SessionStateInvalid {
		t.Fatal("invalid session did not stop protocol")
	}
}

func TestExpiredQueuedQRIsNotPublished(t *testing.T) {
	clock := &testClock{now: time.Unix(0, 0)}
	transport := newTransport()
	blocked := make(chan struct{})
	events := make(chan Event, 16)
	c := New(func() (Transport, error) { return transport, nil }, func(e Event) {
		if e.State == Connecting {
			<-blocked
		}
		events <- e
	}, clock)
	c.Prepare(false)
	c.Connect()
	channel := started(t, transport)
	channel <- TransportEvent{Kind: "qr", QR: "expired", ExpiresAt: clock.Now().Add(time.Second)}
	until := time.After(time.Second)
	for c.State() != AwaitingQR {
		select {
		case <-until:
			t.Fatal("QR not accepted")
		default:
			runtime.Gosched()
		}
	}
	clock.Advance(2 * time.Second)
	close(blocked)
	if receive(t, events).State != Connecting || receive(t, events).State != AwaitingQR {
		t.Fatal("state order changed")
	}
	select {
	case e := <-events:
		if e.QR != "" {
			t.Fatal("expired QR delivered")
		}
	case <-time.After(20 * time.Millisecond):
	}
	c.Disconnect()
}

func TestBackoffSequenceCapsAndResetsAfterConnection(t *testing.T) {
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 32)}
	events := make(chan Event, 40)
	created := make(chan *testTransport, 8)
	c := New(func() (Transport, error) { transport := newTransport(); created <- transport; return transport, nil }, func(e Event) { events <- e }, clock)
	c.Prepare(true)
	c.Connect()
	transport := <-created
	channel := started(t, transport)
	receive(t, events)
	clock.WaitTimer(t)
	for index, delay := range []time.Duration{1, 2, 4, 8, 16, 30, 30} {
		channel <- TransportEvent{Kind: "networkFailure"}
		if receive(t, events).Error != ConnectionFailed {
			t.Fatal("missing retry transition")
		}
		if index == 0 && receive(t, events).State != Reconnecting {
			t.Fatal("not reconnecting")
		}
		if c.State() != Reconnecting {
			t.Fatal("retry state changed")
		}
		clock.WaitTimer(t)
		if got := clock.LastDuration(); got != delay*time.Second {
			t.Fatalf("backoff %v, want %v", got, delay*time.Second)
		}
		clock.Advance(delay * time.Second)
		select {
		case transport = <-created:
		case <-time.After(time.Second):
			t.Fatal("retry not created")
		}
		channel = started(t, transport)
		clock.WaitTimer(t)
	}
	channel <- TransportEvent{Kind: "connected"}
	if receive(t, events).State != Connected {
		t.Fatal("connection missing")
	}
	channel <- TransportEvent{Kind: "networkFailure"}
	if receive(t, events).Error != ConnectionFailed || receive(t, events).State != Reconnecting {
		t.Fatal("missing retry after success")
	}
	clock.WaitTimer(t)
	if got := clock.LastDuration(); got != time.Second {
		t.Fatalf("backoff did not reset: %v", got)
	}
	c.Disconnect()
}
