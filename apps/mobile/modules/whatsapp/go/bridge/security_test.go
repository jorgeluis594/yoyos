package bridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"yoyos-whatsapp/internal/connection"
)

// WA-14. IT-SEG-01: every family of failures, including panics and calls on unusable bindings, leaves the
// Go side with a public code and a fixed message: no key, QR, message text or descriptor, and no value a
// callback panicked or failed with. Consumers decide by code. Nothing here talks to WhatsApp.

const secret = "canary-3f9a7c1e-private-6b2d"

// publicCodeList are the codes of the TypeScript union in types.ts, the contract consumers decide on.
// wa14.contract.test.ts compares this list with types.ts, because test-go.sh runs these tests on a copy of go/.
var publicCodeList = []string{
	"MODULE_UNAVAILABLE", "NOT_INITIALIZED", "INVALID_INPUT", "INVALID_NATIVE_RESPONSE", "NATIVE_CALL_FAILED",
	"CONNECTION_FAILED", "SESSION_EXPIRED", "SESSION_STORAGE_FAILED", "SESSION_STORAGE_LIMIT_REACHED",
	"SESSION_STATE_INVALID", "IDENTITY_UNAVAILABLE", "ACCOUNT_NOT_CONNECTED", "RECOVERY_BUFFER_FULL",
	"HISTORY_LIMIT_REACHED", "STORAGE_LIMIT_REACHED", "IMAGE_UNAVAILABLE", "IMAGE_DOWNLOAD_FAILED",
	"IMAGE_DELETE_FAILED", "REMOTE_LOGOUT_UNCONFIRMED",
}

func publicCodes(t *testing.T) map[string]bool {
	t.Helper()
	codes := map[string]bool{}
	for _, code := range publicCodeList {
		codes[code] = true
	}
	if len(codes) != 19 {
		t.Fatalf("expected the 19 agreed codes, found %d", len(codes))
	}
	return codes
}

var allConnectionCodes = []connection.Code{
	connection.ConnectionFailed, connection.SessionExpiredError, connection.SessionStorageFailed, connection.SessionStorageLimitReached,
	connection.SessionStateInvalid, connection.RecoveryBufferFull, connection.ConsumerUnavailable, connection.IdentityUnavailable,
	connection.HistoryLimitReached, connection.NativeCallFailed,
}

func TestITSEG01EveryErrorEventIsAPublicCodeWithAFixedMessage(t *testing.T) {
	public := publicCodes(t)
	for _, code := range allConnectionCodes {
		raw, err := json.Marshal(connectionEvent(connection.Event{Error: code}))
		if err != nil {
			t.Fatal(err)
		}
		var decoded struct {
			Event   string `json:"event"`
			Payload struct{ Code, Message string }
		}
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded.Event != "error" || !public[decoded.Payload.Code] {
			t.Fatalf("%s produced %s", code, raw)
		}
		if decoded.Payload.Message != "WhatsApp connection failed" {
			t.Fatalf("%s: the message is not fixed: %q", code, decoded.Payload.Message)
		}
		if got := publicConnectCode(code); got != "" && !public[got] {
			t.Fatalf("%s: connect() would return %q, which is not a public code", code, got)
		}
	}
}

func TestITSEG01StorageCodesMapOntoPublicOnes(t *testing.T) {
	public := publicCodes(t)
	for _, err := range []error{nil, errors.New(secret), fmt.Errorf("wrapped: %w", errors.New(secret))} {
		if code := publicCode(err); !public[code] {
			t.Fatalf("publicCode(%v) = %q", err, code)
		}
	}
}

// leakyStorage fails every way a native callback can: with an error, with a structured rejection and with
// a panic, each carrying the canary.
type leakyStorage struct{ mode string }

