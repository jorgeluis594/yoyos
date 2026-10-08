// Package normalization converts whatsmeow events into stable public messages.
// Callers retain the original event and recovery data until admission commits.
package normalization

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/reflect/protoreflect"
)

var ErrInvalidTimestamp = errors.New("invalid WhatsApp timestamp")
var ErrInvalidIdentity = errors.New("invalid WhatsApp identity")

// VerifiedLIDs contains only protocol/store-verified PN-to-LID correspondences.
type VerifiedLIDs map[types.JID]types.JID

type ImageReference struct {
	MessageID         string `json:"messageId"`
	DownloadReference string `json:"downloadReference"`
}
type Image struct {
	MIMEType  string         `json:"mimeType,omitempty"`
	Size      *uint64        `json:"size,omitempty"`
	Reference ImageReference `json:"reference"`
}
type ReceivedMessage struct {
	ID                string  `json:"id"`
	AccountID         string  `json:"accountId"`
	WhatsAppMessageID string  `json:"whatsappMessageId"`
	ChatID            string  `json:"chatId"`
	Direction         string  `json:"direction"`
	Timestamp         int64   `json:"timestamp"`
	Text              *string `json:"text,omitempty"`
	Image             *Image  `json:"image,omitempty"`
}

// Result has exactly one of Message, Unresolved, or neither (excluded content).
type Result struct {
	Message    *ReceivedMessage
	Unresolved *UnresolvedIdentity
}
type UnresolvedIdentity struct {
	AccountJID        string
	ChatJID           string
	WhatsAppMessageID string
}

type imageDescriptor struct {
	AccountID     string `json:"accountId"`
	MessageID     string `json:"messageId"`
	MIMEType      string `json:"mimeType,omitempty"`
	DirectPath    string `json:"directPath,omitempty"`
	MediaKey      string `json:"mediaKey,omitempty"`
	FileSHA256    string `json:"fileSha256,omitempty"`
	FileEncSHA256 string `json:"fileEncSha256,omitempty"`
	FileLength    string `json:"fileLength,omitempty"`
}

const maxSafeJSONInteger = 9007199254740991

