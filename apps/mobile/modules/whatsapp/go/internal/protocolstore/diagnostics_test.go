package protocolstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

// WA-14 IT-SEG-01 / IT-PRO-04: whatever a transaction body or a native callback panics or fails with, the
// store's error carries a code and a fixed sentence, never the value.
const diagnosticCanary = "canary-3f9a7c1e-private-6b2d"

func mustNotLeak(t *testing.T, label string, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected an error", label)
	}
	var typed *Error
	if !errors.As(err, &typed) {
		t.Fatalf("%s: %v is not a typed store error", label, err)
	}
	for _, text := range []string{err.Error(), fmt.Sprintf("%v %+v %#v", err, err, typed)} {
		if strings.Contains(text, diagnosticCanary) {
			t.Fatalf("%s: the failure value reached the error: %s", label, text)
		}
	}
}

func TestWA14ITPRO04PanicInATransactionBodyDoesNotLeakItsValue(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	err := s.DoDecryptionTxn(context.Background(), func(tx context.Context) error { _ = s.PutNCTSalt(tx, []byte{1}); panic(diagnosticCanary) })
	codeIs(t, err, StorageFailed)
	mustNotLeak(t, "transaction panic", err)
	mustNotLeak(t, "stopped store", s.PutNCTSalt(context.Background(), []byte{2}))
}

func TestWA14ITPRO04NativeCallbackFailuresDoNotLeakTheirValue(t *testing.T) {
	for _, label := range []string{"apply panic", "apply error"} {
		n := &controlledStorage{}
		s := openTest(t, n)
		if label == "apply panic" {
			n.onApply = func() { panic(diagnosticCanary) }
		} else {
			n.onApply = func() { n.errCode = Code(diagnosticCanary) }
		}
		err := s.PutNCTSalt(context.Background(), []byte{1})
		mustNotLeak(t, label, err)
	}
}

type leakyRead struct{ mode string }

func (r leakyRead) ReadState(string) (string, error) {
	if r.mode == "panic" {
		panic(diagnosticCanary)
	}
	return "", errors.New(diagnosticCanary)
}
func (leakyRead) ApplyChanges(string) (string, error) { panic("unused") }

func TestWA14ITPRO04OpenWithAFailingReadDoesNotLeakTheValue(t *testing.T) {
	for _, mode := range []string{"panic", "error"} {
		_, err := Open(leakyRead{mode}, "gen", "123@lid", 10<<20, 10<<20)
		mustNotLeak(t, "open/"+mode, err)
	}
}
