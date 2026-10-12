package receive

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"yoyos-whatsapp/internal/protocolstate"
	"yoyos-whatsapp/internal/protocolstore"
)

// WA-14 IT-SEG-03: cost of the snapshots the Go side exchanges with the native container, with a session and a
// recovery buffer that are representative and close to their limits, and with repeated confirmations.
//
// What is measured: Go-side latency of each exchange, the bytes that cross the boundary (the transient copy
// native and Go both hold while an exchange runs) and the Go heap above its baseline. What is NOT measured here:
// native encryption, fsync, atomic replacement and temporary files, the Kotlin/Swift heap and process RSS. The
// container is an in-memory double, so these figures bound the Go share of the cost, not the device's. No
// threshold is asserted: the project has agreed none. Run with WA_MEASURE=1 (and WA_MEASURE_OUT=file.json) and
// without -race; a normal run only checks the harness on small sizes.

// meter wraps the container double and records every exchange.
type meter struct {
	*native
	calls map[string]*callStats
}

type callStats struct {
	Count         int
	RequestBytes  int64
	ResponseBytes int64
	MaxResponse   int64
	durations     []time.Duration
}

func newMeter(n *native) *meter { return &meter{native: n, calls: map[string]*callStats{}} }

func (m *meter) record(name, request, response string, since time.Time) {
	m.native.mu.Lock() // the double's own lock is not held by the callers here
	defer m.native.mu.Unlock()
	c := m.calls[name]
	if c == nil {
		c = &callStats{}
		m.calls[name] = c
	}
	c.Count++
	c.RequestBytes += int64(len(request))
	c.ResponseBytes += int64(len(response))
	c.MaxResponse = max(c.MaxResponse, int64(len(response)))
	c.durations = append(c.durations, time.Since(since))
}

func (m *meter) ReadState(r string) (string, error) {
	start := time.Now()
	out, err := m.native.ReadState(r)
	m.record("ReadState", r, out, start)
	return out, err
}
func (m *meter) ApplyChanges(r string) (string, error) {
	start := time.Now()
	out, err := m.native.ApplyChanges(r)
	m.record("ApplyChanges", r, out, start)
	return out, err
}
func (m *meter) ReadPending(r string) (string, error) {
	start := time.Now()
	out, err := m.native.ReadPending(r)
	m.record("ReadPending", r, out, start)
	return out, err
}
func (m *meter) RetirePending(r string) (string, error) {
	start := time.Now()
	out, err := m.native.RetirePending(r)
	m.record("RetirePending", r, out, start)
	return out, err
}

type callReport struct {
	Count             int     `json:"count"`
	RequestBytesTotal int64   `json:"requestBytesTotal"`
	ResponseBytesMax  int64   `json:"responseBytesMax"`
	MedianMicros      float64 `json:"medianMicros"`
	P95Micros         float64 `json:"p95Micros"`
	MaxMicros         float64 `json:"maxMicros"`
}

