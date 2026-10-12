package protocolstore

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"

	"yoyos-whatsapp/internal/protocolstate"
)

type freshStorage struct {
	controlledStorage
	requests  int
	loseFirst bool
}

type rejectedFreshStorage struct{ freshStorage }

func (*rejectedFreshStorage) BeginFreshSession(string) (string, error) {
	return `{"contractVersion":1,"success":false,"error":{"code":"SESSION_FULL","message":"capacity"}}`, nil
}

func TestFirstLinkFailureLatchesTypedHealth(t *testing.T) {
	native := &rejectedFreshStorage{}
	fresh, err := NewFirstLinkDevice(native, "gen", 10<<20, 10<<20)
	if err != nil {
		t.Fatal(err)
	}
	paired := validDevice()
	paired.Container = fresh.Container
	codeIs(t, paired.Container.PutDevice(context.Background(), paired), SessionFull)
	health, ok := paired.Container.(interface{ StopReason() error })
	if !ok {
		t.Fatal("first-link health unavailable to connection bridge")
	}
	codeIs(t, health.StopReason(), SessionFull)
	codeIs(t, paired.Container.PutDevice(context.Background(), paired), SessionFull)
}

func (n *freshStorage) BeginFreshSession(raw string) (string, error) {
	var request struct {
		ContractVersion int                  `json:"contractVersion"`
		GenerationID    string               `json:"generationId"`
		AccountID       string               `json:"accountId"`
		Device          protocolstate.Record `json:"device"`
	}
	if err := json.Unmarshal([]byte(raw), &request); err != nil {
		return "", err
	}
	if request.ContractVersion != 1 || request.GenerationID != "gen" || request.AccountID != "123@lid" {
		return "", errors.New("wrong authority")
	}
	if _, err := protocolstate.Encode([]protocolstate.Record{request.Device}); err != nil {
		return "", err
	}
	n.requests++
	if n.sessionRevision == 0 {
		n.revision++
		n.sessionRevision = n.revision
		n.records = []protocolstate.Record{request.Device}
	} else if len(n.records) != 1 || n.records[0] != request.Device {
		return "", errors.New("existing device differs")
	}
	if n.loseFirst && n.requests == 1 {
		return "", errors.New("response lost after commit")
	}
	bytes, _ := json.Marshal(response[applied]{ContractVersion: 1, Success: true, Data: &applied{"1", "1"}})
	return string(bytes), nil
}

func TestFirstLinkPublishesDeviceAtomicallyAndRecoversLostReply(t *testing.T) {
	n := &freshStorage{loseFirst: true}
	fresh, err := NewFirstLinkDevice(n, "gen", 10<<20, 10<<20)
	if err != nil || fresh.Container == nil || len(n.records) != 0 {
		t.Fatal("generated device touched storage", err)
	}
	paired := validDevice()
	paired.LID.Device = 2
	paired.Container = fresh.Container
	if err = paired.Container.PutDevice(context.Background(), paired); err != nil {
		t.Fatal(err)
	}
	if n.requests != 2 || len(n.records) != 1 || !paired.Initialized || paired.Sessions == nil {
		t.Fatal("first link not durably attached")
	}
	value, err := base64.StdEncoding.DecodeString(n.records[0].ValueBase64)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := protocolstate.DecodeValue("device", value); err != nil || got.(*protocolstate.Device).LID != "123:2@lid" {
		t.Fatal("device-addressed LID was not preserved", err)
	}
	if err = paired.Container.PutDevice(context.Background(), paired); err != nil {
		t.Fatal("linked save failed", err)
	}
}
