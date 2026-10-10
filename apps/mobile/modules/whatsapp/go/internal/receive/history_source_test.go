package receive

import (
	"context"
	"errors"
	"testing"
	"time"

	"yoyos-whatsapp/internal/protocolstore"
)

// batchPublications counts the publications that carried historical messages, not captures.
func batchPublications(n *native) (count int) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, r := range n.requests {
		if len(r.PendingInserts) > 0 && r.PendingInserts[0].Source == "history" && !protocolstore.IsHistoryNotification(r.PendingInserts[0]) {
			count++
		}
	}
	return
}

// IT-HIS-07: the notification ACK, the hist_sync receipt and the remote deletion are three
// separate steps, each recorded where it happens, and none runs before what it releases is durable.
func TestITHIS07OrdersAckReceiptAndDeletionAfterDurability(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	var early []string
	durable := func(step string) func() {
		return func() {
			if messages, _ := n.historyEntries(); messages != 3 {
				early = append(early, step)
			}
		}
	}
	remote.onReceipt, remote.onDelete = durable("receipt"), durable("delete")
	h := newHistoryLife(t, n, bigBuffer, remote)
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
	if !grant.ack(t) {
		t.Fatal("a captured notification is acknowledged")
	}
	if fetches, _, _, receipts, deletes := remote.counts(); fetches != 0 || receipts != 0 || deletes != 0 {
		t.Fatalf("the ACK needs only the capture, with no consumer and before the batch: %d %d %d", fetches, receipts, deletes)
	}
	h.mustDrain()
	if len(early) != 0 {
		t.Fatalf("%v ran before the batch was durable", early)
	}
	steps := n.log.snapshot()
	order := []string{"commit", "ack", "fetch", "stage", "commit", "receipt", "delete", "retire"}
	at := -1
	for _, step := range order {
		next := indexOf(steps, step, at+1)
		if next < 0 {
			t.Fatalf("step %q missing or out of order in %v", step, steps)
		}
		at = next
	}
	if messages, captures := n.historyEntries(); messages != 3 || captures != 0 {
		t.Fatalf("the capture retires, the admitted messages stay until the consumer confirms: %d %d", messages, captures)
	}
}

// IT-HIS-07: a receipt that fails keeps the capture and the remote batch; the next life
// completes the release without admitting the batch a second time.
func TestITHIS07AFailedReceiptKeepsTheCaptureAndNeverRepeatsTheBatch(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
	grant.ack(t)
	remote.mu.Lock()
	remote.receiptEr = errors.New("receipt could not be sent")
	remote.mu.Unlock()
	if err := h.drain(context.Background()); err == nil {
		t.Fatal("a failed receipt leaves the pass unfinished")
	}
	if _, _, _, receipts, deletes := remote.counts(); receipts != 1 || deletes != 0 {
		t.Fatalf("no deletion after a receipt that failed: %d %d", receipts, deletes)
	}
	if messages, captures := n.historyEntries(); messages != 3 || captures != 1 {
		t.Fatalf("the batch is durable and the capture still stands: %d %d", messages, captures)
	}

	remote.mu.Lock()
	remote.receiptEr = nil
	remote.mu.Unlock()
	fetches, _, _, _, _ := remote.counts()
	next := newHistoryLife(t, n, bigBuffer, remote)
	next.mustDrain()
	if again, _, _, receipts, deletes := remote.counts(); again != fetches || receipts != 2 || deletes != 1 {
		t.Fatalf("the retry only releases: fetches %d->%d receipts %d deletes %d", fetches, again, receipts, deletes)
	}
	if batchPublications(n) != 1 {
		t.Fatalf("the batch was published exactly once, got %d", batchPublications(n))
	}
	if messages, captures := n.historyEntries(); messages != 3 || captures != 0 {
		t.Fatalf("released: %d %d", messages, captures)
	}
}

// IT-HIS-07: a failed remote deletion neither blocks the release nor admits the batch again.
func TestITHIS07AFailedDeletionIsOnlyBestEffort(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	remote.deleteErr = errors.New("server refused deletion")
	h := newHistoryLife(t, n, bigBuffer, remote)
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
	grant.ack(t)
	h.mustDrain()
	if _, _, _, receipts, deletes := remote.counts(); receipts != 1 || deletes != 1 {
		t.Fatalf("%d %d", receipts, deletes)
	}
	if messages, captures := n.historyEntries(); messages != 3 || captures != 0 {
		t.Fatalf("the local copy is complete, so the capture retires anyway: %d %d", messages, captures)
	}
	if batchPublications(n) != 1 {
		t.Fatal("published once")
	}
}

// IT-HIS-08: a capture interrupted inside the decryption transaction leaves nothing, and the
// redelivered ciphertext is captured whole.
func TestITHIS08InterruptedCaptureLeavesNothingAndIsRedelivered(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	notification := remote.serve(t, "/v/batch", supportedBatch())
	n.set(func() { n.failApply = errBoom })
	failed, _ := h.capture("notif-1", notification)
	if failed.err == nil {
		t.Fatal("the interrupted capture reports its failure and is not acknowledged")
	}
	if n.pendingCount() != 0 {
		t.Fatal("an interrupted capture publishes nothing")
	}
	n.set(func() { n.failApply = nil })
	next := newHistoryLife(t, n, bigBuffer, remote)
	grant, _ := next.capture("notif-1", notification)
	if !grant.ack(t) {
		t.Fatal("the redelivery is captured and acknowledged")
	}
	next.mustDrain()
	if messages, captures := n.historyEntries(); messages != 3 || captures != 0 {
		t.Fatalf("%d %d", messages, captures)
	}
}

