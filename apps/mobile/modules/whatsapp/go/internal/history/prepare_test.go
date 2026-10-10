package history

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/protocolstore"
)

func mapping(pn, lid string) *waHistorySync.PhoneNumberToLIDMapping {
	return &waHistorySync.PhoneNumberToLIDMapping{PnJID: proto.String(pn), LidJID: proto.String(lid)}
}

func chatOf(t *testing.T, insert protocolstore.PendingInsert) string {
	t.Helper()
	var message struct {
		ChatID string `json:"chatId"`
	}
	if err := json.Unmarshal(insert.Message, &message); err != nil {
		t.Fatal(err)
	}
	return message.ChatID
}

// UT-HIS-02: every supported message is prepared; out-of-scope content is excluded, not an error.
func TestUTHIS02ExcludesOutOfScopeWithoutFailing(t *testing.T) {
	reaction := text("r1", "555@lid", 1700000003, "")
	reaction.Message.Message = &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{Text: proto.String("👍")}}
	protocolMessage := text("p1", "555@lid", 1700000004, "")
	protocolMessage.Message.Message = &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{Type: waE2E.ProtocolMessage_REVOKE.Enum()}}
	image := text("i1", "555@lid", 1700000005, "")
	image.Message.Message = &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
		Mimetype: proto.String("image/jpeg"), DirectPath: proto.String("/v/t62/file"),
		MediaKey: make([]byte, 32), FileSHA256: make([]byte, 32), FileEncSHA256: make([]byte, 32), FileLength: proto.Uint64(10),
	}}
	b := batch(
		conversation("555@lid", text("t1", "555@lid", 1700000001, "hello"), text("t2", "555@lid", 1700000002, "again"), reaction, protocolMessage, image),
		conversation("999-1@g.us", text("g1", "999-1@g.us", 1700000006, "group")),
		conversation("status@broadcast", text("s1", "status@broadcast", 1700000007, "status")),
	)
	got, err := Prepare(context.Background(), b, env(t, nil))
	if err != nil {
		t.Fatalf("out-of-scope content must not fail the batch: %v", err)
	}
	if len(got.Inserts) != 3 || got.Excluded != 2 {
		t.Fatalf("want 3 inserted and 2 excluded in-scope messages, got %d and %d", len(got.Inserts), got.Excluded)
	}
	for _, insert := range got.Inserts {
		if insert.Source != "history" || insert.IdentityState != "resolved" || insert.AccountID != account || chatOf(t, insert) != "555@lid" {
			t.Fatalf("unexpected insert %+v", insert)
		}
		if insert.Recovery.Items[0].Format != "history" || insert.Recovery.Items[0].CiphertextHashBase64 != "" {
			t.Fatalf("history recovery carries the web message only: %+v", insert.Recovery)
		}
	}
	if !json.Valid(got.Inserts[2].Message) || string(got.Inserts[2].Message) == "" {
		t.Fatal("the image message keeps its descriptor")
	}
}

// UT-HIS-02: a supported message that cannot be prepared fails the whole preparation.
func TestUTHIS02AnInvalidSupportedMessageFailsTheBatch(t *testing.T) {
	broken := text("bad", "555@lid", 1700000002, "mine")
	broken.Message.Key.FromMe = proto.Bool(true)
	broken.Message.OriginalSelfAuthorUserJIDString = proto.String("a:b:c@s.whatsapp.net")
	b := batch(conversation("555@lid", text("ok1", "555@lid", 1700000001, "fine"), broken, text("ok2", "555@lid", 1700000003, "also fine")))
	got, err := Prepare(context.Background(), b, env(t, nil))
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
	if len(got.Inserts) != 0 {
		t.Fatalf("a failed batch yields nothing to publish, got %d", len(got.Inserts))
	}
}

// UT-HIS-02: a failing store read is a failure of the batch, never an absent mapping.
func TestUTHIS02AStoreReadFailureIsNotAbsence(t *testing.T) {
	boom := errors.New("store unreadable")
	e := env(t, nil)
	e.Stored = func(context.Context, []types.JID) (map[types.JID]types.JID, error) { return nil, boom }
	_, err := Prepare(context.Background(), batch(conversation("34600@s.whatsapp.net", text("t1", "34600@s.whatsapp.net", 1700000001, "hi"))), e)
	if !errors.Is(err, boom) || errors.Is(err, ErrInvalid) {
		t.Fatalf("want the read failure itself, got %v", err)
	}
}

