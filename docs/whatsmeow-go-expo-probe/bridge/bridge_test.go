package bridge

import (
	"errors"
	"testing"
)

type failingStorage struct{ err error }

func (s failingStorage) Commit(string) error { return s.err }

func TestBindingProbe(t *testing.T) {
	if !DependencyProbe() {
		t.Fatal("unexpected connected client")
	}
	want := errors.New("disk write failed")
	if got := CommitProbe(failingStorage{want}, `{"revision":1}`); !errors.Is(got, want) {
		t.Fatalf("storage failure was not propagated: %v", got)
	}
	if got := CommitProbe(failingStorage{}, `invalid`); got == nil {
		t.Fatal("invalid snapshot was accepted")
	}
}
