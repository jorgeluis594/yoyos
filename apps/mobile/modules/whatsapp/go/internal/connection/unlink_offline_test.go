package connection

import (
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
)

// buildUnlink is how the bridge builds the client that connects only to unlink.
var buildUnlink = func(device *store.Device) *whatsmeowTransport {
	return NewUnlinkTransport(device, nil).(*whatsmeowTransport)
}

// M3: the server starts the offline queue as soon as the client is active, before the unlink is sent.
// The unlink client must neither decrypt nor acknowledge any of it, so the server redelivers it
// to the real receive path.
func TestM3UnlinkClientNeitherDecryptsNorAcknowledgesOfflineMessages(t *testing.T) {
	h := newSocketHarness(t, openAuthStore{}, true)
	jid := types.NewJID("review", types.DefaultUserServer)
	device := &store.Device{ID: &jid, NoiseKey: keys.NewKeyPair()}
	device.SetAllStores(&store.NoopStore{})
	device.PreKeys, device.PrivacyTokens = openAuthStore{}, openAuthStore{}
	h.transport = buildUnlink(device)
	h.wa.point(h.transport.client)
	conn := h.connectFirstLink(t)
	conn.success(t)
	for h.c.State() != Connected {
		time.Sleep(time.Millisecond)
	}
	for _, id := range []string{"OFFLINE1", "OFFLINE2"} {
		conn.send(t, waBinary.Node{Tag: "message", Attrs: waBinary.Attrs{"from": types.NewJID("34600", types.DefaultUserServer), "id": id, "t": "1700000000", "type": "text", "offline": "1"},
			Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"type": "msg", "v": "2"}, Content: []byte{1, 2, 3}}}})
	}
	deadline := time.After(700 * time.Millisecond)
	for {
		select {
		case node := <-conn.nodes:
			if node.Tag == "ack" || node.Tag == "receipt" {
				t.Fatalf("the unlink client answered an offline message with %q %v: the server would drop it", node.Tag, node.Attrs)
			}
		case <-deadline:
			return
		}
	}
}

// M3: the configuration itself, so a regression does not depend on timing.
func TestM3UnlinkClientRejectsMessagesBeforeDecryptionAndWithholdsAcks(t *testing.T) {
	jid := types.NewJID("review", types.DefaultUserServer)
	client := buildUnlink(&store.Device{ID: &jid, NoiseKey: keys.NewKeyPair()}).client
	if client.PreDecryptMessage == nil || !client.SynchronousAck || !client.EnableDecryptedEventBuffer {
		t.Fatal("unlink client can decrypt or acknowledge on its own")
	}
	if _, err := client.PreDecryptMessage(nil, &types.MessageInfo{}, &waBinary.Node{}); err == nil { //nolint:staticcheck // the hook ignores its context
		t.Fatal("the hook must reject every message")
	}
}