// IT-HIS-08: the batch survives every later interruption; none of them depends on the remote reference again.
func TestITHIS08RecoversAfterInterruptionsAtEachStage(t *testing.T) {
	t.Run("after the capture, before the download", func(t *testing.T) {
		n := newNative()
		remote := defaultRemote(n)
		h := newHistoryLife(t, n, bigBuffer, remote)
		grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
		grant.ack(t)
		next := newHistoryLife(t, n, bigBuffer, remote) // the process died; nothing but the container survives
		next.mustDrain()
		if messages, captures := n.historyEntries(); messages != 3 || captures != 0 {
			t.Fatalf("%d %d", messages, captures)
		}
	})
	t.Run("during the download", func(t *testing.T) {
		n := newNative()
		remote := defaultRemote(n)
		h := newHistoryLife(t, n, bigBuffer, remote)
		grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
		grant.ack(t)
		gate := make(chan struct{})
		remote.mu.Lock()
		remote.gate = gate
		remote.mu.Unlock()
		ctx, die := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { done <- h.drain(ctx) }()
		eventually(t, "the download to start", func() bool { f, _, _, _, _ := remote.counts(); return f == 1 })
		die()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("%v", err)
		}
		if messages, captures := n.historyEntries(); messages != 0 || captures != 1 {
			t.Fatalf("an interrupted download leaves the capture and nothing else: %d %d", messages, captures)
		}
		remote.mu.Lock()
		remote.gate = nil
		remote.mu.Unlock()
		newHistoryLife(t, n, bigBuffer, remote).mustDrain()
		if messages, captures := n.historyEntries(); messages != 3 || captures != 0 {
			t.Fatalf("%d %d", messages, captures)
		}
	})
	t.Run("during the admission", func(t *testing.T) {
		n := newNative()
		remote := defaultRemote(n)
		h := newHistoryLife(t, n, bigBuffer, remote)
		grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
		grant.ack(t)
		n.set(func() { n.failApply = errBoom })
		_ = h.drain(context.Background())
		n.set(func() { n.failApply = nil })
		if messages, captures := n.historyEntries(); messages != 0 || captures != 1 || n.hasRecord("lid-mapping") {
			t.Fatalf("nothing partial: %d %d", messages, captures)
		}
		newHistoryLife(t, n, bigBuffer, remote).mustDrain()
		if messages, captures := n.historyEntries(); messages != 3 || captures != 0 || batchPublications(n) != 1 {
			t.Fatalf("%d %d", messages, captures)
		}
	})
	t.Run("after the admission, during the delivery", func(t *testing.T) {
		n := newNative()
		remote := defaultRemote(n)
		h := newHistoryLife(t, n, bigBuffer, remote)
		app := h.subscribe("c1")
		grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
		grant.ack(t)
		h.mustDrain()
		first := app.take(t)
		if err := h.coord.Confirm(first.ID); err != nil {
			t.Fatal(err)
		}
		// the process dies with two messages unconfirmed; the remote batch is gone for good
		remote.mu.Lock()
		remote.fetchErr = errors.New("remote batch deleted")
		remote.mu.Unlock()
		fetches, _, _, _, _ := remote.counts()
		next := newHistoryLife(t, n, bigBuffer, remote)
		again := next.subscribe("c2")
		var got []string
		for range 2 {
			d := again.take(t)
			got = append(got, d.ID)
			if err := next.coord.Confirm(d.ID); err != nil {
				t.Fatal(err)
			}
		}
		if got[0] == first.ID || got[1] == first.ID || got[0] == got[1] {
			t.Fatalf("the confirmed message is not delivered again: %v", got)
		}
		next.mustDrain()
		if after, _, _, _, _ := remote.counts(); after != fetches {
			t.Fatalf("delivery recovery never goes back to the remote reference: %d -> %d", fetches, after)
		}
		eventually(t, "all history retired", func() bool { return n.pendingCount() == 0 })
	})
	t.Run("a rejected batch is not recoverable forever", func(t *testing.T) {
		limits := defaultRemote(newNative()).limits
		limits.MaxInflated = 8
		n := newNative()
		remote := newRemote(n.log, limits)
		h := newHistoryLife(t, n, bigBuffer, remote)
		grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
		grant.ack(t)
		h.mustDrain()
		fetches, _, _, _, _ := remote.counts()
		next := newHistoryLife(t, n, bigBuffer, remote)
		next.mustDrain()
		if after, _, _, _, _ := remote.counts(); after != fetches || n.pendingCount() != 0 {
			t.Fatalf("a rejected batch stays rejected across lives: %d -> %d, %d pending", fetches, after, n.pendingCount())
		}
	})
}

// A history message whose chat has no mapping yet is kept without identity and completed by the
// same resolver as live content once the mapping arrives.
func TestHistoryPendingIdentityResolvesLikeLiveContent(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	il := h.withIdentity()
	app := h.subscribe("c1")
	b := batchOf(conversationOf(phone.String(), textMessage("late-1", phone.String(), 1700000001, "who is this")))
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", b))
	grant.ack(t)
	h.mustDrain()
	select {
	case pending := <-h.admitted:
		if !pending {
			t.Fatal("the admission reports identity still pending")
		}
	case <-time.After(time.Second):
		t.Fatal("admission not reported")
	}
	if messages, captures := n.historyEntries(); messages != 1 || captures != 0 {
		t.Fatalf("%d %d", messages, captures)
	}
	if n.entry(t, 0).IdentityState != "pendingLid" || len(n.entry(t, 0).Message) != 0 {
		t.Fatal("no provisional identity")
	}
	app.none(t)
	h.storeMapping() // the account's own store learns phone -> lid
	d := app.take(t)
	if d.ID == "" {
		t.Fatal("resolved and delivered")
	}
	_ = il
}
