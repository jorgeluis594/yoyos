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

// IT-MSG-07 (decision 2026-10-10): a live message whose timestamp is missing or invalid is not an error: it is
// committed durably like any other and delivered once with the date unknown (the `timestamp` key is absent, never
// 0 and never the reception time), acknowledged only after its confirmation, and it neither fails the session nor
// stops reception. The invalid values range from a zero time through a negative one to a year beyond 9999.
func TestITMSG07LiveMessageWithAnInvalidTimestampIsDeliveredWithAnUnknownDateAndNeverStopsReception(t *testing.T) {
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
				t.Fatalf("the decryption transaction failed for an invalid timestamp: %v", bad.err)
			}
			d := app.take(t)
			assertUnknownDate(t, d.Message, "sin hora")
			// A valid message right after it flows normally and keeps its date: the invalid one did not stop reception.
			good := l.receive("good", "con hora")
			bad.stillWaiting(t) // not acknowledged before its confirmation
			app.persist(d)
			if err := l.coord.Confirm(d.ID); err != nil {
				t.Fatal(err)
			}
			if !bad.ack(t) {
				t.Fatal("the message with an unknown date must be acknowledged once it is confirmed")
			}
			next := app.take(t)
			var withDate struct {
				Timestamp *int64 `json:"timestamp"`
			}
			if err := jsonUnmarshal(next.Message, &withDate); err != nil || withDate.Timestamp == nil || *withDate.Timestamp != 1_700_000_000_000 {
				t.Fatalf("a valid message must keep its date: %s (%v)", next.Message, err)
			}
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

// Delivery order is arrival order and identity is the message ID, whatever the dates say: a message whose date is
// unknown, or older than the previous one, is not moved, and the same ID again is the same message.
func TestITMSG07UnknownDateKeepsArrivalOrderAndIdentityComesFromTheMessageID(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	app := l.subscribe("a")
	l.coord.Start()
	first := l.receiveAt("m1", "uno", time.Unix(1700000500, 0))
	second := l.receiveAt("m2", "dos", time.Time{})
	third := l.receiveAt("m3", "tres", time.Unix(1700000100, 0)) // older than the first, arrives last
	var ids, texts []string
	for _, r := range []*received{first, second, third} {
		d := app.take(t)
		var m struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		}
		if err := jsonUnmarshal(d.Message, &m); err != nil {
			t.Fatal(err)
		}
		ids, texts = append(ids, m.ID), append(texts, m.Text)
		app.persist(d)
		if err := l.coord.Confirm(d.ID); err != nil {
			t.Fatal(err)
		}
		if !r.ack(t) {
			t.Fatal("not acknowledged after confirmation")
		}
	}
	if strings.Join(texts, ",") != "uno,dos,tres" {
		t.Fatalf("delivery order is not the arrival order: %v", texts)
	}
	if ids[0] == ids[1] || ids[1] == ids[2] || ids[0] == ids[2] {
		t.Fatalf("distinct messages must have distinct IDs: %v", ids)
	}
	// The message ID does not depend on the date: the same WhatsApp ID with another date, or none, is the same message.
	idWith := func(at time.Time) string {
		other := newLife(t, newNative(), 1<<20)
		consumer := other.subscribe("a")
		other.coord.Start()
		other.receiveAt("same", "igual", at)
		var m struct {
			ID string `json:"id"`
		}
		if err := jsonUnmarshal(consumer.take(t).Message, &m); err != nil {
			t.Fatal(err)
		}
		return m.ID
	}
	if a, b := idWith(time.Unix(1700000000, 0)), idWith(time.Time{}); a != b {
		t.Fatalf("the ID changed with the date: %s != %s", a, b)
	}
}

// The message with an unknown date survives a restart before its confirmation and is delivered again; the server
// then redelivers the very same message to the new life, which is recognised (same ID, one effect) and acknowledged
// only after the confirmation.
func TestITMSG07UnknownDateMessageSurvivesRestartAndTheServerRedeliversIt(t *testing.T) {
	n := newNative()
	failures := 0
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
		t.Fatalf("pending = %d, want the message kept", n.pendingCount())
	}
	two := newLife(t, n, 1<<20) // restart before the confirmation: the first life never acknowledged
	two.recv.hooks.LocalFailure = func(error) { failures++ }
	two.consumer = app
	two.subscribe("b")
	two.coord.Start()
	again := app.take(t)
	assertUnknownDate(t, again.Message, "sin hora")
	if again.ID != d.ID {
		t.Fatalf("restart delivered another message: %s != %s", again.ID, d.ID)
	}
	app.persist(again)
	// The server redelivers the unacknowledged message to the new connection.
	redelivered := two.receiveAt("bad", "sin hora", time.Unix(-5, 0))
	if redelivered.err != nil {
		t.Fatalf("redelivery failed: %v", redelivered.err)
	}
	redelivered.stillWaiting(t)
	if err := two.coord.Confirm(again.ID); err != nil {
		t.Fatal(err)
	}
	// The redelivery is a second capture of the same message: it is delivered once more with the same message.id, the
	// idempotent consumer has no second effect, and only its own confirmation releases the ACK.
	repeat := app.take(t)
	assertUnknownDate(t, repeat.Message, "sin hora")
	if repeat.ID == again.ID {
		t.Fatal("the redelivery must be a new delivery of the same message")
	}
	redelivered.stillWaiting(t)
	app.persist(repeat)
	if err := two.coord.Confirm(repeat.ID); err != nil {
		t.Fatal(err)
	}
	if !redelivered.ack(t) {
		t.Fatal("the redelivered message must be acknowledged once its confirmation is durable")
	}
	if app.effects != 1 || failures != 0 || n.pendingCount() != 0 {
		t.Fatalf("effects=%d failures=%d pending=%d, want 1/0/0", app.effects, failures, n.pendingCount())
	}
}

// assertUnknownDate checks a delivered message carries its content and no timestamp key at all.
func assertUnknownDate(t *testing.T, message []byte, text string) {
	t.Helper()
	var fields map[string]any
	if err := jsonUnmarshal(message, &fields); err != nil {
		t.Fatal(err)
	}
	if _, present := fields["timestamp"]; present || fields["text"] != text {
		t.Fatalf("delivery must carry %q with no timestamp key (unknown date): %s", text, message)
	}
}
