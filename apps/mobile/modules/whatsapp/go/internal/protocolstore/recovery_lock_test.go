package protocolstore

import (
	"context"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waServerSync"
	"go.mau.fi/whatsmeow/proto/waSyncAction"
	recoverypb "go.mau.fi/whatsmeow/proto/waSyncdSnapshotRecovery"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"runtime"
	"testing"
	"time"
)

type reviewOutsideKey struct{}
type reviewGatedKeys struct {
	*Store
	entered, release chan struct{}
}

func (s reviewGatedKeys) GetAppStateSyncKey(ctx context.Context, id []byte) (*store.AppStateSyncKey, error) {
	if ctx.Value(reviewOutsideKey{}) != nil {
		close(s.entered)
		<-s.release
	}
	return s.Store.GetAppStateSyncKey(ctx, id)
}
func TestRecoveryKeyCacheLockOrder(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	d := &store.Device{}
	s.AttachDevice(d)
	keys := reviewGatedKeys{s, make(chan struct{}), make(chan struct{})}
	d.AppStateKeys = keys
	c := whatsmeow.NewClient(d, nil)
	if err := s.PutAppStateSyncKey(ctx, []byte{1}, store.AppStateSyncKey{Data: make([]byte, 32)}); err != nil {
		t.Fatal(err)
	}
	snap := &recoverypb.SyncdSnapshotRecovery{CollectionName: proto.String("regular"), Version: &recoverypb.SyncdVersion{Version: proto.Uint64(2)}, CollectionLthash: make([]byte, 128)}
	snap.MutationRecords = []*recoverypb.SyncdPlainTextRecord{{KeyID: []byte{1}, Mac: make([]byte, 32), Value: &waSyncAction.SyncActionData{Index: []byte(`["contact","456@lid"]`), Value: &waSyncAction.SyncActionValue{ContactAction: &waSyncAction.ContactAction{FullName: proto.String("Name")}}}}}
	raw, _ := proto.Marshal(snap)
	plain, _ := proto.Marshal(&waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{PeerDataOperationRequestResponseMessage: &waE2E.PeerDataOperationRequestResponseMessage{PeerDataOperationRequestType: waE2E.PeerDataOperationRequestType_COMPANION_SYNCD_SNAPSHOT_FATAL_RECOVERY.Enum(), PeerDataOperationResult: []*waE2E.PeerDataOperationRequestResponseMessage_PeerDataOperationResult{{SyncdSnapshotFatalRecoveryResponse: &waE2E.PeerDataOperationRequestResponseMessage_PeerDataOperationResult_SyncDSnapshotFatalRecoveryResponse{CollectionSnapshot: raw}}}}}})
	outsideDone := make(chan struct{})
	go func() {
		defer close(outsideDone)
		_, _ = c.DangerousInternals().ApplyAppStatePatches(context.WithValue(ctx, reviewOutsideKey{}, true), appstate.WAPatchRegular, appstate.HashState{}, &appstate.PatchList{Snapshot: &waServerSync.SyncdSnapshot{KeyID: &waServerSync.KeyId{ID: []byte{1}}, Version: &waServerSync.SyncdVersion{Version: proto.Uint64(1)}}}, true, nil)
	}()
	select {
	case <-keys.entered:
	case <-time.After(time.Second):
		t.Fatal("normal app-state key read not reached")
	}
	insideEntered := make(chan struct{})
	insideDone := make(chan struct{})
	go func() {
		defer close(insideDone)
		_ = s.DoDecryptionTxn(ctx, func(tx context.Context) error {
			close(insideEntered)
			return c.ReplayRecoveredProtocol(tx, &types.MessageInfo{MessageSource: types.MessageSource{IsFromMe: true}}, "v2", plain)
		})
	}()
	<-insideEntered
	close(keys.release)
	select {
	case <-insideDone:
	case <-time.After(300 * time.Millisecond):
		buf := make([]byte, 65536)
		buf = buf[:runtime.Stack(buf, true)]
		t.Fatalf("receive transaction and ordinary app-state decode deadlocked: %s", buf)
	}
	select {
	case <-outsideDone:
	case <-time.After(time.Second):
		t.Fatal("ordinary decode stuck")
	}
}
