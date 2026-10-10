package receive

import (
	"testing"
	"time"
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
