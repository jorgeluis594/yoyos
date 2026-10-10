package receive

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"go.mau.fi/whatsmeow/types/events"
	"strings"
	"testing"
	"time"

	"yoyos-whatsapp/internal/delivery"
	"yoyos-whatsapp/internal/protocolstate"
	"yoyos-whatsapp/internal/protocolstore"
)

func did(n int) string { return fmt.Sprintf("wa-delivery:v1:%032x", n) }

// seed adds a durable pending entry as an earlier life or another account left it.
func seed(n *native, id int, owner string, revision string, ordinal uint32, state string, timestamp int64) {
	rec := protocolstore.PendingRecord{CreatedRevision: revision, CreatedOrdinal: &ordinal}
	rec.DeliveryID, rec.AccountID, rec.Source, rec.IdentityState = did(id), owner, "live", state
	info, _ := json.Marshal(map[string]any{"version": 1, "accountId": owner, "id": fmt.Sprint("seed", id), "chat": "555@lid", "sender": "555@lid", "timestampSeconds": 100})
	rec.Recovery = protocolstore.Recovery{MessageInfoJSON: string(info), Items: []protocolstore.RecoveryItem{{Format: "v2", PlaintextBase64: base64.StdEncoding.EncodeToString([]byte("p")), CiphertextHashBase64: base64.StdEncoding.EncodeToString(make([]byte, 32))}}}
	if state == "resolved" {
		rec.Message = json.RawMessage(fmt.Sprintf(`{"id":"wa-message:v1:seed%d","timestamp":%d}`, id, timestamp))
	}
	n.mu.Lock()
	n.pending = append(n.pending, rec)
	if v, _ := parseRev(revision); v > n.revision {
		n.revision = v
	}
	n.mu.Unlock()
}
func parseRev(s string) (uint64, error) {
	var v uint64
	_, err := fmt.Sscan(s, &v)
	return v, err
}

// IT-DEL-06: recovery and new reception share one public delivery, ordered by revision and ordinal, not by message date.
func TestITDEL06RecoveryAndNewReceptionShareOneOrderedDelivery(t *testing.T) {
	n := newNative()
	seed(n, 2, account, "9", 1, "resolved", 5000) // newest message date, but created first
	seed(n, 1, account, "9", 0, "resolved", 9000)
	seed(n, 3, account, "10", 0, "resolved", 1)
	l := newLife(t, n, 1<<20)
	app := l.subscribe("a")
	started := make(chan struct{})
	go func() { l.coord.Start(); close(started) }()
	select { // initialization does not wait for the confirmations
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("Start waited for confirmations")
	}
	live := l.receive("m-live", "nuevo")
	live.stillWaiting(t)
	for i, want := range []string{did(1), did(2), did(3)} {
		d := app.take(t)
		if d.ID != want {
			t.Fatalf("delivery %d was %s, want %s", i, d.ID, want)
		}
		app.none(t) // exactly one at a time
		if err := l.coord.Confirm(d.ID); err != nil {
			t.Fatal(err)
		}
	}
	d := app.take(t) // the new reception is last in the same traversal
	if !strings.Contains(string(d.Message), "wa-message:v1:") {
		t.Fatal("expected the live delivery")
	}
	app.persist(d)
	_ = l.coord.Confirm(d.ID)
	if !live.ack(t) {
		t.Fatal("live handler not released")
	}
}

// IT-DEL-07 and IT-DEL-08: durable idempotent retirement; a lost reply is resolved by repeating; failures are not absence.
func TestITDEL07And08RetireIdempotentAndLostReplyRepeatable(t *testing.T) {
	n := newNative()
	seed(n, 1, account, "5", 0, "resolved", 1)
	seed(n, 2, account, "5", 1, "resolved", 1)
	l := newLife(t, n, 1<<20)
	n.set(func() { n.loseRetire = true })
	if err := l.coord.Confirm(did(1)); err == nil {
		t.Fatal("a lost reply must surface as an error")
	}
	if n.pendingCount() != 1 {
		t.Fatal("the retirement did not persist")
	}
	if err := l.coord.Confirm(did(1)); err != nil { // repeat resolves it
		t.Fatal(err)
	}
	if n.pendingCount() != 1 {
		t.Fatal("repeating the confirmation removed another entry")
	}
	if err := l.coord.Confirm(did(9)); err != nil { // valid, absent
		t.Fatal(err)
	}
	if err := l.coord.Confirm("wa-delivery:v1:zz"); err == nil {
		t.Fatal("malformed ID accepted")
	}
	n.set(func() { n.failRetire = errBoom })
	if err := l.coord.Confirm(did(2)); err == nil || n.pendingCount() != 1 {
		t.Fatal("a failed write was reported as success or removed content")
	}
	n.set(func() { n.failRetire, n.failRead = nil, errBoom })
	if _, err := l.ledger.Retire(did(2)); err != nil { // retirement does not read the list
		t.Fatal(err)
	}
	if _, err := l.ledger.Pending(); err == nil {
		t.Fatal("an unreadable ledger was reported as empty")
	}
}

