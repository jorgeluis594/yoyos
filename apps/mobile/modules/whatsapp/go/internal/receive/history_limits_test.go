package receive

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/history"
)

// IT-HIS-04: one batch at a time; the next one is not even downloaded until the previous
// one is published, and nothing is spooled outside the agreed buffer.
func TestITHIS04ProcessesOneBatchAtATime(t *testing.T) {
	spool := t.TempDir()
	t.Setenv("TMPDIR", spool)
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	one := batchOf(conversationOf("501@lid", numbered("one-", "501@lid", 3, "first")...))
	two := batchOf(conversationOf("502@lid", numbered("two-", "502@lid", 3, "second")...))
	first, _ := h.capture("notif-1", remote.serve(t, "/v/one", one))
	second, _ := h.capture("notif-2", remote.serve(t, "/v/two", two))
	first.ack(t)
	second.ack(t)
	if messages, captures := n.historyEntries(); messages != 0 || captures != 2 {
		t.Fatalf("both notifications are captured, no batch is in memory yet: %d %d", messages, captures)
	}

	gate := make(chan struct{})
	remote.mu.Lock()
	remote.gate = gate
	remote.mu.Unlock()
	var passes sync.WaitGroup
	for range 2 { // overlapping triggers, as a connection event and a captured notification would
		passes.Add(1)
		go func() { defer passes.Done(); _ = h.drain(t.Context()) }()
	}
	time.Sleep(200 * time.Millisecond)
	if fetches, _, _, _, _ := remote.counts(); fetches != 1 {
		t.Fatalf("the second batch must not be fetched while the first is in hand: %d fetches", fetches)
	}
	close(gate)
	passes.Wait()

	remote.mu.Lock()
	peak := remote.maxRunning
	remote.mu.Unlock()
	if peak != 1 {
		t.Fatalf("at most one batch in flight, saw %d", peak)
	}
	steps := n.log.snapshot()
	firstFetch := indexOf(steps, "fetch", 0)
	// the two captures commit first; the third commit is the first batch
	firstCommit := indexOf(steps, "commit", indexOf(steps, "commit", indexOf(steps, "commit", 0)+1)+1)
	secondFetch := indexOf(steps, "fetch", firstFetch+1)
	if !(firstFetch < firstCommit && firstCommit < secondFetch) {
		t.Fatalf("batch 1 is published before batch 2 is fetched: %v", steps)
	}
	if messages, captures := n.historyEntries(); messages != 6 || captures != 0 {
		t.Fatalf("both batches admitted in order: %d %d", messages, captures)
	}
	if entries, _ := os.ReadDir(spool); len(entries) != 0 {
		t.Fatalf("history is never spooled outside the buffer: %v", entries)
	}
}

// randomText is incompressible, so compressed size tracks the raw size.
func randomText(n int) string {
	raw := make([]byte, n/2)
	_, _ = rand.Read(raw)
	return hex.EncodeToString(raw)
}

func incompressibleBatch(messages, bodyBytes int) *waHistorySync.HistorySync {
	var items []*waHistorySync.HistorySyncMsg
	for i := range messages {
		items = append(items, textMessage("m"+string(rune('a'+i%26))+hex.EncodeToString([]byte{byte(i >> 8), byte(i)}), "501@lid", uint64(1700000000+i), randomText(bodyBytes)))
	}
	return batchOf(conversationOf("501@lid", items...))
}

// limitCase prepares one rejected batch against a life with the given limits.
func rejectedByLimit(t *testing.T, limits history.Limits, buffer int64, serve func(*remoteStub) *waE2E.HistorySyncNotification) (*historyLife, *native) {
	t.Helper()
	n := newNative()
	remote := newRemote(n.log, limits)
	h := newHistoryLife(t, n, buffer, remote)
	earlier := h.receive("live-before", "kept")
	_ = earlier
	grant, _ := h.capture("notif-1", serve(remote))
	grant.ack(t)
	h.mustDrain()
	return h, n
}

func assertLimitRejected(t *testing.T, h *historyLife, n *native, want history.Code) {
	t.Helper()
	select {
	case code := <-h.rejected:
		if code != want {
			t.Fatalf("want %s, got %s", want, code)
		}
	case <-time.After(time.Second):
		t.Fatalf("no rejection reported, want %s", want)
	}
	if messages, captures := n.historyEntries(); messages != 0 || captures != 0 {
		t.Fatalf("a rejected batch leaves nothing: %d %d", messages, captures)
	}
	if n.pendingCount() != 1 {
		t.Fatalf("earlier pending content is preserved, %d entries", n.pendingCount())
	}
	_, parses, stages, receipts, deletes := h.remote.counts()
	// a limit stops the batch before the parser; the buffer can only be judged once messages are normalized
	if (want == history.CodeLimit && parses != 0) || stages != 0 || receipts != 0 || deletes != 0 {
		t.Fatalf("nothing was staged, acknowledged or deleted, and a limit stops before normalization: %d %d %d %d", parses, stages, receipts, deletes)
	}
	fetches, _, _, _, _ := h.remote.counts()
	h.mustDrain()
	if again, _, _, _, _ := h.remote.counts(); again != fetches {
		t.Fatalf("a rejected batch is not retried by the process: %d then %d", fetches, again)
	}
}

