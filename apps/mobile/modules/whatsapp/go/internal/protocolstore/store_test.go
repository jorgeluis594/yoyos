package protocolstore

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/protocolstate"
)

type controlledStorage struct {
	mu                        sync.Mutex
	revision, sessionRevision uint64
	records                   []protocolstate.Record
	pending                   []PendingRecord
	calls                     []ApplyRequest
	errCode                   Code
	loseReply                 bool
	malformedReply            bool
	onApply                   func()
}

func (n *controlledStorage) ReadState(request string) (string, error) {
	if request != `{"contractVersion":1}` {
		return "", errors.New("wrong read request")
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	var sess *session
	if n.sessionRevision != 0 {
		sess = &session{AccountID: "123@lid", ProtocolSchemaVersion: 1, Records: append([]protocolstate.Record{}, n.records...)}
	}
	pending := append([]PendingRecord{}, n.pending...)
	b, _ := json.Marshal(response[readData]{ContractVersion: 1, Success: true, Data: &readData{Revision: fmt.Sprint(n.revision), SessionRevision: fmt.Sprint(n.sessionRevision), Session: sess, Pending: pending}})
	return string(b), nil
}
func (n *controlledStorage) ApplyChanges(request string) (string, error) {
	var a ApplyRequest
	if err := json.Unmarshal([]byte(request), &a); err != nil {
		return "", err
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	n.calls = append(n.calls, a)
	if n.onApply != nil {
		n.onApply()
	}
	if n.errCode != "" {
		b, _ := json.Marshal(response[applied]{ContractVersion: 1, Error: &struct {
			Code    Code   `json:"code"`
			Message string `json:"message"`
		}{n.errCode, "rejected"}})
		return string(b), nil
	}
	if a.GenerationID != "gen" {
		return "", errors.New("wrong generation")
	}
	if a.AccountID != "123@lid" {
		return "", errors.New("wrong account")
	}
	if a.ExpectedSessionRevision != fmt.Sprint(n.sessionRevision) {
		return "", errors.New("wrong expected revision")
	}
	current := map[string]protocolstate.Record{}
	for _, r := range n.records {
		current[recordID(r.RecordType, r.RecordKey)] = r
	}
	for _, c := range a.ProtocolChanges {
		key := recordID(c.RecordType, c.RecordKey)
		switch c.Operation {
		case "put":
			current[key] = protocolstate.Record{RecordType: c.RecordType, RecordKey: c.RecordKey, ValueBase64: c.ValueBase64}
		case "delete":
			delete(current, key)
		default:
			return "", errors.New("unknown operation")
		}
	}
	next := make([]protocolstate.Record, 0, len(current))
	for _, r := range current {
		next = append(next, r)
	}
	if _, err := protocolstate.Encode(next); err != nil {
		return "", err
	}
	n.records = next
	n.revision++
	if len(a.ProtocolChanges) > 0 {
		n.sessionRevision++
	}
	for i, p := range a.PendingInserts {
		n.pending = append(n.pending, PendingRecord{PendingInsert: p, CreatedRevision: fmt.Sprint(n.revision), CreatedOrdinal: uint32(i)})
	}
	for _, update := range a.PendingIdentityUpdates {
		found := false
		for i := range n.pending {
			if n.pending[i].DeliveryID == update.DeliveryID && n.pending[i].IdentityState == "pendingLid" {
				n.pending[i].IdentityState = update.IdentityState
				n.pending[i].Message = update.Message
				found = true
				break
			}
		}
		if !found {
			return "", errors.New("identity update targets missing pending")
		}
	}
	if n.loseReply {
		return "", errors.New("reply lost after commit")
	}
	if n.malformedReply {
		return `{"contractVersion":1,"success":true,"data":{}`, nil
	}
	b, _ := json.Marshal(response[applied]{ContractVersion: 1, Success: true, Data: &applied{fmt.Sprint(n.revision), fmt.Sprint(n.sessionRevision)}})
	return string(b), nil
}
func openTest(t *testing.T, n *controlledStorage) *Store {
	t.Helper()
	s, e := Open(n, "gen", "123@lid", 10<<20, 10<<20)
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func codeIs(t *testing.T, err error, code Code) {
	t.Helper()
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}
func TestEmptyReadAndReadFailure(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	if s.revision != 0 || s.sessionRevision != 0 || len(s.records) != 0 {
		t.Fatal("not empty")
	}
	if e := s.DeleteSession(context.Background(), "123:1"); e != nil || len(n.calls) != 0 {
		t.Fatal("absent delete published", e)
	}
	_, e := Open(readFailure{}, "gen", "123@lid", 1, 1)
	codeIs(t, e, StorageFailed)
	_, e = Open(&badRead{}, "gen", "123@lid", 1, 1)
	codeIs(t, e, StateInvalid)
}

type readFailure struct{}

func (readFailure) ReadState(string) (string, error)    { return "", errors.New("disk") }
func (readFailure) ApplyChanges(string) (string, error) { panic("unused") }

type badRead struct{}

func (*badRead) ReadState(string) (string, error) {
	return `{"contractVersion":1,"success":true,"data":{"revision":"0","sessionRevision":"0","session":null,"pending":null}}`, nil
}
func (*badRead) ApplyChanges(string) (string, error) { panic("unused") }
func TestTransactionStagesAndOrderedDelta(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	a := "alice.0:0"
	id := [32]byte{1}
	err := s.DoDecryptionTxn(ctx, func(tx context.Context) error {
		if err := s.PutIdentity(tx, a, id); err != nil {
			return err
		}
		ok, e := s.IsTrustedIdentity(tx, a, id)
		if e != nil || !ok {
			t.Fatalf("staged identity %v %v", ok, e)
		}
		if e := s.PutSession(tx, a, []byte("session")); e != nil {
			return e
		}
		got, e := s.GetSession(tx, a)
		if e != nil || string(got) != "session" {
			t.Fatalf("staged session %q %v", got, e)
		}
		if e := s.DeleteSession(tx, a); e != nil {
			return e
		}
		if got, e = s.GetSession(tx, a); e != nil || got != nil {
			t.Fatalf("staged delete %q %v", got, e)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(n.calls) != 1 || len(n.calls[0].ProtocolChanges) != 3 {
		t.Fatalf("delta: %+v", n.calls)
	}
	want := []string{"put", "put", "delete"}
	for i, c := range n.calls[0].ProtocolChanges {
		if c.Operation != want[i] {
			t.Fatal("wrong order")
		}
	}
	if n.calls[0].ExpectedSessionRevision != "0" || n.sessionRevision != 1 {
		t.Fatal("session revision")
	}
	if got, e := s.GetSession(ctx, a); e != nil || got != nil {
		t.Fatal("delete not durable")
	}
}
func TestRollbackAndStickyMutationError(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	e := s.DoDecryptionTxn(ctx, func(tx context.Context) error {
		_ = s.PutNCTSalt(tx, []byte("valid"))
		return errors.New("decrypt rejected")
	})
	if e == nil || len(n.calls) != 0 {
		t.Fatal("rollback failed")
	}
	codeIs(t, e, StorageFailed)
	n = &controlledStorage{}
	s = openTest(t, n)
	e = s.DoDecryptionTxn(ctx, func(tx context.Context) error {
		_ = s.PutNCTSalt(tx, []byte("valid"))
		_ = s.PutNCTSalt(tx, nil)
		return nil
	})
	if e == nil || len(n.calls) != 0 {
		t.Fatal("ignored mutation error committed")
	}
	n = &controlledStorage{}
	s = openTest(t, n)
	protocolErr := errors.New("bad ciphertext")
	if got := s.DoDecryptionTxn(ctx, func(context.Context) error { return protocolErr }); !errors.Is(got, protocolErr) || s.StopReason() != nil {
		t.Fatal("pure protocol error was reclassified", got)
	}
}
func TestDurableCallbackAndUncertainCommit(t *testing.T) {
	for _, mode := range []string{"lost", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			n := &controlledStorage{loseReply: mode == "lost", malformedReply: mode == "malformed"}
			s := openTest(t, n)
			e := s.PutNCTSalt(context.Background(), []byte("salt"))
			codeIs(t, e, UncertainCommit)
			if n.revision != 1 || s.revision != 1 {
				t.Fatal("readback did not observe published state")
			}
			e = s.PutNCTSalt(context.Background(), []byte("again"))
			codeIs(t, e, UncertainCommit)
			if len(n.calls) != 1 {
				t.Fatal("blind retry")
			}
		})
	}
	n := &controlledStorage{errCode: BufferFull}
	s := openTest(t, n)
	e := s.PutNCTSalt(context.Background(), []byte("salt"))
	codeIs(t, e, BufferFull)
	if n.revision != 0 || len(s.records) != 0 {
		t.Fatal("rejected commit mutated view")
	}
}
func TestExternalWriteWaitsAndConfirmDoesNotConflict(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	n := &controlledStorage{}
	n.onApply = func() { n.revision++; close(entered); <-release }
	s := openTest(t, n)
	done := make(chan error, 1)
	go func() { done <- s.PutNCTSalt(context.Background(), []byte("x")) }()
	<-entered
	select {
	case <-done:
		t.Fatal("returned before durable callback")
	default:
	}
	// A native confirmation may advance global revision while preserving session revision.
	close(release)
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	if s.revision != n.revision || s.sessionRevision != n.sessionRevision {
		t.Fatal("revision mismatch")
	}
}
func TestLIDMappingAccountScopeAndUnexpectedRecovery(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	pn, _ := types.ParseJID("123@s.whatsapp.net")
	lid, _ := types.ParseJID("456@lid")
	if e := s.PutLIDMapping(context.Background(), lid, pn); e != nil {
		t.Fatal(e)
	}
	got, e := s.GetLIDForPN(context.Background(), pn)
	if e != nil || got != lid {
		t.Fatal(got, e)
	}
	got, e = s.GetPNForLID(context.Background(), lid)
	if e != nil || got != pn {
		t.Fatal(got, e)
	}
	other, _ := types.ParseJID("789@s.whatsapp.net")
	e = s.PutLIDMapping(context.Background(), lid, other)
	codeIs(t, e, InvalidRequest)
	third, _ := types.ParseJID("999@lid")
	e = s.PutManyLIDMappings(context.Background(), []store.LIDMapping{{LID: third, PN: other}, {LID: lid, PN: other}})
	codeIs(t, e, InvalidRequest)
	if got, e = s.GetLIDForPN(context.Background(), other); e != nil || !got.IsEmpty() {
		t.Fatal("bulk mapping partly committed", got, e)
	}
	codeIs(t, s.PutBufferedEvent(context.Background(), [32]byte{}, []byte("body"), time.Now()), RecoveryContextMissing)
	_, e = s.GetBufferedEvent(context.Background(), [32]byte{})
	codeIs(t, e, RecoveryContextMissing)
	codeIs(t, s.ClearBufferedEventPlaintext(context.Background(), [32]byte{}), RecoveryContextMissing)
	codeIs(t, s.DeleteOldBufferedHashes(context.Background()), RecoveryContextMissing)
	_, _, e = s.GetOutgoingEvent(context.Background(), pn, lid, "id")
	codeIs(t, e, OutgoingUnsupported)
	codeIs(t, s.AddOutgoingEvent(context.Background(), pn, "id", "v2", []byte{1}), OutgoingUnsupported)
	codeIs(t, s.DeleteOldOutgoingEvents(context.Background()), OutgoingUnsupported)
	if len(n.records) != len(snapshotRecords(s)) {
		t.Fatal("local view differs from durable state")
	}
}
func snapshotRecords(s *Store) []protocolstate.Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]protocolstate.Record, 0, len(s.records))
	for _, r := range s.records {
		out = append(out, r)
	}
	return out
}
func TestPreparedPendingAtomicWithProtocolAndIdentityUpdate(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	recovery := Recovery{MessageInfoJSON: `{"id":"m"}`, Items: []RecoveryItem{{Format: "v2", PlaintextBase64: "AQ==", CiphertextHashBase64: base64.StdEncoding.EncodeToString(make([]byte, 32))}}}
	pending := PendingInsert{DeliveryID: "wa-delivery:v1:00112233445566778899aabbccddeeff", AccountID: "123@lid", Source: "live", IdentityState: "pendingLid", Recovery: recovery}
	e := s.DoDecryptionTxn(ctx, func(tx context.Context) error {
		if e := s.PutIdentity(tx, "123:1", [32]byte{1}); e != nil {
			return e
		}
		return s.PreparePendingInsert(tx, pending)
	})
	if e != nil {
		t.Fatal(e)
	}
	if len(n.calls) != 1 || len(n.calls[0].ProtocolChanges) != 1 || len(n.calls[0].PendingInserts) != 1 || n.pending[0].CreatedRevision != "1" {
		t.Fatal("protocol and recovery were not one native publication")
	}
	if _, e = Open(n, "gen", "123@lid", 10<<20, 10<<20); e != nil {
		t.Fatal("readback rejected pending", e)
	}
	update := PendingIdentityUpdate{DeliveryID: pending.DeliveryID, IdentityState: "resolved", Message: json.RawMessage(`{"id":"m"}`)}
	if e = s.PreparePendingIdentityUpdate(ctx, update); e != nil {
		t.Fatal(e)
	}
	if n.pending[0].IdentityState != "resolved" || n.pending[0].CreatedRevision != "1" {
		t.Fatal("identity update changed pending order")
	}
	n.onApply = func() { n.revision++; n.pending = nil }
	if e = s.PutNCTSalt(ctx, []byte{1}); e != nil {
		t.Fatal(e)
	}
	if len(n.pending) != 0 {
		t.Fatal("concurrent confirmation resurrected pending")
	}
	if _, e = Open(n, "gen", "123@lid", 10<<20, 10<<20); e != nil {
		t.Fatal(e)
	}
}
func TestPreparedPendingRejectsMalformedRecovery(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	p := PendingInsert{DeliveryID: "wa-delivery:v1:00112233445566778899aabbccddeeff", AccountID: "123@lid", Source: "live", IdentityState: "resolved", Message: json.RawMessage(`{}`), Recovery: Recovery{MessageInfoJSON: `{}`, Items: []RecoveryItem{{Format: "v2", PlaintextBase64: "AQ=="}}}}
	codeIs(t, s.PreparePendingInsert(context.Background(), p), InvalidRequest)
	if len(n.calls) != 0 {
		t.Fatal("malformed pending reached native callback")
	}
}
func TestTxnPanicStopsWithoutPublishing(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	e := s.DoDecryptionTxn(context.Background(), func(tx context.Context) error { _ = s.PutNCTSalt(tx, []byte{1}); panic("sensitive") })
	codeIs(t, e, StorageFailed)
	if len(n.calls) != 0 {
		t.Fatal("panic published staged writes")
	}
	codeIs(t, s.PutNCTSalt(context.Background(), []byte{2}), StorageFailed)
}
func TestGenerationRetiredWhileWaitingOnNative(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	n := &controlledStorage{}
	n.onApply = func() { close(entered); <-release; n.errCode = StaleGeneration }
	s := openTest(t, n)
	done := make(chan error, 1)
	go func() { done <- s.PutNCTSalt(context.Background(), []byte{1}) }()
	<-entered
	close(release)
	codeIs(t, <-done, StaleGeneration)
	if n.revision != 0 {
		t.Fatal("retired generation committed")
	}
	codeIs(t, s.PutNCTSalt(context.Background(), []byte{2}), StaleGeneration)
	if len(n.calls) != 1 {
		t.Fatal("late second write reached native")
	}
}
func TestNativeApplyPanicStopsAndReadsBack(t *testing.T) {
	n := &controlledStorage{}
	n.onApply = func() { panic("native panic") }
	s := openTest(t, n)
	codeIs(t, s.PutNCTSalt(context.Background(), []byte{1}), UncertainCommit)
	if s.ReadbackError() != nil || s.revision != 0 {
		t.Fatal("panic readback failed")
	}
	if len(n.calls) != 1 {
		t.Fatal("unexpected retry")
	}
}