// IT-DEL-09: confirmation of another account's delivery is valid with a different active account or no credentials.
func TestITDEL09ConfirmsForeignAccountWithoutCredentials(t *testing.T) {
	n := newNative()
	seed(n, 1, "999@lid", "5", 0, "resolved", 1)
	seed(n, 2, "999@lid", "5", 1, "resolved", 1)
	ledger, err := protocolstore.NewLedger(n, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	c := delivery.New(ledger, 1<<20, delivery.Hooks{})
	t.Cleanup(c.Close)
	app := newConsumerApp(n.log)
	c.SetConsumer(consumerOf("a", app))
	c.Start()
	first := app.take(t)
	if err := c.Confirm(first.ID); err != nil { // no Store, no client, no network
		t.Fatal(err)
	}
	if err := c.Confirm(first.ID); err != nil {
		t.Fatal(err)
	}
	if second := app.take(t); second.ID != did(2) {
		t.Fatalf("got %s", second.ID)
	}
}

// IT-DEL-10: pending entries never expire, and confirming removes the whole entry including its content.
func TestITDEL10PendingNeverExpiresAndConfirmationRemovesWholeEntry(t *testing.T) {
	n := newNative()
	first := newLife(t, n, 1<<20)
	first.subscribe("a")
	first.coord.Start()
	first.receive("m1", "contenido-secreto")
	d := first.consumer.take(t)
	time.Sleep(50 * time.Millisecond)
	later := newLife(t, n, 1<<20) // arbitrarily later: there is no age check
	if n.pendingCount() != 1 {
		t.Fatal("an unconfirmed pending expired")
	}
	if err := later.coord.Confirm(d.ID); err != nil {
		t.Fatal(err)
	}
	state, _ := n.ReadState("")
	pending, _ := n.ReadPending("")
	plain := base64.StdEncoding.EncodeToString([]byte("contenido-secreto"))
	for _, raw := range []string{state, pending} {
		if strings.Contains(raw, "contenido-secreto") || strings.Contains(raw, "wa-message:v1:") || strings.Contains(raw, plain) {
			t.Fatal("confirmed content stayed in the container")
		}
	}
	if len(n.records) == 0 {
		t.Fatal("protocol retry marker must remain")
	}
	_ = protocolstate.Record{}
}

// IT-DEL-11: resolved pending entries are delivered without network, credentials or a valid session.
func TestITDEL11RecoversWithoutSessionOrNetwork(t *testing.T) {
	n := newNative()
	n.sessionRev, n.revision = 1, 1 // a session whose account does not match: Open fails with a session fault
	n.records["x"] = protocolstate.Record{RecordType: "device", RecordKey: "x", ValueBase64: "AA=="}
	seed(n, 1, "999@lid", "1", 0, "resolved", 1)
	if _, err := protocolstore.Open(n, "gen", account, 1<<20, 1<<20); err == nil {
		t.Fatal("expected an exclusive session failure")
	}
	ledger, err := protocolstore.NewLedger(n, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	c := delivery.New(ledger, 1<<20, delivery.Hooks{})
	t.Cleanup(c.Close)
	app := newConsumerApp(n.log)
	c.SetConsumer(consumerOf("a", app))
	c.Start()
	d := app.take(t)
	if d.ID != did(1) || !strings.Contains(string(d.Message), "seed1") {
		t.Fatal("origin data changed")
	}
	if err := c.Confirm(d.ID); err != nil {
		t.Fatal(err)
	}
}

// IT-DEL-01 corollary: a message without a resolved identity never receives ACK permission in this task.
func TestUnresolvedIdentityNeverGrantsAck(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	l.subscribe("a")
	l.coord.Start()
	// A PN-addressed chat with no verified LID mapping is unresolved.
	seed(n, 1, account, "1", 0, "pendingLid", 0)
	n.pending[0].Recovery.MessageInfoJSON = `{"version":1,"accountId":"123@lid","id":"u1","chat":"777@s.whatsapp.net","sender":"777@s.whatsapp.net","timestampSeconds":100}`
	if _, found, err := l.recv.find(infoFor("u1", "777@s.whatsapp.net")); err != nil || !found {
		t.Fatalf("lookup %v %v", found, err)
	}
	l.consumer.none(t) // pendingLid is skipped, not emitted
}

// m2: an unreadable ledger while deciding the ACK is a storage failure, and the ACK stays withheld.
func TestHandleReadFailureIsReportedAsStorageFailure(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	failures := make(chan error, 1)
	l.recv.hooks.LocalFailure = func(err error) { failures <- err }
	n.set(func() { n.failRead = errBoom })
	info := infoFor("m1", "555@lid")
	if l.recv.Handle(t.Context(), &events.Message{Info: info}) {
		t.Fatal("ACK permitted although the ledger could not be read")
	}
	select {
	case err := <-failures:
		var typed *protocolstore.Error
		if !errors.As(err, &typed) || typed.Code != protocolstore.StorageFailed {
			t.Fatalf("unclassified failure: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("read failure not reported")
	}
}
