// Package bridge is a disposable binding probe, not the production WhatsApp API.
package bridge

import (
	"encoding/json"
	"errors"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
)

// Storage is implemented by the native side of the generated bindings.
type Storage interface {
	Commit(snapshot string) error
}

// DependencyProbe links whatsmeow without connecting or using account credentials.
func DependencyProbe() bool {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	return !client.IsConnected()
}

// CommitProbe verifies the cross-language callback and error signature.
func CommitProbe(storage Storage, snapshot string) error {
	if storage == nil || !json.Valid([]byte(snapshot)) {
		return errors.New("invalid probe input")
	}
	return storage.Commit(snapshot)
}
