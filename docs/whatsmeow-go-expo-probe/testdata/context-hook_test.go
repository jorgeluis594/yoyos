package whatsmeow

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/libsignal/protocol"
	"go.mau.fi/libsignal/signalerror"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

type recoveryContextKey struct{}

type recoveryContext struct {
	Account string
	Info    types.MessageInfo
	Version int
}

// These spies test context transport and error propagation, not native durability.
type contextBuffer struct {
	store.EventBuffer
	lookup, transaction, write context.Context
	writeErr                   error
}

func (s *contextBuffer) GetBufferedEvent(ctx context.Context, _ [32]byte) (*store.BufferedEvent, error) {
	s.lookup = ctx
	return nil, nil
}

func (s *contextBuffer) DoDecryptionTxn(ctx context.Context, fn func(context.Context) error) error {
	s.transaction = ctx
	return fn(ctx)
}

func (s *contextBuffer) PutBufferedEvent(ctx context.Context, _ [32]byte, _ []byte, _ time.Time) error {
	s.write = ctx
	return s.writeErr
}

type canceledSessions struct {
	store.SessionStore
	seen context.Context
}

func (s *canceledSessions) HasSession(ctx context.Context, _ string) (bool, error) {
	s.seen = ctx
	// Stop the real receive path inside the transaction, before requiring keys.
	return false, context.Canceled
}

func recoveryProbeMessage() (types.MessageInfo, waBinary.Node) {
	info := types.MessageInfo{
		MessageSource: types.MessageSource{
			Chat:     types.NewJID("chat", types.HiddenUserServer),
			Sender:   types.NewJID("sender", types.HiddenUserServer),
			IsFromMe: true,
		},
		ID: "message-id", Timestamp: time.Unix(123, 0),
	}
	// Syntactically valid envelope only: this does not authenticate or decrypt it.
	ratchetKey := make([]byte, 33)
	ratchetKey[0] = 5
	ciphertext := pbSerializer.SignalMessage.Serialize(&protocol.SignalMessageStructure{
		Version: 3, RatchetKey: ratchetKey, CipherText: []byte{1}, Mac: make([]byte, 8),
	})
	node := waBinary.Node{Tag: "message", Content: []waBinary.Node{
		{Tag: "enc", Attrs: waBinary.Attrs{"type": "msg", "v": "2"}, Content: ciphertext},
	}}
	node.Attrs = waBinary.Attrs{"id": info.ID, "from": info.Sender}
	return info, node
}

func TestRecoveryContextHook(t *testing.T) {
	info, node := recoveryProbeMessage()
	for _, outcome := range []string{"metadata", "error", "nil-context", "no-hook"} {
		t.Run(outcome, func(t *testing.T) {
			buffer := &contextBuffer{}
			sessions := &canceledSessions{}
			client := NewClient(&store.Device{EventBuffer: buffer, Sessions: sessions}, nil)
			client.EnableDecryptedEventBuffer = true
			calls := 0
			finished := 0
			var finishErr error
			client.MessageReceiveFinished = func(_ context.Context, _ *types.MessageInfo, errorValue error) {
				finished++
				finishErr = errorValue
			}
			if outcome != "no-hook" {
				client.PreDecryptMessage = func(ctx context.Context, got *types.MessageInfo, packet *waBinary.Node) (context.Context, error) {
					calls++
					if outcome == "error" {
						return ctx, errors.New("buffer full")
					}
					if outcome == "nil-context" {
						return nil, nil
					}
					version := packet.GetChildren()[0].AttrGetter().Int("v")
					return context.WithValue(ctx, recoveryContextKey{}, recoveryContext{"account", *got, version}), nil
				}
			}
			client.decryptMessages(context.Background(), &info, &node)
			if finished != 1 {
				t.Fatal("receive completion must be reported once")
			}
			if outcome == "error" || outcome == "nil-context" {
				if calls != 1 || finishErr == nil || buffer.lookup != nil || buffer.transaction != nil || sessions.seen != nil {
					t.Fatal("rejected hook must stop before buffer and session access")
				}
				return
			}
			if buffer.lookup == nil || buffer.transaction == nil || sessions.seen == nil {
				t.Fatal("receive path did not reach the buffer transaction and Signal store")
			}
			if outcome == "no-hook" {
				if calls != 0 || sessions.seen.Value(recoveryContextKey{}) != nil {
					t.Fatal("unset hook changed the receive context")
				}
				return
			}
			for _, ctx := range []context.Context{buffer.lookup, buffer.transaction, sessions.seen} {
				got, ok := ctx.Value(recoveryContextKey{}).(recoveryContext)
				if !ok || got.Account != "account" || got.Info.ID != info.ID || got.Info.Chat != info.Chat || !got.Info.IsFromMe || got.Info.Timestamp != info.Timestamp || got.Version != 2 {
					t.Fatal("recovery metadata did not reach the receive transaction")
				}
			}
			// Exercise the existing successful-plaintext path without real Signal keys.
			failure := errors.New("native storage failed")
			buffer.writeErr = failure
			_, _, err := client.bufferedDecrypt(buffer.transaction, []byte("another envelope"), info.Timestamp,
				func(context.Context) ([]byte, error) { return []byte("plaintext"), nil })
			if !errors.Is(err, failure) || buffer.write == nil || buffer.write.Value(recoveryContextKey{}) == nil {
				t.Fatal("buffer must receive metadata and propagate its write failure")
			}
		})
	}
}

