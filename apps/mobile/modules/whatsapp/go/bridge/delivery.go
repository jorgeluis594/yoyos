package bridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"yoyos-whatsapp/internal/connection"
	"yoyos-whatsapp/internal/delivery"
	"yoyos-whatsapp/internal/protocolstore"
)

// DeliveryStorage reads and retires pending entries without any generation,
// session or network, so recovery and confirmation survive an invalid session
// or another active account.
type DeliveryStorage interface {
	ReadPending(request string) (string, error)
	RetirePending(request string) (string, error)
}

// DeliveryEvents is implemented by the platform module. OnDelivery returns once
// the callback accepted the event; an error keeps the pending entry and stops emission.
type DeliveryEvents interface{ OnDelivery(value string) error }

type deliveryEnvelope struct {
	ContractVersion int    `json:"contractVersion"`
	Event           string `json:"event"`
	Consumer        string `json:"consumer"`
	Payload         any    `json:"payload"`
}

// DeliverySession is the single delivery coordinator for local recovery and new receptions.
type DeliverySession struct {
	ledger      *protocolstore.Ledger
	coordinator *delivery.Coordinator
	sink        DeliveryEvents
	mu          sync.Mutex
	connection  *ConnectionSession
}

type DeliveryOpenResult struct {
	Session *DeliverySession
	Code    string
}

// OpenDelivery validates the budget and prepares recovery. Start releases it once storage is prepared.
func OpenDelivery(storage DeliveryStorage, sink DeliveryEvents, recoveryBytes int64) *DeliveryOpenResult {
	if storage == nil || sink == nil {
		return &DeliveryOpenResult{Code: "INVALID_INPUT"}
	}
	ledger, err := protocolstore.NewLedger(storage, recoveryBytes)
	if err != nil {
		return &DeliveryOpenResult{Code: publicCode(err)}
	}
	session := &DeliverySession{ledger: ledger, sink: sink}
	session.coordinator = delivery.New(ledger, recoveryBytes, delivery.Hooks{Stop: session.stop, Resume: session.resume})
	return &DeliveryOpenResult{Session: session}
}

func (s *DeliverySession) stop(cause delivery.Cause, _ error) {
	code := connection.ConsumerUnavailable
	if cause == delivery.ReadFailed {
		code = connection.SessionStorageFailed
	}
	if active := s.active(); active != nil {
		active.controller.FailLocal(code)
	}
}
func (s *DeliverySession) resume() {
	if active := s.active(); active != nil {
		active.resumeCapacity()
	}
}
func (s *DeliverySession) active() *ConnectionSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.connection
}
func (s *DeliverySession) attach(c *ConnectionSession) {
	s.mu.Lock()
	s.connection = c
	s.mu.Unlock()
}
func (s *DeliverySession) detach(c *ConnectionSession) {
	s.mu.Lock()
	if s.connection == c {
		s.connection = nil
	}
	s.mu.Unlock()
}

// Start declares storage prepared; it never waits for a confirmation.
func (s *DeliverySession) Start() {
	if s != nil {
		s.coordinator.Start()
	}
}

// SetConsumer registers the single active consumer, replacing any previous one.
func (s *DeliverySession) SetConsumer(token string) string {
	if s == nil || token == "" {
		return "INVALID_INPUT"
	}
	s.coordinator.SetConsumer(delivery.Consumer{Token: token, Emit: func(d delivery.Delivery) (err error) {
		defer func() {
			if recovered := recover(); recovered != nil {
				err = fmt.Errorf("delivery callback panicked")
			}
		}()
		raw, err := json.Marshal(deliveryEnvelope{1, "messageReceived", token, struct {
			DeliveryID string          `json:"deliveryId"`
			Message    json.RawMessage `json:"message"`
		}{d.ID, d.Message}})
		if err != nil {
			return err
		}
		return s.sink.OnDelivery(string(raw))
	}})
	return ""
}

// RemoveConsumer is ignored when the token belongs to a replaced subscription.
func (s *DeliverySession) RemoveConsumer(token string) {
	if s != nil {
		s.coordinator.RemoveConsumer(token)
	}
}

// Confirm returns "" once the entry is durably gone or was valid but absent.
func (s *DeliverySession) Confirm(deliveryID string) string {
	if s == nil {
		return "NOT_INITIALIZED"
	}
	err := s.coordinator.Confirm(deliveryID)
	switch {
	case err == nil:
		return ""
	case errors.Is(err, delivery.ErrInvalidDeliveryID):
		return "INVALID_INPUT"
	default:
		return publicCode(err)
	}
}

func (s *DeliverySession) Close() {
	if s != nil {
		s.coordinator.Close()
	}
}