// IT-HIS-01 (pure half): the mappings of the batch are applied before the messages that depend on them.
func TestMappingsOfTheBatchResolveTheirDependents(t *testing.T) {
	phone := "34600@s.whatsapp.net"
	b := batch(conversation(phone, text("t1", phone, 1700000001, "hi")), conversation("77@lid", text("t2", "77@lid", 1700000002, "direct")))
	b.PhoneNumberToLidMappings = []*waHistorySync.PhoneNumberToLIDMapping{mapping(phone, "600@lid")}

	got, err := Prepare(context.Background(), b, env(t, nil))
	if err != nil || len(got.Inserts) != 2 {
		t.Fatalf("%v %d", err, len(got.Inserts))
	}
	if got.Inserts[0].IdentityState != "resolved" || chatOf(t, got.Inserts[0]) != "600@lid" {
		t.Fatalf("the dependent message must resolve through the batch mapping: %+v", got.Inserts[0])
	}

	// without the mapping the same message is kept without identity, never with a provisional one
	b.PhoneNumberToLidMappings = nil
	got, err = Prepare(context.Background(), b, env(t, nil))
	if err != nil || got.Inserts[0].IdentityState != "pendingLid" || len(got.Inserts[0].Message) != 0 {
		t.Fatalf("an unmapped chat stays pendingLid without a message: %v %+v", err, got.Inserts[0])
	}

	// a stored correspondence completes it; a conflicting one in the batch wins, as it will once published
	pn, _ := types.ParseJID(phone)
	stored := map[types.JID]types.JID{pn: {User: "700", Server: types.HiddenUserServer}}
	got, _ = Prepare(context.Background(), b, env(t, stored))
	if chatOf(t, got.Inserts[0]) != "700@lid" {
		t.Fatalf("stored mapping: %s", chatOf(t, got.Inserts[0]))
	}
	b.PhoneNumberToLidMappings = []*waHistorySync.PhoneNumberToLIDMapping{mapping(phone, "600@lid")}
	got, _ = Prepare(context.Background(), b, env(t, stored))
	if chatOf(t, got.Inserts[0]) != "600@lid" {
		t.Fatalf("batch mapping wins: %s", chatOf(t, got.Inserts[0]))
	}
}

func TestInvalidMappingsFailTheBatchBeforeAnythingIsStaged(t *testing.T) {
	phone := "34600@s.whatsapp.net"
	base := func(m ...*waHistorySync.PhoneNumberToLIDMapping) *waHistorySync.HistorySync {
		b := batch(conversation(phone, text("t1", phone, 1700000001, "hi")))
		b.PhoneNumberToLidMappings = m
		return b
	}
	if _, err := Prepare(context.Background(), base(mapping("600@lid", phone)), env(t, nil)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a reversed pair is invalid: %v", err)
	}
	if _, err := Prepare(context.Background(), base(mapping("a:b:c@s.whatsapp.net", "600@lid"), mapping(phone, "600@lid")), env(t, nil)); err != nil {
		t.Fatalf("an unparsable pair is skipped like the dependency does: %v", err)
	}
	e := env(t, nil)
	e.CheckMappings = func(context.Context, []store.LIDMapping) error { return errors.New("inverse LID mapping conflict") }
	if _, err := Prepare(context.Background(), base(mapping(phone, "600@lid")), e); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a mapping the store would refuse fails the batch: %v", err)
	}
}

func TestPrepareDeduplicatesAndKeepsChronologicalOrder(t *testing.T) {
	b := batch(
		conversation("555@lid", text("late", "555@lid", 1700000009, "late"), text("early", "555@lid", 1700000001, "early"), text("early", "555@lid", 1700000001, "early again")),
		conversation("666@lid", text("mid", "666@lid", 1700000005, "mid")),
	)
	got, err := Prepare(context.Background(), b, env(t, nil))
	if err != nil || len(got.Inserts) != 3 {
		t.Fatalf("%v %d", err, len(got.Inserts))
	}
	var ids []string
	for _, insert := range got.Inserts {
		var m struct {
			WhatsAppMessageID string `json:"whatsappMessageId"`
		}
		_ = json.Unmarshal(insert.Message, &m)
		ids = append(ids, m.WhatsAppMessageID)
	}
	if ids[0] != "early" || ids[1] != "mid" || ids[2] != "late" {
		t.Fatalf("order %v", ids)
	}
	seen := map[string]bool{}
	for _, insert := range got.Inserts {
		if seen[insert.DeliveryID] {
			t.Fatal("delivery IDs are unique")
		}
		seen[insert.DeliveryID] = true
	}
}

