package protocolstore

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/protocolstate"
)

func historyInsert(n int, body string) PendingInsert {
	return PendingInsert{
		DeliveryID: fmt.Sprintf("wa-delivery:v1:%032x", n), AccountID: "123@lid", Source: "history", IdentityState: "resolved",
		Message:  json.RawMessage(`{"id":"` + body + `","accountId":"123@lid"}`),
		Recovery: Recovery{MessageInfoJSON: `{"version":1}`, Items: []RecoveryItem{{Format: "history", PlaintextBase64: "AA=="}}},
	}
}

func captureInsert(n int) PendingInsert {
	return PendingInsert{
		DeliveryID: fmt.Sprintf("wa-delivery:v1:%032x", n), AccountID: "123@lid", Source: "history", IdentityState: "pendingLid",
		Recovery: Recovery{MessageInfoJSON: `{"version":1,"messageType":"history-notification"}`, Items: []RecoveryItem{{Format: "history", PlaintextBase64: "AA=="}}},
	}
}

func openLimited(t *testing.T, n *controlledStorage, limit int64) *Store {
	t.Helper()
	s, err := Open(n, "gen", "123@lid", limit, limit)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// IT-HIS-01: protocol changes, every insert and the batch marker are one publication.
func TestAdmitHistoryBatchPublishesChangesInsertsAndMarkerTogether(t *testing.T) {
	native := &controlledStorage{}
	s := openTest(t, native)
	marker := [32]byte{7}
	batch := HistoryBatch{Marker: marker, Inserts: []PendingInsert{historyInsert(1, "a"), historyInsert(2, "b")},
		Stage: func(ctx context.Context) error { return s.PutNCTSalt(ctx, []byte("salt")) }}
	if err := s.AdmitHistoryBatch(context.Background(), batch); err != nil {
		t.Fatal(err)
	}
	if len(native.calls) != 1 || len(native.calls[0].PendingInserts) != 2 || len(native.calls[0].ProtocolChanges) != 2 {
		t.Fatalf("one publication carries the salt, the marker and both inserts: %+v", native.calls)
	}
	kinds := map[string]bool{}
	for _, change := range native.calls[0].ProtocolChanges {
		kinds[change.RecordType] = true
	}
	if !kinds["nct-salt"] || !kinds["retry-hash"] {
		t.Fatalf("changes %v", kinds)
	}
	if done, err := s.HistoryAdmitted(marker); err != nil || !done {
		t.Fatalf("the marker is durable: %v %v", done, err)
	}
	reopened := openTest(t, native)
	if done, _ := reopened.HistoryAdmitted(marker); !done {
		t.Fatal("the marker survives a restart")
	}
	if err := reopened.AdmitHistoryBatch(context.Background(), batch); !errors.Is(err, ErrHistoryAdmitted) {
		t.Fatalf("a repeated admission is recognized: %v", err)
	}
	if len(native.calls) != 1 {
		t.Fatal("and writes nothing")
	}
}

// IT-HIS-02: a failing stage publishes nothing, not even the inserts that were valid.
func TestAdmitHistoryBatchStageFailureIsAllOrNothing(t *testing.T) {
	native := &controlledStorage{}
	s := openTest(t, native)
	boom := errors.New("staging failed")
	err := s.AdmitHistoryBatch(context.Background(), HistoryBatch{Marker: [32]byte{1}, Inserts: []PendingInsert{historyInsert(1, "a")},
		Stage: func(ctx context.Context) error {
			if e := s.PutNCTSalt(ctx, []byte("salt")); e != nil {
				return e
			}
			return boom
		}})
	if err == nil || len(native.calls) != 0 || len(native.pending) != 0 {
		t.Fatalf("nothing is published after a failed stage: %v %d %d", err, len(native.calls), len(native.pending))
	}
	if done, _ := s.HistoryAdmitted([32]byte{1}); done {
		t.Fatal("no marker without a publication")
	}
}

func TestAdmitHistoryBatchRefusesWhatIsNotAHistoricalMessage(t *testing.T) {
	native := &controlledStorage{}
	s := openTest(t, native)
	live := historyInsert(1, "a")
	live.Source = "live"
	live.Recovery.Items[0].Format = "v2"
	wrongAccount := historyInsert(2, "b")
	wrongAccount.AccountID = "999@lid"
	for name, inserts := range map[string][]PendingInsert{
		"live source":     {live},
		"another account": {wrongAccount},
		"a capture":       {captureInsert(3)},
		"duplicate IDs":   {historyInsert(4, "a"), historyInsert(4, "b")},
		"provisional text": {func() PendingInsert {
			p := captureInsert(5)
			p.Message = json.RawMessage(`{}`)
			p.Recovery.MessageInfoJSON = `{"version":1}`
			return p
		}()},
	} {
		t.Run(name, func(t *testing.T) {
			err := s.AdmitHistoryBatch(context.Background(), HistoryBatch{Marker: [32]byte{9}, Inserts: inserts})
			codeIs(t, err, InvalidRequest)
			if len(native.calls) != 0 {
				t.Fatal("rejected before any publication")
			}
		})
	}
}

// IT-HIS-03 / IT-HIS-06: the whole batch is decided together beside its own capture entry.
func TestAdmitHistoryBatchCapacityRules(t *testing.T) {
	capture, live := captureInsert(1), historyInsert(2, strings.Repeat("l", 500))
	batch := []PendingInsert{historyInsert(10, "a"), historyInsert(11, "b"), historyInsert(12, "c")}
	size := func(p PendingInsert) int64 { v, _ := EntrySize(p); return v }
	var total int64
	for _, p := range batch {
		total += size(p)
	}
	seed := func(native *controlledStorage, entries ...PendingInsert) {
		for i, p := range entries {
			ordinal := uint32(i)
			native.pending = append(native.pending, PendingRecord{PendingInsert: p, CreatedRevision: "1", CreatedOrdinal: &ordinal})
		}
		native.revision = 1
	}
	admit := func(s *Store) error {
		return s.AdmitHistoryBatch(context.Background(), HistoryBatch{Marker: [32]byte{3}, Capture: capture.DeliveryID, Inserts: batch})
	}
	t.Run("exactly the limit beside the capture is admitted", func(t *testing.T) {
		native := &controlledStorage{}
		seed(native, capture)
		if err := admit(openLimited(t, native, size(capture)+total)); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("one byte more can never fit beside its capture", func(t *testing.T) {
		native := &controlledStorage{}
		seed(native, capture)
		err := admit(openLimited(t, native, size(capture)+total-1))
		var typed *Error
		if !errors.As(err, &typed) || typed.Code != BufferFull || !typed.Oversize || typed.Needed != total {
			t.Fatalf("want an oversize refusal, got %v", err)
		}
		if len(native.calls) != 0 {
			t.Fatal("no partial admission")
		}
	})
	t.Run("other pending entries make it wait, and confirmations free it without a latched store", func(t *testing.T) {
		native := &controlledStorage{}
		seed(native, capture, live)
		s := openLimited(t, native, size(capture)+total+size(live)/2)
		err := admit(s)
		var typed *Error
		if !errors.As(err, &typed) || typed.Code != BufferFull || typed.Oversize || typed.Needed != total {
			t.Fatalf("want a waiting refusal, got %v", err)
		}
		if s.StopReason() != nil {
			t.Fatal("waiting must not stop the store")
		}
		// the ledger retires the live entry behind the store's back; the next attempt sees it
		native.mu.Lock()
		native.pending = native.pending[:1]
		native.revision++
		native.mu.Unlock()
		if err := admit(s); err != nil {
			t.Fatalf("the freed space admits the batch: %v", err)
		}
		if len(native.calls) != 1 || len(native.calls[0].PendingInserts) != 3 {
			t.Fatal("admitted whole")
		}
	})
}

func captureThrough(t *testing.T, s *Store, builder ReceiveBuilder) {
	t.Helper()
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: types.NewJID("123", types.HiddenUserServer), Sender: types.NewJID("123", types.HiddenUserServer), IsFromMe: true}, ID: "message", Timestamp: time.Unix(123, 0)}
	node := &waBinary.Node{Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"v": "2", "type": "msg"}, Content: []byte{1, 2, 3}}}}
	ctx, err := CaptureReceive(context.Background(), "123@lid", info, node, builder, stagingProcessor{store: s})
	if err != nil {
		t.Fatal(err)
	}
	err = s.DoDecryptionTxn(store.WithBufferedEventChild(ctx, 0), func(tx context.Context) error {
		return s.PutBufferedEvent(tx, [32]byte{5}, []byte("plain"), time.Unix(124, 0))
	})
	if err != nil {
		t.Fatal(err)
	}
}

