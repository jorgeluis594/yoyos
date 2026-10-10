// Package identity decides the public identity of received content and completes
// it later: content kept with a pendingLid identity becomes deliverable once the
// account's own store holds the verifiable PN-to-LID correspondence it lacked.
package identity

import (
	"encoding/json"
	"errors"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/normalization"
	"yoyos-whatsapp/internal/protocolstore"
)

// State is the identity decision for one received encrypted child.
type State string

const (
	Excluded   State = "excluded"
	PendingLID State = "pendingLid"
	Resolved   State = "resolved"
	// HistoryNotification is a decrypted history sync notification of the own account: it
	// is kept for the history processor and never becomes a public message.
	HistoryNotification State = protocolstore.HistoryNotificationState
)

// Classify turns decrypted content into its identity state and, when resolved, its
// public message. Mappings must be verified correspondences of the receiving account.
func Classify(info *types.MessageInfo, format string, plaintext []byte, own, ownAlt types.JID, mappings normalization.VerifiedLIDs) (State, json.RawMessage, error) {
	switch format {
	case "v2":
		var message waE2E.Message
		if err := proto.Unmarshal(plaintext, &message); err != nil {
			return Excluded, nil, nil
		}
		if isHistoryNotification(info, &message) {
			return HistoryNotification, nil, nil
		}
		event := (&events.Message{Info: *info, RawMessage: &message}).UnwrapRaw()
		return classifyEvent(event, own, ownAlt, mappings)
	case "history":
		var web waWeb.WebMessageInfo
		if err := proto.Unmarshal(plaintext, &web); err != nil {
			return Excluded, nil, nil
		}
		return ClassifyWeb(info, &web, own, ownAlt, mappings)
	default:
		return Excluded, nil, nil
	}
}

// ClassifyWeb is Classify for one historical message whose MessageInfo was already derived,
// by the same rules as a live message: it is the one definition both admission and the
// later identity resolution use.
func ClassifyWeb(info *types.MessageInfo, web *waWeb.WebMessageInfo, own, ownAlt types.JID, mappings normalization.VerifiedLIDs) (State, json.RawMessage, error) {
	event := (&events.Message{Info: *info, RawMessage: web.GetMessage(), SourceWebMsg: web}).UnwrapRaw()
	return classifyEvent(event, own, ownAlt, mappings)
}

// isHistoryNotification recognizes the notification the phone sends to this companion; one
// from anyone else is ordinary protocol content and is excluded like any other.
func isHistoryNotification(info *types.MessageInfo, message *waE2E.Message) bool {
	return info.IsFromMe && message.GetProtocolMessage().GetHistorySyncNotification() != nil
}

// classifyEvent applies IT-MSG-07 (decision 2026-10-10): a message whose own timestamp is missing or invalid is
// still normalized, persisted, delivered and confirmed like any other; its public timestamp is simply absent
// (unknown), never 0 and never the reception time. It neither stops reception nor affects another message, and a
// history batch stays whole.
func classifyEvent(event *events.Message, own, ownAlt types.JID, mappings normalization.VerifiedLIDs) (State, json.RawMessage, error) {
	result, err := normalization.Normalize(event, own, ownAlt, mappings)
	switch {
	case errors.Is(err, normalization.ErrInvalidIdentity), errors.Is(err, normalization.ErrRawEditInspectionExhausted):
		// Content that cannot be given a valid public identity is never deliverable.
		return Excluded, nil, nil
	case err != nil:
		return "", nil, err
	case result.Unresolved != nil:
		return PendingLID, nil, nil
	case result.Message == nil:
		return Excluded, nil, nil
	}
	raw, err := json.Marshal(result.Message)
	if err != nil {
		return "", nil, err
	}
	return Resolved, raw, nil
}
