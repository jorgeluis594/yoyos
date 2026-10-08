package connection

import (
	"context"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types/events"
	"yoyos-whatsapp/internal/protocolstore"
)

func TestPinnedClientEventsAreClassifiedWithoutRetryingRevocation(t *testing.T) {
	cases := []struct {
		event any
		want  string
	}{
		{&events.Connected{}, "connected"},
		{&events.PairSuccess{}, "authenticating"},
		{&events.ManualLoginReconnect{}, "networkFailure"},
		{&events.Disconnected{}, "networkFailure"},
		{&events.LoggedOut{}, "revoked"},
		{&events.ConnectFailure{Reason: events.ConnectFailureLoggedOut}, "revoked"},
		{&events.ConnectFailure{Reason: events.ConnectFailureServiceUnavailable}, "networkFailure"},
		{&events.ConnectFailure{Reason: events.ConnectFailureBadUserAgent}, "permanentFailure"},
		{&events.ClientOutdated{}, "permanentFailure"},
		{&events.StreamReplaced{}, "permanentFailure"},
		{struct{}{}, ""},
	}
	for _, tc := range cases {
		if got := classify(tc.event); got != tc.want {
			t.Errorf("%T: got %s, want %s", tc.event, got, tc.want)
		}
	}
}

func TestFirstLinkStorageErrorIsNotTreatedAsQRFailure(t *testing.T) {
	if got := storageCode(&protocolstore.Error{Code: protocolstore.SessionFull}); got != SessionStorageLimitReached {
		t.Fatalf("session capacity classified as %q", got)
	}
}

func TestPinned515AfterPairSuccessRetriesFirstLink(t *testing.T) {
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 8)}
	first, second := newTransport(), newTransport()
	upstream := NewWhatsmeowTransport(&store.Device{}, nil).(*whatsmeowTransport).client
	if !upstream.DisableLoginAutoReconnect || upstream.EnableAutoReconnect {
		t.Fatal("upstream reconnect must be owned by the controller")
	}
	created := 0
	published := make(chan Event, 16)
	c := New(func() (Transport, error) {
		created++
		if created == 1 {
			return first, nil
		}
		return second, nil
	}, func(event Event) { published <- event }, clock)
	defer c.Close()
	c.Prepare(false)
	if code := c.Connect(); code != "" {
		t.Fatal(code)
	}
	out := started(t, first)
	if receive(t, published).State != Connecting {
		t.Fatal("first attempt did not start")
	}
	clock.WaitTimer(t)
	out <- TransportEvent{Kind: "qr", QR: "code", ExpiresAt: clock.Now().Add(time.Minute)}
	if receive(t, published).State != AwaitingQR || receive(t, published).QR != "code" {
		t.Fatal("first link QR missing")
	}
	upstream.AddEventHandler(func(event any) {
		if kind := classify(event); kind != "" {
			out <- TransportEvent{Kind: kind}
		}
	})
	upstream.DangerousInternals().DispatchEvent(&events.PairSuccess{})
	upstream.DangerousInternals().HandleStreamError(context.Background(), &binary.Node{Tag: "stream:error", Attrs: binary.Attrs{"code": "515"}})
	select {
	case <-first.stopped:
	case <-time.After(time.Second):
		t.Fatal("515 did not retire the first client")
	}
	if c.State() != Reconnecting {
		t.Fatalf("first link was not retried: %s", c.State())
	}
	clock.WaitTimer(t)
	clock.Advance(time.Second)
	started(t, second)
	if created != 2 || c.State() != Reconnecting {
		t.Fatal("reconnect did not create exactly one new attempt")
	}
}
