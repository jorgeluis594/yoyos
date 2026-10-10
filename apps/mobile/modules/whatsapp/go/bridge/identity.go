package bridge

import (
	"context"

	"go.mau.fi/whatsmeow/store"
	"yoyos-whatsapp/internal/connection"
	"yoyos-whatsapp/internal/identity"
	"yoyos-whatsapp/internal/protocolstore"
)

// startIdentity wires the late PN/LID resolution of this account. A pass runs when the
// session opens, so a restart re-evaluates entries kept earlier, and afterwards only
// when a mapping is stored or content is kept without identity: there is no polling.
func (s *ConnectionSession) startIdentity(delivery *DeliverySession) {
	s.identity = identity.NewService(delivery.ledger, s.identitySource, identity.Hooks{
		Unavailable: func() { s.controller.Notify(connection.IdentityUnavailable) },
		Resolved:    delivery.coordinator.Refresh,
		Failure:     func(err error) { s.controller.FailLocal(connection.Code(publicCode(err))) },
	})
	s.watchMappings()
	s.identity.Trigger()
}

func (s *ConnectionSession) identityTrigger() {
	if s.identity != nil {
		s.identity.Trigger()
	}
}

// accountStore is the protocol store that holds this account's mappings.
func (s *ConnectionSession) accountStore() (*protocolstore.Store, *store.Device) {
	s.mu.Lock()
	defer s.mu.Unlock()
	protocol := s.store
	if protocol == nil && s.device != nil {
		protocol, _ = s.device.Container.(*protocolstore.Store)
	}
	return protocol, s.device
}

func (s *ConnectionSession) identitySource() (identity.Account, *store.Device) {
	protocol, device := s.accountStore()
	if protocol == nil {
		return nil, nil
	}
	return protocol, device
}

// watchMappings points the mapping commits of the current store, or of the store the
// first link will create, at the resolution service.
func (s *ConnectionSession) watchMappings() {
	s.mu.Lock()
	var source any
	if s.store != nil {
		source = s.store
	} else if s.device != nil {
		source = s.device.Container
	}
	s.mu.Unlock()
	if watched, ok := source.(interface{ SetMappingHook(func()) }); ok {
		watched.SetMappingHook(s.identity.Trigger)
	}
}

// ResolveIdentities applies every verifiable mapping already stored to the pending
// entries of this account and returns once their definitive identities are durable. It is
// what must run before credentials are retired; it returns a public error code or "".
func (s *ConnectionSession) ResolveIdentities() string {
	if s == nil || s.identity == nil {
		return "NOT_INITIALIZED"
	}
	if _, err := s.identity.Resolve(context.Background()); err != nil {
		return publicCode(err)
	}
	return ""
}