// A history notification is captured with the Signal state that consumed it, as an entry nobody delivers.
func TestHistoryNotificationIsCapturedAsAnUndeliverableEntry(t *testing.T) {
	native := &controlledStorage{}
	s := openTest(t, native)
	captureThrough(t, s, func(CapturedReceive, CapturedChild, []byte) (string, json.RawMessage, error) {
		return HistoryNotificationState, nil, nil
	})
	if len(native.calls) != 1 || len(native.pending) != 1 {
		t.Fatalf("captured in the decryption transaction: %d calls, %d entries", len(native.calls), len(native.pending))
	}
	entry := native.pending[0]
	if !IsHistoryNotification(entry.PendingInsert) || entry.Source != "history" || entry.IdentityState != "pendingLid" || len(entry.Message) != 0 {
		t.Fatalf("not an undeliverable capture: %+v", entry)
	}
	info, err := ParseReceiveInfo(CapturedReceive{AccountID: "123@lid", MessageInfoJSON: entry.Recovery.MessageInfoJSON})
	if err != nil || info.ID != "message" || !info.IsFromMe {
		t.Fatalf("the capture keeps the replay metadata: %v %+v", err, info)
	}
	if entry.Recovery.Items[0].Format != "history" || entry.Recovery.Items[0].CiphertextHashBase64 != "" {
		t.Fatalf("history recovery format: %+v", entry.Recovery.Items[0])
	}
	// a redelivery of the same ciphertext is recognized: the capture is the recoverable source
	if buffered, err := s.GetBufferedEvent(context.Background(), [32]byte{5}); err != nil || buffered == nil {
		t.Fatalf("retry marker %v %v", buffered, err)
	}
	// and it costs no identity reserve: it will never become a message
	plain := entry.PendingInsert
	plain.Recovery.MessageInfoJSON = `{"version":1}`
	withReserve, _ := EntrySize(plain)
	without, _ := EntrySize(entry.PendingInsert)
	if withReserve-without < IdentityReserveBytes/2 {
		t.Fatalf("the capture must not reserve identity budget: %d vs %d", withReserve, without)
	}
}

