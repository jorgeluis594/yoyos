// Package bridge is the gomobile boundary. Protocol types remain internal to Go.
package bridge

import (
	"encoding/json"
	"errors"

	"yoyos-whatsapp/internal"
)

// Storage is implemented by the native platform and called synchronously by Go.
type Storage interface {
	Commit(value string) (string, error)
}

// Probe exercises a real whatsmeow dependency and a round trip through native code.
func Probe(storage Storage, value string) (string, error) {
	if storage == nil || !json.Valid([]byte(value)) {
		return "", errors.New("invalid probe input")
	}
	if !internal.DependencyReady() {
		return "", errors.New("unexpected connected probe client")
	}
	return storage.Commit(value)
}