type receiveFailureStore struct {
	store.NoopStore
	phase       string
	cleared     bool
	bufferReads int
	cause       error
}

func (s *receiveFailureStore) GetBufferedEvent(context.Context, [32]byte) (*store.BufferedEvent, error) {
	s.bufferReads++
	switch s.phase {
	case "lookup":
		return nil, fmt.Errorf("lookup: %w", store.ErrLocalStorage)
	case "panic":
		panic("private payload")
	case "clear", "handler-panic":
		// Conversation field containing "x", followed by one byte of padding.
		return &store.BufferedEvent{Plaintext: []byte{0x0a, 0x01, 'x', 0x01}}, nil
	case "message-secret":
		payload, err := proto.Marshal(&waE2E.Message{Conversation: proto.String("x"),
			MessageContextInfo: &waE2E.MessageContextInfo{MessageSecret: []byte{1}}})
		if err != nil {
			return nil, err
		}
		return &store.BufferedEvent{Plaintext: append(payload, 1)}, nil
	}
	return nil, nil
}

func (s *receiveFailureStore) GetLIDForPN(context.Context, types.JID) (types.JID, error) {
	if s.phase == "lid-lookup" {
		return types.EmptyJID, s.cause
	}
	return types.NewJID("sender", types.HiddenUserServer), nil
}

func (s *receiveFailureStore) MigratePNToLID(context.Context, types.JID, types.JID) error {
	return s.cause
}

func (s *receiveFailureStore) PutMessageSecret(context.Context, types.JID, types.JID, types.MessageID, []byte) error {
	return s.cause
}

func (s *receiveFailureStore) DoDecryptionTxn(ctx context.Context, fn func(context.Context) error) error {
	if s.phase == "transaction" {
		return fmt.Errorf("transaction: %w", store.ErrLocalStorage)
	}
	if err := fn(ctx); err != nil {
		return err
	}
	if s.phase == "commit" {
		return fmt.Errorf("commit: %w", store.ErrLocalStorage)
	}
	return nil
}

func (s *receiveFailureStore) HasSession(context.Context, string) (bool, error) {
	if s.phase == "mixed" {
		return false, errors.Join(store.ErrLocalStorage, signalerror.ErrOldCounter)
	}
	if s.phase == "protocol" {
		return false, nil
	}
	return false, fmt.Errorf("session: %w", store.ErrLocalStorage)
}

func (s *receiveFailureStore) PutBufferedEvent(context.Context, [32]byte, []byte, time.Time) error {
	if s.phase == "write" {
		return fmt.Errorf("write: %w", store.ErrLocalStorage)
	}
	return nil
}

func (s *receiveFailureStore) ClearBufferedEventPlaintext(context.Context, [32]byte) error {
	s.cleared = true
	return fmt.Errorf("clear: %w", store.ErrLocalStorage)
}

// With no socket, any attempted ACK/receipt produces these upstream warnings.
type receiveProbeLog struct {
	waLog.Logger
	acks, receipts, errors, leaked atomic.Int32
}

func (l *receiveProbeLog) Warnf(format string, args ...any) {
	if strings.HasPrefix(format, "Failed to send acknowledgement") {
		l.acks.Add(1)
	}
	if strings.HasPrefix(format, "Failed to send receipt") {
		l.receipts.Add(1)
	}
}

func (l *receiveProbeLog) Errorf(format string, args ...any) {
	l.errors.Add(1)
	if strings.Contains(fmt.Sprintf(format, args...), "private payload") {
		l.leaked.Add(1)
	}
}