// idsOf lists the WhatsApp IDs of the prepared inserts in order, with whether each carries a timestamp key.
func idsOf(t *testing.T, inserts []protocolstore.PendingInsert) (ids []string, dated map[string]bool) {
	t.Helper()
	dated = map[string]bool{}
	for _, insert := range inserts {
		var m struct {
			WhatsAppID string `json:"whatsappMessageId"`
			Timestamp  *int64 `json:"timestamp"`
		}
		if err := json.Unmarshal(insert.Message, &m); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.WhatsAppID)
		dated[m.WhatsAppID] = m.Timestamp != nil
	}
	return ids, dated
}

// IT-MSG-07 (decision 2026-10-10): one history message with a missing or invalid timestamp has an unknown date;
// it is prepared and kept with its content like the rest, the batch is neither failed nor split, and nothing is
// excluded. The unknown date is absent from the message, never 0.
func TestITMSG07AnInvalidTimestampInHistoryIsAnUnknownDateAndKeepsTheBatch(t *testing.T) {
	for name, at := range map[string]uint64{"zero": 0, "year 11500": 300000000000, "overflow": 1<<63 + 5} {
		t.Run(name, func(t *testing.T) {
			b := batch(conversation("555@lid",
				text("ok1", "555@lid", 1700000001, "fine"),
				text("nots", "555@lid", at, "no time"),
				text("ok2", "555@lid", 1700000003, "also fine")))
			got, err := Prepare(context.Background(), b, env(t, nil))
			if err != nil {
				t.Fatalf("one invalid timestamp must not fail the batch: %v", err)
			}
			if got.Excluded != 0 || len(got.Inserts) != 3 {
				t.Fatalf("excluded=%d inserts=%d, want all three kept", got.Excluded, len(got.Inserts))
			}
			_, dated := idsOf(t, got.Inserts)
			if dated["nots"] || !dated["ok1"] || !dated["ok2"] {
				t.Fatalf("dates present: %v, want only the invalid one unknown", dated)
			}
			for _, insert := range got.Inserts {
				if insert.IdentityState != "resolved" {
					t.Fatalf("state %s", insert.IdentityState)
				}
			}
		})
	}
}

// An unknown date keeps the protocol position of the message instead of being sorted by its garbage value, and
// deduplication still goes by chat and message ID, not by date (n1, IT-MSG-07).
func TestITMSG07UnknownDateKeepsItsProtocolPositionInTheBatchAndDeduplicatesByID(t *testing.T) {
	b := batch(
		conversation("555@lid",
			text("a", "555@lid", 1700000001, "a"),
			text("u1", "555@lid", 0, "unknown after a"),
			text("b", "555@lid", 1700000005, "b"),
			text("u2", "555@lid", 300000000000, "unknown after b"),
			text("a", "555@lid", 0, "a again with no date")), // same ID: a duplicate, whatever its date
		conversation("666@lid",
			text("lead", "666@lid", 0, "leading unknown"),
			text("c", "666@lid", 1700000003, "c")),
		conversation("777@lid", text("only", "777@lid", 0, "no known date at all")),
	)
	got, err := Prepare(context.Background(), b, env(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	ids, _ := idsOf(t, got.Inserts)
	// Conversations merge by date; the unknown ones follow their neighbours. The repeated ID is one message.
	if len(ids) != 7 {
		t.Fatalf("ids %v, want 7 messages", ids)
	}
	pos := map[string]int{}
	for i, id := range ids {
		pos[id] = i
	}
	if !(pos["a"] < pos["u1"] && pos["u1"] < pos["b"] && pos["b"] < pos["u2"]) {
		t.Fatalf("unknown dates left their protocol position: %v", ids)
	}
	if !(pos["lead"] < pos["c"]) {
		t.Fatalf("a leading unknown must stay before its known neighbour: %v", ids)
	}
	if pos["u1"] != pos["a"]+1 {
		t.Fatalf("u1 must stay right after a: %v", ids)
	}
}
