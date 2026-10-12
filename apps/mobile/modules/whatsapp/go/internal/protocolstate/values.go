package protocolstate

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

// Every value has an explicit version. Byte slices use Go's standard padded Base64 JSON form.
type Binary struct {
	Version int    `json:"version"`
	Data    []byte `json:"data"`
}
type PreKey struct {
	Version    int    `json:"version"`
	PrivateKey []byte `json:"privateKey"`
	Uploaded   bool   `json:"uploaded"`
}
type PreKeyState struct {
	Version         int    `json:"version"`
	NextID          uint64 `json:"nextId"`
	UploadedThrough uint32 `json:"uploadedThrough"`
}
type AppStateKey struct {
	Version     int    `json:"version"`
	Data        []byte `json:"data"`
	Fingerprint []byte `json:"fingerprint"`
	Timestamp   int64  `json:"timestamp"`
}
type AppStateVersion struct {
	Version int    `json:"version"`
	Number  uint64 `json:"number"`
	Hash    []byte `json:"hash"`
}
type AppStateMAC struct {
	Version         int    `json:"version"`
	MutationVersion uint64 `json:"mutationVersion"`
	ValueMAC        []byte `json:"valueMac"`
}
type Contact struct {
	Version       int    `json:"version"`
	FirstName     string `json:"firstName"`
	FullName      string `json:"fullName"`
	PushName      string `json:"pushName"`
	BusinessName  string `json:"businessName"`
	RedactedPhone string `json:"redactedPhone"`
}
type ChatSetting struct {
	Version          int    `json:"version"`
	MutedUntil       string `json:"mutedUntil"`
	Pinned           bool   `json:"pinned"`
	Archived         bool   `json:"archived"`
	WASARootSecretID string `json:"wasaRootSecretId"`
}
type PrivacyToken struct {
	Version         int    `json:"version"`
	Token           []byte `json:"token"`
	Timestamp       int64  `json:"timestamp"`
	SenderTimestamp *int64 `json:"senderTimestamp"`
}
type LIDMapping struct {
	Version int    `json:"version"`
	LID     string `json:"lid"`
}
type RetryHash struct {
	Version           int   `json:"version"`
	InsertTimeMS      int64 `json:"insertTimeMs"`
	ServerTimeSeconds int64 `json:"serverTimeSeconds"`
}

func EncodeValue(recordType string, value any) ([]byte, error) {
	b, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if err := ValidateValue(recordType, b); err != nil {
		return nil, err
	}
	return b, nil
}
func ValidateValue(recordType string, data []byte) error {
	if len(data) == 0 || len(data) > MaxRecordBytes {
		return errors.New("invalid value size")
	}
	value := newValue(recordType)
	if value == nil {
		return errors.New("unknown record type")
	}
	if err := strict(data, value); err != nil {
		return err
	}
	canonical, _ := json.Marshal(value)
	if !bytes.Equal(data, canonical) {
		return errors.New("noncanonical value JSON")
	}
	switch v := value.(type) {
	case *Device:
		return v.validate()
	case *Binary:
		if v.Version != 1 || len(v.Data) == 0 {
			return errors.New("invalid binary value")
		}
		if recordType == "identity" && len(v.Data) != 32 {
			return errors.New("identity key must be 32 bytes")
		}
	case *PreKey:
		if v.Version != 1 || len(v.PrivateKey) != 32 {
			return errors.New("invalid prekey")
		}
	case *PreKeyState:
		if v.Version != 1 || v.NextID == 0 || v.NextID > uint64(math.MaxUint32)+1 || uint64(v.UploadedThrough) >= v.NextID {
			return errors.New("invalid prekey state")
		}
	case *AppStateKey:
		if v.Version != 1 || len(v.Data) == 0 {
			return errors.New("invalid app state key")
		}
		var fingerprint waE2E.AppStateSyncKeyFingerprint
		if err := proto.Unmarshal(v.Fingerprint, &fingerprint); err != nil {
			return errors.New("invalid fingerprint protobuf")
		}
	case *AppStateVersion:
		if v.Version != 1 || v.Number == 0 || len(v.Hash) != 128 {
			return errors.New("invalid app state version")
		}
	case *AppStateMAC:
		if v.Version != 1 || v.MutationVersion == 0 || len(v.ValueMAC) != 32 {
			return errors.New("invalid app state MAC")
		}
	case *Contact:
		if v.Version != 1 {
			return errors.New("invalid contact version")
		}
	case *ChatSetting:
		if v.Version != 1 {
			return errors.New("invalid chat setting")
		}
		if v.MutedUntil != "" {
			t, err := time.Parse(time.RFC3339Nano, v.MutedUntil)
			if err != nil || t.UTC().Format(time.RFC3339Nano) != v.MutedUntil {
				return errors.New("invalid mute time")
			}
		}
	case *PrivacyToken:
		if v.Version != 1 || len(v.Token) == 0 || v.Timestamp < 0 || (v.SenderTimestamp != nil && *v.SenderTimestamp < 0) {
			return errors.New("invalid privacy token")
		}
	case *LIDMapping:
		if v.Version != 1 || validJID(v.LID) != nil {
			return errors.New("invalid LID")
		}
		j, _ := types.ParseJID(v.LID)
		if j.Server != types.HiddenUserServer || j.Device != 0 || j.RawAgent != 0 {
			return errors.New("mapping value is not LID")
		}
	case *RetryHash:
		if v.Version != 1 || v.InsertTimeMS < 0 || v.ServerTimeSeconds < 0 {
			return errors.New("invalid retry hash")
		}
	default:
		return fmt.Errorf("unhandled value %T", v)
	}
	return nil
}

// DecodeValue returns the typed v1 value after complete validation.
func DecodeValue(recordType string, data []byte) (any, error) {
	if err := ValidateValue(recordType, data); err != nil {
		return nil, err
	}
	value := newValue(recordType)
	if err := json.Unmarshal(data, value); err != nil {
		return nil, err
	}
	return value, nil
}

func newValue(recordType string) any {
	var value any
	switch recordType {
	case "device":
		value = &Device{}
	case "identity", "signal-session", "sender-key", "message-secret", "nct-salt":
		value = &Binary{}
	case "prekey":
		value = &PreKey{}
	case "prekey-state":
		value = &PreKeyState{}
	case "app-state-key":
		value = &AppStateKey{}
	case "app-state-version":
		value = &AppStateVersion{}
	case "app-state-mac":
		value = &AppStateMAC{}
	case "contact":
		value = &Contact{}
	case "chat-setting":
		value = &ChatSetting{}
	case "privacy-token":
		value = &PrivacyToken{}
	case "lid-mapping":
		value = &LIDMapping{}
	case "retry-hash":
		value = &RetryHash{}
	default:
		return nil
	}
	return value
}