// Normalize accepts an already unwrapped live event or ParseWebMessage result.
// A missing chat LID is returned explicitly; its source event must be retained by the caller.
func Normalize(evt *events.Message, own, ownAlt types.JID, mappings VerifiedLIDs) (Result, error) {
	if evt == nil || evt.Message == nil || evt.Info.IsGroup || evt.Info.Chat.Server == types.GroupServer || evt.Info.Chat.Server == types.BroadcastServer || evt.Info.Chat.Server == types.NewsletterServer || evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension || evt.IsEdit || evt.Info.Edit != types.EditAttributeEmpty {
		return Result{}, nil
	}
	msg := evt.Message
	if msg.GetProtocolMessage() != nil || evt.RawMessage.GetProtocolMessage() != nil || msg.GetReactionMessage() != nil || msg.GetEncReactionMessage() != nil || msg.GetEditedMessage() != nil || msg.GetViewOnceMessage() != nil || msg.GetViewOnceMessageV2() != nil || msg.GetViewOnceMessageV2Extension() != nil {
		return Result{}, nil
	}
	contentFields := 0
	supported := true
	msg.ProtoReflect().Range(func(field protoreflect.FieldDescriptor, _ protoreflect.Value) bool {
		switch field.Name() {
		case "conversation", "imageMessage", "extendedTextMessage":
			contentFields++
		case "messageContextInfo", "senderKeyDistributionMessage":
		default:
			supported = false
		}
		return supported
	})
	if !supported || contentFields != 1 {
		return Result{}, nil
	}
	var content string
	var image *waE2E.ImageMessage
	switch {
	case msg.GetImageMessage() != nil:
		image = msg.GetImageMessage()
		if image.GetViewOnce() {
			return Result{}, nil
		}
		content = image.GetCaption()
	case msg.Conversation != nil:
		content = msg.GetConversation()
	case msg.GetExtendedTextMessage() != nil:
		content = msg.GetExtendedTextMessage().GetText()
	default:
		return Result{}, nil
	}
	if image == nil && content == "" {
		return Result{}, nil
	}
	if evt.Info.ID == "" {
		return Result{}, fmt.Errorf("%w: empty protocol message ID", ErrInvalidIdentity)
	}
	ts := evt.Info.Timestamp
	if ts.IsZero() || ts.Unix() <= 0 || ts.Year() > 9999 || ts.UnixMilli() > maxSafeJSONInteger {
		return Result{}, fmt.Errorf("%w: message %q", ErrInvalidTimestamp, evt.Info.ID)
	}
	account, err := canonicalLID(own, ownAlt, mappings)
	if err != nil {
		return Result{}, err
	}
	if account == "" {
		return Result{}, fmt.Errorf("%w: own LID unavailable for message %q", ErrInvalidIdentity, evt.Info.ID)
	}
	chatAlt := evt.Info.SenderAlt
	if evt.Info.IsFromMe {
		chatAlt = evt.Info.RecipientAlt
	}
	chat, err := canonicalLID(evt.Info.Chat, chatAlt, mappings)
	if err != nil {
		return Result{}, err
	}
	if chat == "" {
		return Result{Unresolved: &UnresolvedIdentity{AccountJID: account, ChatJID: evt.Info.Chat.String(), WhatsAppMessageID: evt.Info.ID}}, nil
	}
	id, err := MessageID(account, chat, evt.Info.ID)
	if err != nil {
		return Result{}, err
	}
	direction := "incoming"
	if evt.Info.IsFromMe {
		direction = "outgoing"
	}
	out := &ReceivedMessage{ID: id, AccountID: account, ChatID: chat, WhatsAppMessageID: evt.Info.ID, Direction: direction, Timestamp: ts.UnixMilli()}
	if content != "" {
		out.Text = &content
	}
	if image != nil {
		descriptor := imageDescriptor{AccountID: account, MessageID: id, MIMEType: image.GetMimetype(), DirectPath: image.GetDirectPath(), MediaKey: encodeBytes(image.GetMediaKey()), FileSHA256: encodeBytes(image.GetFileSHA256()), FileEncSHA256: encodeBytes(image.GetFileEncSHA256())}
		if image.FileLength != nil {
			descriptor.FileLength = strconv.FormatUint(image.GetFileLength(), 10)
		}
		raw, err := json.Marshal(descriptor)
		if err != nil {
			return Result{}, err
		}
		ref := "wa-image:v1:" + base64.RawURLEncoding.EncodeToString(raw)
		if len(ref) > 16*1024 {
			return Result{}, errors.New("image descriptor exceeds 16 KiB")
		}
		if err := ValidateImageReference(ImageReference{MessageID: id, DownloadReference: ref}); err != nil {
			return Result{}, fmt.Errorf("invalid image metadata: %w", err)
		}
		out.Image = &Image{MIMEType: image.GetMimetype(), Reference: ImageReference{MessageID: id, DownloadReference: ref}}
		if image.FileLength != nil && image.GetFileLength() <= maxSafeJSONInteger {
			size := image.GetFileLength()
			out.Image.Size = &size
		}
	}
	return Result{Message: out}, nil
}

func canonicalLID(jid, alternate types.JID, mappings VerifiedLIDs) (string, error) {
	jid = jid.ToNonAD()
	alternate = alternate.ToNonAD()
	if jid.Server == types.HiddenUserServer && jid.User != "" && jid.Integrator == 0 {
		return jid.String(), nil
	}
	if alternate.Server == types.HiddenUserServer && alternate.User != "" && alternate.Integrator == 0 {
		return alternate.String(), nil
	}
	if jid.Server != types.DefaultUserServer || jid.User == "" {
		return "", nil
	}
	lid, ok := mappings[jid]
	if !ok {
		return "", nil
	}
	lid = lid.ToNonAD()
	if lid.Server != types.HiddenUserServer || lid.User == "" || lid.Integrator != 0 {
		return "", fmt.Errorf("%w: invalid verified LID for %s", ErrInvalidIdentity, jid)
	}
	return lid.String(), nil
}

