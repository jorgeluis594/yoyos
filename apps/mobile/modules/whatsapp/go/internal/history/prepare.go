package history

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/identity"
	"yoyos-whatsapp/internal/normalization"
	"yoyos-whatsapp/internal/protocolstore"
)

// Parser is whatsmeow's ParseWebMessage: it derives the message source of a historical
// message. Production passes the client's method.
type Parser func(types.JID, *waWeb.WebMessageInfo) (*events.Message, error)

// Env is everything preparing a batch needs; nothing in it writes.
type Env struct {
	// Account is the canonical own LID; Own and OwnAlt are the device's PN and LID.
	Account     string
	Own, OwnAlt types.JID
	Parse       Parser
	// Stored reads the account's verified PN-to-LID correspondences.
	Stored func(context.Context, []types.JID) (map[types.JID]types.JID, error)
	// CheckMappings refuses mappings the store would refuse, before anything is staged.
	CheckMappings func(context.Context, []store.LIDMapping) error
	// Budget is the recovery buffer. Preparation stops as soon as the entries built so far
	// exceed it: the batch can never be admitted, and the rest need not be materialized.
	Budget int64
}

// Prepared is a batch ready to publish: every supported message, in chronological order.
type Prepared struct {
	Inserts  []protocolstore.PendingInsert
	Excluded int
}

// Prepare applies the whole batch in memory. The mappings of the batch are processed first and
// are what the dependent messages are normalized with. An unreadable store or a supported
// message that cannot be normalized fails the batch; content out of scope is only excluded.
func Prepare(ctx context.Context, batch *waHistorySync.HistorySync, env Env) (Prepared, error) {
	mappings, err := batchMappings(batch)
	if err != nil {
		return Prepared{}, err
	}
	if err := env.CheckMappings(ctx, mappings); err != nil {
		return Prepared{}, errors.Join(ErrInvalid, err)
	}
	chats := individualChats(batch)
	verified, err := verifiedLIDs(ctx, env, chats, mappings)
	if err != nil {
		return Prepared{}, err
	}
	var prepared Prepared
	seen := map[string]bool{}
	var times []int64
	var used int64
	for _, conversation := range batch.GetConversations() {
		chat, ok := individual(conversation.GetID())
		if !ok {
			continue
		}
		for _, item := range conversation.GetMessages() {
			if err := ctx.Err(); err != nil {
				return Prepared{}, err
			}
			insert, timestamp, included, err := prepareMessage(env, chat, item.GetMessage(), verified)
			switch {
			case err != nil:
				return Prepared{}, err
			case !included:
				prepared.Excluded++
			case seen[insert.key]:
			default:
				size, err := protocolstore.EntrySize(insert.PendingInsert)
				if err != nil {
					return Prepared{}, errors.Join(ErrInvalid, err)
				}
				if used += size; env.Budget > 0 && used > env.Budget {
					return Prepared{}, &protocolstore.Error{Code: protocolstore.BufferFull, Message: "history batch exceeds recovery buffer", Needed: used, Oversize: true}
				}
				seen[insert.key] = true
				prepared.Inserts = append(prepared.Inserts, insert.PendingInsert)
				times = append(times, timestamp)
			}
		}
	}
	sortChronologically(prepared.Inserts, times)
	return prepared, nil
}

type keyed struct {
	protocolstore.PendingInsert
	key string
}

