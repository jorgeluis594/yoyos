package protocolstore

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waServerSync"
	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"google.golang.org/protobuf/proto"
)

func TestOrdinaryAppStatePushNamePublication(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "commit", true: "rollback"}[fail], func(t *testing.T) {
			native := &controlledStorage{}
			protocol := openTest(t, native)
			device := validDevice()
			device.PushName = "Before"
			ctx := context.Background()
			if err := protocol.PutDevice(ctx, device); err != nil {
				t.Fatal(err)
			}
			client := whatsmeow.NewClient(device, nil)
			if fail {
				native.errCode = StorageFailed
			}
			mutations := []appstate.Mutation{{Operation: waServerSync.SyncdMutation_SET, Index: []string{appstate.IndexSettingPushName}, Action: &waSyncAction.SyncActionValue{PushNameSetting: &waSyncAction.PushNameSetting{Name: proto.String("After")}}}}
			var events []any
			err := client.DangerousInternals().CollectEventsToDispatch(ctx, appstate.WAPatchCriticalBlock, mutations, false, &events)
			if fail {
				if err == nil || device.PushName != "Before" {
					t.Fatalf("failed save changed live push name: %q, %v", device.PushName, err)
				}
			} else if err != nil || device.PushName != "After" || len(events) != 2 {
				t.Fatalf("successful save left stale live push name: %q, events=%d, err=%v", device.PushName, len(events), err)
			}
			restored, err := openTest(t, native).RestoreDevice(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if restored.PushName != device.PushName {
				t.Fatalf("live/durable push names differ: %q / %q", device.PushName, restored.PushName)
			}
		})
	}
}
