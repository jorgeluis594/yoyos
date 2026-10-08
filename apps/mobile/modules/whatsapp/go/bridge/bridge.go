// Package bridge is the gomobile boundary. Protocol types remain internal to Go.
package bridge

import (
	"encoding/json"

	"yoyos-whatsapp/internal"
)

// Storage is implemented by the native platform and called synchronously by Go.
type Storage interface {
	Commit(value string) (string, error)
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
