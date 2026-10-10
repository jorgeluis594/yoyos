package receive

import (
	"strings"
	"testing"
	"time"
)

// WA-14 controlled journey on the Go side: live reception, a lost confirmation, a restart, a PN/LID identity that
// arrives late and the deliveries left by an account that was unlinked, all through one durable container and
// one durable, idempotent consumer (consumerApp persists by message id, so a repeated delivery has no second
// effect). Transport is not involved: the receive path is driven the way whatsmeow drives it. Linking, QR,
// history, image download and remote logout have their own controlled tests (see README "Journey map").
func TestWA14JourneyDurableConsumerSurvivesLostConfirmationRestartLateIdentityAndLogout(t *testing.T) {
	n := newNative()

	// Life 1: a live message is delivered, persisted by the consumer and confirmed.
	one := newLife(t, n, 1<<20)
	app := one.subscribe("a")
	one.coord.Start()
	first := one.receive("m1", "hola")
	d1 := app.take(t)
	app.persist(d1)
	if err := one.coord.Confirm(d1.ID); err != nil {
		t.Fatal(err)
	}
	if !first.ack(t) {
		t.Fatal("the handler was not released after the confirmation")
	}
	if n.pendingCount() != 0 {
		t.Fatal("a confirmed delivery stayed pending")
	}

	// A confirmation that cannot be written leaves the entry pending: nothing is lost, nothing is acknowledged.
	second := one.receive("m2", "segundo")
	d2 := app.take(t)
	app.persist(d2)
	n.set(func() { n.failRetire = errBoom })
	if err := one.coord.Confirm(d2.ID); err == nil {
		t.Fatal("a failed retirement was reported as confirmed")
	}
	second.stillWaiting(t)
	if n.pendingCount() != 1 {
		t.Fatalf("pending = %d, want the unconfirmed entry", n.pendingCount())
	}
	n.set(func() { n.failRetire = nil })

	// Life 2 (a restart over the same container): the same delivery returns, the consumer's second persist is a
	// no-op and the confirmation now retires it.
	two := newLife(t, n, 1<<20)
	two.consumer = app // the consumer's own database outlives the process
	two.subscribe("b")
	two.coord.Start()
	again := app.take(t)
	if again.ID != d2.ID {
		t.Fatalf("redelivered %s, want %s", again.ID, d2.ID)
	}
	app.persist(again)
	if app.effects != 2 {
		t.Fatalf("a repeated delivery produced %d effects, want 2 (one per message)", app.effects)
	}
	if err := two.coord.Confirm(again.ID); err != nil {
		t.Fatal(err)
	}
	if err := two.coord.Confirm(again.ID); err != nil { // repeating the confirmation is harmless
		t.Fatal(err)
	}
	if n.pendingCount() != 0 {
		t.Fatal("the confirmed entry stayed pending after the restart")
	}

	// A message from a phone-number chat has no definitive identity yet: kept, not delivered, not acknowledged.
	ident := two.withIdentity()
	late := two.receiveFrom("p1", "tarde", phone)
	app.none(t)
	if n.pendingCount() != 1 || n.entry(t, 0).IdentityState != "pendingLid" {
		t.Fatalf("the unresolved message was not kept as pendingLid: %d", n.pendingCount())
	}
	_ = ident
	two.storeMapping() // the LID mapping arrives later
	d3 := app.take(t)
	if !strings.Contains(string(d3.Message), "wa-message:v1:") {
		t.Fatal("the resolved delivery has no public message")
	}
	app.persist(d3)
	if err := two.coord.Confirm(d3.ID); err != nil {
		t.Fatal(err)
	}
	// The handler that parked the message never grants its ACK (WA-07, PR #47 m3): the server's redelivery does,
	// once the confirmed message is recognised. Until then the message stays unacknowledged on the server.
	if late.ack(t) {
		t.Fatal("a message whose identity arrived late must not be acknowledged by its original handler")
	}
	app.none(t) // exactly once
	if app.effects != 3 {
		t.Fatalf("effects = %d, want 3", app.effects)
	}

	// Logout and a new account: what the unlinked account left is still deliverable and confirmable by its own id,
	// with no session of the new account involved.
	seed(n, 90, "999@lid", "50", 0, "resolved", 1)
	three := newLife(t, n, 1<<20)
	three.consumer = app
	three.subscribe("c")
	three.coord.Start()
	left := app.take(t)
	if left.ID != did(90) {
		t.Fatalf("got %s, want the unlinked account's delivery", left.ID)
	}
	app.persist(left)
	if err := three.coord.Confirm(left.ID); err != nil {
		t.Fatal(err)
	}
	if n.pendingCount() != 0 {
		t.Fatal("the unlinked account's delivery stayed pending")
	}
}