// IT-HIS-05: input is counted as it is received, inflation as it is produced; declared sizes do not matter.
func TestITHIS05LimitsInputAndInflationBeforeMaterializing(t *testing.T) {
	b := incompressibleBatch(4, 400)
	raw, _ := proto.Marshal(b)
	compressed := len(compress(t, raw))

	t.Run("input one byte over", func(t *testing.T) {
		limits := history.DefaultLimits()
		limits.MaxInput = int64(compressed - 1)
		h, n := rejectedByLimit(t, limits, bigBuffer, func(r *remoteStub) *waE2E.HistorySyncNotification { return r.serve(t, "/v/b", b) })
		assertLimitRejected(t, h, n, history.CodeLimit)
	})
	t.Run("declared size lies about the input", func(t *testing.T) {
		limits := history.DefaultLimits()
		limits.MaxInput = int64(compressed - 1)
		h, n := rejectedByLimit(t, limits, bigBuffer, func(r *remoteStub) *waE2E.HistorySyncNotification {
			notification := r.serve(t, "/v/b", b)
			notification.FileLength = proto.Uint64(10) // the notification claims a tiny file
			return notification
		})
		assertLimitRejected(t, h, n, history.CodeLimit)
	})
	t.Run("inline payload over the input limit", func(t *testing.T) {
		limits := history.DefaultLimits()
		limits.MaxInput = int64(compressed - 1)
		h, n := rejectedByLimit(t, limits, bigBuffer, func(r *remoteStub) *waE2E.HistorySyncNotification {
			notification := r.serve(t, "/v/b", b)
			notification.InitialHistBootstrapInlinePayload = r.batches["/v/b"]
			return notification
		})
		assertLimitRejected(t, h, n, history.CodeLimit)
	})
	t.Run("inflated one byte over", func(t *testing.T) {
		limits := history.DefaultLimits()
		limits.MaxInflated = int64(len(raw) - 1)
		h, n := rejectedByLimit(t, limits, bigBuffer, func(r *remoteStub) *waE2E.HistorySyncNotification { return r.serve(t, "/v/b", b) })
		assertLimitRejected(t, h, n, history.CodeLimit)
	})
	t.Run("exactly at both limits is admitted", func(t *testing.T) {
		limits := history.DefaultLimits()
		limits.MaxInput, limits.MaxInflated = int64(compressed), int64(len(raw))
		n := newNative()
		h := newHistoryLife(t, n, bigBuffer, newRemote(n.log, limits))
		grant, _ := h.capture("notif-1", h.remote.serve(t, "/v/b", b))
		grant.ack(t)
		h.mustDrain()
		if messages, _ := n.historyEntries(); messages != 4 {
			t.Fatalf("a batch exactly at the limits is valid: %d", messages)
		}
	})
	t.Run("expansion bomb with the real limits", func(t *testing.T) {
		h, n := rejectedByLimit(t, history.DefaultLimits(), bigBuffer, func(r *remoteStub) *waE2E.HistorySyncNotification {
			return r.serveRaw(t, "/v/bomb", make([]byte, 96<<20)) // ~100 KB on the wire, 96 MiB inflated
		})
		assertLimitRejected(t, h, n, history.CodeLimit)
	})
}

// IT-HIS-06: the recovery budget is a separate restriction from the 16 MiB / 32 MiB history limits.
func TestITHIS06BudgetsAreIndependent(t *testing.T) {
	b := incompressibleBatch(40, 2000)
	limits := history.DefaultLimits()

	t.Run("fits the history limits but not the buffer", func(t *testing.T) {
		h, n := rejectedByLimit(t, limits, 24*1024, func(r *remoteStub) *waE2E.HistorySyncNotification { return r.serve(t, "/v/b", b) })
		assertLimitRejected(t, h, n, history.CodeBufferFull)
	})
	t.Run("a bigger buffer admits it and changes no history limit", func(t *testing.T) {
		n := newNative()
		remote := newRemote(n.log, limits)
		h := newHistoryLife(t, n, 8<<20, remote)
		grant, _ := h.capture("notif-1", remote.serve(t, "/v/b", b))
		grant.ack(t)
		h.mustDrain()
		if messages, _ := n.historyEntries(); messages != 40 {
			t.Fatalf("admitted with a bigger buffer: %d", messages)
		}
		if remote.limits != limits || limits.MaxInput != 16<<20 || limits.MaxInflated != 32<<20 {
			t.Fatal("raising the buffer must not move the history limits")
		}
	})
	t.Run("a huge buffer does not hide a history limit", func(t *testing.T) {
		tight := limits
		raw, _ := proto.Marshal(b)
		tight.MaxInflated = int64(len(raw) - 1)
		h, n := rejectedByLimit(t, tight, 64<<20, func(r *remoteStub) *waE2E.HistorySyncNotification { return r.serve(t, "/v/b", b) })
		assertLimitRejected(t, h, n, history.CodeLimit)
	})
}
