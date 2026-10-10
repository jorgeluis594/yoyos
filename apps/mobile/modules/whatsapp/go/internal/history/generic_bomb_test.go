package history

import (
	"errors"
	"fmt"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"runtime"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// reach maps every message type the decoder will parse to the field path that leads to it.
func reach() (order []protoreflect.MessageDescriptor, paths map[protoreflect.FullName][]protoreflect.FieldDescriptor) {
	paths = map[protoreflect.FullName][]protoreflect.FieldDescriptor{historyDescriptor.FullName(): nil}
	queue := []protoreflect.MessageDescriptor{historyDescriptor}
	for len(queue) > 0 {
		md := queue[0]
		queue = queue[1:]
		order = append(order, md)
		for i := 0; i < md.Fields().Len(); i++ {
			field := md.Fields().Get(i)
			if field.Message() == nil || field.IsMap() || field.Kind() == protoreflect.GroupKind || !kept(md, field.Number()) {
				continue
			}
			if _, seen := paths[field.Message().FullName()]; !seen {
				paths[field.Message().FullName()] = append(append([]protoreflect.FieldDescriptor(nil), paths[md.FullName()]...), field)
				queue = append(queue, field.Message())
			}
		}
	}
	return
}

// bomb builds a batch whose target field occurs enough times to reach `cost` estimated bytes, nested
// at the end of the shortest path from the root. It reports false for fields it cannot build.
func bomb(t *testing.T, path []protoreflect.FieldDescriptor, target protoreflect.FieldDescriptor, cost int) ([]byte, bool) {
	var entries []byte
	align := 1
	switch {
	case target.Kind() == protoreflect.GroupKind || target.IsMap():
		return nil, false
	case target.Message() != nil:
		per := elementCost(target, protowire.BytesType, 0)
		unit := protowire.AppendBytes(protowire.AppendTag(nil, target.Number(), protowire.BytesType), nil)
		align = len(unit)
		for n := 0; n*per < cost; n++ {
			entries = append(entries, unit...)
		}
	case target.IsList() && packable(target.Kind()):
		total := cost/packedPerInput + 8
		piece := 256 << 10 // a multiple of 8, so fixed-width kinds stay aligned
		total = total / 8 * 8
		for done := 0; done < total; done += piece {
			payload := make([]byte, min(piece, total-done))
			for i := range payload {
				payload[i] = 1
			}
			entries = protowire.AppendBytes(protowire.AppendTag(entries, target.Number(), protowire.BytesType), payload)
		}
		align = len(protowire.AppendBytes(protowire.AppendTag(nil, target.Number(), protowire.BytesType), make([]byte, piece)))
	case target.Kind() == protoreflect.StringKind || target.Kind() == protoreflect.BytesKind:
		per := elementCost(target, protowire.BytesType, 1)
		unit := protowire.AppendBytes(protowire.AppendTag(nil, target.Number(), protowire.BytesType), []byte{'x'})
		align = len(unit)
		for n := 0; n*per < cost; n++ {
			entries = append(entries, unit...)
		}
	default: // a repeated scalar sent unpacked
		unit := protowire.AppendVarint(protowire.AppendTag(nil, target.Number(), protowire.VarintType), 1)
		align = len(unit)
		for n := 0; n*pointerSlot < cost; n++ {
			entries = append(entries, unit...)
		}
	}
	// split into units of at most 512 KiB so that no message record exceeds its own bound
	const unitSize = 512 << 10
	var units [][]byte
	for len(entries) > 0 {
		n := min(len(entries), unitSize/align*align)
		if n < len(entries) && !target.IsList() && target.Message() == nil {
			n = len(entries) // singular scalars cannot be split on the wire without changing their meaning
		}
		units = append(units, entries[:n])
		entries = entries[n:]
	}
	conversations := false
	var body []byte
	for _, unit := range units {
		wrapped := unit
		for i := len(path) - 1; i >= 0; i-- {
			if path[i].Number() == historyFields.conversations && i == 0 {
				conversations = true
				break
			}
			wrapped = protowire.AppendBytes(protowire.AppendTag(nil, path[i].Number(), protowire.BytesType), wrapped)
		}
		body = append(body, wrapped...)
	}
	syncType := protowire.AppendVarint(protowire.AppendTag(nil, historyFields.syncType, protowire.VarintType), 0)
	if conversations {
		id := protowire.AppendString(protowire.AppendTag(nil, fieldNumber(conversationDescriptor, "ID"), protowire.BytesType), "1@lid")
		body = append(id, body...)
		return append(syncType, protowire.AppendBytes(protowire.AppendTag(nil, historyFields.conversations, protowire.BytesType), body)...), true
	}
	if len(path) == 0 {
		return append(syncType, body...), true
	}
	return append(syncType, body...), true
}

// IT-HIS-09: for EVERY repeated field and nested message of the history schema, a bomb of that field
// is refused by the estimated-memory bound before anything is allocated, and a bomb just under the
// bound costs no more heap than the model estimated. A field whose real cost outgrows the model
// fails here, not in production.
func TestEveryRepeatedOrNestedFieldIsBoundedByEstimatedMemory(t *testing.T) {
	limits := DefaultLimits()
	limits.MaxEstimatedBytes = 1 << 20
	order, paths := reach()
	tested, skipped := 0, 0
	for _, md := range order {
		for i := 0; i < md.Fields().Len(); i++ {
			target := md.Fields().Get(i)
			if !kept(md, target.Number()) || (!target.IsList() && target.Message() == nil) {
				continue
			}
			name := fmt.Sprintf("%s.%s", md.FullName(), target.Name())
			over, ok := bomb(t, paths[md.FullName()], target, int(limits.MaxEstimatedBytes)*5/2)
			if !ok {
				skipped++
				continue
			}
			tested++
			var err error
			objects, bytes := allocations(func() { _, err = Decode(over, limits) })
			var limited *LimitError
			if !errors.As(err, &limited) {
				t.Errorf("%s: a bomb of 2.5x the bound must be refused as a limit, got %v", name, err)
				continue
			}
			if bytes > uint64(len(over))*2+(256<<10) || objects > 5000 {
				t.Errorf("%s: refusal allocated %d objects and %d KiB for %d KiB of input", name, objects, bytes>>10, len(over)>>10)
			}
			under, _ := bomb(t, paths[md.FullName()], target, int(limits.MaxEstimatedBytes)*9/10)
			_, bytes = allocations(func() { _, err = Decode(under, limits) })
			if err != nil && !errors.Is(err, ErrInvalid) && !errors.Is(err, ErrLimit) {
				t.Errorf("%s: unexpected error %v", name, err)
			}
			if budget := uint64(limits.MaxEstimatedBytes) * 2; bytes > budget+uint64(len(under))*3 {
				t.Errorf("%s: a bomb under the bound allocated %d KiB, more than twice its %d KiB estimate", name, bytes>>10, limits.MaxEstimatedBytes>>10)
			}
		}
	}
	t.Logf("%d fields bombed, %d skipped (maps and groups) across %d message types", tested, skipped, len(order))
	if tested < 500 {
		t.Fatalf("the schema walk reached too little: %d fields", tested)
	}
}

// The reviewer's shape: 4 records of 185 000 empty add-ons, 3.6 MiB inflated and a few KiB compressed,
// accepted by the old element count and 814 MiB of heap.
func TestMessageAddOnBombIsRefused(t *testing.T) {
	md := (&waWeb.WebMessageInfo{}).ProtoReflect().Descriptor()
	field := md.Fields().ByName("messageAddOns")
	_, paths := reach()
	raw, ok := bomb(t, paths[md.FullName()], field, 600<<20)
	if !ok || len(raw) > 32<<20 {
		t.Skipf("fixture does not fit the inflated limit: %d", len(raw))
	}
	var err error
	objects, bytes := allocations(func() { _, err = Decode(raw, DefaultLimits()) })
	t.Logf("%d KiB inflated, %d objects, %d KiB allocated, err=%v", len(raw)>>10, objects, bytes>>10, err)
	isLimit(t, err, "estimated memory")
}

// peak runs fn and returns the highest live heap it reached above the heap before it. A tight GC
// percentage keeps unreachable garbage out of the sample.
func peak(fn func()) uint64 {
	defer debug.SetGCPercent(debug.SetGCPercent(5))
	runtime.GC()
	var base runtime.MemStats
	runtime.ReadMemStats(&base)
	var top atomic.Uint64
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		var stats runtime.MemStats
		for {
			runtime.ReadMemStats(&stats)
			if stats.HeapAlloc > top.Load() {
				top.Store(stats.HeapAlloc)
			}
			select {
			case <-stop:
				return
			case <-time.After(300 * time.Microsecond):
			}
		}
	}()
	fn()
	close(stop)
	<-done
	if top.Load() < base.HeapAlloc {
		return 0
	}
	return top.Load() - base.HeapAlloc
}