func (s leakyStorage) fail() (string, error) {
	switch s.mode {
	case "error":
		return "", errors.New(secret)
	case "panic":
		panic(secret)
	case "rejection":
		return `{"contractVersion":1,"success":false,"error":{"code":"STORAGE_FAILED","message":"` + secret + `"}}`, nil
	default:
		return secret, nil // not even JSON
	}
}
func (s leakyStorage) ReadState(string) (string, error)         { return s.fail() }
func (s leakyStorage) ApplyChanges(string) (string, error)      { return s.fail() }
func (s leakyStorage) BeginFreshSession(string) (string, error) { return s.fail() }

func TestITSEG01NativeStorageFailuresNeverReachTheOpenResult(t *testing.T) {
	public := publicCodes(t)
	for _, mode := range []string{"error", "panic", "rejection", "garbage"} {
		for _, account := range []string{"", "123@lid"} {
			result := OpenConnection(leakyStorage{mode}, connectionSink{}, "g", account, 10<<20, 10<<20)
			if result.Session != nil {
				defer result.Session.Close()
			}
			if text := fmt.Sprintf("%+v", *result); strings.Contains(text, secret) {
				t.Fatalf("%s/%q leaked through the open result: %s", mode, account, text)
			}
			if result.Code != "" && !public[result.Code] {
				t.Fatalf("%s/%q: %q is not a public code", mode, account, result.Code)
			}
		}
	}
}

// recordingSink keeps every raw string that crossed the connection boundary.
type recordingSink struct {
	mu     sync.Mutex
	raw    []string
	panics int // panics (with the canary) on this many first events
}

func (r *recordingSink) OnConnectionEvent(value string) {
	r.mu.Lock()
	r.raw = append(r.raw, value)
	panicNow := r.panics > 0
	if panicNow {
		r.panics--
	}
	r.mu.Unlock()
	if panicNow {
		panic(secret)
	}
}
func (r *recordingSink) seen() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return strings.Join(r.raw, "\n")
}

func TestITSEG01APanickingConnectionCallbackIsContainedAndSanitized(t *testing.T) {
	sink := &recordingSink{panics: 1}
	opened := OpenConnection(connectionStorage{}, sink, "g", "", 10<<20, 10<<20)
	if opened.Code != "" {
		t.Fatal(opened.Code)
	}
	defer opened.Session.Close()
	opened.Session.controller.Notify(connection.IdentityUnavailable) // the first callback panics with the canary
	deadline := time.After(2 * time.Second)
	for !strings.Contains(sink.seen(), "NATIVE_CALL_FAILED") { // the local fault follows once, sanitized
		select {
		case <-deadline:
			t.Fatalf("no sanitized fault after the panic; saw %q", sink.seen())
		case <-time.After(5 * time.Millisecond):
		}
	}
	if strings.Contains(sink.seen(), secret) {
		t.Fatalf("the panic value reached an event: %s", sink.seen())
	}
	if code := opened.Session.Connect(); code != "NATIVE_CALL_FAILED" {
		t.Fatalf("a broken callback must stop reception with a public code, got %q", code)
	}
}

func TestITSEG01DeliveryCallbackFailuresCarryOnlyCodes(t *testing.T) {
	for _, mode := range []string{"panic", "error"} {
		storage := &pendingStorage{}
		storage.add(1)
		session, sink := openDelivery(t, storage)
		recording := &recordingSink{}
		opened := OpenConnectionWithDelivery(connectionStorage{}, recording, session, "g", "", 10<<20, 10<<20)
		if opened.Code != "" {
			t.Fatal(opened.Code)
		}
		sink.mu.Lock()
		if mode == "panic" {
			sink.panics = true // the existing sink panics with a fixed text; the canary is set on the error path below
		} else {
			sink.fail = errors.New(secret)
		}
		sink.mu.Unlock()
		session.SetConsumer("a")
		session.Start()
		deadline := time.After(2 * time.Second)
		for !strings.Contains(recording.seen(), "NATIVE_CALL_FAILED") {
			select {
			case <-deadline:
				t.Fatalf("%s: no sanitized error; saw %q", mode, recording.seen())
			case <-time.After(5 * time.Millisecond):
			}
		}
		if strings.Contains(recording.seen(), secret) {
			t.Fatalf("%s: callback failure text reached an event: %s", mode, recording.seen())
		}
		if storage.count() != 1 {
			t.Fatalf("%s: a failed callback must keep the pending entry", mode)
		}
		opened.Session.Close()
	}
}

