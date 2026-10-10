package identity

import (
	"encoding/base64"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/protocolstore"
)

func notificationMessage(t *testing.T) []byte {
	t.Helper()
	raw, err := proto.Marshal(&waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type:                    waE2E.ProtocolMessage_HISTORY_SYNC_NOTIFICATION.Enum(),
		HistorySyncNotification: &waE2E.HistorySyncNotification{DirectPath: proto.String("/v/batch")},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Only a notification from the account's own phone is a capture; anyone else's is ordinary excluded protocol content.
func TestClassifyRecognizesTheOwnHistoryNotification(t *testing.T) {
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: lid, Sender: lid, IsFromMe: true}, ID: "n1"}
	if state, message, err := Classify(info, "v2", notificationMessage(t), *device.ID, device.LID, nil); err != nil || state != HistoryNotification || len(message) != 0 {
		t.Fatalf("own notification: %s %s %v", state, message, err)
	}
	info.IsFromMe = false
	if state, _, err := Classify(info, "v2", notificationMessage(t), *device.ID, device.LID, nil); err != nil || state != Excluded {
		t.Fatalf("a notification from someone else is excluded: %s %v", state, err)
	}
}

func webMessage(t *testing.T, id string) []byte {
	t.Helper()
	raw, err := proto.Marshal(&waWeb.WebMessageInfo{
		Key:              &waCommon.MessageKey{RemoteJID: proto.String("34600@s.whatsapp.net"), FromMe: proto.Bool(false), ID: proto.String(id)},
		MessageTimestamp: proto.Uint64(1700000000),
		Message:          &waE2E.Message{Conversation: proto.String("hola")},
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// A historical message is classified by the same rules as a live one, from the metadata and web message it was kept with.
func TestClassifyHistoryFormatMatchesLiveRules(t *testing.T) {
	live := &types.MessageInfo{MessageSource: types.MessageSource{Chat: phone, Sender: phone}, ID: "h1", Timestamp: time.Unix(1700000000, 0)}
	if state, _, err := Classify(live, "history", webMessage(t, "h1"), *device.ID, device.LID, nil); err != nil || state != PendingLID {
		t.Fatalf("an unmapped phone chat is pending: %s %v", state, err)
	}
	state, message, err := Classify(live, "history", webMessage(t, "h1"), *device.ID, device.LID, map[types.JID]types.JID{phone: lid})
	if err != nil || state != Resolved || !belongsTo(message, owner) {
		t.Fatalf("a verified mapping resolves it: %s %s %v", state, message, err)
	}
	if state, _, _ := Classify(live, "history", []byte("not a web message"), *device.ID, device.LID, nil); state != Excluded {
		t.Fatalf("garbage is excluded, not an error: %s", state)
	}
	if state, _, _ := Classify(live, "v3", webMessage(t, "h1"), *device.ID, device.LID, nil); state != Excluded {
		t.Fatalf("unknown formats are excluded: %s", state)
	}
}

// The resolver completes history entries from their durable web message, and never mistakes a capture for one.
func TestResolveCompletesHistoryEntriesAndSkipsCaptures(t *testing.T) {
	history := pendingRecord(t, owner)
	history.Source = "history"
	history.Recovery.MessageInfoJSON = `{"version":1,"accountId":"` + owner + `","id":"h1","chat":"34600@s.whatsapp.net","sender":"34600@s.whatsapp.net","timestampSeconds":1700000000}`
	history.Recovery.Items = []protocolstore.RecoveryItem{{Format: "history", PlaintextBase64: base64.StdEncoding.EncodeToString(webMessage(t, "h1"))}}

	capture := pendingRecord(t, owner)
	capture.DeliveryID = "wa-delivery:v1:00000000000000000000000000000002"
	capture.Source = "history"
	capture.Recovery.MessageInfoJSON = `{"version":1,"accountId":"` + owner + `","id":"n1","chat":"123@lid","sender":"123@lid","isFromMe":true,"timestampSeconds":1700000000,"messageType":"history-notification"}`
	capture.Recovery.Items = []protocolstore.RecoveryItem{{Format: "history", PlaintextBase64: base64.StdEncoding.EncodeToString(notificationMessage(t))}}

	unmapped := &fakeAccount{id: owner}
	ledger := &fakeLedger{records: []protocolstore.PendingRecord{capture, history}}
	out, err := Resolve(t.Context(), ledger, unmapped, device)
	if err != nil || out != (Outcome{Unresolved: 1}) {
		t.Fatalf("a capture is neither unresolved nor invalid: %+v %v", out, err)
	}
	mapped := &fakeAccount{id: owner, mappings: map[types.JID]types.JID{phone: lid}}
	out, err = Resolve(t.Context(), ledger, mapped, device)
	if err != nil || out != (Outcome{Resolved: 1}) || len(mapped.publishes) != 1 || len(mapped.publishes[0]) != 1 || mapped.publishes[0][0].DeliveryID != history.DeliveryID {
		t.Fatalf("only the historical message completes: %+v %v %v", out, err, mapped.publishes)
	}
}
