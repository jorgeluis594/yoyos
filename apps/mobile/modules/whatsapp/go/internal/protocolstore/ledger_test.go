package protocolstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

type fakeDelivery struct {
	read, retire string
	readErr      error
	retireErr    error
	lastRetire   string
}

func (f *fakeDelivery) ReadPending(string) (string, error) { return f.read, f.readErr }
func (f *fakeDelivery) RetirePending(request string) (string, error) {
	f.lastRetire = request
	return f.retire, f.retireErr
}

func pendingJSON(t *testing.T, revision string, records ...PendingRecord) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"contractVersion": 1, "success": true, "data": map[string]any{"revision": revision, "pending": records}})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func ledgerRecord(n int, revision string, ordinal uint32) PendingRecord {
	r := PendingRecord{CreatedRevision: revision, CreatedOrdinal: &ordinal}
	r.DeliveryID, r.AccountID, r.Source, r.IdentityState = fmt.Sprintf("wa-delivery:v1:%032x", n), "123@lid", "live", "resolved"
	r.Message = json.RawMessage(`{"id":"m"}`)
	r.Recovery = Recovery{MessageInfoJSON: `{}`, Items: []RecoveryItem{{Format: "history", PlaintextBase64: "AA=="}}}
	r.Source = "history"
	return r
}

// UT-DEL-06 / IT-DEL-06: order is numeric by revision then ordinal ("10" follows "9", not "1").
func TestLedgerOrdersByNumericRevisionThenOrdinal(t *testing.T) {
	fake := &fakeDelivery{read: pendingJSON(t, "12", ledgerRecord(1, "10", 0), ledgerRecord(2, "9", 1), ledgerRecord(3, "9", 0), ledgerRecord(4, "2", 5))}
	ledger, err := NewLedger(fake, 1<<20, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ledger.Pending()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"4", "3", "2", "1"}
	for i, record := range got {
		if fmt.Sprint(record.DeliveryID[len(record.DeliveryID)-1:]) != want[i] {
			t.Fatalf("position %d is %s", i, record.DeliveryID)
		}
	}
}

// UT-DEL-08 / IT-DEL-08: an unreadable or malformed container is an error, never an empty list.
func TestLedgerReadFailureIsNeverAnEmptyList(t *testing.T) {
	for name, fake := range map[string]*fakeDelivery{
		"callback error": {readErr: errors.New("io")},
		"native error":   {read: `{"contractVersion":1,"success":false,"error":{"code":"STORAGE_FAILED","message":"x"}}`},
		"not json":       {read: `nope`},
		"missing list":   {read: `{"contractVersion":1,"success":true,"data":{"revision":"1","pending":null}}`},
		"extra member":   {read: `{"contractVersion":1,"success":true,"data":{"revision":"1","pending":[],"x":1}}`},
	} {
		ledger, _ := NewLedger(fake, 1<<20, 1<<20)
		if got, err := ledger.Pending(); err == nil || got != nil {
			t.Errorf("%s: %v %v", name, got, err)
		}
	}
}

// UT-DEL-07 / UT-DEL-08: retirement sends a validated ID, treats removed=false as success, and surfaces failures.
func TestLedgerRetireContract(t *testing.T) {
	id := "wa-delivery:v1:" + "00000000000000000000000000000001"
	fake := &fakeDelivery{retire: `{"contractVersion":1,"success":true,"data":{"revision":"7","removed":true}}`}
	ledger, _ := NewLedger(fake, 1<<20, 1<<20)
	removed, err := ledger.Retire(id)
	if err != nil || !removed || fake.lastRetire != `{"contractVersion":1,"deliveryId":"`+id+`"}` {
		t.Fatalf("%v %v %q", removed, err, fake.lastRetire)
	}
	fake.retire = `{"contractVersion":1,"success":true,"data":{"revision":"8","removed":false}}`
	if removed, err := ledger.Retire(id); err != nil || removed {
		t.Fatalf("absent ID must succeed without removal: %v %v", removed, err)
	}
	fake.lastRetire = ""
	if _, err := ledger.Retire("wa-delivery:v1:XYZ"); err == nil || fake.lastRetire != "" {
		t.Fatal("malformed ID reached native")
	}
	fake.retireErr = errors.New("lost")
	if _, err := ledger.Retire(id); err == nil {
		t.Fatal("failed retirement reported as success")
	}
	fake.retireErr, fake.retire = nil, `{"contractVersion":1,"success":false,"error":{"code":"STORAGE_FAILED","message":"disk"}}`
	var typed *Error
	if _, err := ledger.Retire(id); !errors.As(err, &typed) || typed.Code != StorageFailed {
		t.Fatalf("native failure lost: %v", err)
	}
}

