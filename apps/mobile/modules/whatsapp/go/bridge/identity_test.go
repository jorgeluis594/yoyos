package bridge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/protocolstate"
	"yoyos-whatsapp/internal/protocolstore"
)

// linkStorage is one native container serving protocol state, first link and pending entries.
type linkStorage struct {
	mu         sync.Mutex
	revision   uint64
	sessionRev uint64
	records    map[string]protocolstate.Record
	pending    []protocolstore.PendingRecord
	realRetire bool // RetirePending removes the entry; earlier tests rely on the inert stub
}

func okJSON(data any) string {
	raw, _ := json.Marshal(map[string]any{"contractVersion": 1, "success": true, "data": data})
	return string(raw)
}

func (s *linkStorage) ReadState(string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var session any
	if s.sessionRev != 0 {
		records := []protocolstate.Record{}
		for _, r := range s.records {
			records = append(records, r)
		}
		session = map[string]any{"accountId": "123@lid", "protocolSchemaVersion": 1, "records": records}
	}
	return okJSON(map[string]any{"revision": fmt.Sprint(s.revision), "sessionRevision": fmt.Sprint(s.sessionRev), "session": session, "pending": append([]protocolstore.PendingRecord{}, s.pending...)}), nil
}
func (s *linkStorage) BeginFreshSession(request string) (string, error) {
	var in struct {
		Device protocolstate.Record `json:"device"`
	}
	if err := json.Unmarshal([]byte(request), &in); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revision++
	s.sessionRev = s.revision
	s.records = map[string]protocolstate.Record{in.Device.RecordType + "\x00" + in.Device.RecordKey: in.Device}
	return okJSON(map[string]string{"revision": fmt.Sprint(s.revision), "sessionRevision": fmt.Sprint(s.sessionRev)}), nil
}
func (s *linkStorage) ApplyChanges(request string) (string, error) {
	var a protocolstore.ApplyRequest
	if err := json.Unmarshal([]byte(request), &a); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range a.ProtocolChanges {
		key := c.RecordType + "\x00" + c.RecordKey
		if c.Operation == "put" {
			s.records[key] = protocolstate.Record{RecordType: c.RecordType, RecordKey: c.RecordKey, ValueBase64: c.ValueBase64}
		} else {
			delete(s.records, key)
		}
	}
	s.revision++
	if len(a.ProtocolChanges) > 0 {
		s.sessionRev = s.revision
	}
	for _, u := range a.PendingIdentityUpdates {
		for i := range s.pending {
			if s.pending[i].DeliveryID == u.DeliveryID {
				s.pending[i].IdentityState, s.pending[i].Message = u.IdentityState, u.Message
			}
		}
	}
	return okJSON(map[string]string{"revision": fmt.Sprint(s.revision), "sessionRevision": fmt.Sprint(s.sessionRev)}), nil
}
func (s *linkStorage) ReadPending(string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return okJSON(map[string]any{"revision": fmt.Sprint(s.revision), "pending": append([]protocolstore.PendingRecord{}, s.pending...)}), nil
}
func (s *linkStorage) RetirePending(request string) (string, error) {
	var in struct {
		DeliveryID string `json:"deliveryId"`
	}
	_ = json.Unmarshal([]byte(request), &in)
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.realRetire {
		return okJSON(map[string]any{"revision": "1", "removed": false}), nil
	}
	removed := false
	for i, p := range s.pending {
		if p.DeliveryID == in.DeliveryID {
			s.pending = append(s.pending[:i:i], s.pending[i+1:]...)
			s.revision++
			removed = true
			break
		}
	}
	return okJSON(map[string]any{"revision": fmt.Sprint(s.revision), "removed": removed}), nil
}
func (s *linkStorage) has(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.pending {
		if p.DeliveryID == id {
			return true
		}
	}
	return false
}
func (s *linkStorage) state(i int) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pending[i].IdentityState
}

func pairedDevice(fresh *store.Device) *store.Device {
	id := types.JID{User: "123", Device: 1, Server: types.DefaultUserServer}
	details, _ := proto.Marshal(&waAdv.ADVDeviceIdentity{RawID: proto.Uint32(1)})
	fresh.ID = &id
	fresh.LID = types.JID{User: "123", Device: 1, Server: types.HiddenUserServer}
	fresh.Account = &waAdv.ADVSignedDeviceIdentity{Details: details, AccountSignatureKey: bytes.Repeat([]byte{1}, 32), AccountSignature: bytes.Repeat([]byte{1}, 64), DeviceSignature: bytes.Repeat([]byte{1}, 64)}
	return fresh
}

func pendingEntry(t *testing.T, id int, text string) protocolstore.PendingRecord {
	t.Helper()
	plaintext, _ := proto.Marshal(&waE2E.Message{Conversation: proto.String(text)})
	ordinal := uint32(id)
	record := protocolstore.PendingRecord{CreatedRevision: "1", CreatedOrdinal: &ordinal}
	record.DeliveryID, record.AccountID, record.Source, record.IdentityState = deliveryID(id), "123@lid", "live", "pendingLid"
	record.Recovery = protocolstore.Recovery{
		MessageInfoJSON: fmt.Sprintf(`{"version":1,"accountId":"123@lid","id":"p%d","chat":"34600@s.whatsapp.net","sender":"34600@s.whatsapp.net","timestampSeconds":1700000000}`, id),
		Items:           []protocolstore.RecoveryItem{{Format: "v2", PlaintextBase64: base64.StdEncoding.EncodeToString(plaintext), CiphertextHashBase64: base64.StdEncoding.EncodeToString(make([]byte, 32))}},
	}
	return record
}

// M1: a mapping that arrives after the first link, in the store created by the pairing, completes the identity.
func TestITID08LateMappingAfterFirstLinkResolves(t *testing.T) {
	native := &linkStorage{records: map[string]protocolstate.Record{}}
	delivery, _ := openDeliveryOn(t, native)
	opened := OpenConnectionWithDelivery(native, connectionSink{}, delivery, "gen", "", 10<<20, 10<<20)
	if opened.Code != "" {
		t.Fatal(opened.Code)
	}
	defer opened.Session.Close()
	device := pairedDevice(opened.Session.device)
	if err := device.Container.PutDevice(context.Background(), device); err != nil {
		t.Fatal(err)
	}
	native.mu.Lock()
	native.pending = append(native.pending, pendingEntry(t, 1, "hola"))
	native.mu.Unlock()
	opened.Session.identity.Trigger()
	time.Sleep(100 * time.Millisecond)
	if native.state(0) != "pendingLid" {
		t.Fatal("resolved without a mapping")
	}
	linked, ok := device.Container.(*protocolstore.Store)
	if !ok {
		t.Fatalf("linked container is %T", device.Container)
	}
	if err := linked.PutLIDMapping(context.Background(), types.JID{User: "9001", Server: types.HiddenUserServer}, types.JID{User: "34600", Server: types.DefaultUserServer}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for native.state(0) != "resolved" {
		if time.Now().After(deadline) {
			t.Fatal("late mapping after the first link did not resolve the entry")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func openDeliveryOn(t *testing.T, storage DeliveryStorage) (*DeliverySession, *deliverySink) {
	t.Helper()
	sink := newDeliverySink()
	result := OpenDelivery(storage, sink, 10<<20, 10<<20)
	if result.Code != "" || result.Session == nil {
		t.Fatalf("open failed: %+v", result)
	}
	t.Cleanup(result.Session.Close)
	return result.Session, sink
}
