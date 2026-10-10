// Package identity decides the public identity of received content and completes
// it later: content kept with a pendingLid identity becomes deliverable once the
// account's own store holds the verifiable PN-to-LID correspondence it lacked.
package identity

import (
	"encoding/json"
	"errors"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/normalization"
)

// State is the identity decision for one received encrypted child.
type State string

const (
	Excluded   State = "excluded"
	PendingLID State = "pendingLid"
	Resolved   State = "resolved"
)

// Classify turns decrypted content into its identity state and, when resolved, its
// public message. Mappings must be verified correspondences of the receiving account.
func Classify(info *types.MessageInfo, format string, plaintext []byte, own, ownAlt types.JID, mappings normalization.VerifiedLIDs) (State, json.RawMessage, error) {
	if format != "v2" {
		return Excluded, nil, nil
	}
	var message waE2E.Message
	if err := proto.Unmarshal(plaintext, &message); err != nil {
		return Excluded, nil, nil
	}
	event := (&events.Message{Info: *info, RawMessage: &message}).UnwrapRaw()
	result, err := normalization.Normalize(event, own, ownAlt, mappings)
	switch {
	case errors.Is(err, normalization.ErrInvalidTimestamp), errors.Is(err, normalization.ErrInvalidIdentity), errors.Is(err, normalization.ErrRawEditInspectionExhausted):
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