func prepareMessage(env Env, chat types.JID, web *waWeb.WebMessageInfo, verified normalization.VerifiedLIDs) (keyed, int64, bool, error) {
	if web == nil {
		return keyed{}, 0, false, nil
	}
	event, err := env.Parse(chat, web)
	if err != nil {
		return keyed{}, 0, false, errors.Join(ErrInvalid, err)
	}
	info := event.Info
	state, message, err := identity.ClassifyWeb(&info, web, env.Own, env.OwnAlt, verified)
	if err != nil {
		return keyed{}, 0, false, errors.Join(ErrInvalid, err)
	}
	if state == identity.Excluded {
		return keyed{}, 0, false, nil
	}
	if state == identity.Resolved && !belongs(message, env.Account) {
		return keyed{}, 0, false, errors.Join(ErrInvalid, errors.New("message names another account"))
	}
	infoJSON, err := protocolstore.MarshalReceiveInfo(env.Account, &info)
	if err != nil {
		return keyed{}, 0, false, errors.Join(ErrInvalid, err)
	}
	plaintext, err := proto.Marshal(web)
	if err != nil || len(plaintext) == 0 {
		return keyed{}, 0, false, errors.Join(ErrInvalid, errors.New("message cannot be preserved"))
	}
	id, err := newDeliveryID()
	if err != nil {
		return keyed{}, 0, false, err
	}
	insert := protocolstore.PendingInsert{
		DeliveryID: id, AccountID: env.Account, Source: "history", IdentityState: string(state), Message: message,
		Recovery: protocolstore.Recovery{MessageInfoJSON: infoJSON, Items: []protocolstore.RecoveryItem{{Format: "history", PlaintextBase64: base64.StdEncoding.EncodeToString(plaintext)}}},
	}
	return keyed{insert, chat.String() + "\x00" + string(info.ID)}, info.Timestamp.Unix(), true, nil
}

func belongs(message []byte, account string) bool {
	var head struct {
		AccountID string `json:"accountId"`
	}
	return json.Unmarshal(message, &head) == nil && head.AccountID == account
}

func newDeliveryID() (string, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", fmt.Errorf("delivery ID generation failed: %w", err)
	}
	return "wa-delivery:v1:" + hex.EncodeToString(random[:]), nil
}

// sortChronologically keeps the protocol order of messages with the same second.
func sortChronologically(inserts []protocolstore.PendingInsert, times []int64) {
	order := make([]int, len(inserts))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return times[order[a]] < times[order[b]] })
	sorted := make([]protocolstore.PendingInsert, len(inserts))
	for i, from := range order {
		sorted[i] = inserts[from]
	}
	copy(inserts, sorted)
}

// individual accepts the chats this module delivers: one-to-one, by phone number or LID.
func individual(id string) (types.JID, bool) {
	chat, err := types.ParseJID(id)
	if err != nil || chat.User == "" {
		return types.EmptyJID, false
	}
	if chat.Server == types.LegacyUserServer {
		chat.Server = types.DefaultUserServer
	}
	return chat, chat.Server == types.DefaultUserServer || chat.Server == types.HiddenUserServer
}

func individualChats(batch *waHistorySync.HistorySync) []types.JID {
	var phones []types.JID
	for _, conversation := range batch.GetConversations() {
		if chat, ok := individual(conversation.GetID()); ok && chat.Server == types.DefaultUserServer {
			phones = append(phones, chat.ToNonAD())
		}
	}
	return phones
}

// batchMappings reads the batch's PN-to-LID pairs like whatsmeow does: a pair that does not parse is
// skipped, while a pair that parses into the wrong kind of address fails the batch.
func batchMappings(batch *waHistorySync.HistorySync) ([]store.LIDMapping, error) {
	var pairs []store.LIDMapping
	for _, mapping := range batch.GetPhoneNumberToLidMappings() {
		pn, pnErr := types.ParseJID(mapping.GetPnJID())
		lid, lidErr := types.ParseJID(mapping.GetLidJID())
		if pnErr != nil || lidErr != nil {
			continue
		}
		if pn.Server == types.LegacyUserServer {
			pn.Server = types.DefaultUserServer
		}
		if pn.Server != types.DefaultUserServer || pn.User == "" || lid.Server != types.HiddenUserServer || lid.User == "" {
			return nil, errors.Join(ErrInvalid, errors.New("mapping is not a phone number to LID pair"))
		}
		pairs = append(pairs, store.LIDMapping{LID: lid, PN: pn})
	}
	return pairs, nil
}

// verifiedLIDs merges the stored correspondences with the batch's; the batch is applied first,
// so it wins exactly as it will once published.
func verifiedLIDs(ctx context.Context, env Env, phones []types.JID, mappings []store.LIDMapping) (normalization.VerifiedLIDs, error) {
	stored, err := env.Stored(ctx, phones)
	if err != nil {
		return nil, err
	}
	verified := normalization.VerifiedLIDs{}
	for pn, lid := range stored {
		verified[pn.ToNonAD()] = lid.ToNonAD()
	}
	for _, mapping := range mappings {
		verified[mapping.PN.ToNonAD()] = mapping.LID.ToNonAD()
	}
	return verified, nil
}
