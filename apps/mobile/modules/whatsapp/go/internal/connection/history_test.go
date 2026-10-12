package connection

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"yoyos-whatsapp/internal/history"
)

// historyReceiving is a receive path that also wants history.
type historyReceiving struct {
	fakeReceiving
	remote    history.Remote
	limits    history.Limits
	ran       chan struct{}
	connected chan struct{}
}

func (h *historyReceiving) EnableHistory(remote history.Remote, _ history.Store, limits history.Limits) {
	h.remote, h.limits = remote, limits
}
func (h *historyReceiving) RunHistory(context.Context) { close(h.ran) }
func (h *historyReceiving) Connected()                 { h.connected <- struct{}{} }

// IT-HIS-07: with a receive path the dependency's automatic history download and receipt are
// switched off, and the module's own steps are what is installed in their place.
func TestHistoryIsDownloadedAndAcknowledgedByTheModuleNotTheDependency(t *testing.T) {
	h := &historyReceiving{fakeReceiving: fakeReceiving{handled: make(chan context.Context, 4)}, ran: make(chan struct{}), connected: make(chan struct{}, 2)}
	jid := types.NewJID("review", types.DefaultUserServer)
	transport := NewWhatsmeowTransport(&store.Device{ID: &jid}, nil, h).(*whatsmeowTransport)
	if !transport.client.ManualHistorySyncDownload || !transport.client.DisableManualHistorySyncReceipt {
		t.Fatal("the automatic history download and receipt must be off")
	}
	if h.remote == nil || h.limits != history.DefaultLimits() || h.limits.MaxInput != 16<<20 || h.limits.MaxInflated != 32<<20 {
		t.Fatalf("the module's steps and the contractual limits are installed: %v %+v", h.remote, h.limits)
	}
	// Without a receive path nothing changes: the client keeps the dependency defaults.
	plain := NewWhatsmeowTransport(&store.Device{ID: &jid}, nil).(*whatsmeowTransport)
	if plain.client.ManualHistorySyncDownload || plain.client.DisableManualHistorySyncReceipt {
		t.Fatal("history flags belong to the receive path only")
	}
}

func TestHistoryProcessorRunsAndResumesOnConnection(t *testing.T) {
	h := &historyReceiving{fakeReceiving: fakeReceiving{handled: make(chan context.Context, 4)}, ran: make(chan struct{}), connected: make(chan struct{}, 2)}
	jid := types.NewJID("review", types.DefaultUserServer)
	transport := NewWhatsmeowTransport(&store.Device{ID: &jid}, nil, h).(*whatsmeowTransport)
	transport.dial = func(context.Context) error { return nil }
	transport.socketConnected = func() bool { return true }
	transport.socketID = func() uint64 { return 7 }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out := make(chan TransportEvent, 4)
	go func() { _ = transport.Run(ctx, out) }()
	select {
	case <-h.ran:
	case <-time.After(2 * time.Second):
		t.Fatal("the history processor starts with the connection generation")
	}
	transport.client.DangerousInternals().DispatchEvent(&events.Connected{SocketID: 7})
	select {
	case <-h.connected:
	case <-time.After(2 * time.Second):
		t.Fatal("a connection resumes captured notifications")
	}
}

// A permanent download failure is told from a transient one: only the first discards the capture.
func TestPermanentDownloadFailuresAreSeparatedFromNetworkFaults(t *testing.T) {
	for _, err := range []error{whatsmeow.ErrMediaDownloadFailedWith404, whatsmeow.ErrMediaDownloadFailedWith410, whatsmeow.ErrMediaDownloadFailedWith403, whatsmeow.ErrInvalidMediaSHA256, whatsmeow.ErrInvalidMediaEncSHA256, whatsmeow.ErrInvalidMediaHMAC, whatsmeow.ErrTooShortFile} {
		if !permanent(errors.Join(errors.New("download"), err)) {
			t.Errorf("%v must be permanent", err)
		}
	}
	for _, err := range []error{context.DeadlineExceeded, errors.New("connection reset"), whatsmeow.ErrNotConnected, nil} {
		if permanent(err) {
			t.Errorf("%v must stay transient", err)
		}
	}
}
