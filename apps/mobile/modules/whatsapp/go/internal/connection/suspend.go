package connection

// Suspend ends the live generation before the operating system suspends the process (iOS). The
// request to stay connected is remembered, not kept alive: nothing is received while suspended and
// nothing here wakes the process. The generation is invalidated, so a QR, a connection result or a
// download that finishes late is discarded instead of published, and the stored session, pending
// entries and image files are untouched. Repeating it, or calling it without a request, changes nothing.
func (c *Controller) Suspend() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.suspended || c.logout != nil || !(c.requested || c.paused) {
		return
	}
	c.retireLocked() // stops the transport and the pending retry; clears the QR and the flags
	c.suspended = true
	c.setState(Disconnected)
}

// Resume revalidates a suspended request and starts one new attempt with fresh deadlines. It builds
// the transport outside the lock; if a Disconnect, Connect, Logout or Close replaced the generation
// meanwhile, the attempt is dropped, so Resume never duplicates a client. A repeat, or a call that
// follows no Suspend, returns "". A revoked session or a local fault is reported with its code.
func (c *Controller) Resume() Code {
	c.mu.Lock()
	if !c.suspended {
		c.mu.Unlock()
		return ""
	}
	c.suspended = false
	if code := c.resumeBlockLocked(); code != "" {
		c.mu.Unlock()
		return code
	}
	generation := c.generation
	c.mu.Unlock()
	transport, err := c.create()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.generation != generation || c.requested || c.logout != nil || c.closedLocked() {
		discardUnused(transport)
		return "" // another call owns the connection now
	}
	if code := c.resumeBlockLocked(); code != "" {
		discardUnused(transport)
		return code
	}
	if err != nil {
		c.publish(Event{Error: ConnectionFailed})
		return ConnectionFailed
	}
	c.requested, c.retries = true, 0
	state := Connecting
	if c.paired {
		state = Reconnecting
	}
	c.startLocked(transport, state)
	return ""
}

func (c *Controller) resumeBlockLocked() Code {
	switch {
	case c.loggedOut:
		return SessionStateInvalid
	case c.localFault != "":
		return c.localFault
	case c.expired:
		return SessionExpiredError
	}
	return ""
}

func (c *Controller) closedLocked() bool {
	c.eventMu.Lock()
	defer c.eventMu.Unlock()
	return c.closed
}

func discardUnused(transport Transport) {
	if transport != nil {
		transport.Stop()
	}
}