func TestCheckLIDMappingsRefusesWhatPutWouldRefuse(t *testing.T) {
	native := &controlledStorage{}
	s := openTest(t, native)
	pn := func(n string) types.JID { return types.NewJID(n, types.DefaultUserServer) }
	lid := func(n string) types.JID { return types.NewJID(n, types.HiddenUserServer) }
	if err := s.PutManyLIDMappings(context.Background(), []store.LIDMapping{{LID: lid("1"), PN: pn("10")}}); err != nil {
		t.Fatal(err)
	}
	if err := s.CheckLIDMappings(context.Background(), []store.LIDMapping{{LID: lid("2"), PN: pn("20")}, {LID: lid("3"), PN: pn("10")}}); err != nil {
		t.Fatalf("a new LID and a remapped PN are valid: %v", err)
	}
	conflict := []store.LIDMapping{{LID: lid("1"), PN: pn("11")}}
	err := s.CheckLIDMappings(context.Background(), conflict)
	codeIs(t, err, InvalidRequest)
	if s.StopReason() != nil {
		t.Fatal("checking never latches the store")
	}
	inBatch := []store.LIDMapping{{LID: lid("5"), PN: pn("50")}, {LID: lid("5"), PN: pn("51")}}
	codeIs(t, s.CheckLIDMappings(context.Background(), inBatch), InvalidRequest)
	codeIs(t, s.PutManyLIDMappings(context.Background(), conflict), InvalidRequest)
}

func notificationFor(path string) []byte {
	raw, _ := proto.Marshal(&waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type:                    waE2E.ProtocolMessage_HISTORY_SYNC_NOTIFICATION.Enum(),
		HistorySyncNotification: &waE2E.HistorySyncNotification{DirectPath: proto.String(path)},
	}})
	return raw
}