func (m *meter) report() map[string]callReport {
	out := map[string]callReport{}
	for name, c := range m.calls {
		sorted := append([]time.Duration(nil), c.durations...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
		at := func(q float64) float64 { return float64(sorted[min(len(sorted)-1, int(q*float64(len(sorted))))].Microseconds()) }
		out[name] = callReport{c.Count, c.RequestBytes, c.MaxResponse, at(0.5), at(0.95), float64(sorted[len(sorted)-1].Microseconds())}
	}
	return out
}

// shapedPending adds n resolved entries whose message text and recovery plaintext are textBytes long.
func shapedPending(n *native, count, textBytes int) (stored int64) {
	text := strings.Repeat("x", textBytes)
	for i := 1; i <= count; i++ {
		ordinal := uint32(0)
		rec := protocolstore.PendingRecord{CreatedRevision: fmt.Sprint(i), CreatedOrdinal: &ordinal}
		rec.DeliveryID, rec.AccountID, rec.Source, rec.IdentityState = did(i), account, "live", "resolved"
		info, _ := json.Marshal(map[string]any{"version": 1, "accountId": account, "id": fmt.Sprint("m", i), "chat": "555@lid", "sender": "555@lid", "timestampSeconds": 100})
		rec.Recovery = protocolstore.Recovery{MessageInfoJSON: string(info), Items: []protocolstore.RecoveryItem{{Format: "v2", PlaintextBase64: base64.StdEncoding.EncodeToString([]byte(text)), CiphertextHashBase64: base64.StdEncoding.EncodeToString(make([]byte, 32))}}}
		rec.Message = json.RawMessage(fmt.Sprintf(`{"id":"wa-message:v1:m%d","accountId":%q,"whatsappMessageId":"m%d","chatId":"555@lid","direction":"incoming","timestamp":%d,"text":%q}`, i, account, i, 100+i, text))
		n.pending = append(n.pending, rec)
		n.revision = uint64(i)
	}
	raw, _ := json.Marshal(n.pending)
	return int64(len(raw))
}

// shapedSession adds count Signal-session records of recordBytes each; they are valid, so Open decodes
// and checks them like a real session. It returns the size of the encoded session blob.
func shapedSession(t *testing.T, n *native, count, recordBytes int) (stored int64) {
	t.Helper()
	records := make([]protocolstate.Record, 0, count)
	for i := 0; i < count; i++ {
		keyJSON, _ := json.Marshal([]string{fmt.Sprintf("%d:0", 5100000000+i)})
		value, err := protocolstate.EncodeValue("signal-session", protocolstate.Binary{Version: 1, Data: make([]byte, recordBytes)})
		if err != nil {
			t.Fatal(err)
		}
		record := protocolstate.Record{RecordType: "signal-session", RecordKey: base64.RawURLEncoding.EncodeToString(keyJSON), ValueBase64: base64.StdEncoding.EncodeToString(value)}
		records = append(records, record)
		n.records[record.RecordType+"\x00"+record.RecordKey] = record
	}
	if count > 0 {
		n.sessionRev, n.revision = 1, max(n.revision, 1)
		blob, err := protocolstate.Encode(records)
		if err != nil {
			t.Fatal(err)
		}
		stored = int64(len(blob))
	}
	return stored
}

type scenario struct {
	Name           string `json:"name"`
	SessionRecords int    `json:"sessionRecords"`
	RecordBytes    int    `json:"recordBytes"`
	PendingEntries int    `json:"pendingEntries"`
	TextBytes      int    `json:"textBytes"`
}

type measurement struct {
	Scenario        scenario              `json:"scenario"`
	SessionBytes    int64                 `json:"sessionBytes"`
	PendingBytes    int64                 `json:"pendingBytes"`
	OpenHeapPeak    uint64                `json:"openHeapPeakBytes"`
	PendingHeapPeak uint64                `json:"pendingReadHeapPeakBytes"`
	ConfirmHeapPeak uint64                `json:"confirmAllHeapPeakBytes"`
	Calls           map[string]callReport `json:"calls"`
	Confirmed       int                   `json:"confirmed"`
}

func measureSnapshots(t *testing.T, s scenario) measurement {
	t.Helper()
	n := newNative()
	sessionBytes := shapedSession(t, n, s.SessionRecords, s.RecordBytes)
	pendingBytes := shapedPending(n, s.PendingEntries, s.TextBytes)
	limit := int64(64 << 20) // above every shaped size: this measures cost, not admission
	meter := newMeter(n)
	out := measurement{Scenario: s, SessionBytes: sessionBytes, PendingBytes: pendingBytes}

	out.OpenHeapPeak = peakHeap(func() {
		if _, err := protocolstore.Open(meter, "gen", account, limit, limit); err != nil {
			t.Fatalf("%s: open: %v", s.Name, err)
		}
	})
	ledger, err := protocolstore.NewLedger(meter, limit, limit)
	if err != nil {
		t.Fatal(err)
	}
	var listed []protocolstore.PendingRecord
	out.PendingHeapPeak = peakHeap(func() {
		if listed, err = ledger.Pending(); err != nil {
			t.Fatalf("%s: pending: %v", s.Name, err)
		}
	})
	if len(listed) != s.PendingEntries {
		t.Fatalf("%s: read %d entries, want %d", s.Name, len(listed), s.PendingEntries)
	}
	// Repeated confirmations: every delivery is confirmed once, then once more (a repeated confirmation is a no-op).
	out.ConfirmHeapPeak = peakHeap(func() {
		for _, rec := range listed {
			removed, err := ledger.Retire(rec.DeliveryID)
			if err != nil || !removed {
				t.Fatalf("%s: retire %s: removed=%v err=%v", s.Name, rec.DeliveryID, removed, err)
			}
			out.Confirmed++
		}
		for _, rec := range listed {
			if removed, err := ledger.Retire(rec.DeliveryID); err != nil || removed {
				t.Fatalf("%s: second retire %s: removed=%v err=%v", s.Name, rec.DeliveryID, removed, err)
			}
		}
	})
	if n.pendingCount() != 0 {
		t.Fatalf("%s: %d entries left after confirming all", s.Name, n.pendingCount())
	}
	out.Calls = meter.report()
	return out
}

func TestITSEG03SnapshotCostHarnessOnSmallLoads(t *testing.T) {
	result := measureSnapshots(t, scenario{"small", 20, 256, 50, 200})
	if result.SessionBytes == 0 || result.PendingBytes == 0 || result.Calls["ReadState"].ResponseBytesMax == 0 {
		t.Fatalf("nothing measured: %+v", result)
	}
	if got := result.Calls["RetirePending"].Count; got != 100 { // 50 confirmations + 50 repeats
		t.Fatalf("expected 100 confirmation exchanges, got %d", got)
	}
}

// TestITSEG03MeasureSnapshotCost prints the figures reported in the README. It is skipped unless WA_MEASURE=1.
func TestITSEG03MeasureSnapshotCost(t *testing.T) {
	if os.Getenv("WA_MEASURE") != "1" {
		t.Skip("set WA_MEASURE=1 (and run without -race) to measure; no threshold is asserted")
	}
	scenarios := []scenario{
		{"small session, few messages", 50, 512, 20, 300},
		{"representative session, typical buffer", 2000, 512, 500, 300},
		{"session near its 16 MiB allowance, empty buffer", 19500, 400, 0, 0},
		{"buffer near its 10 MiB default, typical messages", 2000, 512, 5000, 600},
		{"buffer near its 10 MiB default, few large entries", 2000, 512, 8, 400 << 10},
		{"both near their limits", 19500, 400, 5000, 600},
	}
	report := struct {
		Go         string        `json:"go"`
		GOOS       string        `json:"goos"`
		GOARCH     string        `json:"goarch"`
		CPUs       int           `json:"cpus"`
		Scope      string        `json:"scope"`
		Race       bool          `json:"raceDetector"`
		Scenarios  []measurement `json:"scenarios"`
		NotMeasure []string      `json:"notMeasured"`
	}{
		Go: runtime.Version(), GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, CPUs: runtime.NumCPU(),
		Scope: "Go side only, against an in-memory container double",
		Race:  raceEnabled,
		NotMeasure: []string{
			"native encryption, fsync, atomic replacement and temporary files of the container",
			"Kotlin/Swift heap and process RSS", "any run on Android or iOS hardware", "battery and thermal behaviour",
		},
	}
	for _, s := range scenarios {
		got := measureSnapshots(t, s)
		report.Scenarios = append(report.Scenarios, got)
		t.Logf("%-52s session=%dB pending=%dB open=%dB pendingRead=%dB confirm=%dB retire(median/p95)=%.0f/%.0fus", s.Name, got.SessionBytes, got.PendingBytes, got.OpenHeapPeak, got.PendingHeapPeak, got.ConfirmHeapPeak, got.Calls["RetirePending"].MedianMicros, got.Calls["RetirePending"].P95Micros)
	}
	if path := os.Getenv("WA_MEASURE_OUT"); path != "" {
		raw, _ := json.MarshalIndent(report, "", "  ")
		if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
