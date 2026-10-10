package delivery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"testing"
	"time"

	"yoyos-whatsapp/internal/protocolstore"
)

func did(n int) string { return fmt.Sprintf("wa-delivery:v1:%032x", n) }

func record(n int, revision string, ordinal uint32, state string) protocolstore.PendingRecord {
	r := protocolstore.PendingRecord{CreatedRevision: revision, CreatedOrdinal: &ordinal}
	r.DeliveryID, r.AccountID, r.Source, r.IdentityState = did(n), "1@lid", "live", state
	if state == "resolved" {
		r.Message = json.RawMessage(`{"id":"wa-message:v1:` + strconv.Itoa(n) + `"}`)
	}
	return r
}

// fakeLedger is the durable pending set with injectable read, retire and latency faults.
type fakeLedger struct {
	mu          sync.Mutex
	records     []protocolstore.PendingRecord
	reads       int
	readErr     error
	retireErr   error
	retireGate  chan struct{}
	retireEnter chan string
	retired     []string
	readGate    chan struct{} // when set, a read returns its snapshot only after the gate opens
	readEnter   chan struct{}
}

func (l *fakeLedger) Pending() ([]protocolstore.PendingRecord, error) {
	l.mu.Lock()
	l.reads++
	if l.readErr != nil {
		defer l.mu.Unlock()
		return nil, l.readErr
	}
	snapshot := append([]protocolstore.PendingRecord(nil), l.records...)
	gate, enter := l.readGate, l.readEnter
	l.mu.Unlock()
	if enter != nil {
		enter <- struct{}{}
	}
	if gate != nil {
		<-gate
	}
	return snapshot, nil
}

func (l *fakeLedger) Retire(id string) (bool, error) {
	l.mu.Lock()
	gate, enter := l.retireGate, l.retireEnter
	l.mu.Unlock()
	if enter != nil {
		enter <- id
	}
	if gate != nil {
		<-gate
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.retireErr != nil {
		return false, l.retireErr
	}
	for i, r := range l.records {
		if r.DeliveryID == id {
			l.records = append(l.records[:i:i], l.records[i+1:]...)
			l.retired = append(l.retired, id)
			return true, nil
		}
	}
	return false, nil
}

func (l *fakeLedger) readCount() int { l.mu.Lock(); defer l.mu.Unlock(); return l.reads }
func (l *fakeLedger) add(r ...protocolstore.PendingRecord) {
	l.mu.Lock()
	l.records = append(l.records, r...)
	l.mu.Unlock()
}

type sink struct {
	mu     sync.Mutex
	got    []string
	fail   error
	notify chan string
}

func newSink() *sink { return &sink{notify: make(chan string, 64)} }
func (s *sink) consumer(token string) Consumer {
	return Consumer{Token: token, Emit: func(d Delivery) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.fail != nil {
			return s.fail
		}
		s.got = append(s.got, token+":"+d.ID)
		s.notify <- token + ":" + d.ID
		return nil
	}}
}
func (s *sink) next(t *testing.T) string {
	t.Helper()
	select {
	case v := <-s.notify:
		return v
	case <-time.After(2 * time.Second):
		t.Fatal("no delivery emitted")
		return ""
	}
}
func (s *sink) quiet(t *testing.T) {
	t.Helper()
	select {
	case v := <-s.notify:
		t.Fatalf("unexpected delivery %s", v)
	case <-time.After(80 * time.Millisecond):
	}
}
func (s *sink) count() int { s.mu.Lock(); defer s.mu.Unlock(); return len(s.got) }

type hookLog struct {
	mu      sync.Mutex
	stops   []Cause
	resumes int
}

func (h *hookLog) hooks() Hooks {
	return Hooks{Stop: func(c Cause, _ error) { h.mu.Lock(); h.stops = append(h.stops, c); h.mu.Unlock() },
		Resume: func() { h.mu.Lock(); h.resumes++; h.mu.Unlock() }}
}
func (h *hookLog) snapshot() ([]Cause, int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]Cause(nil), h.stops...), h.resumes
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); time.Sleep(5 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("timed out: %s", what)
}

func started(t *testing.T, ledger Ledger, limit int64) (*Coordinator, *hookLog) {
	t.Helper()
	logs := &hookLog{}
	c := New(ledger, limit, logs.hooks())
	t.Cleanup(c.Close)
	return c, logs
}

var errRead = errors.New("read failed")

func waitCtx(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	t.Cleanup(cancel)
	return ctx
}
