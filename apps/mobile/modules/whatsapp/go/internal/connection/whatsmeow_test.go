package connection

import (
	"context"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
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
		{&events.ManualLoginReconnect{}, "loginReconnect"},
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

func TestDelayedQRConsumptionKeepsProducerExpiry(t *testing.T) {
	producedAt := time.Now().Add(-25 * time.Second)
	item := whatsmeow.QRChannelItem{Event: whatsmeow.QRChannelEventCode, Code: "stale", Timeout: 20 * time.Second, ExpiresAt: producedAt.Add(20 * time.Second)}
	if _, valid := codeEvent(item, time.Now()); valid {
		t.Fatal("expired buffered QR was advertised")
	}
	item.ExpiresAt = time.Now().Add(20 * time.Second)
	if event, valid := codeEvent(item, time.Now()); !valid || !event.ExpiresAt.Equal(item.ExpiresAt) {
		t.Fatal("producer deadline was replaced at consumption")
	}
}

func TestPinned515ContinuesAuthenticationWithinOriginalDeadline(t *testing.T) {
	for _, mode := range []string{"within deadline", "late connected", "late 515"} {
		t.Run(mode, func(t *testing.T) {
			clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 8)}
			transport := NewWhatsmeowTransport(&store.Device{}, nil).(*whatsmeowTransport)
			if !transport.client.DisableLoginAutoReconnect || transport.client.EnableAutoReconnect {
				t.Fatal("upstream reconnect must be owned by the transport")
			}
			dials := make(chan struct{}, 2)
			transport.dial = func(context.Context) error { dials <- struct{}{}; return nil }
			created := 0
			published := make(chan Event, 16)
			c := New(func() (Transport, error) { created++; return transport, nil }, func(event Event) { published <- event }, clock)
			defer c.Close()
			c.Prepare(false)
			if code := c.Connect(); code != "" {
				t.Fatal(code)
			}
			select {
			case <-dials:
			case <-time.After(time.Second):
				t.Fatal("initial dial did not start")
			}
			if receive(t, published).State != Connecting {
				t.Fatal("initial state missing")
			}
			clock.WaitTimer(t)
			transport.client.DangerousInternals().DispatchEvent(&events.PairSuccess{})
			clock.WaitTimer(t)
			if mode == "late 515" {
				clock.Advance(31 * time.Second)
			} else {
				clock.Advance(29 * time.Second)
			}
			transport.client.DangerousInternals().HandleStreamError(context.Background(), &binary.Node{Tag: "stream:error", Attrs: binary.Attrs{"code": "515"}})
			transport.client.DangerousInternals().DispatchEvent(&events.Disconnected{})
			if mode == "late 515" {
				if receive(t, published).Error != ConnectionFailed || receive(t, published).State != Reconnecting {
					t.Fatal("expired 515 was accepted")
				}
				select {
				case <-dials:
					t.Fatal("expired 515 started another dial")
				case <-time.After(20 * time.Millisecond):
				}
				return
			}
			select {
			case <-dials:
			case <-time.After(time.Second):
				t.Fatal("515 did not reconnect")
			}
			if created != 1 || c.State() != Connecting {
				t.Fatal("515 created another client or reset state")
			}
			if mode == "late connected" {
				clock.Advance(2 * time.Second)
				transport.client.DangerousInternals().DispatchEvent(&events.Connected{})
				if receive(t, published).Error != ConnectionFailed || receive(t, published).State != Reconnecting {
					t.Fatal("expired authentication was accepted or not stopped")
				}
			} else {
				transport.client.DangerousInternals().DispatchEvent(&events.Connected{})
				if receive(t, published).State != Connected {
					t.Fatal("515 handoff did not authenticate")
				}
			}
		})
	}
}
