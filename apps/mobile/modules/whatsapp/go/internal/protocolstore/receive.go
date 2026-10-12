package protocolstore

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/protocolstate"
)

// CapturedChild owns its bytes; it never points into whatsmeow's receive node.
type CapturedChild struct {
	Index          int
	Format         string
	EncryptionType string
	Ciphertext     []byte
}

type CapturedReceive struct {
	AccountID       string
	MessageInfoJSON string
	Children        []CapturedChild
}

// ReceiveBuilder performs the pure message/identity decision after decryption.
// It must not call back into Store while its decryption transaction is active.
type ReceiveBuilder func(CapturedReceive, CapturedChild, []byte) (identityState string, message json.RawMessage, err error)

type receiveContextKey struct{}
type receiveContext struct {
	captured  CapturedReceive
	build     ReceiveBuilder
	processor RecoveryProcessor
}

type RecoveryProcessor interface {
	ReplayRecoveredProtocol(context.Context, *types.MessageInfo, string, []byte) error
}

// receiveMetadata is the replay metadata of one received message, version 1.
type receiveMetadata struct {
	Version          int    `json:"version"`
	AccountID        string `json:"accountId"`
	ID               string `json:"id"`
	Chat             string `json:"chat"`
	Sender           string `json:"sender"`
	SenderAlt        string `json:"senderAlt"`
	RecipientAlt     string `json:"recipientAlt"`
	IsFromMe         bool   `json:"isFromMe"`
	IsGroup          bool   `json:"isGroup"`
	TimestampSeconds int64  `json:"timestampSeconds"`
	Category         string `json:"category"`
	MessageType      string `json:"messageType"`
}

// MarshalReceiveInfo is the replay metadata that ParseReceiveInfo reads back; live capture
// and the historical admission share it so one resolver can re-evaluate both.
func MarshalReceiveInfo(accountID string, info *types.MessageInfo) (string, error) {
	if info == nil || accountID == "" {
		return "", malformed("receive metadata missing")
	}
	raw, err := json.Marshal(receiveMetadata{1, accountID, string(info.ID), info.Chat.String(), info.Sender.String(), info.SenderAlt.String(), info.RecipientAlt.String(), info.IsFromMe, info.IsGroup, info.Timestamp.Unix(), info.Category, info.Type})
	if err != nil {
		return "", malformed("invalid receive metadata")
	}
	return string(raw), nil
}

func parseReceiveInfo(raw, accountID string) (*types.MessageInfo, error) {
	var metadata receiveMetadata
	// Any instant, even a zero or negative one, is accepted: a message whose timestamp cannot become a public
	// one is isolated and delivered sanitized by the identity layer (IT-MSG-07), not refused here.
	if err := json.Unmarshal([]byte(raw), &metadata); err != nil || metadata.Version != 1 || metadata.AccountID != accountID || metadata.ID == "" {
		return nil, failure(StateInvalid, "invalid replay metadata")
	}
	chat, err := types.ParseJID(metadata.Chat)
	if err != nil {
		return nil, failure(StateInvalid, "invalid replay chat")
	}
	sender, err := types.ParseJID(metadata.Sender)
	if err != nil {
		return nil, failure(StateInvalid, "invalid replay sender")
	}
	parseOptional := func(value string) (types.JID, error) {
		if value == "" {
			return types.EmptyJID, nil
		}
		return types.ParseJID(value)
	}
	senderAlt, err := parseOptional(metadata.SenderAlt)
	if err != nil {
		return nil, failure(StateInvalid, "invalid replay sender alternate")
	}
	recipientAlt, err := parseOptional(metadata.RecipientAlt)
	if err != nil {
		return nil, failure(StateInvalid, "invalid replay recipient alternate")
	}
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: chat, Sender: sender, SenderAlt: senderAlt,
		RecipientAlt: recipientAlt, IsFromMe: metadata.IsFromMe, IsGroup: metadata.IsGroup},
		ID: types.MessageID(metadata.ID), Timestamp: time.Unix(metadata.TimestampSeconds, 0), Category: metadata.Category, Type: metadata.MessageType}
	return info, nil
}

