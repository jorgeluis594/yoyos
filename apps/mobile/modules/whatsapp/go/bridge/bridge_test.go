package bridge

import (
	"errors"
	"testing"
)

type testStorage struct {
	value string
	err   error
}

func (s testStorage) Commit(string) (string, error) { return s.value, s.err }

func TestProbe(t *testing.T) {
	got := Probe(testStorage{value: "native callback"}, `{"probe":true}`)
	if got.Code != "" || got.Value != "native callback" {
		t.Fatalf("callback value: %+v", got)
	}
	got = Probe(testStorage{err: errors.New("native callback failed")}, `{"probe":true}`)
	if got.Code != "NATIVE_CALL_FAILED" || got.Value != "" {
		t.Fatalf("callback error was lost: %+v", got)
	}
	if got = Probe(testStorage{}, "bad json"); got.Code != "INVALID_REQUEST" {
		t.Fatalf("invalid input accepted: %+v", got)
	}
}

type protocolStorage struct {
	response string
	err      error
}

func (s protocolStorage) ReadState(string) (string, error)    { return s.response, s.err }
func (s protocolStorage) ApplyChanges(string) (string, error) { return "", errors.New("not called") }
func (s protocolStorage) BeginFreshSession(string) (string, error) {
	return "", errors.New("not called")
}

func TestOpenProtocolStoreUsesNativeRead(t *testing.T) {
	account := "123@lid"
	storage := protocolStorage{response: `{"contractVersion":1,"success":true,"data":{"revision":"0","sessionRevision":"0","session":null,"pending":[]}}`}
	opened := OpenProtocolStore(storage, "registered", account, 1024, 1024)
	if opened.Code != "" || opened.Session == nil || opened.Session.StopReason() != "" {
		t.Fatalf("native read did not open Go store: %+v", opened)
	}
	failed := OpenProtocolStore(protocolStorage{err: errors.New("read failed")}, "registered", account, 1024, 1024)
	if failed.Code != "STORAGE_FAILED" || failed.Session != nil {
		t.Fatalf("failed native read became empty state: %+v", failed)
	}
}

func TestFirstLinkBridgeKeepsCredentialsInGo(t *testing.T) {
	if got := NewFirstLinkProtocolStore(nil, "generation", 1024, 1024); got.Code != "INVALID_REQUEST" || got.Session != nil {
		t.Fatalf("nil native storage admitted: %+v", got)
	}
	got := NewFirstLinkProtocolStore(protocolStorage{}, "generation", 1024, 1024)
	if got.Code != "" || got.Session == nil || got.Session.device == nil || got.Session.StopReason() != "" {
		t.Fatalf("first-link credentials unavailable to Go controller: %+v", got)
	}
	if got.Session.device.ID != nil {
		t.Fatal("first-link device was treated as paired before verification")
	}
}

func TestPureNativeAdmissionUsesCompleteCodec(t *testing.T) {
	if !ValidateProtocolChange("put", "prekey-state", "W10", "eyJ2ZXJzaW9uIjoxLCJuZXh0SWQiOjEsInVwbG9hZGVkVGhyb3VnaCI6MH0=") {
		t.Fatal("valid protocol record rejected")
	}
	if ValidateProtocolChange("put", "prekey", "WyIwMSJd", "eyJ2ZXJzaW9uIjoxfQ==") {
		t.Fatal("noncanonical prekey admitted")
	}
	if ValidateProtocolChange("put", "device", "W10", "eyJ2ZXJzaW9uIjoxLCJpZCI6IjEyMzoyQHMud2hhdHNhcHAubmV0IiwibGlkIjoiMTIzQGxpZCJ9") {
		t.Fatal("incomplete paired device admitted")
	}
	if ValidateProtocolChange("put", "signal-session", "WyAiMTIzOjIiIF0", "eyJ2ZXJzaW9uIjoxLCJkYXRhIjoiQVE9PSJ9") {
		t.Fatal("noncanonical tuple admitted")
	}
}
