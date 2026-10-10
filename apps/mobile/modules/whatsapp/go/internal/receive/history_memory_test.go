package receive

import (
	"context"
	"fmt"
	"runtime"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/history"
	"yoyos-whatsapp/internal/protocolstore"
)

// peakHeap runs fn and returns the highest live heap it reached above the heap before it,
// sampled while it runs. It measures this process's Go heap only.
func peakHeap(fn func()) uint64 {
	// A tight collector percentage keeps garbage out of the sample: the peak reported is
	// close to what stays reachable, which is what holds the process's memory.
	defer debug.SetGCPercent(debug.SetGCPercent(5))
	runtime.GC()
	var base runtime.MemStats
	runtime.ReadMemStats(&base)
	var peak atomic.Uint64
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		var stats runtime.MemStats
		for {
			runtime.ReadMemStats(&stats)
			if stats.HeapAlloc > peak.Load() {
				peak.Store(stats.HeapAlloc)
			}
			select {
			case <-stop:
				return
			case <-time.After(500 * time.Microsecond):
			}
		}
	}()
	fn()
	close(stop)
	<-done
	if peak.Load() < base.HeapAlloc {
		return 0
	}
	return peak.Load() - base.HeapAlloc
}

func deepMessage(depth int, body string) *waE2E.Message {
	message := &waE2E.Message{Conversation: proto.String(body)}
	for range depth {
		message = &waE2E.Message{EphemeralMessage: &waE2E.FutureProofMessage{Message: message}}
	}
	return message
}

type memoryShape struct {
	name  string
	build func() *waHistorySync.HistorySync
	// Regression ceilings, as multiples of the bytes each stage consumes. They sit above the
	// measured peaks and state what is known today; they are not a guarantee about process memory.
	inflate, decode, prepare, admit, snapshot float64
	// excluded shapes are parsed and normalized but publish nothing (out-of-scope content).
	excluded bool
}

func memoryShapes() []memoryShape {
	return []memoryShape{
		{"representative chats of short texts", func() *waHistorySync.HistorySync {
			var conversations []*waHistorySync.Conversation
			for c := range 120 {
				chat := fmt.Sprintf("7%03d@lid", c)
				conversations = append(conversations, conversationOf(chat, numbered("m", chat, 40, "short chat text of an ordinary message")...))
			}
			return batchOf(conversations...)
		}, 4, 45, 25, 3, 8, false},
		{"adversarial: many tiny messages", func() *waHistorySync.HistorySync {
			return batchOf(conversationOf("901@lid", numbered("t", "901@lid", 9000, "x")...))
		}, 5, 80, 45, 3, 8, false},
		{"adversarial: records near the size cap", func() *waHistorySync.HistorySync {
			return batchOf(conversationOf("902@lid", numbered("b", "902@lid", 8, strings.Repeat("y", 900<<10))...))
		}, 3, 3, 5, 5, 9, false},
		{"adversarial: deeply nested wrappers", func() *waHistorySync.HistorySync {
			items := numbered("d", "903@lid", 3000, "")
			for _, item := range items {
				item.Message.Message = deepMessage(5, "nested")
			}
			return batchOf(conversationOf("903@lid", items...))
		}, 5, 150, 45, 0, 0, true},
	}
}

// IT-HIS-09: the real peak heap of each stage of history processing, for representative and
// adversarial batches: download and inflation, parsing, normalization, the binding payload and
// publication, and the snapshot read back. The byte limits are not a RAM bound; the multiples
// are what is reported, and what a regression would move.
func TestITHIS09MeasuresTheRealPeakOfHistoryProcessing(t *testing.T) {
	for _, shape := range memoryShapes() {
		t.Run(shape.name, func(t *testing.T) {
			b := shape.build()
			raw, err := proto.Marshal(b)
			if err != nil {
				t.Fatal(err)
			}
			b = nil
			n := newNative()
			remote := defaultRemote(n)
			h := newHistoryLife(t, n, 64<<20, remote)
			notification := remote.serveRaw(t, "/v/shape", raw)
			compressed := remote.batches["/v/shape"]
			ctx := context.Background()
			limits := history.DefaultLimits()

			var inflated []byte
			inflate := peakHeap(func() {
				inflated, err = history.Fetch(ctx, nil, func(context.Context) ([]byte, error) { return compressed, nil }, limits)
			})
			if err != nil || len(inflated) != len(raw) {
				t.Fatalf("inflate: %d %v", len(inflated), err)
			}
			var parsed *waHistorySync.HistorySync
			decode := peakHeap(func() { parsed, err = history.Decode(inflated, limits) })
			if err != nil {
				t.Fatal(err)
			}
			var prepared history.Prepared
			env := history.Env{Account: account, Own: ownDevice.ID.ToNonAD(), OwnAlt: ownDevice.LID, Parse: remote.Parse,
				Stored: h.store.GetManyLIDsForPNs, CheckMappings: h.store.CheckLIDMappings, Budget: h.store.RecoveryBudget()}
			prepare := peakHeap(func() { prepared, err = history.Prepare(ctx, parsed, env) })
			if err != nil || (len(prepared.Inserts) == 0) != shape.excluded {
				t.Fatalf("the shape must publish exactly when it is in scope: %d inserts, %v", len(prepared.Inserts), err)
			}
			if shape.excluded {
				t.Logf("compressed %d KiB, inflated %d KiB, nothing in scope", len(compressed)>>10, len(raw)>>10)
				report := func(stage string, peak uint64, against int, ceiling float64) {
					ratio := float64(peak) / float64(against)
					t.Logf("%-9s peak %7d KiB = %5.1fx of %d KiB", stage, peak>>10, ratio, against>>10)
					if ratio > ceiling {
						t.Errorf("%s peak is %.1fx, above its %.0fx regression ceiling", stage, ratio, ceiling)
					}
				}
				report("inflate", inflate, len(raw), shape.inflate)
				report("decode", decode, len(raw), shape.decode)
				report("prepare", prepare, len(raw), shape.prepare)
				return
			}
			var budget int64
			for _, insert := range prepared.Inserts {
				size, _ := protocolstore.EntrySize(insert)
				budget += size
			}
			admit := peakHeap(func() {
				err = h.store.AdmitHistoryBatch(ctx, protocolstore.HistoryBatch{
					Marker: [32]byte{1}, Stage: func(ctx context.Context) error { return remote.Stage(ctx, parsed) }, Inserts: prepared.Inserts,
				})
			})
			if err != nil {
				t.Fatal(err)
			}
			snapshot := peakHeap(func() { _, err = h.ledger.Pending() })
			if err != nil {
				t.Fatal(err)
			}
			_ = notification

			report := func(stage string, peak uint64, against int, ceiling float64) {
				ratio := float64(peak) / float64(against)
				t.Logf("%-9s peak %7d KiB = %5.1fx of %d KiB", stage, peak>>10, ratio, against>>10)
				if ratio > ceiling {
					t.Errorf("%s peak is %.1fx, above its %.0fx regression ceiling", stage, ratio, ceiling)
				}
			}
			t.Logf("compressed %d KiB, inflated %d KiB, %d entries, %d KiB of recovery budget", len(compressed)>>10, len(raw)>>10, len(prepared.Inserts), budget>>10)
			report("inflate", inflate, len(raw), shape.inflate)
			report("decode", decode, len(raw), shape.decode)
			report("prepare", prepare, len(raw), shape.prepare)
			report("admit", admit, int(budget), shape.admit)
			report("snapshot", snapshot, int(budget), shape.snapshot)
		})
	}
}
