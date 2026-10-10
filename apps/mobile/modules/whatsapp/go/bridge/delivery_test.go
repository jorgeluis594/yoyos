package bridge

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"yoyos-whatsapp/internal/protocolstore"
)

func deliveryID(n int) string { return fmt.Sprintf("wa-delivery:v1:%032x", n) }

// pendingStorage is the native pending container, reachable without any session.
type pendingStorage struct {
	mu        sync.Mutex
	pending   []protocolstore.PendingRecord
	revision  uint64
	failRead  bool
	failWrite bool
}

func (s *pendingStorage) add(n int) {
	ordinal := uint32(n)
	info := fmt.Sprintf(`{"version":1,"accountId":"999@lid","id":"m%d","chat":"555@lid","sender":"555@lid","timestampSeconds":100}`, n)
	message := fmt.Sprintf(`{"id":"wa-message:v1:m%d","accountId":"999@lid","whatsappMessageId":"m%d","chatId":"555@lid","direction":"incoming","timestamp":1,"image":{"mimeType":"image/jpeg","size":3,"reference":{"messageId":"wa-message:v1:m%d","downloadReference":"wa-image:v1:AAAA"}}}`, n, n, n)
	record := protocolstore.PendingRecord{CreatedRevision: "5", CreatedOrdinal: &ordinal}
	record.DeliveryID, record.AccountID, record.Source, record.IdentityState = deliveryID(n), "999@lid", "live", "resolved"
	record.Message = json.RawMessage(message)
	record.Recovery = protocolstore.Recovery{MessageInfoJSON: info, Items: []protocolstore.RecoveryItem{{Format: "v2", PlaintextBase64: base64.StdEncoding.EncodeToString([]byte("p")), CiphertextHashBase64: base64.StdEncoding.EncodeToString(make([]byte, 32))}}}
	s.mu.Lock()
	s.pending = append(s.pending, record)
	s.revision = 5
	s.mu.Unlock()
}

func (s *pendingStorage) ReadPending(string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failRead {
		return "", errors.New("read failed")
	}
	raw, _ := json.Marshal(map[string]any{"contractVersion": 1, "success": true, "data": map[string]any{"revision": fmt.Sprint(s.revision), "pending": s.pending}})
	return string(raw), nil
}

