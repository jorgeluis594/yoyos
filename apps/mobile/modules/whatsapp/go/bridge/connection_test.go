package bridge

import (
	"encoding/json"
	"testing"

	"yoyos-whatsapp/internal/connection"
)

type connectionStorage struct{}

func (connectionStorage) ReadState(string) (string, error) {
	return `{"contractVersion":1,"success":false,"error":{"code":"STATE_INVALID","message":"invalid"}}`, nil
}
func (connectionStorage) ApplyChanges(string) (string, error)      { panic("unexpected write") }
func (connectionStorage) BeginFreshSession(string) (string, error) { panic("unexpected link") }

type connectionSink struct{}

func (connectionSink) OnConnectionEvent(string) {}

func TestOpenConnectionPreparesFirstLinkWithoutNetworkOrStorageMutation(t *testing.T) {
	result := OpenConnection(connectionStorage{}, connectionSink{}, "generation-1", "", 10*1024*1024, 10*1024*1024)
	if result.Code != "" || result.Session == nil || result.Session.State() != "disconnected" || result.Session.CurrentQR() != "" {
		t.Fatalf("unexpected first-link preparation: %+v", result)
	}
	result.Session.Close()
}

func TestOpenConnectionRejectsInvalidStorageAndSession(t *testing.T) {
	if got := OpenConnection(nil, connectionSink{}, "g", "", 1, 1).Code; got != "INVALID_INPUT" {
		t.Fatal(got)
	}
	if got := OpenConnection(connectionStorage{}, connectionSink{}, "g", "123@lid", 1, 1).Code; got != "SESSION_STATE_INVALID" {
		t.Fatal(got)
	}
}

func TestConnectionEventsUseVersionedSanitizedEnvelope(t *testing.T) {
	for _, tc := range []struct {
		event connection.Event
		kind  string
		code  string
	}{
		{connection.Event{State: connection.Connected}, "connectionChanged", ""},
		{connection.Event{QR: "private", ExpiresAt: 123}, "qr", ""},
		{connection.Event{Error: connection.ConsumerUnavailable}, "error", "NATIVE_CALL_FAILED"},
	} {
		raw, err := json.Marshal(connectionEvent(tc.event))
		if err != nil {
			t.Fatal(err)
		}
		var decoded struct {
			ContractVersion int    `json:"contractVersion"`
			Event           string `json:"event"`
			Payload         struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatal(err)
		}
		if decoded.ContractVersion != 1 || decoded.Event != tc.kind || decoded.Payload.Code != tc.code {
			t.Fatalf("unexpected event %s", raw)
		}
		if decoded.Payload.Message == "private" {
			t.Fatal("diagnostic leaked QR")
		}
	}
}
