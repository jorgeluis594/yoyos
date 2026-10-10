package connection

import (
	"context"
	"errors"
	"sync"
	"time"
)

type State string

const (
	Disconnected   State = "disconnected"
	Connecting     State = "connecting"
	AwaitingQR     State = "awaitingQr"
	Connected      State = "connected"
	Reconnecting   State = "reconnecting"
	SessionExpired State = "sessionExpired"
)

type Code string

const (
	ConnectionFailed           Code = "CONNECTION_FAILED"
	SessionExpiredError        Code = "SESSION_EXPIRED"
	SessionStorageFailed       Code = "SESSION_STORAGE_FAILED"
	SessionStorageLimitReached Code = "SESSION_STORAGE_LIMIT_REACHED"
	SessionStateInvalid        Code = "SESSION_STATE_INVALID"
	RecoveryBufferFull         Code = "RECOVERY_BUFFER_FULL"
	ConsumerUnavailable        Code = "CONSUMER_UNAVAILABLE"
	IdentityUnavailable        Code = "IDENTITY_UNAVAILABLE"
)

type Event struct {
	State     State
	QR        string
	ExpiresAt int64
	Error     Code
}
type TransportEvent struct {
	Kind      string
	QR        string
	ExpiresAt time.Time
	Error     Code
}
type Transport interface {
	Run(context.Context, chan<- TransportEvent) error
	Stop()
}
type RunError struct {
	Retry bool
	Code  Code
}

func (e RunError) Error() string { return "connection attempt failed" }

type Clock interface {
	Now() time.Time
	After(time.Duration) <-chan time.Time
}
type realClock struct{}

func (realClock) Now() time.Time                         { return time.Now() }
func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

// Controller owns one requested connection; callbacks only describe the current generation.
type Controller struct {
	mu            sync.Mutex
	clock         Clock
	create        func() (Transport, error)
	emit          func(Event)
	eventMu       sync.Mutex
	eventReady    *sync.Cond
	pendingEvents []Event
	closed        bool
	prepared      bool
	paired        bool
	requested     bool
	paused        bool
	expired       bool
	localFault    Code
	state         State
	qr            Event
	qrExpiry      time.Time
	generation    uint64
	cancel        context.CancelFunc
	retryCancel   chan struct{}
	transport     Transport
	retries       int
}

func New(create func() (Transport, error), emit func(Event), clock Clock) *Controller {
	if clock == nil {
		clock = realClock{}
	}
	c := &Controller{create: create, emit: emit, clock: clock, state: Disconnected}
	c.eventReady = sync.NewCond(&c.eventMu)
	go c.deliver()
	return c
}
func (c *Controller) publish(event Event) {
	c.eventMu.Lock()
	if !c.closed {
		c.pendingEvents = append(c.pendingEvents, event)
		c.eventReady.Signal()
	}
	c.eventMu.Unlock()
}
func (c *Controller) deliver() {
	for {
		c.eventMu.Lock()
		for len(c.pendingEvents) == 0 && !c.closed {
			c.eventReady.Wait()
		}
		if c.closed {
			c.eventMu.Unlock()
			return
		}
		event := c.pendingEvents[0]
		c.pendingEvents[0] = Event{}
		c.pendingEvents = c.pendingEvents[1:]
		c.eventMu.Unlock()
		if event.QR != "" {
			c.mu.Lock()
			current := c.state == AwaitingQR && c.qr.QR == event.QR && c.qr.ExpiresAt == event.ExpiresAt && c.clock.Now().Before(c.qrExpiry)
			c.mu.Unlock()
			if !current {
				continue
			}
		}
		c.emit(event)
	}
}
func (c *Controller) Close() bool {
	c.mu.Lock()
	revoked := c.expired
	c.retireLocked()
	c.setState(Disconnected)
	c.mu.Unlock()
	c.eventMu.Lock()
	c.closed = true
	c.pendingEvents = nil
	c.eventReady.Broadcast()
	c.eventMu.Unlock()
	return revoked
}
func (c *Controller) State() State { c.mu.Lock(); defer c.mu.Unlock(); return c.state }
func (c *Controller) CanUpdateOptions() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.requested && !c.expired && c.state == Disconnected
}
func (c *Controller) CurrentQR() (Event, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.qr, c.state == AwaitingQR && c.qr.QR != "" && c.clock.Now().Before(c.qrExpiry)
}
func (c *Controller) Prepare(paired bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.prepared && c.requested && c.localFault == "" {
		return
	}
	c.prepared, c.paired, c.localFault = true, paired, ""
	c.setState(Disconnected)
}
func (c *Controller) PrepareInvalidSession() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.retireLocked()
	c.prepared, c.localFault = true, SessionStateInvalid
	c.setState(Disconnected)
}
func (c *Controller) Connect() Code {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.prepared {
		return SessionStateInvalid
	}
	if c.localFault != "" {
		return c.localFault
	}
	if c.expired {
		return SessionExpiredError
	}
	if c.requested {
		return ""
	}
	transport, err := c.create()
	if err != nil {
		return ConnectionFailed
	}
	c.requested = true
	c.retries = 0
	c.startLocked(transport, Connecting)
	return ""
}
func (c *Controller) Disconnect() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.retireLocked()
	c.setState(Disconnected)
}
func (c *Controller) RetiredSession() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.retireLocked()
	c.expired, c.paired, c.localFault = false, false, ""
	c.setState(Disconnected)
}
func (c *Controller) FailLocal(code Code) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failLocalLocked(code)
}
func (c *Controller) failLocalLocked(code Code) {
	if c.localFault != "" {
		return // the first local fault is the one reported
	}
	c.retireLocked()
	c.localFault = code
	c.publish(Event{Error: code})
	c.setState(Disconnected)
}