func MessageID(accountID, chatID, whatsappMessageID string) (string, error) {
	if !validLID(accountID) || !validLID(chatID) || whatsappMessageID == "" {
		return "", ErrInvalidIdentity
	}
	raw, err := json.Marshal([3]string{accountID, chatID, whatsappMessageID})
	if err != nil {
		return "", err
	}
	return "wa-message:v1:" + base64.RawURLEncoding.EncodeToString(raw), nil
}
func validLID(value string) bool {
	jid, err := types.ParseJID(value)
	return err == nil && jid.Server == types.HiddenUserServer && jid.User != "" && jid.ToNonAD().String() == value && jid.Integrator == 0 && !strings.ContainsAny(jid.User, "@.:/")
}
func encodeBytes(value []byte) string {
	if len(value) == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(value)
}

// NewDeliveryID checks every candidate against the caller's durable pending set.
// The caller must serialize the check and insertion in the same admission transaction.
func NewDeliveryID(random io.Reader, pending func(string) (bool, error)) (string, error) {
	if random == nil {
		random = rand.Reader
	}
	if pending == nil {
		return "", errors.New("pending lookup required")
	}
	for range 16 {
		var bytes [16]byte
		if _, err := io.ReadFull(random, bytes[:]); err != nil {
			return "", err
		}
		id := "wa-delivery:v1:" + hex.EncodeToString(bytes[:])
		exists, err := pending(id)
		if err != nil {
			return "", err
		}
		if !exists {
			return id, nil
		}
	}
	return "", errors.New("delivery ID collisions exhausted")
}

// ValidateImageReference enforces the descriptor contract before download.
func ValidateImageReference(ref ImageReference) error {
	const prefix = "wa-image:v1:"
	if !strings.HasPrefix(ref.DownloadReference, prefix) || len(ref.DownloadReference) > 16*1024 {
		return ErrInvalidIdentity
	}
	encoded := strings.TrimPrefix(ref.DownloadReference, prefix)
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != encoded {
		return ErrInvalidIdentity
	}
	var descriptor imageDescriptor
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&descriptor); err != nil {
		return err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return ErrInvalidIdentity
	}
	if descriptor.MessageID != ref.MessageID || !validLID(descriptor.AccountID) {
		return ErrInvalidIdentity
	}
	tuple, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(ref.MessageID, "wa-message:v1:"))
	if err != nil || !strings.HasPrefix(ref.MessageID, "wa-message:v1:") {
		return ErrInvalidIdentity
	}
	var parts [3]string
	if json.Unmarshal(tuple, &parts) != nil || parts[0] != descriptor.AccountID {
		return ErrInvalidIdentity
	}
	if canonical, err := MessageID(parts[0], parts[1], parts[2]); err != nil || canonical != ref.MessageID {
		return ErrInvalidIdentity
	}
	for _, field := range []string{descriptor.MediaKey, descriptor.FileSHA256, descriptor.FileEncSHA256} {
		if field == "" {
			continue
		}
		value, err := base64.StdEncoding.DecodeString(field)
		if err != nil || len(value) != 32 || base64.StdEncoding.EncodeToString(value) != field {
			return ErrInvalidIdentity
		}
	}
	if descriptor.FileLength != "" {
		n, err := strconv.ParseUint(descriptor.FileLength, 10, 64)
		if err != nil || strconv.FormatUint(n, 10) != descriptor.FileLength {
			return ErrInvalidIdentity
		}
	}
	if descriptor.DirectPath != "" && (!strings.HasPrefix(descriptor.DirectPath, "/") || strings.HasPrefix(descriptor.DirectPath, "//") || strings.ContainsAny(descriptor.DirectPath, "?#") || strings.Contains(descriptor.DirectPath, "://")) {
		return ErrInvalidIdentity
	}
	return nil
}
