package internal

import (
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
)

// DependencyReady proves the pinned client can be constructed without connecting.
func DependencyReady() bool {
	return !whatsmeow.NewClient(&store.Device{}, nil).IsConnected()
}