// IT-BUF-02: a rejected admission keeps its capacity code and publishes nothing, even with staged Signal changes.
func TestCapacityRejectionKeepsCodeAndDoesNotCommit(t *testing.T) {
	n := &controlledStorage{}
	s, err := Open(n, "gen", "123@lid", 10<<20, 200)
	if err != nil {
		t.Fatal(err)
	}
	insert := PendingInsert{DeliveryID: "wa-delivery:v1:00000000000000000000000000000001", AccountID: "123@lid", Source: "history", IdentityState: "resolved",
		Message: json.RawMessage(`{"id":"m"}`), Recovery: Recovery{MessageInfoJSON: `{}`, Items: []RecoveryItem{{Format: "history", PlaintextBase64: "AA=="}}}}
	err = s.DoDecryptionTxn(t.Context(), func(ctx context.Context) error {
		if e := s.PutLIDMapping(ctx, types.NewJID("1", types.HiddenUserServer), types.NewJID("2", types.DefaultUserServer)); e != nil { // a Signal-side change staged before the entry
			return e
		}
		return s.PreparePendingInsert(ctx, insert)
	})
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != BufferFull || !typed.Oversize || typed.Needed <= 200 {
		t.Fatalf("capacity code lost: %v", err)
	}
	if len(n.calls) != 0 || len(n.pending) != 0 {
		t.Fatal("a rejected admission was partially committed")
	}
}

// Excluded content leaves only the metadata-only retry marker: no pending entry and no body.
func TestExcludedContentStagesOnlyRetryMarker(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: types.NewJID("555", types.HiddenUserServer), Sender: types.NewJID("555", types.HiddenUserServer)}, ID: "x", Timestamp: time.Unix(5, 0)}
	node := &waBinary.Node{Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"v": "2", "type": "msg"}, Content: []byte{1}}}}
	ctx, err := CaptureReceive(context.Background(), "123@lid", info, node,
		func(CapturedReceive, CapturedChild, []byte) (string, json.RawMessage, error) {
			return "excluded", nil, nil
		},
		stagingProcessorNoop{})
	if err != nil {
		t.Fatal(err)
	}
	hash := [32]byte{9}
	if err := s.DoDecryptionTxn(store.WithBufferedEventChild(ctx, 0), func(tx context.Context) error {
		return s.PutBufferedEvent(tx, hash, []byte("body"), time.Unix(6, 0))
	}); err != nil {
		t.Fatal(err)
	}
	buffered, err := s.GetBufferedEvent(ctx, hash)
	if err != nil || buffered == nil || buffered.Pending || len(n.pending) != 0 {
		t.Fatalf("expected a completed marker only: %+v %v", buffered, err)
	}
	if err := s.ClearBufferedEventPlaintext(ctx, hash); err != nil {
		t.Fatal(err)
	}
}

type stagingProcessorNoop struct{}

func (stagingProcessorNoop) ReplayRecoveredProtocol(context.Context, *types.MessageInfo, string, []byte) error {
	return nil
}

// IT-CFG-07: reducing the budget below what is stored keeps the read bound of the earlier budget,
// so the snapshot holding the excess still decodes (and can be drained); the bound is finite, so a
// response of arbitrary length is still refused.
func TestITCFG07ReducedBudgetKeepsTheReadBoundOfTheSnapshot(t *testing.T) {
	const oldBudget, reduced = int64(32 << 20), int64(1 << 20)
	var records []PendingRecord
	for i := 0; i < 20; i++ { // ~20 MiB: over the reduced budget and over what the reduced bound alone admits
		record := ledgerRecord(i+1, "1", uint32(i))
		record.Message = json.RawMessage(`{"id":"m","padding":"` + strings.Repeat("A", 1<<20) + `"}`)
		records = append(records, record)
	}
	fake := &fakeDelivery{read: pendingJSON(t, "1", records...)}

	if int64(len(fake.read)) <= int64(payloadLimit(reduced)) {
		t.Fatalf("fixture must exceed the bound derived from the reduced budget: %d", len(fake.read))
	}
	control, _ := NewLedger(fake, reduced, reduced)
	if _, err := control.Pending(); err == nil {
		t.Fatal("control: a read bound equal to the reduced budget cannot decode the older snapshot")
	}
	ledger, err := NewLedger(fake, oldBudget, reduced)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ledger.Pending()
	if err != nil || len(got) != 20 {
		t.Fatalf("the older snapshot stays readable: %d %v", len(got), err)
	}
	// Arbitrary lengths are still refused: the bound is the earlier budget, not unlimited.
	huge := &fakeDelivery{read: strings.Repeat(" ", int(payloadLimit(oldBudget))+1)}
	bounded, _ := NewLedger(huge, oldBudget, reduced)
	if _, err := bounded.Pending(); err == nil {
		t.Fatal("a response beyond the read bound is refused")
	}
	if _, err := NewLedger(fake, reduced-1, reduced); err == nil {
		t.Fatal("a read bound below the budget is invalid")
	}
}
