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
	got, err := Probe(testStorage{value: "native callback"}, `{"probe":true}`)
	if err != nil || got != "native callback" {
		t.Fatalf("callback value: %q, %v", got, err)
	}
	want := errors.New("native callback failed")
	_, err = Probe(testStorage{err: want}, `{"probe":true}`)
	if !errors.Is(err, want) {
		t.Fatalf("callback error was lost: %v", err)
	}
	if _, err = Probe(testStorage{}, "bad json"); err == nil {
		t.Fatal("invalid input accepted")
	}
}
