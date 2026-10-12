package receive

import (
	"reflect"
	"testing"
)

// IT-DEL-01: commit -> event -> consumer commit -> durable retirement -> ACK permission, in that order.
func TestITDEL01OrdersCommitEmitConsumerCommitRetireAndAck(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	app := l.subscribe("a")
	l.coord.Start()
	r := l.receive("m1", "hola")
	if r.err != nil {
		t.Fatal(r.err)
	}
	d := app.take(t)
	r.stillWaiting(t) // an emitted event alone grants nothing
	if n.pendingCount() != 1 {
		t.Fatal("content was not committed before the event")
	}
	app.persist(d)
	r.stillWaiting(t) // neither does the consumer's own commit
	if err := l.coord.Confirm(d.ID); err != nil {
		t.Fatal(err)
	}
	if !r.ack(t) {
		t.Fatal("ACK permission not granted after durable retirement")
	}
	want := []string{"commit", "emit", "persist", "retire", "ack"}
	if got := n.log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("order %v, want %v", got, want)
	}
	if l.replayed != 1 {
		t.Fatalf("protocol replay ran %d times", l.replayed)
	}
}

// IT-DEL-02: a crash before the native commit emits nothing, confirms nothing and leaves no pending state.
func TestITDEL02CrashBeforeNativeCommitDiscardsUnconfirmedState(t *testing.T) {
	n := newNative()
	n.set(func() { n.failApply = errBoom })
	l := newLife(t, n, 1<<20)
	app := l.subscribe("a")
	l.coord.Start()
	r := l.receive("m1", "hola")
	if r.err == nil {
		t.Fatal("a failed commit was reported as success")
	}
	app.none(t)
	if n.pendingCount() != 0 || len(n.records) != 0 {
		t.Fatal("unconfirmed state survived")
	}
	// The next life neither emits nor retires anything for it.
	n.set(func() { n.failApply = nil })
	again := newLife(t, n, 1<<20)
	again.subscribe("a").none(t)
	again.coord.Start()
	again.consumer.none(t)
}

// IT-DEL-03: a crash before the consumer commits re-emits the committed pending with the same IDs, without decrypting again.
func TestITDEL03CrashBeforeConsumerCommitReemitsSameIDsWithoutReplay(t *testing.T) {
	n := newNative()
	first := newLife(t, n, 1<<20)
	app := first.subscribe("a")
	first.coord.Start()
	r := first.receive("m1", "hola")
	before := app.take(t)
	r.stillWaiting(t)
	// crash: the process disappears with the delivery unconfirmed
	second := newLife(t, n, 1<<20)
	app2 := second.subscribe("a")
	second.coord.Start()
	after := app2.take(t)
	if after.ID != before.ID || string(after.Message) != string(before.Message) {
		t.Fatal("IDs changed across the restart")
	}
	if second.replayed != 0 {
		t.Fatal("recovery decrypted or replayed the packet again")
	}
	if n.pendingCount() != 1 {
		t.Fatal("pending was dropped")
	}
}

// IT-DEL-04: a crash after the consumer's commit but before retirement yields one logical persistence.
func TestITDEL04CrashAfterConsumerCommitDoesNotDuplicatePersistence(t *testing.T) {
	n := newNative()
	first := newLife(t, n, 1<<20)
	app := first.subscribe("a")
	first.coord.Start()
	first.receive("m1", "hola")
	d := app.take(t)
	app.persist(d)
	second := newLife(t, n, 1<<20)
	second.consumer = app // the consumer's database survives the crash
	second.coord.SetConsumer(consumerOf("a", app))
	second.coord.Start()
	dup := app.take(t)
	if dup.ID != d.ID {
		t.Fatal("different delivery after restart")
	}
	app.persist(dup) // recognizes the duplicate
	if err := second.coord.Confirm(dup.ID); err != nil {
		t.Fatal(err)
	}
	if app.effects != 1 {
		t.Fatalf("%d logical persistences", app.effects)
	}
	if n.pendingCount() != 0 {
		t.Fatal("pending not retired after the duplicate was acknowledged")
	}
}

// IT-DEL-05: protocol state confirmed before a crash before ACK survives; a recoverable re-delivery keeps message.id.
func TestITDEL05CrashAfterRetirementBeforeAckKeepsProtocolAndAllowsIdempotentRedelivery(t *testing.T) {
	n := newNative()
	first := newLife(t, n, 1<<20)
	app := first.subscribe("a")
	first.coord.Start()
	r := first.receive("m1", "hola")
	d := app.take(t)
	app.persist(d)
	if err := first.coord.Confirm(d.ID); err != nil {
		t.Fatal(err)
	}
	// crash between the durable retirement and the ACK: the retry marker is the surviving protocol state
	second := newLife(t, n, 1<<20)
	if n.pendingCount() != 0 {
		t.Fatal("confirmed content kept")
	}
	buffered, err := second.store.GetBufferedEvent(r.ctx, [32]byte{'m', '1'})
	if err != nil || buffered == nil || buffered.Pending {
		t.Fatalf("completed marker missing: %v %v", buffered, err)
	}
	// A later recoverable delivery of the same message gets a new deliveryId but the same message.id.
	app2 := second.subscribe("a")
	second.coord.Start()
	again := second.receive("m1", "hola")
	_ = again
	d2 := app2.take(t)
	if d2.ID == d.ID {
		t.Fatal("expected a new deliveryId")
	}
	var a, b struct {
		ID string `json:"id"`
	}
	_ = jsonUnmarshal(d.Message, &a)
	_ = jsonUnmarshal(d2.Message, &b)
	if a.ID == "" || a.ID != b.ID {
		t.Fatal("message.id changed")
	}
	app2.persist(d2)
	if err := second.coord.Confirm(d2.ID); err != nil {
		t.Fatal(err)
	}
	if app2.effects != 1 {
		t.Fatalf("duplicate message produced %d logical effects", app2.effects)
	}
}