// IT-HIS-09: the heap the parser holds, at the real bound, for the costliest shapes just under it. The
// numbers are what README documents: the bound is estimated heap, not input bytes, and the measured
// peak must stay within twice of it.
func TestPeakHeapAtTheRealBoundForTheCostliestShapes(t *testing.T) {
	limits := DefaultLimits()
	_, paths := reach()
	var worst uint64
	for _, name := range []string{
		"WAWebProtobufsWeb.WebMessageInfo.messageAddOns",
		"WAWebProtobufsE2E.ContactsArrayMessage.contacts",
		"WAWebProtobufsE2E.InteractiveMessage.CarouselMessage.cards",
		"WAWebProtobufsE2E.ImageMessage.scanLengths",
		"WAWebProtobufsWeb.WebMessageInfo.userReceipt",
	} {
		full := protoreflect.FullName(name[:strings.LastIndex(name, ".")])
		md := historyDescriptor
		for _, m := range func() []protoreflect.MessageDescriptor { o, _ := reach(); return o }() {
			if m.FullName() == full {
				md = m
			}
		}
		target := md.Fields().ByName(protoreflect.Name(name[strings.LastIndex(name, ".")+1:]))
		if target == nil {
			t.Logf("%s is not reachable in this schema", name)
			continue
		}
		raw, ok := bomb(t, paths[md.FullName()], target, int(limits.MaxEstimatedBytes)*95/100)
		if !ok || int64(len(raw)) > limits.MaxInflated {
			t.Fatalf("%s: fixture of %d bytes does not fit the inflated limit", name, len(raw))
		}
		var err error
		top := peak(func() { _, err = Decode(raw, limits) })
		t.Logf("%-52s %5d KiB inflated -> peak heap %4d MiB (bound %d MiB), err=%v", name, len(raw)>>10, top>>20, limits.MaxEstimatedBytes>>20, err)
		if top > uint64(limits.MaxEstimatedBytes)*2 {
			t.Errorf("%s: peak %d MiB exceeds twice the bound", name, top>>20)
		}
		worst = max(worst, top)
	}
	t.Logf("worst peak: %d MiB for a bound of %d MiB and %d MiB inflated", worst>>20, limits.MaxEstimatedBytes>>20, limits.MaxInflated>>20)
}
