package bridge

import (
	"errors"
	"testing"
)

type testStorage struct {
	value string
	err error
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
