package identity

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/protocolstore"
)

const owner = "123@lid"

var (
	phone      = types.JID{User: "34600", Server: types.DefaultUserServer}
	lid        = types.JID{User: "9001", Server: types.HiddenUserServer}
	device     = &store.Device{ID: &types.JID{User: "123", Device: 1, Server: types.DefaultUserServer}, LID: types.JID{User: "123", Device: 1, Server: types.HiddenUserServer}}
	errStore   = errors.New("store unreadable")
	errLedger  = errors.New("ledger unreadable")
	deliveryID = "wa-delivery:v1:00000000000000000000000000000001"
)

type fakeLedger struct {
	records []protocolstore.PendingRecord
	err     error
}

func (f *fakeLedger) Pending() ([]protocolstore.PendingRecord, error) { return f.records, f.err }

type fakeAccount struct {
	id        string
	mappings  map[types.JID]types.JID
	readErr   error
	publishes [][]protocolstore.PendingIdentityUpdate
}

func (f *fakeAccount) AccountID() string { return f.id }
func (f *fakeAccount) GetManyLIDsForPNs(_ context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	if f.readErr != nil {
		return nil, f.readErr
	}
	out := map[types.JID]types.JID{}
	for _, pn := range pns {
		if value, ok := f.mappings[pn]; ok {
			out[pn] = value
		}
	}
	return out, nil
}
func (f *fakeAccount) PublishPendingIdentities(_ context.Context, updates []protocolstore.PendingIdentityUpdate) error {
	if len(updates) > 0 {
		f.publishes = append(f.publishes, updates)
	}
	return nil
}

func pendingRecord(t *testing.T, accountID string) protocolstore.PendingRecord {
	t.Helper()
	plaintext, err := proto.Marshal(&waE2E.Message{Conversation: proto.String("hola")})
	if err != nil {
		t.Fatal(err)
	}
	ordinal := uint32(0)
	record := protocolstore.PendingRecord{CreatedRevision: "1", CreatedOrdinal: &ordinal}
	record.DeliveryID, record.AccountID, record.Source, record.IdentityState = deliveryID, accountID, "live", "pendingLid"
	record.Recovery = protocolstore.Recovery{
		MessageInfoJSON: `{"version":1,"accountId":"` + accountID + `","id":"p1","chat":"34600@s.whatsapp.net","sender":"34600@s.whatsapp.net","timestampSeconds":1700000000}`,
		Items:           []protocolstore.RecoveryItem{{Format: "v2", PlaintextBase64: base64.StdEncoding.EncodeToString(plaintext)}},
	}
	return record
}

// UT-ID-07: an absent correspondence is a valid state, not an error, and stays pending untouched.
func TestUTID07AbsentMappingIsValidAndLeavesEntryPending(t *testing.T) {
	account := &fakeAccount{id: owner}
	ledger := &fakeLedger{records: []protocolstore.PendingRecord{pendingRecord(t, owner)}}
	out, err := Resolve(t.Context(), ledger, account, device)
	if err != nil || out != (Outcome{Unresolved: 1}) || len(account.publishes) != 0 {
		t.Fatalf("outcome %+v err %v publishes %d", out, err, len(account.publishes))
	}
}

// UT-ID-07: a failing read of the store or of the ledger is an error and never counts as absence.
func TestUTID07ReadFailureIsNotAbsence(t *testing.T) {
	account := &fakeAccount{id: owner, readErr: errStore}
	ledger := &fakeLedger{records: []protocolstore.PendingRecord{pendingRecord(t, owner)}}
	if _, err := Resolve(t.Context(), ledger, account, device); !errors.Is(err, errStore) {
		t.Fatalf("store read failure lost: %v", err)
	}
	ledger.err = errLedger
	if _, err := Resolve(t.Context(), ledger, &fakeAccount{id: owner}, device); !errors.Is(err, errLedger) {
		t.Fatalf("ledger read failure lost: %v", err)
	}
}

// UT-ID-07: a verified mapping completes the entry with a definitive message, keeping its delivery ID.
func TestUTID07VerifiedMappingResolvesWithDefinitiveIdentity(t *testing.T) {
	account := &fakeAccount{id: owner, mappings: map[types.JID]types.JID{phone: lid}}
	ledger := &fakeLedger{records: []protocolstore.PendingRecord{pendingRecord(t, owner)}}
	out, err := Resolve(t.Context(), ledger, account, device)
	if err != nil || out != (Outcome{Resolved: 1}) || len(account.publishes) != 1 {
		t.Fatalf("outcome %+v err %v", out, err)
	}
	update := account.publishes[0][0]
	if update.DeliveryID != deliveryID || update.IdentityState != "resolved" || len(update.Message) == 0 {
		t.Fatalf("update %+v", update)
	}
}

// UT-ID-07: the mappings of one account never complete the entries of another.
func TestUTID07OtherAccountEntryIsIgnored(t *testing.T) {
	account := &fakeAccount{id: owner, mappings: map[types.JID]types.JID{phone: lid}}
	ledger := &fakeLedger{records: []protocolstore.PendingRecord{pendingRecord(t, "999@lid")}}
	out, err := Resolve(t.Context(), ledger, account, device)
	if err != nil || out != (Outcome{}) || len(account.publishes) != 0 {
		t.Fatalf("outcome %+v err %v", out, err)
	}
}

