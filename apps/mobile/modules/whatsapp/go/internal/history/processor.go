package history

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sync"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/protocolstore"
)

// Remote is the network side of a batch. Each method is one separately observable step:
// the download, the history receipt and the remote deletion are never bundled.
type Remote interface {
	// Fetch returns the decompressed protobuf, bounded while it is received and inflated.
	Fetch(context.Context, *waE2E.HistorySyncNotification) ([]byte, error)
	Parse(types.JID, *waWeb.WebMessageInfo) (*events.Message, error)
	// Stage applies the batch's protocol effects to the stores of the context.
	Stage(context.Context, *waHistorySync.HistorySync) error
	// Receipt sends the hist_sync receipt of the notification message.
	Receipt(context.Context, types.MessageID) error
	// Delete asks WhatsApp to remove the remote batch.
	Delete(context.Context, *waE2E.HistorySyncNotification) error
}

// Store is the account's protocol store.
type Store interface {
	AdmitHistoryBatch(context.Context, protocolstore.HistoryBatch) error
	HistoryAdmitted([32]byte) (bool, error)
	GetManyLIDsForPNs(context.Context, []types.JID) (map[types.JID]types.JID, error)
	CheckLIDMappings(context.Context, []store.LIDMapping) error
	RecoveryBudget() int64
}

type Ledger interface {
	Pending() ([]protocolstore.PendingRecord, error)
	Retire(string) (bool, error)
}

// Capacity blocks until a rejected admission of the given size would fit; it never polls.
type Capacity interface {
	AwaitCapacity(ctx context.Context, needed int64) error
	CapacityFreed()
}

// Code is the public code of a rejected batch.
type Code string

const (
	CodeLimit      Code = "HISTORY_LIMIT_REACHED"
	CodeBufferFull Code = "RECOVERY_BUFFER_FULL"
	CodeInvalid    Code = "NATIVE_CALL_FAILED"
)

type Hooks struct {
	// Rejected reports a batch that was refused for good. The connection keeps running.
	Rejected func(Code)
	// Admitted runs after a batch was published; identityPending says it holds pendingLid entries.
	Admitted func(identityPending bool)
	// Failure reports a local storage failure that must stop reception.
	Failure func(error)
}

// Processor admits captured history notifications, one batch at a time. The durable
// captures in the ledger are its queue: nothing waits in memory but the batch in hand.
type Processor struct {
	account  func() string
	env      func() Env
	limits   Limits
	remote   Remote
	store    Store
	ledger   Ledger
	capacity Capacity
	hooks    Hooks

	run  sync.Mutex // one batch at a time, whoever asks
	wake chan struct{}
}

func NewProcessor(account func() string, env func() Env, limits Limits, remote Remote, store Store, ledger Ledger, capacity Capacity, hooks Hooks) *Processor {
	return &Processor{account: account, env: env, limits: limits, remote: remote, store: store, ledger: ledger, capacity: capacity, hooks: hooks, wake: make(chan struct{}, 1)}
}

// Trigger asks for a pass without waiting; repeated triggers coalesce.
func (p *Processor) Trigger() {
	select {
	case p.wake <- struct{}{}:
	default:
	}
}

// Run serves triggers until ctx ends, which is when the connection generation is retired.
func (p *Processor) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-p.wake:
			_ = p.Drain(ctx)
		}
	}
}

// Drain processes the captured notifications of the account oldest first, stopping at the
// first one that could not finish: it stays captured and is retried by the next trigger.
func (p *Processor) Drain(ctx context.Context) error {
	p.run.Lock()
	defer p.run.Unlock()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		capture, found, err := p.next()
		if err != nil {
			p.fail(err)
			return err
		}
		if !found {
			return nil
		}
		if err := p.process(ctx, capture); err != nil {
			return err
		}
	}
}

func (p *Processor) next() (protocolstore.PendingRecord, bool, error) {
	pending, err := p.ledger.Pending()
	if err != nil {
		return protocolstore.PendingRecord{}, false, err
	}
	for _, record := range pending {
		if record.AccountID == p.account() && protocolstore.IsHistoryNotification(record.PendingInsert) {
			return record, true, nil
		}
	}
	return protocolstore.PendingRecord{}, false, nil
}

func (p *Processor) fail(err error) {
	if p.hooks.Failure != nil && !errors.Is(err, context.Canceled) {
		p.hooks.Failure(err)
	}
}

func (p *Processor) process(ctx context.Context, capture protocolstore.PendingRecord) error {
	notification, id, err := decodeCapture(capture)
	if err != nil {
		return p.reject(capture, CodeInvalid)
	}
	marker := markerOf(p.account(), notification)
	admitted, err := p.store.HistoryAdmitted(marker)
	if err != nil {
		p.fail(err)
		return err
	}
	if !admitted {
		rejected, err := p.admit(ctx, capture, notification, marker)
		if err != nil || rejected {
			return err
		}
	}
	return p.finish(ctx, capture, notification, id)
}

