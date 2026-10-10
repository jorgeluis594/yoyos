package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"go.mau.fi/whatsmeow/store"
	"yoyos-whatsapp/internal/connection"
	"yoyos-whatsapp/internal/identity"
	"yoyos-whatsapp/internal/protocolstore"
	"yoyos-whatsapp/internal/receive"
)

// ConnectionEvents is implemented by the platform module; only versioned JSON crosses gomobile.
type ConnectionEvents interface{ OnConnectionEvent(value string) }
type connectionEnvelope struct {
	ContractVersion int    `json:"contractVersion"`
	Event           string `json:"event"`
	Payload         any    `json:"payload"`
}
type ConnectionSession struct {
	controller *connection.Controller
	mu         sync.Mutex
	store      *protocolstore.Store
	device     *store.Device
	delivery   *DeliverySession
	identity   *identity.Service
	firstLink  firstLink
	reopen     func() (*protocolstore.Store, *store.Device, error)
}

// firstLink is the container of a device that is not paired yet; it hands out the store pairing creates.
type firstLink interface {
	LinkedStore() *protocolstore.Store
	SetMappingHook(func())
}
type ConnectionOpenResult struct {
	Session *ConnectionSession
	Code    string
}

func OpenConnection(storage ProtocolStorage, sink ConnectionEvents, generationID, accountID string, readRecoveryBytes, newRecoveryBytes int64) *ConnectionOpenResult {
	return OpenConnectionWithDelivery(storage, sink, nil, generationID, accountID, readRecoveryBytes, newRecoveryBytes)
}

// OpenConnectionWithDelivery also receives messages: their durable admission and
// confirmable delivery go through the shared delivery coordinator.
func OpenConnectionWithDelivery(storage ProtocolStorage, sink ConnectionEvents, delivery *DeliverySession, generationID, accountID string, readRecoveryBytes, newRecoveryBytes int64) *ConnectionOpenResult {
	if storage == nil || sink == nil {
		return &ConnectionOpenResult{Code: "INVALID_INPUT"}
	}
	var device *store.Device
	var protocol *protocolstore.Store
	var err error
	if accountID == "" {
		device, err = protocolstore.NewFirstLinkDevice(storage, generationID, readRecoveryBytes, newRecoveryBytes)
	} else {
		protocol, err = protocolstore.Open(storage, generationID, accountID, readRecoveryBytes, newRecoveryBytes)
		if err == nil {
			device, err = protocol.RestoreDevice(context.Background())
		}
		if err == nil && device == nil {
			return &ConnectionOpenResult{Code: "SESSION_STATE_INVALID"}
		}
	}
	if err != nil {
		return &ConnectionOpenResult{Code: publicCode(err)}
	}
	session := &ConnectionSession{store: protocol, device: device, delivery: delivery}
	if protocol == nil {
		session.firstLink, _ = device.Container.(firstLink)
	}
	session.reopen = func() (*protocolstore.Store, *store.Device, error) {
		account := accountID
		if account == "" {
			session.mu.Lock()
			current := session.device
			session.mu.Unlock()
			if current == nil || current.LID.IsEmpty() {
				return nil, nil, errors.New("account unknown")
			}
			account = current.LID.ToNonAD().String()
		}
		reopened, err := protocolstore.Open(storage, generationID, account, readRecoveryBytes, newRecoveryBytes)
		if err != nil {
			return nil, nil, err
		}
		restored, err := reopened.RestoreDevice(context.Background())
		if err == nil && restored == nil {
			err = errors.New("device missing")
		}
		return reopened, restored, err
	}
	var failedCallback sync.Once
	session.controller = connection.New(session.newTransport, func(event connection.Event) {
		raw, _ := json.Marshal(connectionEvent(event))
		defer func() {
			if recover() != nil {
				failedCallback.Do(func() { session.controller.FailLocal(connection.ConsumerUnavailable) })
			}
		}()
		sink.OnConnectionEvent(string(raw))
	}, nil)
	session.controller.SetUnlinkTransport(session.newUnlinkTransport)
	session.controller.Prepare(accountID != "")
	if delivery != nil {
		delivery.attach(session)
		session.startIdentity(delivery)
	}
	return &ConnectionOpenResult{Session: session}
}

