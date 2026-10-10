package connection

import (
	"context"
	"time"
)

// LogoutTimeout bounds the wait for the remote unlink; local retirement proceeds after it.
const LogoutTimeout = 15 * time.Second

// Logouter is implemented by a transport that can ask WhatsApp to unlink this device.
// A nil error means the server confirmed; any error leaves the remote result unknown.
type Logouter interface {
	Logout(context.Context) error
}

// LogoutResult separates the local outcome from the remote one: Err means credentials
// must stay (nothing was unlinked); otherwise Confirmed tells whether WhatsApp confirmed.
// Repeat marks a call that found the logout already done: a local success only.
type LogoutResult struct {
	Confirmed bool
	Repeat    bool
	Err       error
}

// Quieter is implemented by a transport that can stop acknowledging deliveries while it
// stays connected, so nothing is confirmed without the receive path once logout began.
type Quieter interface{ Quiesce() }

// SetUnlinkTransport sets how to build a connection used only to request the unlink when
// no live socket exists. It must not receive or acknowledge messages.
func (c *Controller) SetUnlinkTransport(create func() (Transport, error)) {
	c.mu.Lock()
	c.unlinkCreate = create
	c.mu.Unlock()
}

type logoutCall struct {
	done   chan struct{}
	result LogoutResult
}

// Logout stops the current generation, runs prepare (identity mappings that can still be
// verified) and asks the transport to unlink within LogoutTimeout. Concurrent calls share the
// first result; once finished, a repeat is a local success that certifies nothing remote.
func (c *Controller) Logout(prepare func() error) LogoutResult {
	c.mu.Lock()
	if call := c.logout; call != nil {
		c.mu.Unlock()
		<-call.done
		return call.result
	}
	if c.loggedOut {
		c.mu.Unlock()
		return LogoutResult{Repeat: true}
	}
	call := &logoutCall{done: make(chan struct{})}
	c.logout = call
	transport := c.detachLocked()
	revoked, create := c.expired, c.unlinkCreate
	c.setState(Disconnected)
	c.mu.Unlock()
	if quiet, ok := transport.(Quieter); ok {
		quiet.Quiesce()
	}

	call.result = c.unlink(transport, revoked, create, prepare)

	c.mu.Lock()
	c.logout = nil
	c.loggedOut = call.result.Err == nil
	c.mu.Unlock()
	close(call.done)
	return call.result
}

func (c *Controller) unlink(transport Transport, revoked bool, create func() (Transport, error), prepare func() error) LogoutResult {
	if transport != nil {
		defer transport.Stop()
	}
	if prepare != nil {
		if err := prepare(); err != nil {
			return LogoutResult{Err: err}
		}
	}
	if transport == nil && !revoked && create != nil {
		// No live socket (never connected, restart, backoff, disconnect): connect only to unlink.
		if made, err := create(); err == nil && made != nil {
			transport = made
			defer transport.Stop()
		}
	}
	return LogoutResult{Confirmed: c.requestUnlink(transport)}
}

func (c *Controller) requestUnlink(transport Transport) bool {
	logouter, ok := transport.(Logouter)
	if !ok {
		return false
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- logouter.Logout(ctx) }()
	select {
	case err := <-done:
		return err == nil
	case <-c.clock.After(LogoutTimeout):
		return false
	}
}

// awaitLogoutLocked makes later admissions wait for an unlink in flight, in admission order.
func (c *Controller) awaitLogoutLocked() {
	for c.logout != nil {
		call := c.logout
		c.mu.Unlock()
		<-call.done
		c.mu.Lock()
	}
}
