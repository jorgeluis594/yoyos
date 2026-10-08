package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"go.mau.fi/whatsmeow/store"
	"yoyos-whatsapp/internal/connection"
	"yoyos-whatsapp/internal/protocolstore"
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
	store      *protocolstore.Store
	device     *store.Device
}
type ConnectionOpenResult struct {
	Session *ConnectionSession
	Code    string
}

func OpenConnection(storage ProtocolStorage, sink ConnectionEvents, generationID, accountID string, readRecoveryBytes, newRecoveryBytes int64) *ConnectionOpenResult {
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
	session := &ConnectionSession{store: protocol, device: device}
	var failedCallback sync.Once
	session.controller = connection.New(func() (connection.Transport, error) {
		return connection.NewWhatsmeowTransport(device, func() connection.Code { return connection.Code(session.StopReason()) }), nil
	}, func(event connection.Event) {
		raw, _ := json.Marshal(connectionEvent(event))
		defer func() {
			if recover() != nil {
				failedCallback.Do(func() { session.controller.FailLocal(connection.ConsumerUnavailable) })
			}
		}()
		sink.OnConnectionEvent(string(raw))
	}, nil)
	session.controller.Prepare(accountID != "")
	return &ConnectionOpenResult{Session: session}
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
	return string(s.controller.Connect())
}
func (s *ConnectionSession) Disconnect() {
	if s != nil && s.controller != nil {
		s.controller.Disconnect()
	}
}
func (s *ConnectionSession) Close() {
	if s != nil && s.controller != nil {
		s.controller.Close()
	}
}
func (s *ConnectionSession) State() string {
	if s == nil || s.controller == nil {
		return string(connection.Disconnected)
	}
	return string(s.controller.State())
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
	protocol := s.store
	if protocol == nil {
		protocol, _ = s.device.Container.(*protocolstore.Store)
	}
	if protocol == nil {
		return ""
	}
	if err := protocol.StopReason(); err != nil {
		return publicCode(err)
	}
	return ""
}