// newTransport builds one connection attempt. After a capacity stop the store is
// latched, so the attempt starts again from the last confirmed revision.
func (s *ConnectionSession) newTransport() (connection.Transport, error) {
	s.mu.Lock()
	rebuild := s.stoppedLocked() == "RECOVERY_BUFFER_FULL" && s.reopen != nil
	s.mu.Unlock()
	if rebuild {
		// Reading native state happens outside every lock.
		reopened, device, err := s.reopen()
		if err != nil {
			return nil, err
		}
		s.mu.Lock()
		s.store, s.device = reopened, device
		s.mu.Unlock()
	}
	s.mu.Lock()
	device := s.device
	s.mu.Unlock()
	stopReason := func() connection.Code { return connection.Code(s.StopReason()) }
	if s.delivery == nil {
		return connection.NewWhatsmeowTransport(device, stopReason), nil
	}
	if s.identity != nil {
		s.watchMappings()
	}
	receiver := receive.New(device, s.delivery.ledger, s.delivery.coordinator, receive.Hooks{
		Capacity:        s.controller.PauseForCapacity,
		Oversize:        func() { s.controller.FailLocal(connection.RecoveryBufferFull) },
		IdentityPending: s.identityTrigger,
		LocalFailure:    func(err error) { s.controller.FailLocal(connection.Code(publicCode(err))) },
	})
	return connection.NewWhatsmeowTransport(device, stopReason, receiver), nil
}

// newUnlinkTransport builds a client that connects only to unlink: it decrypts and acknowledges
// nothing (see connection.NewUnlinkTransport).
func (s *ConnectionSession) newUnlinkTransport() (connection.Transport, error) {
	s.mu.Lock()
	device := s.device
	s.mu.Unlock()
	if device == nil {
		return nil, errors.New("device unknown")
	}
	return connection.NewUnlinkTransport(device, func() connection.Code { return connection.Code(s.StopReason()) }), nil
}

func (s *ConnectionSession) resumeCapacity() {
	if s != nil && s.controller != nil {
		s.controller.ResumeCapacity()
	}
}

func connectionEvent(event connection.Event) any {
	if event.Error != "" {
		code := string(event.Error)
		if event.Error == connection.ConsumerUnavailable {
			code = "NATIVE_CALL_FAILED"
		}
		return connectionEnvelope{1, "error", struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}{code, "WhatsApp connection failed"}}
	}
	if event.QR != "" {
		return connectionEnvelope{1, "qr", struct {
			Value     string `json:"value"`
			ExpiresAt int64  `json:"expiresAt"`
		}{event.QR, event.ExpiresAt}}
	}
	return connectionEnvelope{1, "connectionChanged", struct {
		State connection.State `json:"state"`
	}{event.State}}
}
func publicCode(err error) string {
	var typed *protocolstore.Error
	if errors.As(err, &typed) {
		switch typed.Code {
		case protocolstore.StateInvalid:
			return "SESSION_STATE_INVALID"
		case protocolstore.StorageFailed, protocolstore.UncertainCommit, protocolstore.SessionRevisionMismatch, protocolstore.StaleGeneration:
			return "SESSION_STORAGE_FAILED"
		case protocolstore.SessionFull:
			return "SESSION_STORAGE_LIMIT_REACHED"
		case protocolstore.BufferFull:
			return "RECOVERY_BUFFER_FULL"
		case protocolstore.InvalidRequest:
			return "INVALID_INPUT"
		}
	}
	return "NATIVE_CALL_FAILED"
}
func (s *ConnectionSession) Connect() string {
	if s == nil || s.controller == nil {
		return "NOT_INITIALIZED"
	}
	if s.identity != nil {
		// A new request is a new listener scope: unresolved content is reported again, once.
		s.identity.Rearm()
		s.identity.Trigger()
	}
	return publicConnectCode(s.controller.Connect())
}

