package history

import (
	"runtime"
	"testing"

	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func fieldNumber(md protoreflect.MessageDescriptor, name string) protowire.Number {
	return md.Fields().ByName(protoreflect.Name(name)).Number()
}

// repeated is n minimal length-delimited entries (an empty string field) of one repeated field.
func repeated(number protowire.Number, n int) []byte {
	entry := protowire.AppendBytes(protowire.AppendTag(nil, number, protowire.BytesType), protowire.AppendString(protowire.AppendTag(nil, 1, protowire.BytesType), ""))
	out := make([]byte, 0, len(entry)*n)
	for range n {
		out = append(out, entry...)
	}
	return out
}

func syncOf(conversations ...[]byte) []byte {
	raw := protowire.AppendVarint(protowire.AppendTag(nil, fieldNumber((&waHistorySync.HistorySync{}).ProtoReflect().Descriptor(), "syncType"), protowire.VarintType), 0)
	for _, c := range conversations {
		raw = protowire.AppendBytes(protowire.AppendTag(raw, fieldNumber((&waHistorySync.HistorySync{}).ProtoReflect().Descriptor(), "conversations"), protowire.BytesType), c)
	}
	return raw
}

// allocations runs fn and reports the objects and bytes it allocated.
func allocations(fn func()) (objects, bytes uint64) {
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	fn()
	runtime.ReadMemStats(&after)
	return after.Mallocs - before.Mallocs, after.TotalAlloc - before.TotalAlloc
}

// IT-HIS-05 / IT-HIS-09: an amplification bomb of repeated fields nobody counts — about 31 MiB of
// minimal group participants — must neither be materialized nor allocate in proportion to its
// element count. Before the fix it built 6.5 million objects.
func TestAmplificationOfUncountedRepeatedFieldsIsNotMaterialized(t *testing.T) {
	conversation := protowire.AppendString(protowire.AppendTag(nil, fieldNumber((&waHistorySync.Conversation{}).ProtoReflect().Descriptor(), "ID"), protowire.BytesType), "99-1@g.us")
	conversation = append(conversation, repeated(fieldNumber((&waHistorySync.Conversation{}).ProtoReflect().Descriptor(), "participant"), 6_500_000)...)
	raw := syncOf(conversation)
	if len(raw) > 32<<20 {
		t.Fatalf("fixture exceeds the inflated limit: %d", len(raw))
	}
	var decodeErr error
	objects, bytes := allocations(func() { _, decodeErr = Decode(raw, DefaultLimits()) })
	t.Logf("%d KiB decoded into %d objects, %d KiB allocated, err=%v", len(raw)>>10, objects, bytes>>10, decodeErr)
	if objects > 50_000 {
		t.Fatalf("%d objects were built for a batch whose elements the admission never reads", objects)
	}
	if bytes > uint64(len(raw))/2 {
		t.Fatalf("%d KiB allocated for %d KiB of input", bytes>>10, len(raw)>>10)
	}
}

// The same amplification inside the message records the admission does read: the total number of
// decoded elements is bounded, and the batch is refused as a limit before any object exists.
func TestAmplificationInsideMessageRecordsIsRefusedByTheElementBound(t *testing.T) {
	receipts := repeated(fieldNumber((&waWeb.WebMessageInfo{}).ProtoReflect().Descriptor(), "userReceipt"), 150_000) // ~1 MiB of 4-byte entries
	web := proto.Clone(text("m", "555@lid", 1700000000, "x").Message).(*waWeb.WebMessageInfo)
	record, err := proto.Marshal(web)
	if err != nil {
		t.Fatal(err)
	}
	record = append(record, receipts...)
	var conversation []byte
	conversation = protowire.AppendString(protowire.AppendTag(conversation, fieldNumber((&waHistorySync.Conversation{}).ProtoReflect().Descriptor(), "ID"), protowire.BytesType), "555@lid")
	message := protowire.AppendBytes(protowire.AppendTag(nil, fieldNumber((&waHistorySync.HistorySyncMsg{}).ProtoReflect().Descriptor(), "message"), protowire.BytesType), record[:len(record)])
	for range 30 {
		conversation = protowire.AppendBytes(protowire.AppendTag(conversation, fieldNumber((&waHistorySync.Conversation{}).ProtoReflect().Descriptor(), "messages"), protowire.BytesType), message)
	}
	raw := syncOf(conversation)
	var decodeErr error
	objects, bytes := allocations(func() { _, decodeErr = Decode(raw, DefaultLimits()) })
	t.Logf("%d KiB, %d objects, %d KiB allocated, err=%v", len(raw)>>10, objects, bytes>>10, decodeErr)
	isLimit(t, decodeErr, "elements")
	if objects > 50_000 || bytes > uint64(len(raw))/2 {
		t.Fatalf("refusal must come before materialization: %d objects, %d KiB", objects, bytes>>10)
	}
}

// Deep but plausible shapes are admitted: an ephemeral view-once image quoting a text that quotes an ad-bearing image.
func TestPlausiblyDeepMessagesAreNotRefused(t *testing.T) {
	m := text("deep", "555@lid", 1700000000, "")
	m.Message.Message = deepMessage(10)
	if _, err := Decode(wire(t, batch(conversation("555@lid", m))), DefaultLimits()); err != nil {
		t.Fatalf("a message nested ten wrappers deep must decode: %v", err)
	}
}