func captureWith(n int, account, path string) PendingInsert {
	p := captureInsert(n)
	p.AccountID = account
	p.Recovery.Items[0].PlaintextBase64 = base64.StdEncoding.EncodeToString(notificationFor(path))
	return p
}

func markerKey(account, path string) string {
	m := HistoryMarker(account, &waE2E.HistorySyncNotification{DirectPath: proto.String(path)})
	return base64.StdEncoding.EncodeToString(m[:])
}

// The purge is scoped by capture and account: only the markers that live captures of the current
// account reference are kept past the retention, so session growth stays bounded however many captures
// of other accounts, or stuck ones, exist.
func TestPurgeKeepsOnlyTheMarkersOfLiveCapturesOfTheCurrentAccount(t *testing.T) {
	native := &controlledStorage{}
	s := openTest(t, native)
	old := time.Now().Add(-30 * 24 * time.Hour).UnixMilli()
	put := func(key string) {
		if err := s.put(context.Background(), "retry-hash", protocolstate.RetryHash{Version: 1, InsertTimeMS: old, ServerTimeSeconds: 1}, key); err != nil {
			t.Fatal(err)
		}
	}
	// a long-lived session accumulates one retry hash per decrypted message
	for i := 0; i < 200; i++ {
		put(base64.StdEncoding.EncodeToString(append([]byte{byte(i), byte(i >> 8)}, make([]byte, 30)...)))
	}
	put(markerKey("123@lid", "/v/live"))
	put(markerKey("123@lid", "/v/other-batch"))
	put(markerKey("999@lid", "/v/live")) // the marker an unreleased capture of another account would have had
	ordinal := uint32(0)
	other := captureWith(2, "999@lid", "/v/live")
	native.mu.Lock()
	native.pending = []PendingRecord{
		{PendingInsert: captureWith(1, "123@lid", "/v/live"), CreatedRevision: "1", CreatedOrdinal: &ordinal},
		{PendingInsert: other, CreatedRevision: "1", CreatedOrdinal: func() *uint32 { o := uint32(1); return &o }()},
	}
	native.mu.Unlock()
	reopened := openTest(t, native)
	if err := reopened.DeleteOldBufferedHashes(context.Background()); err != nil {
		t.Fatal(err)
	}
	kept := scanMap(reopened.records, "retry-hash")
	if len(kept) != 1 {
		t.Fatalf("only the live capture's marker survives, %d records remain", len(kept))
	}
	want, _ := protocolstate.EncodeKey("retry-hash", markerKey("123@lid", "/v/live"))
	if kept[0].RecordKey != want {
		t.Fatal("the surviving record is not the marker of the live capture")
	}
}

// Rollback runs when a batch whose Stage ran does not publish, whatever the reason, and never otherwise.
func TestRollbackRunsWheneverAStagedBatchIsNotPublished(t *testing.T) {
	native := &controlledStorage{}
	s := openTest(t, native)
	rolled := 0
	batch := func(stage func(context.Context) error) HistoryBatch {
		return HistoryBatch{Marker: [32]byte{byte(rolled + 1)}, Inserts: []PendingInsert{historyInsert(1, "a")}, Stage: stage, Rollback: func() { rolled++ }}
	}
	if err := s.AdmitHistoryBatch(context.Background(), batch(func(context.Context) error { return errors.New("refused") })); !errors.Is(err, ErrHistoryContent) || rolled != 1 {
		t.Fatalf("a refused stage rolls back: %v %d", err, rolled)
	}
	oversize := func(ctx context.Context) error { return s.PutNCTSalt(ctx, make([]byte, 1)) }
	large := batch(oversize)
	large.Inserts[0].Message = json.RawMessage(`{"id":"` + strings.Repeat("x", 11<<20) + `","accountId":"123@lid"}`)
	large.Inserts[0].Recovery.Items[0].PlaintextBase64 = "AA=="
	if err := s.AdmitHistoryBatch(context.Background(), large); err == nil || rolled != 1 {
		t.Fatalf("a batch refused before Stage never ran it, so nothing to roll back: %v %d", err, rolled)
	}
	ok := batch(oversize)
	ok.Marker = [32]byte{42}
	if err := s.AdmitHistoryBatch(context.Background(), ok); err != nil || rolled != 1 {
		t.Fatalf("a published batch is not rolled back: %v %d", err, rolled)
	}
}
