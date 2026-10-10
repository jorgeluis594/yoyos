package receive

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/identity"
	"yoyos-whatsapp/internal/normalization"
	"yoyos-whatsapp/internal/protocolstore"
)

var (
	phone = types.JID{User: "34600", Server: types.DefaultUserServer}
	lid   = types.JID{User: "9001", Server: types.HiddenUserServer}
)

// identityLife adds the late-identity service to a process life, counting what it reports.
type identityLife struct {
	*life
	service     *identity.Service
	unavailable atomic.Int32
	failures    chan error
}

func (l *life) withIdentity() *identityLife {
	il := &identityLife{life: l, failures: make(chan error, 4)}
	il.service = identity.NewService(l.ledger, func() (identity.Account, *store.Device) { return l.store, ownDevice }, identity.Hooks{
		Unavailable: func() { il.unavailable.Add(1) },
		Resolved:    l.coord.Refresh,
		Failure:     func(err error) { il.failures <- err },
	})
	l.t.Cleanup(il.service.Close)
	l.store.SetMappingHook(il.service.Trigger)
	l.recv.hooks.IdentityPending = il.service.Trigger
	return il
}

func (l *life) storeMapping() {
	l.t.Helper()
	if err := l.store.PutLIDMapping(context.Background(), lid, phone); err != nil {
		l.t.Fatal(err)
	}
}

func (n *native) entry(t *testing.T, index int) protocolstore.PendingRecord {
	t.Helper()
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.pending[index]
}

// IT-ID-06: with the own LID known, the content is kept without a provisional public ID and without ACK; reserve is counted.
func TestITID06KeepsPendingIdentityWithoutProvisionalIDOrAck(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	app := l.subscribe("a")
	l.coord.Start()
	r := l.receiveFrom("p1", "hola", phone)
	if r.err != nil {
		t.Fatal(r.err)
	}
	if r.ack(t) {
		t.Fatal("ACK granted for content without a definitive identity")
	}
	app.none(t)
	entry := n.entry(t, 0)
	if entry.IdentityState != "pendingLid" || len(entry.Message) != 0 || entry.AccountID != account || entry.DeliveryID == "" {
		t.Fatalf("unexpected pending entry %+v", entry)
	}
	insert := entry.PendingInsert
	reserved, err := protocolstore.EntrySize(insert)
	if err != nil {
		t.Fatal(err)
	}
	bare := insert
	bare.IdentityState = "resolved"
	bare.Message = json.RawMessage(`{}`)
	plain, _ := protocolstore.EntrySize(bare)
	if reserved < plain+protocolstore.IdentityReserveBytes/2 {
		t.Fatalf("reserve not counted: %d vs %d", reserved, plain)
	}
}

// IT-ID-06: without a known own LID nothing is admitted under another account.
func TestITID06WithoutOwnLIDAdmitsNothing(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	l.recv.device = &store.Device{ID: ownDevice.ID}
	if _, err := l.recv.PreDecrypt(context.Background(), nil, nil); err == nil {
		t.Fatal("receive admitted without own LID")
	}
	if n.pendingCount() != 0 {
		t.Fatal("pending entry created without own LID")
	}
}

// IT-ID-06: a pending identity keeps its reserve until resolved, so it still occupies budget.
func TestITID06ReserveKeepsOccupyingBudgetUntilResolved(t *testing.T) {
	n := newNative()
	probe := newLife(t, n, 1<<20)
	probe.receiveFrom("p0", "hola", phone).ack(t)
	reserved, _ := protocolstore.EntrySize(n.entry(t, 0).PendingInsert)
	n2 := newNative()
	l := newLife(t, n2, reserved+reserved/2) // room for one reserved entry, not two
	l.coord.Start()
	l.subscribe("a")
	l.receiveFrom("p1", "hola", phone).ack(t)
	second := l.receiveFrom("p2", "hola", phone)
	if second.err == nil {
		t.Fatal("second pending identity fit beside the first one's reserve")
	}
	var typed *protocolstore.Error
	if !errors.As(second.err, &typed) || typed.Code != protocolstore.BufferFull {
		t.Fatalf("unexpected error %v", second.err)
	}
	if n2.pendingCount() != 1 {
		t.Fatalf("rejected admission left %d entries", n2.pendingCount())
	}
}

