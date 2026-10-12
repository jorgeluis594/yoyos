package connection

// Suspend ends the live generation before the operating system suspends the process (iOS). The
// request to stay connected is remembered, not kept alive: nothing is received while suspended and
// nothing here wakes the process. The generation is invalidated, so a QR, a connection result or a
// download that finishes late is discarded instead of published, and the stored session, pending
// entries and image files are untouched. Repeating it, or calling it without a request, changes nothing.
func (c *Controller) Suspend() {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch {
	case c.logout != nil:
		return
	case c.requested && !c.paused:
		// A live or retrying connection, whoever started it (Connect may have won a Resume's build):
		// retiring it also clears `resuming`, so that Resume's build is dropped when it returns.
		c.retireLocked() // stops the transport and the pending retry; clears the QR and the flags
		c.suspended = true
		c.setState(Disconnected)
	case c.resuming: // a Resume is building its attempt: cancel it and owe the resume again
		c.resuming = false
		c.generation++
		c.suspended = true
	case c.suspended || !c.paused:
		return
	default: // waiting for capacity: no socket exists; keep waiting, but do not start while suspended
		c.generation++
		c.suspended, c.suspendedPaused = true, true
	}
}

// Resume revalidates a suspended request and starts one new attempt with fresh deadlines. It builds
// the transport outside the lock; if a Disconnect, Connect, Logout, Close or a new Suspend replaced
// the generation meanwhile, the attempt is dropped, so Resume never duplicates a client or connects
// a suspended app. A request that was paused for recovery capacity stays paused until capacity
// returns (ResumeCapacity), also when it returned during the suspension. A repeat, or a call that
// follows no Suspend, returns "". A revoked session or a local fault is returned as its code; a
// failure to build the attempt is published once as an event and returns "".
func (c *Controller) Resume() Code {
	c.mu.Lock()
	if !c.suspended {
		c.mu.Unlock()
		return ""
	}
	if c.suspendedPaused {
		c.suspended, c.suspendedPaused = false, false
		freed := c.capacityFreed
		c.capacityFreed = false
		c.mu.Unlock()
		if freed {
			c.ResumeCapacity()
		}
		return ""
	}
	c.suspended = false
	if code := c.resumeBlockLocked(); code != "" {
		c.mu.Unlock()
		return code
	}
	c.resuming = true
	generation := c.generation
	c.mu.Unlock()
	transport, err := c.create()
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.resuming || c.generation != generation || c.requested || c.logout != nil || c.closedLocked() {
		discardUnused(transport)
		return "" // another call owns the connection now, or the app was suspended again
	}
	c.resuming = false
	if code := c.resumeBlockLocked(); code != "" {
		discardUnused(transport)
		return code
	}
	if err != nil {
		c.publish(Event{Error: ConnectionFailed})
		return ""
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
