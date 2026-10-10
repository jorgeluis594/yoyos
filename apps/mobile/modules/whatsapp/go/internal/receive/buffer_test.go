package receive

import (
	"errors"
	"strings"
	"testing"
	"time"

	"yoyos-whatsapp/internal/protocolstore"
)

func entrySize(t *testing.T, n *native, index int) int64 {
	t.Helper()
	n.mu.Lock()
	defer n.mu.Unlock()
	size, err := protocolstore.EntrySize(n.pending[index].PendingInsert)
	if err != nil {
		t.Fatal(err)
	}
	return size
}

// measure admits one message into a roomy buffer and reports its budget bytes.
func measure(t *testing.T, id, text string) int64 {
	n := newNative()
	l := newLife(t, n, 1<<20)
	if r := l.receive(id, text); r.err != nil {
		t.Fatal(r.err)
	}
	return entrySize(t, n, 0)
}

func isBufferFull(err error) (*protocolstore.Error, bool) {
	var typed *protocolstore.Error
	if errors.As(err, &typed) && typed.Code == protocolstore.BufferFull {
		return typed, true
	}
	return nil, false
}

// IT-BUF-02: exactly the budget is admitted; one byte less is rejected without a partial commit.
func TestITBUF02AdmitsExactLimitAndRejectsOneByteLess(t *testing.T) {
	size := measure(t, "m1", "hola")
	for _, c := range []struct {
		name  string
		limit int64
		full  bool
	}{{"one byte above", size + 1, false}, {"exact", size, false}, {"one byte below", size - 1, true}} {
		t.Run(c.name, func(t *testing.T) {
			n := newNative()
			l := newLife(t, n, c.limit)
			r := l.receive("m1", "hola")
			typed, full := isBufferFull(r.err)
			if full != c.full {
				t.Fatalf("limit %d: err=%v", c.limit, r.err)
			}
			if c.full {
				if !typed.Oversize || n.pendingCount() != 0 || len(n.records) != 0 || n.revision != 0 {
					t.Fatal("a rejected entry was partially committed")
				}
			} else if n.pendingCount() != 1 {
				t.Fatal("admissible entry not committed")
			}
		})
	}
}

// IT-BUF-02 (batch): a set that reaches the limit is admitted whole, one byte more is not.
func TestITBUF02BatchIsAtomicAtTheLimit(t *testing.T) {
	a, b := int64(100), int64(250)
	for _, c := range []struct {
		limit int64
		want  protocolstore.Decision
	}{{a + b, protocolstore.Admit}, {a + b - 1, protocolstore.Reject}, {a + b + 1, protocolstore.Admit}} {
		if got := protocolstore.Decide(c.limit, 0, a, b); got != c.want {
			t.Fatalf("limit %d: %v", c.limit, got)
		}
	}
}

// IT-BUF-01: the budget counts the normalized message and recovery data, not downloaded images.
func TestITBUF01CountsNormalizedContentAndRecoveryTogether(t *testing.T) {
	short, long := measure(t, "m1", "a"), measure(t, "m1", strings.Repeat("a", 4000))
	if long-short < 2*3999 { // text appears in the message and again in the recovery plaintext
		t.Fatalf("content not counted twice: %d vs %d", short, long)
	}
}

// IT-BUF-03: a full buffer pauses, still accepts confirmations, and resumes only once the rejected entry fits.
func TestITBUF03PausesAndResumesOnlyWhenRejectedEntryFits(t *testing.T) {
	small := measure(t, "s1", "a")
	big := measure(t, "bg", strings.Repeat("b", 3000))
	limit := small + big - 1 // the big entry fits alone, and beside no small one
	n := newNative()
	l := newLife(t, n, limit)
	app := l.subscribe("a")
	l.coord.Start()
	r1, r2 := l.receive("s1", "a"), l.receive("s2", "a")
	if r1.err != nil || r2.err != nil {
		t.Fatal(r1.err, r2.err)
	}
	r3 := l.receive("bg", strings.Repeat("b", 3000))
	typed, full := isBufferFull(r3.err)
	if !full || typed.Oversize || typed.Needed != big {
		t.Fatalf("expected a temporary capacity stop: %v", r3.err)
	}
	eventually(t, "capacity pause", func() bool { return l.capacity.Load() == 1 })
	if n.pendingCount() != 2 {
		t.Fatal("the buffer was not paused with its pendings preserved")
	}
	first := app.take(t)
	app.persist(first)
	if err := l.coord.Confirm(first.ID); err != nil { // confirmations stay available while paused
		t.Fatal(err)
	}
	select {
	case <-l.resumes:
		t.Fatal("resumed although the rejected entry still does not fit")
	case <-time.After(100 * time.Millisecond):
	}
	second := app.take(t)
	t.Logf("first=%s second=%s", first.ID, second.ID)
	if err := l.coord.Confirm(second.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-l.resumes:
	case <-time.After(2 * time.Second):
		t.Fatalf("did not resume after enough capacity was freed (pending=%d stops=%d limit=%d big=%d small=%d)", n.pendingCount(), len(l.stops), limit, big, small)
	}
	select {
	case <-l.resumes:
		t.Fatal("resumed twice for one pause")
	case <-time.After(80 * time.Millisecond):
	}
}

// IT-BUF-04: an entry larger than the whole budget is reported, drops nothing and never waits for space.
func TestITBUF04OversizeEntryIsRejectedWithoutRetryLoop(t *testing.T) {
	small := measure(t, "s1", "a")
	limit := small + 200
	n := newNative()
	l := newLife(t, n, limit)
	app := l.subscribe("a")
	l.coord.Start()
	if r := l.receive("s1", "a"); r.err != nil {
		t.Fatal(r.err)
	}
	r := l.receive("big", strings.Repeat("x", 5000))
	typed, full := isBufferFull(r.err)
	if !full || !typed.Oversize {
		t.Fatalf("oversize not reported: %v", r.err)
	}
	eventually(t, "oversize stop", func() bool { return l.oversize.Load() == 1 })
	if l.capacity.Load() != 0 {
		t.Fatal("an oversize entry paused for capacity")
	}
	d := app.take(t)
	if err := l.coord.Confirm(d.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-l.resumes:
		t.Fatal("space was freed but an oversize entry can never fit")
	case <-time.After(120 * time.Millisecond):
	}
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); time.Sleep(5 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("timed out: %s", what)
}
