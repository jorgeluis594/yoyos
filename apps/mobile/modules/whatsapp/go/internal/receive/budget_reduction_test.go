package receive

import (
	"testing"
	"time"
	"yoyos-whatsapp/internal/protocolstore"
)

// IT-CFG-06: after the budget is reduced below what is stored, the stored entries survive a
// restart, are delivered in order and can be confirmed; a new admission waits (it is not
// discarded and nothing is dropped) until the excess drained far enough for it to fit.
func TestITCFG06PendingAboveAReducedBudgetIsKeptDeliveredAndDrained(t *testing.T) {
	size := measure(t, "s1", "a")
	n := newNative()
	roomy := newLife(t, n, 1<<20)
	for _, id := range []string{"s1", "s2", "s3"} {
		if r := roomy.receive(id, "a"); r.err != nil {
			t.Fatal(r.err)
		}
	}
	roomy.coord.Close()

	// New process life, reduced budget: one entry fits, three are stored.
	l := newLifeBound(t, n, 1<<20, size)
	app := l.subscribe("a")
	l.coord.Start()
	if n.pendingCount() != 3 {
		t.Fatalf("a reduction discards nothing: %d", n.pendingCount())
	}
	late := l.receive("s4", "a")
	if typed, full := isBufferFull(late.err); !full || typed.Oversize {
		t.Fatalf("a new admission waits for capacity instead of being dropped: %v", late.err)
	}
	eventually(t, "capacity pause", func() bool { return l.capacity.Load() == 1 })

	var ids []string
	for i := 0; i < 3; i++ {
		d := app.take(t) // readable after the reduction, in creation order
		app.persist(d)
		ids = append(ids, d.ID)
		if i < 2 {
			if err := l.coord.Confirm(d.ID); err != nil { // confirmation is available over the limit
				t.Fatal(err)
			}
			select {
			case <-l.resumes:
				t.Fatalf("resumed after %d confirmations although the excess is not drained", i+1)
			case <-time.After(60 * time.Millisecond):
			}
		}
	}
	if err := l.coord.Confirm(ids[2]); err != nil {
		t.Fatal(err)
	}
	select {
	case <-l.resumes:
	case <-time.After(2 * time.Second):
		t.Fatal("admission did not resume once the excess drained")
	}
	if n.pendingCount() != 0 {
		t.Fatalf("everything drained by confirmations: %d", n.pendingCount())
	}
	// Resuming reopens the store from the published state, as the connection does after a pause.
	resumed := newLifeBound(t, n, 1<<20, size)
	if r := resumed.receive("s4", "a"); r.err != nil {
		t.Fatalf("the waiting message is admitted after draining: %v", r.err)
	}
}

// IT-CFG-09: the budget belongs to the installation: entries of another account count against the
// same budget (a second account does not get a second one), and stay deliverable and confirmable.
func TestITCFG09BudgetIsSharedAcrossAccounts(t *testing.T) {
	size := measure(t, "s1", "a")
	n := newNative()
	seed(n, 1, otherAccount, "1", 0, "resolved", 10) // another account's message, already stored
	used := entrySize(t, n, 0)
	l := newLife(t, n, used+size-1) // room for the old entry plus one byte short of a new one
	app := l.subscribe("a")
	l.coord.Start()
	if typed, full := isBufferFull(l.receive("s1", "a").err); !full || typed.Oversize {
		t.Fatalf("the new account shares the same budget: %v", full)
	}
	d := app.take(t)
	if d.ID != did(1) {
		t.Fatalf("the previous account's message is still delivered: %s", d.ID)
	}
	app.persist(d)
	if err := l.coord.Confirm(d.ID); err != nil {
		t.Fatal(err)
	}
}

// M1 (review of PR #52) / IT-CFG-06 / IT-CFG-07: after the budget is reduced below what is stored,
// pendingLid entries still resolve when their mapping arrives, are delivered and drain. The fake
// native applies the same rule as Kotlin and Swift, which used to refuse every publication whose
// resulting pending set exceeded the reduced budget, identity resolution included.
func TestM1PendingLidAboveAReducedBudgetResolvesDeliversAndDrains(t *testing.T) {
	n := newNative()
	roomy := newLife(t, n, 1<<20)
	for _, id := range []string{"p1", "p2", "p3"} {
		if r := roomy.receiveFrom(id, "hola", phone); r.err != nil {
			t.Fatal(r.err)
		}
	}
	roomy.coord.Close()
	reserved, _ := protocolstore.EntrySize(n.entry(t, 0).PendingInsert)

	n.set(func() { n.budget, n.readBound = 300, 1<<20 }) // native: far below what three entries occupy
	l := newLifeBound(t, n, 1<<20, reserved)
	il := l.withIdentity()
	app := l.subscribe("a")
	l.coord.Start()
	app.none(t) // unresolved entries are not deliverable yet
	if n.pendingCount() != 3 {
		t.Fatalf("a reduction discards nothing: %d", n.pendingCount())
	}

	l.storeMapping()
	for i := 0; i < 3; i++ {
		d := app.take(t) // resolved by the mapping, delivered in order
		app.persist(d)
		if err := l.coord.Confirm(d.ID); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case err := <-il.failures:
		t.Fatalf("the identity publication was refused: %v", err)
	default:
	}
	if n.pendingCount() != 0 {
		t.Fatalf("everything drained: %d", n.pendingCount())
	}
}

// The same native rule still refuses growth: an insertion above the reduced budget is rejected.
func TestM1NativeRuleStillRefusesInsertionsAboveTheBudget(t *testing.T) {
	n := newNative()
	roomy := newLife(t, n, 1<<20)
	roomy.receive("s1", "a").ack(t)
	n.set(func() { n.budget, n.readBound = 300, 1<<20 })
	l := newLifeBound(t, n, 1<<20, 1<<20) // Go would admit; the native store must still refuse growth
	l.coord.Start()
	if r := l.receive("s2", "a"); r.err == nil {
		t.Fatal("an insertion above the budget must be refused natively")
	}
	if n.pendingCount() != 1 {
		t.Fatal("rejected insertion left an entry")
	}
}
