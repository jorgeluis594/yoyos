package history

import (
	"bytes"
	"compress/zlib"
	"context"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

var ownPN = types.JID{User: "123", Server: types.DefaultUserServer}
var ownLID = types.JID{User: "123", Server: types.HiddenUserServer}

const account = "123@lid"

func text(id, chat string, at uint64, body string) *waHistorySync.HistorySyncMsg {
	return &waHistorySync.HistorySyncMsg{Message: &waWeb.WebMessageInfo{
		Key:              &waCommon.MessageKey{RemoteJID: proto.String(chat), FromMe: proto.Bool(false), ID: proto.String(id)},
		MessageTimestamp: proto.Uint64(at),
		Message:          &waE2E.Message{Conversation: proto.String(body)},
	}}
}

func conversation(chat string, messages ...*waHistorySync.HistorySyncMsg) *waHistorySync.Conversation {
	return &waHistorySync.Conversation{ID: proto.String(chat), Messages: messages}
}

func batch(conversations ...*waHistorySync.Conversation) *waHistorySync.HistorySync {
	return &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(), Conversations: conversations}
}

func wire(t testing.TB, b *waHistorySync.HistorySync) []byte {
	t.Helper()
	raw, err := proto.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func deflate(t testing.TB, raw []byte) []byte {
	t.Helper()
	var out bytes.Buffer
	w := zlib.NewWriter(&out)
	if _, err := w.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// testClient parses with the real dependency method, so the tests exercise ParseWebMessage itself.
func testClient() *whatsmeow.Client {
	return whatsmeow.NewClient(&store.Device{ID: &ownPN, LID: ownLID}, nil)
}

func env(t testing.TB, stored map[types.JID]types.JID) Env {
	client := testClient()
	return Env{
		Account: account, Own: ownPN, OwnAlt: ownLID, Parse: client.ParseWebMessage,
		Stored:        func(context.Context, []types.JID) (map[types.JID]types.JID, error) { return stored, nil },
		CheckMappings: func(context.Context, []store.LIDMapping) error { return nil },
	}
}
