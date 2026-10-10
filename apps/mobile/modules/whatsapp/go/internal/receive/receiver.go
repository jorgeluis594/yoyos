// Package receive connects the patched whatsmeow receive path to durable
// admission, normalization and the delivery coordinator.
//
// Order for one live message, each step starting only after the previous one is durable:
//
//	protocol + content commit (PreDecrypt capture, DoDecryptionTxn)
//	  -> messageReceived emission (delivery coordinator)
//	  -> consumer commit (outside this module)
//	  -> confirmMessageStored: durable retirement of the pending entry
//	  -> handler success, which is the permission to acknowledge the protocol.
package receive

import (
	"context"
	"encoding/json"
	"errors"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/delivery"
	"yoyos-whatsapp/internal/normalization"
	"yoyos-whatsapp/internal/protocolstore"
)

// Hooks translate receive-side faults into connection decisions.
type Hooks struct {
	// Capacity pauses reception; the coordinator resumes it when the entry would fit.
	Capacity func()
	// Oversize stops reception: no amount of freed space admits the entry.
	Oversize func()
	// LocalFailure stops reception for a local persistence failure.
	LocalFailure func(error)
}

type Receiver struct {
	device      *store.Device
	ledger      delivery.Ledger
	coordinator *delivery.Coordinator
	hooks       Hooks
	processor   protocolstore.RecoveryProcessor
}

func New(device *store.Device, ledger delivery.Ledger, coordinator *delivery.Coordinator, hooks Hooks) *Receiver {
	return &Receiver{device: device, ledger: ledger, coordinator: coordinator, hooks: hooks}
}

// SetProcessor supplies the client that replays protocol effects of recovered content.
func (r *Receiver) SetProcessor(processor protocolstore.RecoveryProcessor) { r.processor = processor }

func (r *Receiver) account() string {
	if r.device == nil || r.device.LID.IsEmpty() {
		return ""
	}
	return r.device.LID.ToNonAD().String()
}

// PreDecrypt copies every encrypted child before Signal state advances.
func (r *Receiver) PreDecrypt(ctx context.Context, info *types.MessageInfo, node *waBinary.Node) (context.Context, error) {
	if r.processor == nil {
		return nil, errors.New("receive processor missing")
	}
	return protocolstore.CaptureReceive(ctx, r.account(), info, node, r.build, r.processor)
}

// build runs inside the decryption transaction and must not touch the store.
func (r *Receiver) build(captured protocolstore.CapturedReceive, child protocolstore.CapturedChild, plaintext []byte) (string, json.RawMessage, error) {
	if child.Format != "v2" {
		return "excluded", nil, nil
	}
	var message waE2E.Message
	if err := proto.Unmarshal(plaintext, &message); err != nil {
		return "excluded", nil, nil
	}
	info, err := protocolstore.ParseReceiveInfo(captured)
	if err != nil {
		return "", nil, err
	}
	event := (&events.Message{Info: *info, RawMessage: &message}).UnwrapRaw()
	result, err := normalization.Normalize(event, r.device.ID.ToNonAD(), r.device.LID, nil)
	switch {
	case errors.Is(err, normalization.ErrInvalidTimestamp), errors.Is(err, normalization.ErrInvalidIdentity), errors.Is(err, normalization.ErrRawEditInspectionExhausted):
		// Content that cannot be given a valid public identity is never deliverable.
		return "excluded", nil, nil
	case err != nil:
		return "", nil, err
	case result.Unresolved != nil:
		return "pendingLid", nil, nil
	case result.Message == nil:
		return "excluded", nil, nil
	}
	raw, err := json.Marshal(result.Message)
	if err != nil {
		return "", nil, err
	}
	return "resolved", raw, nil
}

// Handle is the protocol handler: true allows the acknowledgement. It waits
// without any store lock, for the retirement of this message's delivery.
func (r *Receiver) Handle(ctx context.Context, event any) bool {
	message, ok := event.(*events.Message)
	if !ok {
		return true
	}
	record, found, err := r.find(message.Info)
	if err != nil {
		// The ACK stays withheld and the unreadable ledger is a storage failure, not absence.
		if r.hooks.LocalFailure != nil {
			go r.hooks.LocalFailure(err)
		}
		return false
	}
	if !found {
		return true
	}
	if record.IdentityState != "resolved" {
		return false
	}
	return r.coordinator.Await(ctx, record.DeliveryID) == delivery.Retired
}

// find returns the newest live pending entry of this account for the protocol message.
// An unreadable ledger is an error: it is never treated as "no pending entry".
func (r *Receiver) find(info types.MessageInfo) (protocolstore.PendingRecord, bool, error) {
	pending, err := r.ledger.Pending()
	if err != nil {
		return protocolstore.PendingRecord{}, false, err
	}
	account := r.account()
	var best *protocolstore.PendingRecord
	for i := range pending {
		candidate := &pending[i]
		if candidate.AccountID != account || candidate.Source != "live" || !matches(candidate, info) {
			continue
		}
		if best == nil || later(candidate, best) {
			best = candidate
		}
	}
	if best == nil {
		return protocolstore.PendingRecord{}, false, nil
	}
	return *best, true, nil
}

func later(a, b *protocolstore.PendingRecord) bool {
	probe := []protocolstore.PendingRecord{*b, *a}
	protocolstore.SortPending(probe)
	return probe[1].DeliveryID == a.DeliveryID
}

func matches(record *protocolstore.PendingRecord, info types.MessageInfo) bool {
	var stored struct {
		ID   string `json:"id"`
		Chat string `json:"chat"`
	}
	if json.Unmarshal([]byte(record.Recovery.MessageInfoJSON), &stored) != nil {
		return false
	}
	return stored.ID == info.ID && stored.Chat == info.Chat.String()
}

// Finished classifies the end of a receive so capacity and storage faults stop the right thing.
func (r *Receiver) Finished(_ context.Context, _ *types.MessageInfo, err error) {
	if err == nil {
		return
	}
	var typed *protocolstore.Error
	if errors.As(err, &typed) && typed.Code == protocolstore.BufferFull {
		if typed.Oversize {
			r.coordinator.ClearCapacityWait()
			callAsync(r.hooks.Oversize)
			return
		}
		// Pause first, then register the wait: a confirmation that frees space in between
		// would otherwise ask to resume a connection that is not paused yet and be lost.
		needed := typed.Needed
		go func() {
			call(r.hooks.Capacity)
			r.coordinator.WaitForCapacity(needed)
		}()
		return
	}
	if errors.Is(err, store.ErrLocalStorage) && r.hooks.LocalFailure != nil {
		go r.hooks.LocalFailure(err)
	}
}

// call runs a connection decision off the receive goroutine: stopping the client
// waits for the handler queue, which this very goroutine is still draining.
func call(fn func()) {
	if fn != nil {
		fn()
	}
}

// callAsync runs a connection decision off the receive goroutine.
func callAsync(fn func()) {
	if fn != nil {
		go fn()
	}
}