// CaptureReceive copies every encrypted child and the replay metadata before Signal changes state.
func CaptureReceive(ctx context.Context, accountID string, info *types.MessageInfo, node *waBinary.Node, build ReceiveBuilder, processor RecoveryProcessor) (context.Context, error) {
	if ctx == nil || info == nil || node == nil || build == nil || processor == nil || accountID == "" {
		return nil, malformed("receive context missing")
	}
	infoJSON, err := MarshalReceiveInfo(accountID, info)
	if err != nil {
		return nil, err
	}
	captured := CapturedReceive{AccountID: accountID, MessageInfoJSON: infoJSON}
	for index, child := range node.GetChildren() {
		if child.Tag != "enc" {
			continue
		}
		ciphertext, ok := child.Content.([]byte)
		if !ok || len(ciphertext) == 0 {
			return nil, malformed("invalid encrypted child")
		}
		version := child.AttrGetter().Int("v")
		format := ""
		if version == 2 {
			format = "v2"
		} else if version == 3 {
			format = "v3"
		} else {
			return nil, malformed("unsupported encrypted child version")
		}
		captured.Children = append(captured.Children, CapturedChild{index, format, child.AttrGetter().OptionalString("type"), append([]byte(nil), ciphertext...)})
	}
	return store.WithAppStateRecoveryStage(store.WithPrecommittedProtocol(context.WithValue(ctx, receiveContextKey{}, receiveContext{captured, build, processor}))), nil
}

// ParseReceiveInfo rebuilds the captured MessageInfo for a receive builder.
func ParseReceiveInfo(captured CapturedReceive) (*types.MessageInfo, error) {
	return parseReceiveInfo(captured.MessageInfoJSON, captured.AccountID)
}

func (s *Store) prepareBufferedEvent(ctx context.Context, hash [32]byte, plaintext []byte, serverTime time.Time) error {
	value, ok := ctx.Value(receiveContextKey{}).(receiveContext)
	if !ok {
		return unsupported("receive context absent")
	}
	if value.captured.AccountID != s.accountID {
		return malformed("receive account mismatch")
	}
	index, ok := store.BufferedEventChild(ctx)
	if !ok {
		return unsupported("encrypted child index absent")
	}
	var child *CapturedChild
	for i := range value.captured.Children {
		if value.captured.Children[i].Index == index {
			child = &value.captured.Children[i]
			break
		}
	}
	if child == nil {
		return unsupported("encrypted child not captured")
	}
	info, err := parseReceiveInfo(value.captured.MessageInfoJSON, s.accountID)
	if err != nil {
		return err
	}
	if info.Sender.Server == types.DefaultUserServer && info.SenderAlt.IsEmpty() {
		lid, err := s.GetLIDForPN(ctx, info.Sender)
		if err != nil {
			return err
		}
		if !lid.IsEmpty() {
			info.SenderAlt = lid
			var metadata map[string]json.RawMessage
			if err := json.Unmarshal([]byte(value.captured.MessageInfoJSON), &metadata); err != nil {
				return failure(StateInvalid, "invalid captured metadata")
			}
			metadata["senderAlt"], _ = json.Marshal(lid.String())
			updated, err := json.Marshal(metadata)
			if err != nil {
				return failure(StateInvalid, "invalid resolved metadata")
			}
			value.captured.MessageInfoJSON = string(updated)
		}
	}
	if err := value.processor.ReplayRecoveredProtocol(ctx, info, child.Format, plaintext); err != nil {
		return err
	}
	identity, message, err := value.build(value.captured, *child, append([]byte(nil), plaintext...))
	if err != nil {
		return storageError(err)
	}
	if identity == "excluded" {
		// Unsupported content leaves only the metadata-only retry marker so a
		// redelivery is acknowledged without a pending entry.
		return s.putRetryHash(ctx, hash, serverTime)
	}
	if identity == HistoryNotificationState {
		return s.captureHistoryNotification(ctx, value.captured, plaintext, hash, serverTime)
	}
	if identity != "resolved" && identity != "pendingLid" {
		return malformed("invalid receive identity state")
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return failure(StorageFailed, "delivery ID generation failed")
	}
	p := PendingInsert{
		DeliveryID: "wa-delivery:v1:" + hex.EncodeToString(random[:]), AccountID: s.accountID,
		Source: "live", IdentityState: identity, Message: message,
		Recovery: Recovery{MessageInfoJSON: value.captured.MessageInfoJSON, Items: []RecoveryItem{{
			Format: child.Format, PlaintextBase64: base64.StdEncoding.EncodeToString(plaintext),
			CiphertextHashBase64: base64.StdEncoding.EncodeToString(hash[:]),
		}}},
	}
	if err := s.PreparePendingInsert(ctx, p); err != nil {
		return err
	}
	return s.putRetryHash(ctx, hash, serverTime)
}

func (s *Store) putRetryHash(ctx context.Context, hash [32]byte, serverTime time.Time) error {
	return s.put(ctx, "retry-hash", protocolstate.RetryHash{Version: 1, InsertTimeMS: time.Now().UnixMilli(), ServerTimeSeconds: serverTime.Unix()}, base64.StdEncoding.EncodeToString(hash[:]))
}
