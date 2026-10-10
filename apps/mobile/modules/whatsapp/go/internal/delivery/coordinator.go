// Package delivery owns the single pending-delivery traversal shared by local
// recovery and newly received messages. Native pending entries are the only
// durable source; the coordinator keeps just the delivery in flight.
package delivery

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"yoyos-whatsapp/internal/protocolstore"
)

// Ledger is the durable pending source. Pending must fail rather than return an
// empty list when the published state cannot be read.
type Ledger interface {
	Pending() ([]protocolstore.PendingRecord, error)
	Retire(id string) (removed bool, err error)
}

type Delivery struct {
	ID      string
	Message json.RawMessage
}

// Consumer is one registered subscription. Token is its identity; Emit hands the
// delivery to the platform and returns once it was accepted, not once persisted.
type Consumer struct {
	Token string
	Emit  func(Delivery) error
}

// Cause says why reception had to stop; the controller maps it to a public error.
type Cause string

const (
	NoConsumer     Cause = "NO_CONSUMER"
	ConsumerFailed Cause = "CONSUMER_FAILED"
	ReadFailed     Cause = "READ_FAILED"
)

type Hooks struct {
	// Stop runs on its own goroutine, at most once per cause until a consumer is registered.
	Stop func(Cause, error)
	// Resume is called when freed capacity can fit the admission that was rejected.
	Resume func()
}

type Outcome int

const (
	// Retired means the pending entry was durably removed, so the protocol ACK is allowed.
	Retired Outcome = iota
	// Interrupted means the wait ended without retirement; the ACK stays withheld.
	Interrupted
)

var ErrInvalidDeliveryID = errors.New("invalid delivery ID")

// ErrClosed ends a capacity wait of a coordinator that was closed.
var ErrClosed = errors.New("delivery coordinator closed")

// ErrTooLarge ends a capacity wait that no amount of freed space can satisfy.
var ErrTooLarge = errors.New("entry exceeds the recovery buffer")

type flight struct {
	id        string
	message   json.RawMessage
	emittedTo string
	retiring  bool
	uncertain bool
}

type Coordinator struct {
	ledger Ledger
	limit  int64
	hooks  Hooks

	confirmMu sync.Mutex
	mu        sync.Mutex
	ready     bool
	closed    bool
	consumer  *Consumer
	failed    string
	inFlight  *flight
	waiters   map[string][]chan Outcome
	waitFor   int64
	retires   uint64 // counts durable retirements so a read taken before one is never trusted after it
	stopped   map[Cause]bool
	capacity  chan struct{} // closed and replaced whenever space may have been freed
	wake      chan struct{}
	done      chan struct{}
}

// New starts the coordinator's single traversal goroutine. It does nothing until Start.
func New(ledger Ledger, limit int64, hooks Hooks) *Coordinator {
	c := &Coordinator{ledger: ledger, limit: limit, hooks: hooks, waiters: map[string][]chan Outcome{},
		stopped: map[Cause]bool{}, capacity: make(chan struct{}), wake: make(chan struct{}, 1), done: make(chan struct{})}
	go c.run()
	return c
}

func (c *Coordinator) run() {
	for {
		select {
		case <-c.wake:
			c.step()
		case <-c.done:
			return
		}
	}
}
func (c *Coordinator) kick() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

// Start declares native storage prepared. It never waits for confirmations.
func (c *Coordinator) Start() {
	c.mu.Lock()
	c.ready = true
	c.mu.Unlock()
	c.kick()
}

// Close ends the traversal and releases every live waiter without retiring anything.
func (c *Coordinator) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.interruptLocked()
	c.mu.Unlock()
	close(c.done)
}

// SetConsumer replaces the single active consumer and re-emits the delivery in flight.
func (c *Coordinator) SetConsumer(consumer Consumer) {
	c.mu.Lock()
	c.consumer = &consumer
	c.failed = ""
	c.stopped = map[Cause]bool{}
	c.mu.Unlock()
	c.kick()
}

// RemoveConsumer ignores a token that was already replaced. It keeps pending entries and
// releases live waiters; the stop for a missing consumer is raised lazily by the next need.
func (c *Coordinator) RemoveConsumer(token string) {
	c.mu.Lock()
	if c.consumer == nil || c.consumer.Token != token {
		c.mu.Unlock()
		return
	}
	c.consumer = nil
	c.interruptLocked()
	c.mu.Unlock()
	// Reception stops only when a delivery actually needs a consumer (Await or step), so
	// remove() followed by a new subscription, or a replacement, never stops it.
}