// Notify publishes an informational error that neither stops reception nor
// changes state, such as content kept while its identity is still unknown.
func (c *Controller) Notify(code Code) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.publish(Event{Error: code})
}
func (c *Controller) PauseForCapacity() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pauseForCapacityLocked()
}
func (c *Controller) pauseForCapacityLocked() {
	if !c.requested {
		return
	}
	c.generation++
	if c.retryCancel != nil {
		close(c.retryCancel)
		c.retryCancel = nil
	}
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
	if c.transport != nil {
		c.transport.Stop()
		c.transport = nil
	}
	c.paused = true
	c.publish(Event{Error: RecoveryBufferFull})
	c.setState(Disconnected)
}
func (c *Controller) ResumeCapacity() {
	c.mu.Lock()
	if !c.paused || !c.requested || c.localFault != "" || c.expired {
		c.mu.Unlock()
		return
	}
	c.paused = false
	generation := c.generation
	c.mu.Unlock()
	// Rebuilding reads native state; do it without holding the controller lock.
	transport, err := c.create()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.generation != generation || !c.requested || c.localFault != "" || c.expired {
		return // stopped or replaced while the attempt was being built
	}
	if err != nil {
		c.requested = false
		c.publish(Event{Error: ConnectionFailed})
		return
	}
	c.startLocked(transport, Reconnecting)
}
func (c *Controller) retireLocked() {
	c.requested = false
	c.paused = false
	c.generation++
	if c.retryCancel != nil {
		close(c.retryCancel)
		c.retryCancel = nil
	}
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
	if c.transport != nil {
		c.transport.Stop()
		c.transport = nil
	}
	c.qr = Event{}
	c.qrExpiry = time.Time{}
}
func (c *Controller) setState(state State) {
	if state != AwaitingQR {
		c.qr = Event{}
		c.qrExpiry = time.Time{}
	}
	if c.state != state {
		c.state = state
		c.publish(Event{State: state})
	}
}
func (c *Controller) startLocked(transport Transport, state State) {
	c.generation++
	generation := c.generation
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel, c.transport = cancel, transport
	c.setState(state)
	go c.run(ctx, generation, transport)
}
func (c *Controller) run(ctx context.Context, generation uint64, transport Transport) {
	events := make(chan TransportEvent, 8)
	done := make(chan error, 1)
	go func() { done <- transport.Run(ctx, events) }()
	deadline := c.clock.Now().Add(30 * time.Second)
	timer := c.clock.After(30 * time.Second)
	awaiting := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer:
			if awaiting {
				continue
			}
			if c.clock.Now().Before(deadline) {
				timer = c.clock.After(deadline.Sub(c.clock.Now()))
				continue
			}
			c.finish(generation, ConnectionFailed, true)
			return
		case item := <-events:
			c.mu.Lock()
			if generation != c.generation || !c.requested {
				c.mu.Unlock()
				return
			}
			if item.Kind != "localFailure" && item.Kind != "revoked" && !awaiting && !c.clock.Now().Before(deadline) {
				c.mu.Unlock()
				c.finish(generation, ConnectionFailed, true)
				return
			}
			switch item.Kind {
			case "qr":
				if c.state != Connected && item.QR != "" && item.ExpiresAt.After(c.clock.Now()) {
					awaiting = true
					timer = nil
					c.setState(AwaitingQR)
					c.qr = Event{QR: item.QR, ExpiresAt: item.ExpiresAt.UnixMilli()}
					c.qrExpiry = item.ExpiresAt
					c.publish(c.qr)
				}
			case "authenticating":
				if c.state == Connected {
					break
				}
				c.paired = true
				awaiting = false
				deadline = c.clock.Now().Add(30 * time.Second)
				timer = c.clock.After(30 * time.Second)
				c.setState(Connecting)
			case "connected":
				awaiting = false
				timer = nil
				c.paired = true
				c.retries = 0
				c.setState(Connected)
			case "loginReconnect":
				if reconnect, ok := transport.(interface{ Reconnect() }); ok {
					reconnect.Reconnect()
				} else {
					c.mu.Unlock()
					c.finish(generation, ConnectionFailed, false)
					return
				}
			case "revoked":
				c.retireLocked()
				c.expired = true
				c.setState(SessionExpired)
				c.publish(Event{Error: SessionExpiredError})
			case "localFailure":
				if item.Error == RecoveryBufferFull {
					c.pauseForCapacityLocked()
					c.mu.Unlock()
					return
				}
				c.retireLocked()
				c.localFault = item.Error
				c.publish(Event{Error: item.Error})
				c.setState(Disconnected)
			case "networkFailure":
				c.mu.Unlock()
				c.finish(generation, ConnectionFailed, true)
				return
			case "permanentFailure":
				c.mu.Unlock()
				c.finish(generation, ConnectionFailed, false)
				return
			case "qrFinished":
				c.mu.Unlock()
				c.finish(generation, ConnectionFailed, false)
				return
			}
			c.mu.Unlock()
		case runErr := <-done:
			var classified RunError
			retry := !awaiting
			if errors.As(runErr, &classified) {
				if classified.Code != "" {
					c.mu.Lock()
					if generation == c.generation && c.requested {
						if classified.Code == RecoveryBufferFull {
							c.pauseForCapacityLocked()
						} else {
							c.failLocalLocked(classified.Code)
						}
					}
					c.mu.Unlock()
					return
				}
				retry = classified.Retry
			}
			c.finish(generation, ConnectionFailed, retry)
			return
		}
	}
}
func (c *Controller) finish(generation uint64, code Code, retry bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if generation != c.generation || !c.requested {
		return
	}
	if c.localFault != "" {
		retry = false
		code = c.localFault
	}
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
	if c.transport != nil {
		c.transport.Stop()
		c.transport = nil
	}
	c.qr = Event{}
	c.qrExpiry = time.Time{}
	c.publish(Event{Error: code})
	if !retry || !c.paired {
		c.requested = false
		c.setState(Disconnected)
		return
	}
	c.generation++
	next := c.generation
	c.setState(Reconnecting)
	delays := [...]time.Duration{1, 2, 4, 8, 16, 30}
	index := c.retries
	if index >= len(delays) {
		index = len(delays) - 1
	}
	c.retries++
	until := c.clock.Now().Add(delays[index] * time.Second)
	wait := c.clock.After(delays[index] * time.Second)
	c.retryCancel = make(chan struct{})
	stop := c.retryCancel
	go func() {
		for {
			select {
			case <-wait:
			case <-stop:
				return
			}
			c.mu.Lock()
			if !c.requested || c.generation != next || c.localFault != "" || c.expired {
				c.mu.Unlock()
				return
			}
			if remaining := until.Sub(c.clock.Now()); remaining > 0 {
				wait = c.clock.After(remaining)
				c.mu.Unlock()
				continue
			}
			c.retryCancel = nil
			transport, err := c.create()
			if err != nil {
				c.requested = false
				c.publish(Event{Error: ConnectionFailed})
				c.setState(Disconnected)
				c.mu.Unlock()
				return
			}
			c.startLocked(transport, Reconnecting)
			c.mu.Unlock()
			return
		}
	}()
}