// IT-ID-07 and UT-ID-07 at integration level: absence is reported once on entering the condition, never per pass.
func TestITID07ReportsUnavailableOnceWithoutPolling(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	il := l.withIdentity()
	l.subscribe("a")
	l.coord.Start()
	l.receiveFrom("p1", "uno", phone).ack(t)
	l.receiveFrom("p2", "dos", phone).ack(t)
	eventually(t, "IDENTITY_UNAVAILABLE", func() bool { return il.unavailable.Load() == 1 })
	for i := 0; i < 3; i++ {
		if _, err := il.service.Resolve(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(60 * time.Millisecond)
	if got := il.unavailable.Load(); got != 1 {
		t.Fatalf("IDENTITY_UNAVAILABLE reported %d times", got)
	}
	// Leaving the condition and entering it again is a new entry.
	l.storeMapping()
	eventually(t, "resolution", func() bool {
		return n.entry(t, 0).IdentityState == "resolved" && n.entry(t, 1).IdentityState == "resolved"
	})
	l.receiveFrom("p3", "tres", types.JID{User: "34999", Server: types.DefaultUserServer}).ack(t)
	eventually(t, "second entry into the condition", func() bool { return il.unavailable.Load() == 2 })
}

// IT-ID-07: an unreadable store is a storage failure, not an absent mapping, and reports no unavailability.
func TestITID07StoreFailureIsNotAbsence(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	il := l.withIdentity()
	l.subscribe("a")
	l.coord.Start()
	l.receiveFrom("p1", "uno", phone).ack(t)
	eventually(t, "first report", func() bool { return il.unavailable.Load() == 1 })
	n.mu.Lock()
	n.failRead = errBoom
	n.mu.Unlock()
	if _, err := il.service.Resolve(context.Background()); err == nil {
		t.Fatal("unreadable ledger treated as no pending entries")
	}
	var typed *protocolstore.Error
	il.service.Trigger()
	select {
	case err := <-il.failures:
		if !errors.As(err, &typed) || typed.Code != protocolstore.StorageFailed {
			t.Fatalf("unclassified failure %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("store failure not reported")
	}
	n.mu.Lock()
	n.failRead = nil
	n.failIdent = errBoom
	n.mu.Unlock()
	l.storeMapping() // the mapping commits, but publishing the identity fails
	select {
	case err := <-il.failures:
		if !errors.As(err, &typed) || typed.Code != protocolstore.UncertainCommit {
			t.Fatalf("unclassified publication failure %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("publication failure not reported")
	}
	if n.entry(t, 0).IdentityState != "pendingLid" || il.unavailable.Load() != 1 {
		t.Fatal("failed publication changed the entry or reported absence")
	}
}

// IT-ID-08: a late mapping completes identity and message together, keeping deliveryId and order, before any event.
func TestITID08LateMappingPublishesIdentityAndMessageBeforeEmission(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	il := l.withIdentity()
	app := l.subscribe("a")
	l.coord.Start()
	l.receiveFrom("p1", "hola", phone).ack(t)
	app.none(t)
	before := n.entry(t, 0)
	l.storeMapping()
	d := app.take(t)
	after := n.entry(t, 0)
	if after.DeliveryID != before.DeliveryID || d.ID != before.DeliveryID {
		t.Fatalf("deliveryId changed: %s -> %s (event %s)", before.DeliveryID, after.DeliveryID, d.ID)
	}
	if after.CreatedRevision != before.CreatedRevision || *after.CreatedOrdinal != *before.CreatedOrdinal {
		t.Fatal("creation order changed")
	}
	var got map[string]any
	if err := json.Unmarshal(d.Message, &got); err != nil {
		t.Fatal(err)
	}
	wantID, _ := identityMessageID(account, lid.String(), "p1")
	if got["id"] != wantID || got["chatId"] != lid.String() || got["accountId"] != account {
		t.Fatalf("message identity %v", got)
	}
	steps := n.log.snapshot()
	if len(steps) < 3 || steps[1] != "identity" || steps[2] != "emit" {
		t.Fatalf("identity not published before the event: %v", steps)
	}
	if il.unavailable.Load() != 1 {
		t.Fatalf("unavailable reported %d times", il.unavailable.Load())
	}
	// ACK still waits for the consumer commit and durable retirement.
	if err := l.coord.Confirm(d.ID); err != nil {
		t.Fatal(err)
	}
	if n.pendingCount() != 0 {
		t.Fatal("confirmed entry not retired")
	}
}

// IT-ID-08: mappings are processed while another delivery waits for confirmation, and unresolved entries never block resolved ones.
func TestITID08MappingProcessedWhileAnotherDeliveryAwaitsConfirmation(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	l.withIdentity()
	app := l.subscribe("a")
	l.coord.Start()
	l.receiveFrom("p1", "pendiente", phone).ack(t) // oldest, unresolved
	first := l.receive("m1", "resuelto uno")       // deliverable, in flight
	d1 := app.take(t)
	first.stillWaiting(t)
	l.storeMapping()
	eventually(t, "identity published while m1 awaits confirmation", func() bool { return n.entry(t, 0).IdentityState == "resolved" })
	app.none(t) // one delivery at a time
	app.persist(d1)
	if err := l.coord.Confirm(d1.ID); err != nil {
		t.Fatal(err)
	}
	if !first.ack(t) {
		t.Fatal("ACK not granted after retirement")
	}
	d2 := app.take(t)
	if d2.ID != n.entry(t, 0).DeliveryID {
		t.Fatal("completed identity was not delivered next")
	}
}

func TestITID08UnresolvedEntryDoesNotBlockOtherChats(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	l.withIdentity()
	app := l.subscribe("a")
	l.coord.Start()
	l.receiveFrom("p1", "pendiente", phone).ack(t)
	l.receive("m1", "otro chat")
	d := app.take(t)
	var m struct {
		WhatsAppMessageID string `json:"whatsappMessageId"`
	}
	_ = json.Unmarshal(d.Message, &m)
	if m.WhatsAppMessageID != "m1" {
		t.Fatalf("delivered %q instead of the resolvable chat", m.WhatsAppMessageID)
	}
}

// IT-ID-08: restart re-evaluates entries with the mapping their own account stored, even if nothing was resolved before the crash.
func TestITID08RestartResolvesFromStoredMapping(t *testing.T) {
	n := newNative()
	l1 := newLife(t, n, 1<<20)
	l1.receiveFrom("p1", "hola", phone).ack(t)
	l1.storeMapping() // no service was running: the process dies before resolving
	l1.coord.Close()
	if n.entry(t, 0).IdentityState != "pendingLid" {
		t.Fatal("setup: entry resolved too early")
	}
	l2 := newLife(t, n, 1<<20)
	il := l2.withIdentity()
	app := l2.subscribe("a")
	l2.coord.Start()
	il.service.Trigger()
	d := app.take(t)
	if d.ID != n.entry(t, 0).DeliveryID || n.entry(t, 0).IdentityState != "resolved" {
		t.Fatal("restart did not complete the stored identity")
	}
	if il.unavailable.Load() != 0 {
		t.Fatal("unavailability reported although the mapping was already stored")
	}
}

// IT-ID-08: entries of another account are never resolved with this account's mappings.
func TestITID08ForeignAccountEntryStaysPending(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	il := l.withIdentity()
	l.storeMapping()
	seed(n, 7, "999@lid", "1", 0, "pendingLid", 0)
	n.pending[0].Recovery.MessageInfoJSON = `{"version":1,"accountId":"999@lid","id":"f1","chat":"34600@s.whatsapp.net","sender":"34600@s.whatsapp.net","timestampSeconds":100}`
	out, err := il.service.Resolve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if out.Resolved != 0 || n.entry(t, 0).IdentityState != "pendingLid" {
		t.Fatalf("foreign entry resolved: %+v", out)
	}
}

// IT-ID-08: the mappings already available are applied synchronously, so they exist before credentials are retired.
func TestITID08ResolvesAvailableMappingsBeforeRetiringCredentials(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	l.receiveFrom("p1", "hola", phone).ack(t)
	l.storeMapping()
	il := l.withIdentity()
	out, err := il.service.Resolve(context.Background())
	if err != nil || out.Resolved != 1 || out.Unresolved != 0 {
		t.Fatalf("resolve %+v %v", out, err)
	}
	if n.entry(t, 0).IdentityState != "resolved" || len(n.entry(t, 0).Message) == 0 {
		t.Fatal("identity not durable when Resolve returned")
	}
}

// IT-ID-08: completing the identity never needs more than the reserve, so publication cannot overflow the budget.
func TestITID08ResolvedEntryFitsWithinItsReserve(t *testing.T) {
	n := newNative()
	l := newLife(t, n, 1<<20)
	l.receiveFrom("p1", "hola", phone).ack(t)
	pending := n.entry(t, 0)
	reserved, _ := protocolstore.EntrySize(pending.PendingInsert)
	l.storeMapping()
	il := l.withIdentity()
	if _, err := il.service.Resolve(context.Background()); err != nil {
		t.Fatal(err)
	}
	resolved, _ := protocolstore.EntrySize(n.entry(t, 0).PendingInsert)
	if resolved > reserved {
		t.Fatalf("resolved entry needs %d bytes, reserve covered %d", resolved, reserved)
	}
}

func identityMessageID(account, chat, id string) (string, error) {
	return normalization.MessageID(account, chat, id)
}