// publicConnectCode keeps connect() inside the public error codes; the local consumer
// fault is reported like the same fault in connectionEvent.
func publicConnectCode(code connection.Code) string {
	if code == connection.ConsumerUnavailable {
		return "NATIVE_CALL_FAILED"
	}
	return string(code)
}
func (s *ConnectionSession) Disconnect() {
	if s != nil && s.controller != nil {
		s.controller.Disconnect()
	}
}

// Logout stops reception and generation, completes the identity mappings that are still
// verifiable and asks WhatsApp to unlink within 15 seconds. It returns "" only when the
// remote unlink was confirmed, "REMOTE_LOGOUT_UNCONFIRMED" when it was not, and a public
// error code when the mappings could not be made durable; then nothing was retired. A repeat
// after a finished logout is a local success that certifies nothing remote. Native
// retires the session and its key afterwards, in every case but the last.
func (s *ConnectionSession) Logout() string {
	if s == nil || s.controller == nil {
		return "NOT_INITIALIZED"
	}
	result := s.controller.Logout(s.resolveBeforeLogout)
	switch {
	case result.Err != nil:
		return publicCode(result.Err)
	case !result.Confirmed && !result.Repeat:
		return "REMOTE_LOGOUT_UNCONFIRMED"
	}
	return ""
}

// MarkRevoked tells a session reopened only to log out that the server already revoked it, so
// no connection is made to unlink it. It changes no state and publishes nothing.
func (s *ConnectionSession) MarkRevoked() {
	if s != nil && s.controller != nil {
		s.controller.MarkRevoked()
	}
}

func (s *ConnectionSession) resolveBeforeLogout() error {
	if s.identity == nil {
		return nil
	}
	_, err := s.identity.Resolve(context.Background())
	return err
}

func (s *ConnectionSession) Close() bool {
	if s != nil && s.identity != nil {
		s.identity.Close()
	}
	if s != nil && s.delivery != nil {
		s.delivery.detach(s)
	}
	if s != nil && s.controller != nil {
		return s.controller.Close()
	}
	return false
}
func (s *ConnectionSession) State() string {
	if s == nil || s.controller == nil {
		return string(connection.Disconnected)
	}
	return string(s.controller.State())
}
func (s *ConnectionSession) CanUpdateOptions() bool {
	return s != nil && s.controller != nil && s.controller.CanUpdateOptions()
}
func (s *ConnectionSession) CurrentQR() string {
	if s == nil || s.controller == nil {
		return ""
	}
	event, valid := s.controller.CurrentQR()
	if !valid {
		return ""
	}
	raw, _ := json.Marshal(struct {
		Value     string `json:"value"`
		ExpiresAt int64  `json:"expiresAt"`
	}{event.QR, event.ExpiresAt})
	return string(raw)
}
func (s *ConnectionSession) RetiredSession() {
	if s != nil && s.controller != nil {
		s.controller.RetiredSession()
	}
}
func (s *ConnectionSession) StopReason() string {
	if s == nil {
		return ""
	}
	s.mu.Lock()
	device, protocol := s.device, s.store
	s.mu.Unlock()
	return stopReason(device, protocol)
}

// stoppedLocked is StopReason for callers that already hold s.mu.
func (s *ConnectionSession) stoppedLocked() string { return stopReason(s.device, s.store) }

func stopReason(device *store.Device, protocol *protocolstore.Store) string {
	if source, ok := device.Container.(interface{ StopReason() error }); ok {
		if err := source.StopReason(); err != nil {
			return publicCode(err)
		}
	}
	if protocol == nil {
		protocol, _ = device.Container.(*protocolstore.Store)
	}
	if protocol == nil {
		return ""
	}
	if err := protocol.StopReason(); err != nil {
		return publicCode(err)
	}
	return ""
}
