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
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"yoyos-whatsapp/internal/delivery"
	"yoyos-whatsapp/internal/history"
	"yoyos-whatsapp/internal/identity"
	"yoyos-whatsapp/internal/protocolstore"
)

// Hooks translate receive-side faults into connection decisions.
type Hooks struct {
	// Capacity pauses reception; the coordinator resumes it when the entry would fit.
	Capacity func()
	// Oversize stops reception: no amount of freed space admits the entry.
	Oversize func()
	// IdentityPending reports that content was kept without a definitive identity.
	IdentityPending func()
	// LocalFailure stops reception for a local persistence failure.
	LocalFailure func(error)
	// HistoryRejected reports a history batch refused for good (HISTORY_LIMIT_REACHED,
	// RECOVERY_BUFFER_FULL or an invalid batch). Reception continues.
	HistoryRejected func(history.Code)
	// HistoryAdmitted runs after a history batch was published and is ready to be delivered;
	// identityPending says that part of it still waits for a mapping.
	HistoryAdmitted func(identityPending bool)
}

type Receiver struct {
	device      *store.Device
	ledger      delivery.Ledger
	coordinator *delivery.Coordinator
	hooks       Hooks
	processor   protocolstore.RecoveryProcessor
	history     *history.Processor
}

func New(device *store.Device, ledger delivery.Ledger, coordinator *delivery.Coordinator, hooks Hooks) *Receiver {
	return &Receiver{device: device, ledger: ledger, coordinator: coordinator, hooks: hooks}
}

// SetProcessor supplies the client that replays protocol effects of recovered content.
func (r *Receiver) SetProcessor(processor protocolstore.RecoveryProcessor) { r.processor = processor }

// EnableHistory attaches the history processor, built over the account's store and the network
// side of this connection. Without it, notifications are still captured durably and wait.
func (r *Receiver) EnableHistory(remote history.Remote, protocol history.Store, limits history.Limits) {
	r.history = history.NewProcessor(r.account, r.historyEnv, limits, remote, protocol, r.ledger, r.coordinator, history.Hooks{
		Rejected: r.hooks.HistoryRejected,
		Admitted: func(identityPending bool) {
			r.coordinator.Refresh()
			if r.hooks.HistoryAdmitted != nil {
				r.hooks.HistoryAdmitted(identityPending)
			}
		},
		Failure: func(err error) {
			if r.hooks.LocalFailure != nil {
				r.hooks.LocalFailure(err)
			}
		},
	})
}

func (r *Receiver) historyEnv() history.Env {
	return history.Env{Account: r.account(), Own: r.device.ID.ToNonAD(), OwnAlt: r.device.LID}
}

// RunHistory serves the history processor until ctx, the connection generation, ends.
func (r *Receiver) RunHistory(ctx context.Context) {
	if r.history != nil {
		r.history.Trigger() // captured notifications of an earlier life are resumed
		r.history.Run(ctx)
	}
}

// Connected is called when the connection is established: captures left by an interruption resume.
func (r *Receiver) Connected() {
	if r.history != nil {
		r.history.Trigger()
	}
}

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
		return string(identity.Excluded), nil, nil
	}
	info, err := protocolstore.ParseReceiveInfo(captured)
	if err != nil {
		return "", nil, err
	}
	state, message, err := identity.Classify(info, child.Format, plaintext, r.device.ID.ToNonAD(), r.device.LID, nil)
	return string(state), message, err
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
	if protocolstore.IsHistoryNotification(record.PendingInsert) {
		// The notification is durable: that, and not the batch, is what the acknowledgement
		// needs. The hist_sync receipt and the remote deletion follow the batch's admission.
		if r.history != nil {
			r.history.Trigger()
		}
		return true
	}
	if record.IdentityState != "resolved" {
		// No ACK for content without a definitive identity; a resolution pass completes it
		// when its mapping arrives. The protocol ACK is only sent when the protocol redelivers the
		// message (normally after reconnecting), never earlier.
		callAsync(r.hooks.IdentityPending)
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
		if candidate.AccountID != account || !(candidate.Source == "live" || protocolstore.IsHistoryNotification(candidate.PendingInsert)) || !matches(candidate, info) {
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
