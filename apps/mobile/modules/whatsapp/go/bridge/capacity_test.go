package bridge

import (
	"context"
	"testing"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/connection"
	"yoyos-whatsapp/internal/protocolstore"
)

// fullStorage reads an empty container and rejects every write with a typed code.
type fullStorage struct{ code string }

func (fullStorage) ReadState(string) (string, error) {
	return `{"contractVersion":1,"success":true,"data":{"revision":"0","sessionRevision":"0","session":null,"pending":[]}}`, nil
}
func (f fullStorage) ApplyChanges(string) (string, error) {
	return `{"contractVersion":1,"success":false,"error":{"code":"` + f.code + `","message":"rejected"}}`, nil
}

// latched returns a ConnectionSession whose store stopped with the given native code.
func latched(t *testing.T, code string, reopened *int) *ConnectionSession {
	t.Helper()
	protocol, err := protocolstore.Open(fullStorage{code}, "g", "123@lid", 1<<20, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if err := protocol.PutLIDMapping(context.Background(), types.NewJID("1", types.HiddenUserServer), types.NewJID("2", types.DefaultUserServer)); err == nil {
		t.Fatal("write was not rejected")
	}
	session := &ConnectionSession{store: protocol, device: &store.Device{Container: protocol}}
	session.controller = connection.New(session.newTransport, func(connection.Event) {}, nil)
	t.Cleanup(func() { session.controller.Close() })
	session.reopen = func() (*protocolstore.Store, *store.Device, error) {
		*reopened++
		fresh, err := protocolstore.Open(fullStorage{code}, "g", "123@lid", 1<<20, 1<<20)
		if err != nil {
			return nil, nil, err
		}
		return fresh, &store.Device{Container: fresh}, nil
	}
	return session
}

// IT-BUF-03 (rebuild): resuming after a capacity stop restarts from the last confirmed revision.
func TestResumeAfterCapacityStopReopensTheLatchedStore(t *testing.T) {
	reopened := 0
	session := latched(t, "BUFFER_FULL", &reopened)
	if got := session.StopReason(); got != "RECOVERY_BUFFER_FULL" {
		t.Fatalf("stop reason %q", got)
	}
	before := session.device
	transport, err := session.newTransport()
	if err != nil || transport == nil {
		t.Fatal(err)
	}
	if reopened != 1 || session.device == before || session.StopReason() != "" {
		t.Fatalf("store was not rebuilt (reopened=%d reason=%q)", reopened, session.StopReason())
	}
}

// A storage failure is not a capacity stop: an explicit reopen is required, so nothing is rebuilt silently.
func TestStorageFailureDoesNotSilentlyRebuild(t *testing.T) {
	reopened := 0
	session := latched(t, "STORAGE_FAILED", &reopened)
	if _, err := session.newTransport(); err != nil {
		t.Fatal(err)
	}
	if reopened != 0 || session.StopReason() != "SESSION_STORAGE_FAILED" {
		t.Fatalf("storage failure was cleared (reopened=%d reason=%q)", reopened, session.StopReason())
	}
}
