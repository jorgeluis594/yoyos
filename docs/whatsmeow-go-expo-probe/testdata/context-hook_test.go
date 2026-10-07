package whatsmeow

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mau.fi/libsignal/protocol"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
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

func TestRecoveryContextHook(t *testing.T) {
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

	for _, outcome := range []string{"metadata", "error", "nil-context", "no-hook"} {
		t.Run(outcome, func(t *testing.T) {
			buffer := &contextBuffer{}
			sessions := &canceledSessions{}
			client := NewClient(&store.Device{EventBuffer: buffer, Sessions: sessions}, nil)
			client.EnableDecryptedEventBuffer = true
			calls := 0
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
			if outcome == "error" || outcome == "nil-context" {
				if calls != 1 || buffer.lookup != nil || buffer.transaction != nil || sessions.seen != nil {
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