// WaitForCapacity records the entry size whose admission was rejected so that a
// later confirmation resumes reception only when that entry would fit.
func (c *Coordinator) WaitForCapacity(needed int64) {
	c.mu.Lock()
	c.waitFor = needed
	c.mu.Unlock()
	c.kick()
}

func (c *Coordinator) ClearCapacityWait() {
	c.mu.Lock()
	c.waitFor = 0
	c.mu.Unlock()
}

// Refresh asks the traversal to look again, for entries that became deliverable
// without a confirmation, such as a pending identity that was completed.
func (c *Coordinator) Refresh() { c.kick() }

// Confirm durably retires a delivery by ID, whichever consumer persisted it.
func (c *Coordinator) Confirm(id string) error {
	if !protocolstore.ValidDeliveryID(id) {
		return ErrInvalidDeliveryID
	}
	c.confirmMu.Lock()
	defer c.confirmMu.Unlock()
	c.mu.Lock()
	if c.inFlight != nil && c.inFlight.id == id {
		c.inFlight.retiring = true
	}
	c.mu.Unlock()
	_, err := c.ledger.Retire(id)
	c.mu.Lock()
	if c.inFlight != nil && c.inFlight.id == id {
		c.inFlight.retiring = false
		if err == nil {
			c.inFlight = nil
		} else {
			c.inFlight.uncertain = true
		}
	}
	if err == nil {
		c.retires++
		c.releaseLocked(id, Retired)
		c.freedLocked()
	}
	c.mu.Unlock()
	c.kick()
	return err
}

// freedLocked wakes every capacity waiter: a retirement may have made room.
func (c *Coordinator) freedLocked() {
	close(c.capacity)
	c.capacity = make(chan struct{})
}

// CapacityFreed announces a retirement that did not go through Confirm, such as a rejected batch.
func (c *Coordinator) CapacityFreed() {
	c.mu.Lock()
	c.freedLocked()
	c.mu.Unlock()
	c.kick()
}

// AwaitCapacity blocks, holding no store or writer lock, until an admission of the given
// size would fit beside the current entries. It wakes on retirements, never by polling, and ends
// with ctx when the generation that wants the admission is retired.
func (c *Coordinator) AwaitCapacity(ctx context.Context, needed int64) error {
	for {
		c.mu.Lock()
		changed, closed := c.capacity, c.closed
		c.mu.Unlock()
		if closed {
			return ErrClosed
		}
		pending, err := c.ledger.Pending()
		if err != nil {
			return err
		}
		used, err := protocolstore.UsedBytes(pending)
		if err != nil {
			return err
		}
		switch protocolstore.Decide(c.limit, used, needed) {
		case protocolstore.Admit:
			return nil
		case protocolstore.Reject:
			return ErrTooLarge
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		case <-c.done:
			return ErrClosed
		}
	}
}

// Await blocks a protocol handler until its delivery is retired or the wait is cut short.
func (c *Coordinator) Await(ctx context.Context, id string) Outcome {
	c.mu.Lock()
	if c.closed || c.consumer == nil {
		noConsumer := !c.closed
		c.mu.Unlock()
		if noConsumer {
			c.stop(NoConsumer, nil)
		}
		return Interrupted
	}
	ch := make(chan Outcome, 1)
	c.waiters[id] = append(c.waiters[id], ch)
	c.mu.Unlock()
	c.kick()
	if !c.stillPending(id) {
		c.dropWaiter(id, ch)
		return Retired
	}
	select {
	case outcome := <-ch:
		return outcome
	case <-ctx.Done():
		c.dropWaiter(id, ch)
		return Interrupted
	}
}

// stillPending distinguishes a delivery retired before the waiter registered from a read failure.
func (c *Coordinator) stillPending(id string) bool {
	pending, err := c.ledger.Pending()
	if err != nil {
		return true
	}
	for _, record := range pending {
		if record.DeliveryID == id {
			return true
		}
	}
	return false
}

func (c *Coordinator) dropWaiter(id string, ch chan Outcome) {
	c.mu.Lock()
	defer c.mu.Unlock()
	list := c.waiters[id]
	for i := range list {
		if list[i] == ch {
			c.waiters[id] = append(list[:i:i], list[i+1:]...)
			break
		}
	}
	if len(c.waiters[id]) == 0 {
		delete(c.waiters, id)
	}
}
func (c *Coordinator) releaseLocked(id string, outcome Outcome) {
	for _, ch := range c.waiters[id] {
		ch <- outcome
	}
	delete(c.waiters, id)
}
func (c *Coordinator) interruptLocked() {
	for id := range c.waiters {
		c.releaseLocked(id, Interrupted)
	}
}