// admit publishes the batch of a notification. rejected means the batch was refused for good
// and its capture retired; a non-nil error means it stays captured for a later attempt.
func (p *Processor) admit(ctx context.Context, capture protocolstore.PendingRecord, notification *waE2E.HistorySyncNotification, marker [32]byte) (rejected bool, err error) {
	history, prepared, err := p.build(ctx, notification)
	if err != nil {
		if code, refused := classify(err); refused {
			return true, p.reject(capture, code)
		}
		if !isCancel(err) && !isNetwork(err) {
			p.fail(err)
		}
		return false, err
	}
	batch := protocolstore.HistoryBatch{
		Marker: marker, Capture: capture.DeliveryID, Inserts: prepared.Inserts,
		Stage: func(ctx context.Context) error { return p.remote.Stage(ctx, history) },
		Rollback: func() {
			if r, ok := p.remote.(interface{ Rollback() }); ok {
				r.Rollback()
			}
		},
	}
	for {
		if err := ctx.Err(); err != nil {
			return false, err // a retired generation never admits late
		}
		err := p.store.AdmitHistoryBatch(ctx, batch)
		var typed *protocolstore.Error
		switch {
		case err == nil:
			p.admitted(prepared)
			return false, nil
		case errors.Is(err, protocolstore.ErrHistoryAdmitted):
			return false, nil
		case errors.As(err, &typed) && typed.Code == protocolstore.BufferFull && typed.Oversize:
			return true, p.reject(capture, CodeBufferFull)
		case errors.As(err, &typed) && typed.Code == protocolstore.BufferFull:
			if err := p.capacity.AwaitCapacity(ctx, typed.Needed); err != nil {
				return false, err
			}
		case errors.Is(err, protocolstore.ErrHistoryTooLarge):
			return true, p.reject(capture, CodeLimit)
		case errors.Is(err, protocolstore.ErrHistoryContent):
			return true, p.reject(capture, CodeInvalid)
		case isCancel(err):
			return false, err
		default:
			p.fail(err)
			return false, err
		}
	}
}

func (p *Processor) admitted(prepared Prepared) {
	if p.hooks.Admitted == nil {
		return
	}
	pendingLID := false
	for _, insert := range prepared.Inserts {
		pendingLID = pendingLID || insert.IdentityState == "pendingLid"
	}
	p.hooks.Admitted(pendingLID)
}

// build downloads, parses and prepares one batch; the raw bytes are released before it returns.
func (p *Processor) build(ctx context.Context, notification *waE2E.HistorySyncNotification) (*waHistorySync.HistorySync, Prepared, error) {
	raw, err := p.remote.Fetch(ctx, notification)
	if err != nil {
		return nil, Prepared{}, err
	}
	history, err := Decode(raw, p.limits)
	raw = nil
	if err != nil {
		return nil, Prepared{}, err
	}
	env := p.env()
	env.Parse = p.remote.Parse
	env.Stored = p.store.GetManyLIDsForPNs
	env.CheckMappings = p.store.CheckLIDMappings
	env.Budget = p.store.RecoveryBudget()
	prepared, err := Prepare(ctx, history, env)
	return history, prepared, err
}

// finish runs after the batch is durable: receipt, then remote deletion, then the capture's
// retirement. The receipt and the deletion are the steps that give up the remote source, so
// neither may run before publication; a failure of either leaves the capture, and the marker
// keeps the retry from admitting the batch twice.
func (p *Processor) finish(ctx context.Context, capture protocolstore.PendingRecord, notification *waE2E.HistorySyncNotification, id types.MessageID) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := p.remote.Receipt(ctx, id); err != nil {
		return err
	}
	_ = p.remote.Delete(ctx, notification) // best effort: the batch is already local
	if _, err := p.ledger.Retire(capture.DeliveryID); err != nil {
		p.fail(err)
		return err
	}
	p.capacity.CapacityFreed()
	return nil
}

// reject drops the capture of a batch that can never be admitted. No receipt and no deletion
// are sent: the remote batch is left as it was and is not retried by this process.
func (p *Processor) reject(capture protocolstore.PendingRecord, code Code) error {
	if _, err := p.ledger.Retire(capture.DeliveryID); err != nil {
		p.fail(err)
		return err
	}
	p.capacity.CapacityFreed()
	if p.hooks.Rejected != nil {
		p.hooks.Rejected(code)
	}
	return nil
}

func classify(err error) (Code, bool) {
	var typed *protocolstore.Error
	switch {
	case errors.As(err, &typed) && typed.Code == protocolstore.BufferFull && typed.Oversize:
		return CodeBufferFull, true
	case errors.Is(err, ErrLimit):
		return CodeLimit, true
	case errors.Is(err, ErrInvalid), errors.Is(err, ErrUnavailable):
		return CodeInvalid, true
	}
	return "", false
}

func isCancel(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// isNetwork is true for errors that neither storage nor content caused; they only delay.
func isNetwork(err error) bool {
	var typed *protocolstore.Error
	return !errors.As(err, &typed) && !errors.Is(err, store.ErrLocalStorage)
}

// decodeCapture reads the notification and the message ID back from a captured entry.
func decodeCapture(capture protocolstore.PendingRecord) (*waE2E.HistorySyncNotification, types.MessageID, error) {
	var head struct {
		ID string `json:"id"`
	}
	if len(capture.Recovery.Items) != 1 || json.Unmarshal([]byte(capture.Recovery.MessageInfoJSON), &head) != nil || head.ID == "" {
		return nil, "", ErrInvalid
	}
	plaintext, err := base64.StdEncoding.DecodeString(capture.Recovery.Items[0].PlaintextBase64)
	if err != nil {
		return nil, "", ErrInvalid
	}
	var message waE2E.Message
	if proto.Unmarshal(plaintext, &message) != nil {
		return nil, "", ErrInvalid
	}
	notification := message.GetProtocolMessage().GetHistorySyncNotification()
	if notification == nil {
		return nil, "", ErrInvalid
	}
	return notification, types.MessageID(head.ID), nil
}

// markerOf identifies the batch a notification points at, independent of the message that
// carried it: the same remote batch announced again is recognized as already admitted.
func markerOf(account string, notification *waE2E.HistorySyncNotification) [32]byte {
	return protocolstore.HistoryMarker(account, notification)
}
