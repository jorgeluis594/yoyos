package receive

import (
	"context"
	"strings"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
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

// IT-MSG-07 (WA-14 review M2): live content whose timestamp cannot become a public one (a zero or negative one is already refused at capture, undecrypted and unacknowledged) is never discarded with an ACK.
// It stays as recoverable pending content, is not delivered, gets no ACK and invents no reception time.
func TestITMSG07LiveContentWithAnInvalidTimestampIsKeptAndNotAcknowledged(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	app := l.subscribe("a")
	l.coord.Start()
	chat := types.JID{User: "555", Server: types.HiddenUserServer}
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: chat, Sender: chat}, ID: "nots", Timestamp: time.Unix(300000000000, 0)} // year ~11500: accepted by capture, invalid for a public timestamp
	node := &waBinary.Node{Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"v": "2", "type": "msg"}, Content: []byte("cipher-nots")}}}
	plain, _ := proto.Marshal(&waE2E.Message{Conversation: proto.String("sin hora")})
	ctx, err := l.recv.PreDecrypt(context.Background(), info, node)
	if err != nil {
		t.Fatal(err)
	}
	hash := [32]byte{}
	copy(hash[:], "nots")
	if _, err := l.store.GetBufferedEvent(ctx, hash); err != nil {
		t.Fatal(err)
	}
	if err := l.store.DoDecryptionTxn(store.WithBufferedEventChild(ctx, 0), func(tx context.Context) error {
		return l.store.PutBufferedEvent(tx, hash, plain, time.Unix(1700000001, 0))
	}); err != nil {
		t.Fatal(err)
	}
	granted := make(chan bool, 1)
	go func() {
		granted <- l.recv.Handle(ctx, &events.Message{Info: *info})
		l.recv.Finished(ctx, info, nil)
	}()
	select {
	case ok := <-granted:
		if ok {
			t.Fatal("content with an invalid timestamp was acknowledged")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not finish")
	}
	if n.pendingCount() != 1 {
		t.Fatalf("pending = %d: the content must be kept for recovery", n.pendingCount())
	}
	if entry := n.entry(t, 0); entry.IdentityState == "resolved" || len(entry.Message) != 0 || len(entry.Recovery.Items) == 0 {
		t.Fatalf("kept entry must be unresolved with its recovery data and no invented message: %+v", entry)
	}
	app.none(t)
}
