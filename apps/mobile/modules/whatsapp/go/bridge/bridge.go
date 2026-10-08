// Package bridge is the gomobile boundary. Protocol types remain internal to Go.
package bridge

import (
	"encoding/base64"
	"encoding/json"

	"go.mau.fi/whatsmeow/store"
	"yoyos-whatsapp/internal"
	"yoyos-whatsapp/internal/protocolstate"
	"yoyos-whatsapp/internal/protocolstore"
)

// ValidateProtocolChange is pure and may be called by native before taking its writer lock.
func ValidateProtocolChange(operation, recordType, recordKey, valueBase64 string) bool {
	if operation == "delete" {
		_, err := protocolstate.DecodeKey(recordType, recordKey)
		return err == nil && recordType != "device" && valueBase64 == ""
	}
	if operation != "put" {
		return false
	}
	value, err := base64.StdEncoding.DecodeString(valueBase64)
	if err != nil || base64.StdEncoding.EncodeToString(value) != valueBase64 {
		return false
	}
	_, err = protocolstate.Encode([]protocolstate.Record{{RecordType: recordType, RecordKey: recordKey, ValueBase64: valueBase64}})
	return err == nil
}

// Storage is implemented by the native platform and called synchronously by Go.
type Storage interface {
	Commit(value string) (string, error)
}

// ProtocolStorage is implemented by the native transactional writer. Its methods
// return a versioned JSON response even for a known storage rejection.
type ProtocolStorage interface {
	ReadState(request string) (string, error)
	ApplyChanges(request string) (string, error)
	BeginFreshSession(request string) (string, error)
}

type ProtocolSession struct{ store *protocolstore.Store }

type ProtocolOpenResult struct {
	Session *ProtocolSession
	Code    string
}

// FirstLinkSession holds the new credentials in Go until whatsmeow verifies
// pairing. Its device is used by the Go connection controller; native only
// receives the opaque session and a typed failure code.
type FirstLinkSession struct{ device *store.Device }

type FirstLinkOpenResult struct {
	Session *FirstLinkSession
	Code    string
}

// NewFirstLinkProtocolStore is called after native registers a fresh generation.
// Its first durable write is the verified pair's BeginFreshSession callback.
func NewFirstLinkProtocolStore(storage ProtocolStorage, generationID string, readRecoveryBytes, newRecoveryBytes int64) *FirstLinkOpenResult {
	if storage == nil {
		return &FirstLinkOpenResult{Code: string(protocolstore.InvalidRequest)}
	}
	device, err := protocolstore.NewFirstLinkDevice(storage, generationID, readRecoveryBytes, newRecoveryBytes)
	if err != nil {
		if typed, ok := err.(*protocolstore.Error); ok {
			return &FirstLinkOpenResult{Code: string(typed.Code)}
		}
		return &FirstLinkOpenResult{Code: string(protocolstore.StorageFailed)}
	}
	return &FirstLinkOpenResult{Session: &FirstLinkSession{device: device}}
}

func (s *FirstLinkSession) StopReason() string {
	if s == nil || s.device == nil || s.device.Container == nil {
		return string(protocolstore.InvalidRequest)
	}
	if health, ok := s.device.Container.(interface{ StopReason() error }); ok {
		return protocolErrorCode(health.StopReason())
	}
	return string(protocolstore.StateInvalid)
}

func protocolErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if typed, ok := err.(*protocolstore.Error); ok {
		return string(typed.Code)
	}
	return string(protocolstore.StorageFailed)
}

// OpenProtocolStore connects the generated native callback to the real Go stores.
// The native controller registers the generation before calling this function.
func OpenProtocolStore(storage ProtocolStorage, generationID, accountID string, readRecoveryBytes, newRecoveryBytes int64) *ProtocolOpenResult {
	if storage == nil {
		return &ProtocolOpenResult{Code: string(protocolstore.InvalidRequest)}
	}
	s, err := protocolstore.Open(storage, generationID, accountID, readRecoveryBytes, newRecoveryBytes)
	if err != nil {
		if typed, ok := err.(*protocolstore.Error); ok {
			return &ProtocolOpenResult{Code: string(typed.Code)}
		}
		return &ProtocolOpenResult{Code: string(protocolstore.StorageFailed)}
	}
	return &ProtocolOpenResult{Session: &ProtocolSession{store: s}}
}

func (s *ProtocolSession) StopReason() string {
	if s == nil || s.store == nil {
		return string(protocolstore.InvalidRequest)
	}
	return protocolErrorCode(s.store.StopReason())
}

// ProbeResult keeps callback errors explicit across bindings that advertise nonnull returns.
type ProbeResult struct {
	Value string
	Code  string
}

// Probe exercises a real whatsmeow dependency and a round trip through native code.
func Probe(storage Storage, value string) *ProbeResult {
	if storage == nil || !json.Valid([]byte(value)) {
		return &ProbeResult{Code: "INVALID_REQUEST"}
	}
	if !internal.DependencyReady() {
		return &ProbeResult{Code: "NATIVE_CALL_FAILED"}
	}
	result, err := storage.Commit(value)
	if err != nil {
		return &ProbeResult{Code: "NATIVE_CALL_FAILED"}
	}
	return &ProbeResult{Value: result}
}
