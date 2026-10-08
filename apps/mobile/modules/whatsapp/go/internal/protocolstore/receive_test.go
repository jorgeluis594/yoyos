package protocolstore

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

type replayRecorder struct { infos []types.MessageInfo; formats []string }
func (r *replayRecorder) ReplayRecoveredProtocol(_ context.Context, info *types.MessageInfo, format string, plaintext []byte) error {
	r.infos = append(r.infos, *info)
	r.formats = append(r.formats, format)
	if string(plaintext) != "plain" { return failure(StateInvalid, "wrong replay plaintext") }
	return nil
}

func TestReplayRecoveryUsesOwnedMetadataAndAccount(t *testing.T) {
	metadata := `{"version":1,"accountId":"123@lid","id":"original","chat":"123@lid","sender":"456@s.whatsapp.net","senderAlt":"","recipientAlt":"","isFromMe":false,"isGroup":false,"timestampSeconds":123,"category":"","messageType":""}`
	pending := PendingRecord{PendingInsert: PendingInsert{AccountID: "123@lid", Source: "live", Recovery: Recovery{MessageInfoJSON: metadata,
		Items: []RecoveryItem{{Format: "v2", PlaintextBase64: base64.StdEncoding.EncodeToString([]byte("plain"))},
			{Format: "v3", PlaintextBase64: base64.StdEncoding.EncodeToString([]byte("plain"))}}}}}
	recorder := &replayRecorder{}
	if err := ReplayRecovery(context.Background(), "123@lid", pending, recorder); err != nil { t.Fatal(err) }
	if len(recorder.infos) != 2 || recorder.infos[0].ID != "original" || recorder.infos[0].Chat.String() != "123@lid" || recorder.formats[1] != "v3" { t.Fatal("replay lost owned metadata") }
	if err := ReplayRecovery(context.Background(), "other@lid", pending, recorder); err == nil { t.Fatal("cross-account replay allowed") }
}

func TestCapturedReceiveCommitsRecoveryWithSignalState(t *testing.T) {
	native := &controlledStorage{}
	protocol := openTest(t, native)
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: types.NewJID("123", types.HiddenUserServer), Sender: types.NewJID("456", types.DefaultUserServer)}, ID: "message", Timestamp: time.Unix(123, 0)}
	ciphertext := []byte{1, 2, 3}
	node := &waBinary.Node{Content: []waBinary.Node{
		{Tag: "enc", Attrs: waBinary.Attrs{"v": "2", "type": "msg"}, Content: ciphertext},
		{Tag: "enc", Attrs: waBinary.Attrs{"v": "3", "type": "msg"}, Content: []byte{4, 5, 6}},
	}}
	called := false
	ctx, err := CaptureReceive(context.Background(), "123@lid", info, node, func(c CapturedReceive, child CapturedChild, plaintext []byte) (string, json.RawMessage, error) {
		called = true
		if c.AccountID != "123@lid" || len(c.Children) != 2 || c.Children[0].Ciphertext[0] != 1 || c.Children[1].Ciphertext[0] != 4 || child.Format != "v2" || string(plaintext) != "plain" {
			t.Fatal("receive metadata was borrowed or incomplete")
		}
		return "pendingLid", nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	ciphertext[0] = 9
	info.ID = "mutated"
	var hash [32]byte
	hash[0] = 7
	err = protocol.DoDecryptionTxn(store.WithBufferedEventChild(ctx, 0), func(tx context.Context) error {
		if err := protocol.PutSession(tx, "alice.0:0", []byte("signal")); err != nil {
			return err
		}
		return protocol.PutBufferedEvent(tx, hash, []byte("plain"), time.Unix(123, 0))
	})
	if err != nil {
		t.Fatal(err)
	}
	if !called || len(native.calls) != 1 || len(native.calls[0].ProtocolChanges) != 2 || len(native.calls[0].PendingInserts) != 1 || len(native.pending) != 1 {
		t.Fatal("recovery and Signal did not commit together")
	}
	if native.pending[0].Recovery.Items[0].Format != "v2" || native.pending[0].Recovery.Items[0].PlaintextBase64 != "cGxhaW4=" {
		t.Fatal("pending plaintext absent")
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(native.pending[0].Recovery.MessageInfoJSON), &meta); err != nil || meta["id"] != "message" {
		t.Fatal("metadata changed after capture", err)
	}
	buffered, err := protocol.GetBufferedEvent(context.Background(), hash)
	if err != nil || buffered == nil || buffered.Plaintext != nil {
		t.Fatal("retry marker not durable", buffered, err)
	}
	if err := protocol.ClearBufferedEventPlaintext(context.Background(), hash); err != nil {
		t.Fatal(err)
	}
}