// UT-ID-07: IDENTITY_UNAVAILABLE is raised once on entering the condition and again only after leaving it.
func TestUTID07ServiceNotifiesOncePerEntry(t *testing.T) {
	account := &fakeAccount{id: owner}
	ledger := &fakeLedger{records: []protocolstore.PendingRecord{pendingRecord(t, owner)}}
	var unavailable, resolved atomic.Int32
	service := NewService(ledger, func() (Account, *store.Device) { return account, device }, Hooks{
		Unavailable: func() { unavailable.Add(1) },
		Resolved:    func() { resolved.Add(1) },
	})
	defer service.Close()
	for i := 0; i < 3; i++ {
		if _, err := service.Resolve(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	if unavailable.Load() != 1 {
		t.Fatalf("reported %d times", unavailable.Load())
	}
	account.mappings = map[types.JID]types.JID{phone: lid}
	if _, err := service.Resolve(t.Context()); err != nil || resolved.Load() != 1 {
		t.Fatalf("resolution %v resolved=%d", err, resolved.Load())
	}
	ledger.records = nil // the resolved entry was delivered and retired
	if _, err := service.Resolve(t.Context()); err != nil || unavailable.Load() != 1 {
		t.Fatalf("no unresolved entry may be reported: %v %d", err, unavailable.Load())
	}
	service.Rearm()
	account.mappings = nil
	ledger.records = []protocolstore.PendingRecord{pendingRecord(t, owner)}
	if _, err := service.Resolve(t.Context()); err != nil || unavailable.Load() != 2 {
		t.Fatalf("re-entry not reported: %v %d", err, unavailable.Load())
	}
}

// UT-ID-07: with no account store yet, nothing is read, resolved or reported.
func TestUTID07ServiceWithoutAccountDoesNothing(t *testing.T) {
	ledger := &fakeLedger{err: errLedger}
	service := NewService(ledger, func() (Account, *store.Device) { return nil, nil }, Hooks{})
	defer service.Close()
	if out, err := service.Resolve(t.Context()); err != nil || out != (Outcome{}) {
		t.Fatalf("%+v %v", out, err)
	}
}

// IT-ID-08 (M2): the reserve of a pendingLid entry bounds its resolved size even when JSON escaping multiplies the text.
func TestITID08ReserveBoundsEscapedResolvedSize(t *testing.T) {
	for _, char := range []string{"<", "\x01", "&", " "} {
		text := strings.Repeat(char, 60000)
		plaintext, err := proto.Marshal(&waE2E.Message{Conversation: proto.String(text)})
		if err != nil {
			t.Fatal(err)
		}
		record := pendingRecord(t, owner)
		record.Recovery.Items[0].PlaintextBase64 = base64.StdEncoding.EncodeToString(plaintext)
		reserved, err := protocolstore.EntrySize(record.PendingInsert)
		if err != nil {
			t.Fatal(err)
		}
		account := &fakeAccount{id: owner, mappings: map[types.JID]types.JID{phone: lid}}
		if _, err := Resolve(t.Context(), &fakeLedger{records: []protocolstore.PendingRecord{record}}, account, device); err != nil {
			t.Fatal(err)
		}
		if len(account.publishes) != 1 {
			t.Fatalf("%q: not resolved", char)
		}
		resolved := record.PendingInsert
		resolved.IdentityState, resolved.Message = "resolved", account.publishes[0][0].Message
		actual, _ := protocolstore.EntrySize(resolved)
		if actual > reserved {
			t.Fatalf("%q: resolved entry takes %d bytes, reserve covered %d", char, actual, reserved)
		}
	}
}

// m1: a poisoned entry is isolated; the other entries of the pass still resolve.
func TestPoisonedEntryDoesNotBlockOthers(t *testing.T) {
	poisonedItems := pendingRecord(t, owner)
	poisonedItems.DeliveryID = "wa-delivery:v1:00000000000000000000000000000002"
	poisonedItems.Recovery.Items = nil
	poisonedInfo := pendingRecord(t, owner)
	poisonedInfo.DeliveryID = "wa-delivery:v1:00000000000000000000000000000003"
	poisonedInfo.Recovery.MessageInfoJSON = `{"version":1}`
	healthy := pendingRecord(t, owner)
	account := &fakeAccount{id: owner, mappings: map[types.JID]types.JID{phone: lid}}
	ledger := &fakeLedger{records: []protocolstore.PendingRecord{poisonedItems, poisonedInfo, healthy}}
	out, err := Resolve(t.Context(), ledger, account, device)
	if err != nil || out != (Outcome{Resolved: 1, Unresolved: 2, Invalid: 2}) {
		t.Fatalf("outcome %+v err %v", out, err)
	}
	if len(account.publishes) != 1 || account.publishes[0][0].DeliveryID != deliveryID {
		t.Fatal("healthy entry not published alone")
	}
}

// M2: an entry whose resolved form would outgrow its reserve is never sent to native, so it cannot make the batch fail.
func TestFitsReserveRejectsOutgrownEntry(t *testing.T) {
	record := pendingRecord(t, owner)
	if !fitsReserve(&record, []byte(`{"id":"small"}`)) {
		t.Fatal("small message rejected")
	}
	huge := []byte(`{"text":"` + strings.Repeat("x", int(protocolstore.IdentityReserveBytes)+1024) + `"}`)
	if fitsReserve(&record, huge) {
		t.Fatal("oversized message accepted")
	}
}
