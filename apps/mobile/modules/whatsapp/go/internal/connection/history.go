package connection

import (
	"context"
	"errors"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"yoyos-whatsapp/internal/history"
	"yoyos-whatsapp/internal/protocolstore"
)

// whatsmeowHistory is the network side of history admission over the pinned client. Every step
// of a batch is a separate call so that the processor, not the dependency, decides their order.
type whatsmeowHistory struct {
	client *whatsmeow.Client
	limits history.Limits
}

func (h *whatsmeowHistory) Fetch(ctx context.Context, notification *waE2E.HistorySyncNotification) ([]byte, error) {
	raw, err := history.Fetch(ctx, notification.GetInitialHistBootstrapInlinePayload(), func(ctx context.Context) ([]byte, error) {
		return h.client.Download(ctx, notification)
	}, h.limits)
	if permanent(err) {
		return nil, errors.Join(history.ErrUnavailable, err)
	}
	return raw, err
}

// permanent recognizes the failures of a batch that will never download: gone, forbidden or
// failing its integrity checks. Network faults stay transient and the capture is retried later.
func permanent(err error) bool {
	for _, target := range []error{whatsmeow.ErrMediaDownloadFailedWith403, whatsmeow.ErrMediaDownloadFailedWith404, whatsmeow.ErrMediaDownloadFailedWith410,
		whatsmeow.ErrInvalidMediaSHA256, whatsmeow.ErrInvalidMediaEncSHA256, whatsmeow.ErrInvalidMediaHMAC, whatsmeow.ErrTooShortFile, whatsmeow.ErrNoURLPresent} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

func (h *whatsmeowHistory) Parse(chat types.JID, web *waWeb.WebMessageInfo) (*events.Message, error) {
	return h.client.ParseWebMessage(chat, web)
}
func (h *whatsmeowHistory) Stage(ctx context.Context, batch *waHistorySync.HistorySync) error {
	// The dependency records the companion nonce in memory before saving it; a refused batch
	// must not leave a nonce that was never made durable.
	nonce := h.client.Store.CompanionMetaNonce
	err := h.client.StageHistorySync(ctx, batch)
	if err != nil {
		h.client.Store.CompanionMetaNonce = nonce
	}
	return err
}
func (h *whatsmeowHistory) Receipt(ctx context.Context, id types.MessageID) error {
	return h.client.SendProtocolMessageReceipt(ctx, id, types.ReceiptTypeHistorySync)
}
func (h *whatsmeowHistory) Delete(ctx context.Context, notification *waE2E.HistorySyncNotification) error {
	return h.client.DeleteMedia(ctx, whatsmeow.MediaHistory, notification.GetDirectPath(), notification.GetFileEncSHA256(), notification.GetEncHandle())
}

var errStoreUnavailable = errors.New("account protocol store unavailable")

// linkedStore resolves the account's protocol store when it is used: before the first link
// completes there is none, and a history batch cannot arrive before it does.
type linkedStore struct{ device *store.Device }

func (l linkedStore) current() (*protocolstore.Store, error) {
	switch container := l.device.Container.(type) {
	case *protocolstore.Store:
		return container, nil
	case interface{ LinkedStore() *protocolstore.Store }:
		if linked := container.LinkedStore(); linked != nil {
			return linked, nil
		}
	}
	return nil, errors.Join(store.ErrLocalStorage, errStoreUnavailable)
}

func (l linkedStore) AdmitHistoryBatch(ctx context.Context, batch protocolstore.HistoryBatch) error {
	s, err := l.current()
	if err != nil {
		return err
	}
	return s.AdmitHistoryBatch(ctx, batch)
}
func (l linkedStore) HistoryAdmitted(marker [32]byte) (bool, error) {
	s, err := l.current()
	if err != nil {
		return false, err
	}
	return s.HistoryAdmitted(marker)
}
func (l linkedStore) GetManyLIDsForPNs(ctx context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	s, err := l.current()
	if err != nil {
		return nil, err
	}
	return s.GetManyLIDsForPNs(ctx, pns)
}
func (l linkedStore) CheckLIDMappings(ctx context.Context, mappings []store.LIDMapping) error {
	s, err := l.current()
	if err != nil {
		return err
	}
	return s.CheckLIDMappings(ctx, mappings)
}
func (l linkedStore) RecoveryBudget() int64 {
	s, err := l.current()
	if err != nil {
		return 0
	}
	return s.RecoveryBudget()
}
