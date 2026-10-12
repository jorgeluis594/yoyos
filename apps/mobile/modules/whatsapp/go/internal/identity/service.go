package identity

import (
	"context"
	"sync"

	"go.mau.fi/whatsmeow/store"
)

// Source supplies the current account store and device; both change when a
// connection attempt is rebuilt, and are absent before the first link completes.
type Source func() (Account, *store.Device)

// Hooks report the outcome of passes to the connection and the delivery coordinator.
type Hooks struct {
	// Unavailable runs once each time the account enters the condition of holding
	// content without a definitive identity; never per pass.
	Unavailable func()
	// Resolved runs after resolved entries were published, so the coordinator can pick them up.
	Resolved func()
	// Failure reports an unreadable or unpublishable store.
	Failure func(error)
}

// Service re-evaluates pending identities when something can have changed them:
// a stored mapping, a newly kept pending entry, or the start of a process. It never polls.
type Service struct {
	ledger Ledger
	source Source
	hooks  Hooks

	passMu      sync.Mutex // one pass at a time, whoever asks
	mu          sync.Mutex
	unavailable bool
	wake        chan struct{}
	done        chan struct{}
	closeOnce   sync.Once
}

func NewService(ledger Ledger, source Source, hooks Hooks) *Service {
	s := &Service{ledger: ledger, source: source, hooks: hooks, wake: make(chan struct{}, 1), done: make(chan struct{})}
	go s.run()
	return s
}

// Trigger asks for a pass without waiting; repeated triggers coalesce.
func (s *Service) Trigger() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *Service) Close() { s.closeOnce.Do(func() { close(s.done) }) }

func (s *Service) run() {
	for {
		select {
		case <-s.wake:
			if _, err := s.Resolve(context.Background()); err != nil && s.hooks.Failure != nil {
				s.hooks.Failure(err)
			}
		case <-s.done:
			return
		}
	}
}

// Resolve runs one synchronous pass. Callers that must have every available mapping
// applied first, such as retiring credentials, use it instead of Trigger.
func (s *Service) Resolve(ctx context.Context) (Outcome, error) {
	s.passMu.Lock()
	defer s.passMu.Unlock()
	account, device := s.source()
	if account == nil {
		return Outcome{}, nil
	}
	outcome, err := Resolve(ctx, s.ledger, account, device)
	if err != nil {
		return Outcome{}, err
	}
	if outcome.Resolved > 0 && s.hooks.Resolved != nil {
		s.hooks.Resolved()
	}
	s.track(outcome.Unresolved)
	return outcome, nil
}

// Rearm makes the next pass that finds unresolved content notify again, as for a
// new connection request whose listener has not seen the condition.
func (s *Service) Rearm() {
	s.mu.Lock()
	s.unavailable = false
	s.mu.Unlock()
}

// track notifies on entering the condition and re-arms when it ends.
func (s *Service) track(unresolved int) {
	s.mu.Lock()
	enter := unresolved > 0 && !s.unavailable
	s.unavailable = unresolved > 0
	s.mu.Unlock()
	if enter && s.hooks.Unavailable != nil {
		s.hooks.Unavailable()
	}
}
