package connection

import (
	"testing"

	"go.mau.fi/whatsmeow/types/events"
)

func TestPinnedClientEventsAreClassifiedWithoutRetryingRevocation(t *testing.T) {
	cases := []struct {
		event any
		want  string
	}{
		{&events.Connected{}, "connected"},
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
