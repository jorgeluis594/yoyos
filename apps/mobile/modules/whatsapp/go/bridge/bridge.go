// Package bridge is the gomobile boundary. Protocol types remain internal to Go.
package bridge

import (
	"encoding/base64"
	"encoding/json"

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
	if err := s.store.StopReason(); err != nil {
		if typed, ok := err.(*protocolstore.Error); ok {
			return string(typed.Code)
		}
		return string(protocolstore.StorageFailed)
	}
	return ""
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