func (c *Coordinator) stop(cause Cause, err error) {
	c.mu.Lock()
	already := c.stopped[cause]
	c.stopped[cause] = true
	c.interruptLocked()
	c.mu.Unlock()
	if !already && c.hooks.Stop != nil {
		// Stopping the client waits for its handler queue, and this may run inside a handler.
		go c.hooks.Stop(cause, err)
	}
}

// step advances the traversal once: resolve an uncertain delivery, choose the
// next pending one, or re-emit the one in flight to a replaced consumer.
func (c *Coordinator) step() {
	c.mu.Lock()
	if c.closed || !c.ready {
		c.mu.Unlock()
		return
	}
	flightNow := c.inFlight
	needRead := flightNow == nil || flightNow.uncertain || c.waitFor > 0
	retiresBefore := c.retires
	c.mu.Unlock()
	var pending []protocolstore.PendingRecord
	if needRead {
		var err error
		if pending, err = c.ledger.Pending(); err != nil {
			c.stop(ReadFailed, err)
			return
		}
	}
	resume := false
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	if needRead && c.retires != retiresBefore {
		// A retirement completed during the read: the list may still hold the retired entry.
		c.mu.Unlock()
		c.kick()
		return
	}
	if needRead {
		resume = c.reconcileLocked(pending)
	}
	next := c.nextLocked()
	c.mu.Unlock()
	if resume && c.hooks.Resume != nil {
		c.hooks.Resume()
	}
	c.emit(next)
}

// reconcileLocked applies a fresh ledger read to the in-flight delivery and capacity wait.
func (c *Coordinator) reconcileLocked(pending []protocolstore.PendingRecord) bool {
	if c.inFlight != nil && c.inFlight.uncertain {
		c.inFlight.uncertain = false
		present := false
		for _, record := range pending {
			present = present || record.DeliveryID == c.inFlight.id
		}
		if !present {
			c.releaseLocked(c.inFlight.id, Retired)
			c.inFlight = nil
		}
	}
	if c.inFlight == nil {
		pending = append([]protocolstore.PendingRecord(nil), pending...)
		protocolstore.SortPending(pending)
		for _, record := range pending {
			if record.IdentityState == "resolved" && len(record.Message) > 0 {
				c.inFlight = &flight{id: record.DeliveryID, message: record.Message}
				break
			}
		}
	}
	if c.waitFor == 0 {
		return false
	}
	used, err := protocolstore.UsedBytes(pending)
	if err != nil || protocolstore.Decide(c.limit, used, c.waitFor) != protocolstore.Admit {
		return false
	}
	c.waitFor = 0
	return true
}

// nextLocked returns the emission to perform, or nil when nothing must be sent now.
func (c *Coordinator) nextLocked() *emission {
	fl := c.inFlight
	if fl == nil || fl.retiring || fl.uncertain {
		return nil
	}
	if c.consumer == nil {
		// Recovery waits for a consumer without stopping reception: the stop is raised only
		// when a live message needs one (Await), so registering shortly after Start is safe.
		return nil
	}
	if fl.emittedTo == c.consumer.Token || c.failed == c.consumer.Token {
		return nil
	}
	return &emission{consumer: *c.consumer, delivery: Delivery{ID: fl.id, Message: fl.message}}
}

type emission struct {
	consumer Consumer
	delivery Delivery
}

func (c *Coordinator) emit(e *emission) {
	if e == nil {
		return
	}
	c.mu.Lock()
	current := c.consumer != nil && c.consumer.Token == e.consumer.Token && c.inFlight != nil && c.inFlight.id == e.delivery.ID
	c.mu.Unlock()
	if !current {
		c.kick()
		return
	}
	err := e.consumer.Emit(e.delivery)
	c.mu.Lock()
	if err != nil {
		if c.consumer != nil && c.consumer.Token == e.consumer.Token {
			c.failed = e.consumer.Token
		}
		c.mu.Unlock()
		c.stop(ConsumerFailed, err)
		return
	}
	if c.inFlight != nil && c.inFlight.id == e.delivery.ID {
		c.inFlight.emittedTo = e.consumer.Token
	}
	c.mu.Unlock()
	// A replacement during the emission must see its own re-emission.
	c.kick()
}
