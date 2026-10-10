package history

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"google.golang.org/protobuf/proto"
)

func tight() Limits {
	l := DefaultLimits()
	l.MaxConversations, l.MaxMessages, l.MaxMappings, l.MaxPushNames, l.MaxRecordBytes, l.MaxDepth, l.MaxEstimatedBytes = 3, 5, 2, 2, 512, 8, 64<<20
	return l
}

func messages(n int) []*waHistorySync.HistorySyncMsg {
	var out []*waHistorySync.HistorySyncMsg
	for i := 0; i < n; i++ {
		out = append(out, text(fmt.Sprintf("m%d", i), "555@lid", uint64(1700000000+i), "hi"))
	}
	return out
}

// deepMessage wraps a text message in n ephemeral layers.
func deepMessage(n int) *waE2E.Message {
	message := &waE2E.Message{Conversation: proto.String("deep")}
	for i := 0; i < n; i++ {
		message = &waE2E.Message{EphemeralMessage: &waE2E.FutureProofMessage{Message: message}}
	}
	return message
}

// IT-HIS-05 / IT-HIS-09: each structural bound is enforced on the wire, at its exact value, before objects exist.
func TestDecodeBoundsRecordsDepthAndSizes(t *testing.T) {
	l := tight()
	for name, tc := range map[string]struct {
		ok, over *waHistorySync.HistorySync
		resource string
	}{
		"conversations": {
			ok:       batch(conversation("1@lid"), conversation("2@lid"), conversation("3@lid")),
			over:     batch(conversation("1@lid"), conversation("2@lid"), conversation("3@lid"), conversation("4@lid")),
			resource: "conversations",
		},
		"messages in one conversation": {
			ok: batch(conversation("1@lid", messages(5)...)), over: batch(conversation("1@lid", messages(6)...)), resource: "messages",
		},
		"messages across conversations": {
			ok: batch(conversation("1@lid", messages(3)...), conversation("2@lid", messages(2)...)), over: batch(conversation("1@lid", messages(3)...), conversation("2@lid", messages(3)...)), resource: "messages",
		},
		"mappings": {
			ok:       &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_RECENT.Enum(), PhoneNumberToLidMappings: make([]*waHistorySync.PhoneNumberToLIDMapping, 2)},
			over:     &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_RECENT.Enum(), PhoneNumberToLidMappings: make([]*waHistorySync.PhoneNumberToLIDMapping, 3)},
			resource: "mappings",
		},
		"push names": {
			ok:       &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_RECENT.Enum(), Pushnames: make([]*waHistorySync.Pushname, 2)},
			over:     &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_RECENT.Enum(), Pushnames: make([]*waHistorySync.Pushname, 3)},
			resource: "push names",
		},
	} {
		t.Run(name, func(t *testing.T) {
			for _, b := range []*waHistorySync.HistorySync{tc.ok, tc.over} {
				for i := range b.PhoneNumberToLidMappings {
					b.PhoneNumberToLidMappings[i] = &waHistorySync.PhoneNumberToLIDMapping{PnJID: proto.String("1@s.whatsapp.net")}
				}
				for i := range b.Pushnames {
					b.Pushnames[i] = &waHistorySync.Pushname{ID: proto.String("1@s.whatsapp.net")}
				}
			}
			if _, err := Decode(wire(t, tc.ok), l); err != nil {
				t.Fatalf("exactly the bound is valid: %v", err)
			}
			_, err := Decode(wire(t, tc.over), l)
			isLimit(t, err, tc.resource)
		})
	}
	t.Run("record size", func(t *testing.T) {
		small := text("a", "1@lid", 1700000000, strings.Repeat("x", 300))
		large := text("b", "1@lid", 1700000000, strings.Repeat("x", 600))
		if _, err := Decode(wire(t, batch(conversation("1@lid", small))), l); err != nil {
			t.Fatalf("a record under the bound is valid: %v", err)
		}
		_, err := Decode(wire(t, batch(conversation("1@lid", small, large))), l)
		var limited *LimitError
		if !errors.As(err, &limited) || !strings.HasPrefix(limited.Resource, "record size") {
			t.Fatalf("an oversize record is a limit: %v", err)
		}
	})
	t.Run("depth", func(t *testing.T) {
		build := func(depth int) []byte {
			m := text("d", "1@lid", 1700000000, "")
			m.Message.Message = deepMessage(depth)
			return wire(t, batch(conversation("1@lid", m)))
		}
		// HistorySync > Conversation > HistorySyncMsg > WebMessageInfo > Message = 5 levels; each wrapper adds 2
		if _, err := Decode(build(1), l); err != nil {
			t.Fatalf("depth within the bound: %v", err)
		}
		_, err := Decode(build(20), l)
		isLimit(t, err, "nesting depth")
	})
	t.Run("corrupt", func(t *testing.T) {
		raw := wire(t, batch(conversation("1@lid", messages(2)...)))
		if _, err := Decode(raw[:len(raw)-3], l); !errors.Is(err, ErrInvalid) || errors.Is(err, ErrLimit) {
			t.Fatalf("truncated wire data is invalid, not a limit: %v", err)
		}
	})
}

// A hostile count is refused before the parser could allocate for it: the decoder never
// builds the collection, which a huge repeated field would otherwise cost.
func TestDecodeRefusesAHugeCountWithoutParsing(t *testing.T) {
	l := tight()
	l.MaxConversations = 1000
	var raw []byte
	one := wire(t, batch(conversation("1@lid")))
	for i := 0; i < 5000; i++ {
		raw = append(raw, one...)
	}
	_, err := Decode(raw, l)
	isLimit(t, err, "conversations")
}

// Fields the admission never reads are not parsed, so they cost neither objects nor limits.
func TestDecodeDropsUnreadFields(t *testing.T) {
	b := batch(conversation("1@lid", messages(1)...))
	b.StatusV3Messages = []*waWeb.WebMessageInfo{{Key: &waCommon.MessageKey{}}, {Key: &waCommon.MessageKey{}}}
	b.NctSalt = []byte{1, 2, 3}
	got, err := Decode(wire(t, b), tight())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.GetStatusV3Messages()) != 0 || len(got.GetConversations()) != 1 || string(got.GetNctSalt()) != "\x01\x02\x03" {
		t.Fatalf("unread fields must be dropped and read ones kept: %d %d %v", len(got.GetStatusV3Messages()), len(got.GetConversations()), got.GetNctSalt())
	}
}