func (s *pendingStorage) RetirePending(request string) (string, error) {
	var in struct {
		DeliveryID string `json:"deliveryId"`
	}
	_ = json.Unmarshal([]byte(request), &in)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failWrite {
		return "", errors.New("write failed")
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
	raw, _ := json.Marshal(map[string]any{"contractVersion": 1, "success": true, "data": map[string]any{"revision": fmt.Sprint(s.revision), "removed": removed}})
	return string(raw), nil
}

func (s *pendingStorage) count() int { s.mu.Lock(); defer s.mu.Unlock(); return len(s.pending) }

type deliverySink struct {
	mu     sync.Mutex
	events chan envelope
	fail   error
	panics bool
}
type envelope struct {
	ContractVersion int    `json:"contractVersion"`
	Event           string `json:"event"`
	Consumer        string `json:"consumer"`
	Payload         struct {
		DeliveryID string          `json:"deliveryId"`
		Message    json.RawMessage `json:"message"`
	} `json:"payload"`
}

func newDeliverySink() *deliverySink { return &deliverySink{events: make(chan envelope, 32)} }
func (d *deliverySink) OnDelivery(value string) error {
	d.mu.Lock()
	fail, panics := d.fail, d.panics
	d.mu.Unlock()
	if panics {
		panic("runtime destroyed")
	}
	if fail != nil {
		return fail
	}
	var e envelope
	if err := json.Unmarshal([]byte(value), &e); err != nil {
		return err
	}
	d.events <- e
	return nil
}
func (d *deliverySink) next(t *testing.T) envelope {
	t.Helper()
	select {
	case e := <-d.events:
		return e
	case <-time.After(2 * time.Second):
		t.Fatal("no delivery")
		return envelope{}
	}
}
func (d *deliverySink) quiet(t *testing.T) {
	t.Helper()
	select {
	case e := <-d.events:
		t.Fatalf("unexpected delivery %s", e.Payload.DeliveryID)
	case <-time.After(80 * time.Millisecond):
	}
}

func openDelivery(t *testing.T, storage *pendingStorage) (*DeliverySession, *deliverySink) {
	t.Helper()
	sink := newDeliverySink()
	result := OpenDelivery(storage, sink, 10<<20)
	if result.Code != "" || result.Session == nil {
		t.Fatalf("open failed: %+v", result)
	}
	t.Cleanup(result.Session.Close)
	return result.Session, sink
}

// IT-API-08: a versioned JSON envelope carries one normalized message at a time and no image bytes.
func TestITAPI08DeliveryEnvelopeIsVersionedMetadataOnlyAndOneAtATime(t *testing.T) {
	storage := &pendingStorage{}
	storage.add(1)
	storage.add(2)
	session, sink := openDelivery(t, storage)
	if code := session.SetConsumer("consumer-1"); code != "" {
		t.Fatal(code)
	}
	session.Start()
	first := sink.next(t)
	if first.ContractVersion != 1 || first.Event != "messageReceived" || first.Consumer != "consumer-1" || first.Payload.DeliveryID != deliveryID(1) {
		t.Fatalf("envelope %+v", first)
	}
	var message struct {
		Image struct {
			Reference struct {
				DownloadReference string `json:"downloadReference"`
			} `json:"reference"`
			Bytes  json.RawMessage `json:"bytes"`
			Base64 json.RawMessage `json:"base64"`
		} `json:"image"`
	}
	if err := json.Unmarshal(first.Payload.Message, &message); err != nil || message.Image.Reference.DownloadReference == "" || message.Image.Bytes != nil || message.Image.Base64 != nil {
		t.Fatalf("image bytes crossed the bridge: %s", first.Payload.Message)
	}
	sink.quiet(t)
	if code := session.Confirm(first.Payload.DeliveryID); code != "" {
		t.Fatal(code)
	}
	if second := sink.next(t); second.Payload.DeliveryID != deliveryID(2) {
		t.Fatalf("got %s", second.Payload.DeliveryID)
	}
}

// IT-INI-05: with an invalid session and a valid buffer, pending entries are emitted and confirmed, never NOT_INITIALIZED.
func TestITINI05RecoversAndConfirmsWithInvalidSession(t *testing.T) {
	if got := OpenConnection(connectionStorage{}, connectionSink{}, "g", "123@lid", 1, 1).Code; got != "SESSION_STATE_INVALID" {
		t.Fatalf("session should be invalid: %s", got)
	}
	storage := &pendingStorage{}
	storage.add(1)
	session, sink := openDelivery(t, storage)
	session.SetConsumer("a")
	session.Start()
	d := sink.next(t)
	if code := session.Confirm(d.Payload.DeliveryID); code != "" {
		t.Fatalf("confirm returned %q", code)
	}
	if storage.count() != 0 {
		t.Fatal("not retired")
	}
}

// IT-SUB-01: registering before or after storage is prepared activates local recovery.
func TestITSUB01RegisteringBeforeOrAfterPreparationActivatesRecovery(t *testing.T) {
	storage := &pendingStorage{}
	storage.add(1)
	session, sink := openDelivery(t, storage)
	session.SetConsumer("early")
	sink.quiet(t)
	session.Start()
	if e := sink.next(t); e.Consumer != "early" {
		t.Fatalf("got %+v", e)
	}
	session.SetConsumer("late")
	if e := sink.next(t); e.Consumer != "late" || e.Payload.DeliveryID != deliveryID(1) {
		t.Fatalf("got %+v", e)
	}
}

// IT-SUB-02, IT-SUB-03, IT-SUB-04, IT-SUB-05: replacement, stale remove, late confirmation and racing confirm.
func TestITSUB02To05ReplacementStaleRemoveLateConfirmAndRace(t *testing.T) {
	storage := &pendingStorage{}
	storage.add(1)
	storage.add(2)
	session, sink := openDelivery(t, storage)
	session.Start()
	session.SetConsumer("a")
	first := sink.next(t)
	session.SetConsumer("b")
	again := sink.next(t)
	if again.Consumer != "b" || again.Payload.DeliveryID != first.Payload.DeliveryID {
		t.Fatalf("not re-emitted with the same ID: %+v", again)
	}
	session.RemoveConsumer("a") // stale remove
	sink.quiet(t)
	if code := session.Confirm(first.Payload.DeliveryID); code != "" { // late, from the replaced consumer
		t.Fatal(code)
	}
	if next := sink.next(t); next.Consumer != "b" || next.Payload.DeliveryID != deliveryID(2) {
		t.Fatalf("got %+v", next)
	}
	var wg sync.WaitGroup
	for range 8 { // racing confirmations and replacements
		wg.Add(2)
		go func() { defer wg.Done(); session.Confirm(deliveryID(2)) }()
		go func() { defer wg.Done(); session.SetConsumer("c") }()
	}
	wg.Wait()
	time.Sleep(50 * time.Millisecond)
	if storage.count() != 0 {
		t.Fatal("pending not retired")
	}
}

// IT-SUB-06 and IT-SUB-08: a destroyed runtime or failed callback keeps the pending entry and stops reception once.
func TestITSUB06And08FailedCallbackKeepsPendingAndStopsReception(t *testing.T) {
	storage := &pendingStorage{}
	storage.add(1)
	session, sink := openDelivery(t, storage)
	errorsSeen := &errorSink{events: make(chan string, 8)}
	opened := OpenConnectionWithDelivery(connectionStorage{}, errorsSeen, session, "g", "", 10<<20, 10<<20)
	if opened.Code != "" {
		t.Fatal(opened.Code)
	}
	defer opened.Session.Close()
	sink.panics = true
	session.SetConsumer("a")
	session.Start()
	select { // never connect before the fault exists: that would dial the network
	case code := <-errorsSeen.events:
		if code != "NATIVE_CALL_FAILED" {
			t.Fatalf("error not sanitized: %s", code)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no error event for the failed callback")
	}
	if code := opened.Session.Connect(); code != "NATIVE_CALL_FAILED" {
		t.Fatalf("reception was not stopped by the callback failure: %q", code)
	}
	select {
	case code := <-errorsSeen.events:
		t.Fatalf("repeated error event %s", code)
	case <-time.After(60 * time.Millisecond):
	}
	if storage.count() != 1 {
		t.Fatal("pending discarded")
	}
	time.Sleep(100 * time.Millisecond)
	sink.mu.Lock()
	sink.panics = false
	sink.mu.Unlock()
	session.SetConsumer("b") // recreated runtime subscribes: local recovery without restarting native code
	if e := sink.next(t); e.Consumer != "b" || e.Payload.DeliveryID != deliveryID(1) {
		t.Fatalf("got %+v", e)
	}
	// IT-SUB-07: the new subscription did not clear the explicit local stop and requested no network.
	if code := opened.Session.Connect(); code != "NATIVE_CALL_FAILED" {
		t.Fatalf("subscription cleared the stop: %q", code)
	}
}

// Confirm maps its outcomes to the public contract.
func TestConfirmReportsInvalidInputAndStorageFailureNotAbsence(t *testing.T) {
	storage := &pendingStorage{}
	storage.add(1)
	session, _ := openDelivery(t, storage)
	if code := session.Confirm("wa-delivery:v1:nope"); code != "INVALID_INPUT" {
		t.Fatal(code)
	}
	if code := session.Confirm(deliveryID(77)); code != "" {
		t.Fatalf("valid absent ID: %q", code)
	}
	storage.mu.Lock()
	storage.failWrite = true
	storage.mu.Unlock()
	if code := session.Confirm(deliveryID(1)); code != "SESSION_STORAGE_FAILED" {
		t.Fatalf("failure hidden as %q", code)
	}
	if storage.count() != 1 {
		t.Fatal("content removed by a failed write")
	}
}

// errorSink records the public error events of a connection.
type errorSink struct{ events chan string }

func (e *errorSink) OnConnectionEvent(value string) {
	var decoded struct {
		Event   string `json:"event"`
		Payload struct {
			Code string `json:"code"`
		} `json:"payload"`
	}
	if json.Unmarshal([]byte(value), &decoded) == nil && decoded.Event == "error" {
		e.events <- decoded.Payload.Code
	}
}
