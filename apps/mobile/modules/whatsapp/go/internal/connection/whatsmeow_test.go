package connection

import (
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
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