func TestITSEG01ImageFailuresCarryOnlyCodes(t *testing.T) {
	public := publicCodes(t)
	opened := OpenImages(t.TempDir(), 1<<20)
	if opened.Code != "" {
		t.Fatal(opened.Code)
	}
	for _, reference := range []string{secret, "", "wa-image:v1:" + secret, "wa-image:v1:!!!"} {
		result := opened.Session.Download("wa-message:v1:"+secret, reference)
		if result.Code != "" && !public[result.Code] {
			t.Fatalf("%q: %q is not a public code", reference, result.Code)
		}
		if text := fmt.Sprintf("%+v", *result); strings.Contains(text, secret) {
			t.Fatalf("image result echoed its input: %s", text)
		}
	}
	if code := opened.Session.Delete(secret); code != "" && !public[code] {
		t.Fatalf("Delete returned %q", code)
	}
	if bad := OpenImages("/proc/"+secret+"/nope", 1<<20); bad.Code == "" || !public[bad.Code] || strings.Contains(bad.Code, secret) {
		t.Fatalf("an unusable directory must give a public code, got %q", bad.Code)
	}
}

// Calls on missing or closed sessions are what a destroyed runtime does: they must answer with a code, never panic.
func TestITSEG01UnusableBindingsAnswerWithPublicCodesAndNeverPanic(t *testing.T) {
	public := publicCodes(t)
	targets := []any{(*ConnectionSession)(nil), (*DeliverySession)(nil), (*ImageSession)(nil), (*ImageOperation)(nil), (*ProtocolSession)(nil)}
	called := 0
	for _, target := range targets {
		value := reflect.ValueOf(target)
		for index := 0; index < value.NumMethod(); index++ {
			method, name := value.Method(index), value.Type().Method(index).Name
			args := make([]reflect.Value, method.Type().NumIn())
			for position := range args {
				args[position] = reflect.Zero(method.Type().In(position))
			}
			func() {
				defer func() {
					if recovered := recover(); recovered != nil {
						t.Errorf("%T.%s panicked on a nil receiver: %v", target, name, recovered)
					}
				}()
				called++
				for _, out := range method.Call(args) {
					if out.Kind() == reflect.String && out.String() != "" && !public[out.String()] && !isDiagnosticText(name, out.String()) {
						t.Errorf("%T.%s answered %q, which is not a public code", target, name, out.String())
					}
				}
			}()
		}
	}
	if called < 20 {
		t.Fatalf("only %d exported methods were exercised", called)
	}
}

// isDiagnosticText covers the few string answers that are state or text rather than codes.
func isDiagnosticText(method, value string) bool {
	return method == "State" || method == "CurrentQR" || method == "StopReason"
}

// Go keeps no log of its own: nothing it prints can carry a key, a QR or a message.
func TestITSEG01GoSourcesNeverLogOrPrint(t *testing.T) {
	forbidden := regexp.MustCompile(`"log"|"log/slog"|fmt\.(Print|Fprint)|os\.Std(out|err)|\bprintln\(|\bprint\(|debug\.PrintStack|runtime\.Stack`)
	var offenders []string
	walkGo(t, "..", func(path, text string) {
		if loc := forbidden.FindString(text); loc != "" {
			offenders = append(offenders, path+": "+loc)
		}
	})
	if len(offenders) > 0 {
		t.Fatalf("Go code writes diagnostics: %v", offenders)
	}
}

func walkGo(t *testing.T, root string, visit func(path, text string)) {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		path := root + "/" + entry.Name()
		switch {
		case entry.IsDir():
			if entry.Name() != "testdata" {
				walkGo(t, path, visit)
			}
		case strings.HasSuffix(entry.Name(), ".go") && !strings.HasSuffix(entry.Name(), "_test.go"):
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			visit(path, string(raw))
		}
	}
}
