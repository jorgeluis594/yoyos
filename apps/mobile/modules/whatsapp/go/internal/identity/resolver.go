package identity

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/normalization"
	"yoyos-whatsapp/internal/protocolstore"
)

// Ledger lists the durable pending entries; an unreadable list is an error, never empty.
type Ledger interface {
	Pending() ([]protocolstore.PendingRecord, error)
}

// Account is the receiving account's protocol store: the only source of mappings
// that may complete that account's pending identities.
type Account interface {
	AccountID() string
	GetManyLIDsForPNs(context.Context, []types.JID) (map[types.JID]types.JID, error)
	PublishPendingIdentities(context.Context, []protocolstore.PendingIdentityUpdate) error
}

// Outcome counts this account's entries after one pass.
type Outcome struct {
	Resolved   int
	Unresolved int
}

var errInvalidPending = errors.New("pending entry cannot be re-evaluated")

// Resolve completes every pendingLid entry of the account whose mapping is now
// verifiable, publishing all of them in one native commit. Absence of a mapping leaves the
// entry untouched; a failing read or publication is returned as an error.
func Resolve(ctx context.Context, ledger Ledger, account Account, device *store.Device) (Outcome, error) {
	pending, err := ledger.Pending()
	if err != nil {
		return Outcome{}, err
	}
	var updates []protocolstore.PendingIdentityUpdate
	unresolved := 0
	for i := range pending {
		record := &pending[i]
		if record.AccountID != account.AccountID() || record.IdentityState != string(PendingLID) {
			continue
		}
		update, found, err := resolveOne(ctx, record, account, device)
		if err != nil {
			return Outcome{}, err
		}
		if found {
			updates = append(updates, update)
		} else {
			unresolved++
		}
	}
	if err := account.PublishPendingIdentities(ctx, updates); err != nil {
		return Outcome{}, err
	}
	return Outcome{Resolved: len(updates), Unresolved: unresolved}, nil
}

// resolveOne re-evaluates one entry from its durable plaintext; the DeliveryID,
// order and recovery data of the entry are never touched.
func resolveOne(ctx context.Context, record *protocolstore.PendingRecord, account Account, device *store.Device) (protocolstore.PendingIdentityUpdate, bool, error) {
	none := protocolstore.PendingIdentityUpdate{}
	if len(record.Recovery.Items) != 1 || device == nil || device.ID == nil {
		return none, false, errInvalidPending
	}
	info, err := protocolstore.ParseReceiveInfo(protocolstore.CapturedReceive{AccountID: record.AccountID, MessageInfoJSON: record.Recovery.MessageInfoJSON})
	if err != nil {
		return none, false, err
	}
	mappings, err := verified(ctx, account, info)
	if err != nil {
		return none, false, err
	}
	item := record.Recovery.Items[0]
	plaintext, err := base64.StdEncoding.DecodeString(item.PlaintextBase64)
	if err != nil {
		return none, false, errInvalidPending
	}
	state, message, err := Classify(info, item.Format, plaintext, device.ID.ToNonAD(), device.LID, mappings)
	if err != nil {
		return none, false, err
	}
	if state != Resolved || !belongsTo(message, record.AccountID) {
		return none, false, nil
	}
	return protocolstore.PendingIdentityUpdate{DeliveryID: record.DeliveryID, IdentityState: string(Resolved), Message: message}, true, nil
}

// verified reads the stored correspondence of every PN the message names.
func verified(ctx context.Context, account Account, info *types.MessageInfo) (normalization.VerifiedLIDs, error) {
	var phones []types.JID
	for _, jid := range []types.JID{info.Chat, info.Sender, info.SenderAlt, info.RecipientAlt} {
		if jid.Server == types.DefaultUserServer && jid.User != "" {
			phones = append(phones, jid.ToNonAD())
		}
	}
	found, err := account.GetManyLIDsForPNs(ctx, phones)
	if err != nil {
		return nil, err
	}
	return normalization.VerifiedLIDs(found), nil
}

// belongsTo guards against publishing an identity of another account.
func belongsTo(message []byte, accountID string) bool {
	var head struct {
		AccountID string `json:"accountId"`
	}
	return json.Unmarshal(message, &head) == nil && head.AccountID == accountID
}