// IT-MSG-07 (WA-14 reviews M2/M2a): a live message whose timestamp cannot become a public one is isolated, not
// lost and not harmful: it is committed durably like any other, delivered once with the timestamp sanitized to 0
// (the marker for "unknown"; no time is invented), acknowledged only after its confirmation, and it neither
// fails the session nor stops reception. The invalid values range from a zero time through a negative one to a
// year beyond 9999. Redelivery and a restart behave like for any other message.
func TestITMSG07LiveMessageWithAnInvalidTimestampIsIsolatedDeliveredSanitizedAndNeverStopsReception(t *testing.T) {
	for name, at := range map[string]time.Time{"zero time": {}, "epoch": time.Unix(0, 0), "negative": time.Unix(-5, 0), "year 11500": time.Unix(300000000000, 0)} {
		t.Run(name, func(t *testing.T) {
			n := newNative()
			failures := 0
			l := newLife(t, n, 1<<20)
			l.recv.hooks.LocalFailure = func(error) { failures++ }
			app := l.subscribe("a")
			l.coord.Start()
			bad := l.receiveAt("bad", "sin hora", at)
			if bad.err != nil {
				t.Fatalf("the descryption transaction failed for an invalid timestamp: %v", bad.err)
			}
			d := app.take(t)
			var delivered struct {
				ID        string `json:"id"`
				Timestamp int64  `json:"timestamp"`
				Text      string `json:"text"`
			}
			if err := jsonUnmarshal(d.Message, &delivered); err != nil || delivered.Timestamp != 0 || delivered.Text != "sin hora" {
				t.Fatalf("delivery must carry the content with timestamp 0 (unknown): %s (%v)", d.Message, err)
			}
			// A valid message right after it flows normally: the invalid one did not stop or poison reception.
			good := l.receive("good", "con hora")
			bad.stillWaiting(t) // not acknowledged before its confirmation
			app.persist(d)
			if err := l.coord.Confirm(d.ID); err != nil {
				t.Fatal(err)
			}
			if !bad.ack(t) {
				t.Fatal("the isolated message must be acknowledged once it is confirmed")
			}
			next := app.take(t)
			app.persist(next)
			_ = l.coord.Confirm(next.ID)
			if !good.ack(t) {
				t.Fatal("reception stopped after the invalid timestamp")
			}
			if failures != 0 {
				t.Fatalf("the session was failed %d times for an invalid timestamp", failures)
			}
			if n.pendingCount() != 0 {
				t.Fatalf("pending = %d after both were confirmed", n.pendingCount())
			}
		})
	}
}

// The same message survives a restart before its confirmation and is delivered again sanitized; a
// repeated persist is a no-op.
func TestITMSG07IsolatedMessageSurvivesRestartAndRedelivery(t *testing.T) {
	n := newNative()
	one := newLife(t, n, 1<<20)
	app := one.subscribe("a")
	one.coord.Start()
	first := one.receiveAt("bad", "sin hora", time.Unix(-5, 0))
	if first.err != nil {
		t.Fatal(first.err)
	}
	d := app.take(t)
	app.persist(d)
	if n.pendingCount() != 1 {
		t.Fatalf("pending = %d, want the isolated message kept", n.pendingCount())
	}
	two := newLife(t, n, 1<<20) // restart before the confirmation
	two.consumer = app
	two.subscribe("b")
	two.coord.Start()
	again := app.take(t)
	if again.ID != d.ID || !strings.Contains(string(again.Message), `"timestamp":0`) {
		t.Fatalf("restart must redeliver the same isolated message: %s", again.Message)
	}
	app.persist(again)
	if app.effects != 1 {
		t.Fatalf("effects = %d, want 1", app.effects)
	}
	if err := two.coord.Confirm(again.ID); err != nil {
		t.Fatal(err)
	}
	// Reconnection redeliveries of the same message are recognised by whatsmeow's retry marker before the hooks run
	// (outside this harness); here the durable consumer's idempotence is what keeps a repeat harmless.
	app.persist(again)
	if app.effects != 1 {
		t.Fatalf("a repeated delivery produced %d effects", app.effects)
	}
	_ = first
}