func TestRecoveryStorageFailure(t *testing.T) {
	for _, synchronous := range []bool{true, false} {
		for _, phase := range []string{"lookup", "transaction", "session", "mixed", "panic", "hook-panic", "clear", "handler-panic", "lid-lookup", "migration-alt", "migration-lookup", "message-secret", "protocol"} {
			// The protocol control uses synchronous ACK so its attempt can be observed without waiting.
			if phase == "protocol" && !synchronous {
				continue
			}
			t.Run(fmt.Sprintf("%s/synchronous=%t", phase, synchronous), func(t *testing.T) {
				info, node := recoveryProbeMessage()
				cause := errors.New("auxiliary native storage failed")
				storage := &receiveFailureStore{phase: phase, cause: cause}
				log := &receiveProbeLog{Logger: waLog.Noop}
				client := NewClient(&store.Device{EventBuffer: storage, Sessions: storage, LIDs: storage, MsgSecrets: storage}, log)
				if phase == "lid-lookup" || strings.HasPrefix(phase, "migration-") {
					info.Sender = types.NewJID("sender", types.DefaultUserServer)
					if phase == "migration-alt" {
						info.SenderAlt = types.NewJID("sender", types.HiddenUserServer)
					}
				}
				client.EnableDecryptedEventBuffer = true
				client.SynchronousAck = synchronous
				// Suppress retries in the protocol control; inspect that the counter stays unchanged on local failures.
				client.messageRetries[info.ID] = 4
				if phase == "hook-panic" {
					client.PreDecryptMessage = func(context.Context, *types.MessageInfo, *waBinary.Node) (context.Context, error) {
						panic("private payload")
					}
				}
				var delivered, undecryptable int
				finished := 0
				var finishErr error
				client.MessageReceiveFinished = func(_ context.Context, got *types.MessageInfo, err error) {
					finished++
					finishErr = err
					if got.ID != info.ID {
						t.Fatal("completion lost message identity")
					}
				}
				client.AddEventHandler(func(evt any) {
					switch evt.(type) {
					case *events.Message:
						delivered++
						if phase == "handler-panic" {
							panic("private payload")
						}
					case *events.UndecryptableMessage:
						undecryptable++
					}
				})
				client.decryptMessages(context.Background(), &info, &node)
				if finished != 1 {
					t.Fatal("receive completion must be reported once")
				}
				if phase == "protocol" {
					if finishErr != nil || log.acks.Load() != 1 || undecryptable != 1 || client.messageRetries[info.ID] != 5 {
						t.Fatal("protocol error lost its existing retry/ACK handling")
					}
					return
				}
				if finishErr == nil {
					t.Fatal("controller did not receive the failure")
				}
				if phase == "panic" || phase == "hook-panic" {
					if !errors.Is(finishErr, ErrMessageReceivePanic) {
						t.Fatal("panic was not classified")
					}
				} else if phase == "handler-panic" {
					if !errors.Is(finishErr, ErrMessageDeliveryFailed) {
						t.Fatal("consumer failure was not classified")
					}
				} else if !errors.Is(finishErr, store.ErrLocalStorage) {
					t.Fatal("local storage classification was lost")
				}
				if phase == "lid-lookup" || strings.HasPrefix(phase, "migration-") || phase == "message-secret" {
					if !errors.Is(finishErr, cause) {
						t.Fatal("auxiliary storage cause was lost")
					}
					if phase != "message-secret" && storage.bufferReads != 0 {
						t.Fatal("decryption continued after failed migration/lookup")
					}
					if storage.cleared {
						t.Fatal("pending content was cleared after auxiliary failure")
					}
				}
				if log.acks.Load() != 0 || log.receipts.Load() != 0 || undecryptable != 0 || client.messageRetries[info.ID] != 4 {
					t.Fatal("local failure attempted a protocol acknowledgement or retry")
				}
				wantDelivered := 0
				if phase == "clear" || phase == "handler-panic" {
					wantDelivered = 1
				}
				if delivered != wantDelivered || log.leaked.Load() != 0 {
					t.Fatal("unexpected delivery or sensitive panic diagnostic")
				}
				if phase == "handler-panic" && storage.cleared {
					t.Fatal("panicking consumer caused pending content to be cleared")
				}
				if phase != "clear" && phase != "lid-lookup" && !strings.HasPrefix(phase, "migration-") && phase != "message-secret" && log.errors.Load() == 0 {
					t.Fatal("receive path was not exercised through its failure handler")
				}
			})
		}
	}
	for _, phase := range []string{"write", "commit"} {
		t.Run(phase+"-propagation", func(t *testing.T) {
			storage := &receiveFailureStore{phase: phase}
			client := NewClient(&store.Device{EventBuffer: storage}, nil)
			client.EnableDecryptedEventBuffer = true
			_, _, err := client.bufferedDecrypt(context.Background(), []byte("envelope"), time.Unix(123, 0),
				func(context.Context) ([]byte, error) { return []byte("plaintext"), nil })
			if !errors.Is(err, store.ErrLocalStorage) {
				t.Fatal("local write/commit classification was lost")
			}
		})
	}
}
