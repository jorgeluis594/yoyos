package protocolstore

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waSyncAction"
	recoverypb "go.mau.fi/whatsmeow/proto/waSyncdSnapshotRecovery"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type failingRecoveryContacts struct{ store.ContactStore }

func (failingRecoveryContacts) PutContactName(context.Context, types.JID, string, string) error {
	return errors.New("injected contact write failure")
}

type failingRecoverySalt struct{ store.NCTSaltStore }

func (failingRecoverySalt) PutNCTSalt(context.Context, []byte) error {
	return errors.New("injected NCT salt write failure")
}

func TestFatalRecoveryAuxiliaryWritesJoinPendingTransaction(t *testing.T) {
	for _, test := range []struct {
		name                   string
		failContacts, failSalt bool
	}{{name: "commit"}, {name: "contact rollback", failContacts: true}, {name: "NCT rollback", failSalt: true}} {
		t.Run(test.name, func(t *testing.T) {
			native := &controlledStorage{}
			protocol := openTest(t, native)
			device := &store.Device{}
			protocol.AttachDevice(device)
			client := whatsmeow.NewClient(device, nil)
			completions := 0
			client.AddEventHandler(func(event any) {
				if _, ok := event.(*events.AppStateSyncComplete); ok {
					completions++
				}
			})
			ctx := context.Background()
			if err := protocol.PutAppStateSyncKey(ctx, []byte{1}, store.AppStateSyncKey{Data: make([]byte, 32)}); err != nil {
				t.Fatal(err)
			}
			if test.failContacts {
				device.Contacts = failingRecoveryContacts{protocol}
			}
			if test.failSalt {
				device.NCTSalt = failingRecoverySalt{protocol}
			}
			records := []struct {
				index string
				value *waSyncAction.SyncActionValue
			}{
				{`["contact","456@lid"]`, &waSyncAction.SyncActionValue{ContactAction: &waSyncAction.ContactAction{FullName: proto.String("Recovered")}}},
				{`["pin_v1","456@lid"]`, &waSyncAction.SyncActionValue{PinAction: &waSyncAction.PinAction{Pinned: proto.Bool(true)}}},
				{`["nct_salt_sync"]`, &waSyncAction.SyncActionValue{NctSaltSyncAction: &waSyncAction.NctSaltSyncAction{Salt: []byte{7, 8}}}},
			}
			snapshot := &recoverypb.SyncdSnapshotRecovery{CollectionName: proto.String("regular"), Version: &recoverypb.SyncdVersion{Version: proto.Uint64(2)}, CollectionLthash: make([]byte, 128)}
			for _, r := range records {
				snapshot.MutationRecords = append(snapshot.MutationRecords, &recoverypb.SyncdPlainTextRecord{KeyID: []byte{1}, Mac: make([]byte, 32), Value: &waSyncAction.SyncActionData{Index: []byte(r.index), Value: r.value}})
			}
			raw, err := proto.Marshal(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			result := []*waE2E.PeerDataOperationRequestResponseMessage_PeerDataOperationResult{{SyncdSnapshotFatalRecoveryResponse: &waE2E.PeerDataOperationRequestResponseMessage_PeerDataOperationResult_SyncDSnapshotFatalRecoveryResponse{CollectionSnapshot: raw}}}
			plain, err := proto.Marshal(&waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{PeerDataOperationRequestResponseMessage: &waE2E.PeerDataOperationRequestResponseMessage{PeerDataOperationRequestType: waE2E.PeerDataOperationRequestType_COMPANION_SYNCD_SNAPSHOT_FATAL_RECOVERY.Enum(), PeerDataOperationResult: result}}})
			if err != nil {
				t.Fatal(err)
			}
			info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: types.NewJID("123", types.HiddenUserServer), Sender: types.NewJID("123", types.HiddenUserServer), IsFromMe: true}, ID: "recovery-aux", Timestamp: time.Unix(123, 0)}
			node := &waBinary.Node{Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"v": "2", "type": "msg"}, Content: []byte{1}}}}
			ctx, err = CaptureReceive(ctx, "123@lid", info, node, func(CapturedReceive, CapturedChild, []byte) (string, json.RawMessage, error) {
				return "pendingLid", nil, nil
			}, client)
			if err != nil {
				t.Fatal(err)
			}
			err = protocol.DoDecryptionTxn(store.WithBufferedEventChild(ctx, 0), func(tx context.Context) error {
				return protocol.PutBufferedEvent(tx, [32]byte{1}, plain, info.Timestamp)
			})
			if test.name != "commit" && err == nil || test.name == "commit" && err != nil {
				t.Fatal("unexpected transaction result", err)
			}
			if completions != 0 {
				t.Fatal("completion dispatched before durable commit")
			}
			if test.name == "commit" {
				for range 2 {
					ok, err := client.DangerousInternals().HandleAppStateRecovery(ctx, info.ID, result)
					if err != nil || !ok {
						t.Fatal("postcommit recovery dispatch failed", err)
					}
				}
				if completions != 1 {
					t.Fatal("recovery completion was not dispatched exactly once", completions)
				}
			}
			restored := openTest(t, native)
			version, _, err := restored.GetAppStateVersion(context.Background(), "regular")
			if err != nil {
				t.Fatal(err)
			}
			contact, err := restored.GetContact(context.Background(), types.NewJID("456", types.HiddenUserServer))
			if err != nil {
				t.Fatal(err)
			}
			chat, err := restored.GetChatSettings(context.Background(), types.NewJID("456", types.HiddenUserServer))
			if err != nil {
				t.Fatal(err)
			}
			salt, err := restored.GetNCTSalt(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if test.name != "commit" {
				if version != 0 || contact.Found || chat.Pinned || len(salt) != 0 || len(native.pending) != 0 {
					t.Fatal("failed mutation published partial recovery")
				}
			} else if version != 2 || contact.FullName != "Recovered" || !chat.Pinned || len(salt) != 2 || len(native.pending) != 1 {
				t.Fatalf("recovery lost auxiliary state: version=%d contact=%+v chat=%+v salt=%v pending=%d", version, contact, chat, salt, len(native.pending))
			}
		})
	}
}
