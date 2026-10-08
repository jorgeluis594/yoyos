package protocolstore

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

type stagingProcessor struct {
	store *Store
	fail  bool
}

func (p stagingProcessor) ReplayRecoveredProtocol(ctx context.Context, info *types.MessageInfo, _ string, plaintext []byte) error {
	if p.fail {
		return failure(StorageFailed, "post-decryption storage failed")
	}
	if info.ID != "message" || string(plaintext) != "plain" {
		return failure(StateInvalid, "wrong precommit metadata")
	}
	return p.store.PutMessageSecret(ctx, info.Chat, info.Sender, info.ID, []byte{1})
}
func TestCapturedReceiveCommitsRecoveryWithSignalState(t *testing.T) {
	for _, format := range []struct {
		name  string
		index int
	}{{"v2", 0}, {"v3", 1}} {
		t.Run(format.name, func(t *testing.T) {
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
				if c.AccountID != "123@lid" || len(c.Children) != 2 || c.Children[0].Ciphertext[0] != 1 || c.Children[1].Ciphertext[0] != 4 || child.Format != format.name || string(plaintext) != "plain" {
					t.Fatal("receive metadata was borrowed or incomplete")
				}
				return "pendingLid", nil, nil
			}, stagingProcessor{store: protocol})
			if err != nil {
				t.Fatal(err)
			}
			ciphertext[0] = 9
			info.ID = "mutated"
			var hash [32]byte
			hash[0] = 7
			err = protocol.DoDecryptionTxn(store.WithBufferedEventChild(ctx, format.index), func(tx context.Context) error {
				if err := protocol.PutSession(tx, "alice.0:0", []byte("signal")); err != nil {
					return err
				}
				return protocol.PutBufferedEvent(tx, hash, []byte("plain"), time.Unix(123, 0))
			})
			if err != nil {
				t.Fatal(err)
			}
			if !called || len(native.calls) != 1 || len(native.calls[0].ProtocolChanges) != 3 || len(native.calls[0].PendingInserts) != 1 || len(native.pending) != 1 {
				t.Fatal("post-decryption writes, recovery and Signal did not commit together")
			}
			if native.pending[0].Recovery.Items[0].Format != format.name || native.pending[0].Recovery.Items[0].PlaintextBase64 != "cGxhaW4=" {
				t.Fatal("pending plaintext absent")
			}
			reopened, err := Open(native, "gen", "123@lid", 10*1024*1024, 10*1024*1024)
			if err != nil || len(reopened.pending) != 1 || len(reopened.records) != 3 {
				t.Fatal("committed recovery was not readable after client restart", err)
			}
			var meta map[string]any
			if err := json.Unmarshal([]byte(native.pending[0].Recovery.MessageInfoJSON), &meta); err != nil || meta["id"] != "message" {
				t.Fatal("metadata changed after capture", err)
			}
			buffered, err := protocol.GetBufferedEvent(context.Background(), hash)
			if err != nil || buffered == nil || buffered.Plaintext != nil || !buffered.Pending {
				t.Fatal("retry marker not durable", buffered, err)
			}
			native.mu.Lock()
			native.pending = nil
			native.revision++
			native.mu.Unlock()
			buffered, err = protocol.GetBufferedEvent(context.Background(), hash)
			if err != nil || buffered == nil || buffered.Pending {
				t.Fatal("confirmed retry marker still blocks ACK", buffered, err)
			}
			if err := protocol.ClearBufferedEventPlaintext(context.Background(), hash); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPostDecryptWriteFailureDoesNotPublishPendingOrSignal(t *testing.T) {
	native := &controlledStorage{}
	protocol := openTest(t, native)
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: types.NewJID("123", types.HiddenUserServer), Sender: types.NewJID("456", types.DefaultUserServer)}, ID: "message", Timestamp: time.Unix(123, 0)}
	node := &waBinary.Node{Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"v": "2", "type": "msg"}, Content: []byte{1}}}}
	ctx, err := CaptureReceive(context.Background(), "123@lid", info, node,
		func(CapturedReceive, CapturedChild, []byte) (string, json.RawMessage, error) {
			return "pendingLid", nil, nil
		},
		stagingProcessor{store: protocol, fail: true})
	if err != nil {
		t.Fatal(err)
	}
	var hash [32]byte
	err = protocol.DoDecryptionTxn(store.WithBufferedEventChild(ctx, 0), func(tx context.Context) error {
		if err := protocol.PutSession(tx, "alice.0:0", []byte("signal")); err != nil {
			return err
		}
		return protocol.PutBufferedEvent(tx, hash, []byte("plain"), time.Unix(123, 0))
	})
	codeIs(t, err, StorageFailed)
	if len(native.calls) != 0 || len(native.pending) != 0 || len(native.records) != 0 {
		t.Fatal("failed post-decryption write published state")
	}
	codeIs(t, protocol.StopReason(), StorageFailed)
}
