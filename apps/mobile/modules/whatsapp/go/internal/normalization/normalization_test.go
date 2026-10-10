package normalization

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

var own = types.NewJID("9007199254740993", types.HiddenUserServer)
var peer = types.NewJID("9007199254740995", types.HiddenUserServer)

func fixture(body *waE2E.Message, outgoing bool) *events.Message {
	return &events.Message{Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: peer, Sender: peer, IsFromMe: outgoing}, ID: "Ab:C/9", Timestamp: time.Unix(1_600_000_000, 0)}, Message: body, RawMessage: body}
}
func normalize(t *testing.T, evt *events.Message) Result {
	t.Helper()
	out, err := Normalize(evt, own, types.JID{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestLiveAndHistoricalFixturesShareContract(t *testing.T) {
	for _, outgoing := range []bool{false, true} {
		for _, image := range []bool{false, true} {
			body := &waE2E.Message{Conversation: proto.String("  intact  ")}
			if image {
				body = &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("  intact  ")}}
			}
			web := &waWeb.WebMessageInfo{
				Key:                             &waCommon.MessageKey{RemoteJID: proto.String(peer.String()), ID: proto.String("Ab:C/9"), FromMe: proto.Bool(outgoing)},
				OriginalSelfAuthorUserJIDString: proto.String(own.String()), Message: body, MessageTimestamp: proto.Uint64(1_600_000_000),
			}
			before, _ := proto.Marshal(web)
			history, err := (&whatsmeow.Client{}).ParseWebMessage(peer, web)
			if err != nil {
				t.Fatal(err)
			}
			got := normalize(t, history).Message
			want := normalize(t, fixture(body, outgoing)).Message
			if !reflect.DeepEqual(got, want) || got == nil {
				t.Fatalf("source mismatch: %#v %#v", got, want)
			}
			direction := "incoming"
			if outgoing {
				direction = "outgoing"
			}
			if got.Text == nil || *got.Text != "  intact  " || got.Timestamp == nil || *got.Timestamp != 1_600_000_000_000 || got.WhatsAppMessageID != "Ab:C/9" || got.AccountID != own.String() || got.ChatID != peer.String() || got.Direction != direction || (got.Image != nil) != image {
				t.Fatalf("lost source content or identity: %#v", got)
			}
			after, _ := proto.Marshal(web)
			if !bytes.Equal(before, after) {
				t.Fatal("source changed")
			}
		}
	}
}

func TestParsedWrappedHistoricalEditExcluded(t *testing.T) {
	edit := &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(), Key: &waCommon.MessageKey{ID: proto.String("original")}, EditedMessage: &waE2E.Message{Conversation: proto.String("edited content")}}}
	for name, raw := range map[string]*waE2E.Message{
		"ephemeral":             {EphemeralMessage: &waE2E.FutureProofMessage{Message: edit}},
		"device then ephemeral": {DeviceSentMessage: &waE2E.DeviceSentMessage{Message: &waE2E.Message{EphemeralMessage: &waE2E.FutureProofMessage{Message: edit}}}},
	} {
		t.Run(name, func(t *testing.T) {
			evt, err := (&whatsmeow.Client{}).ParseWebMessage(peer, &waWeb.WebMessageInfo{Key: &waCommon.MessageKey{ID: proto.String("edit-event")}, MessageTimestamp: proto.Uint64(1_600_000_000), Message: raw})
			if err != nil {
				t.Fatal(err)
			}
			if evt.IsEdit || evt.Message.GetConversation() != "edited content" {
				t.Fatalf("fixture missed parser edit rewrite: %#v", evt)
			}
			if got := normalize(t, evt); got.Message != nil || got.Unresolved != nil {
				t.Fatalf("edit emitted: %#v", got)
			}
		})
	}
	for name, raw := range map[string]*waE2E.Message{
		"ephemeral": {EphemeralMessage: &waE2E.FutureProofMessage{Message: &waE2E.Message{Conversation: proto.String("ordinary")}}},
		"device":    {DeviceSentMessage: &waE2E.DeviceSentMessage{Message: &waE2E.Message{Conversation: proto.String("ordinary")}}},
	} {
		t.Run(name+" content", func(t *testing.T) {
			evt, err := (&whatsmeow.Client{}).ParseWebMessage(peer, &waWeb.WebMessageInfo{Key: &waCommon.MessageKey{ID: proto.String("ordinary")}, MessageTimestamp: proto.Uint64(1_600_000_000), Message: raw})
			if err != nil {
				t.Fatal(err)
			}
			if got := normalize(t, evt).Message; got == nil || got.Text == nil || *got.Text != "ordinary" {
				t.Fatalf("wrapped content lost: %#v", got)
			}
		})
	}
}

func TestRawEditInspectionBoundary(t *testing.T) {
	for _, tc := range []struct {
		wrappers int
		edit     bool
	}{{7, false}, {8, false}, {9, false}, {7, true}} {
		t.Run(fmt.Sprintf("wrappers=%d/edit=%t", tc.wrappers, tc.edit), func(t *testing.T) {
			leaf := &waE2E.Message{Conversation: proto.String("ordinary")}
			if tc.edit {
				leaf = &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum()}}
			}
			raw := leaf
			for range tc.wrappers {
				raw = &waE2E.Message{EphemeralMessage: &waE2E.FutureProofMessage{Message: raw}}
			}
			evt := fixture(&waE2E.Message{Conversation: proto.String("ordinary")}, false)
			evt.RawMessage = raw
			before, err := proto.Marshal(raw)
			if err != nil {
				t.Fatal(err)
			}
			message := evt.Message
			got, err := Normalize(evt, own, types.JID{}, nil)
			after, marshalErr := proto.Marshal(raw)
			if marshalErr != nil || !bytes.Equal(before, after) || evt.Message != message || evt.RawMessage != raw {
				t.Fatalf("source changed: %v", marshalErr)
			}
			switch {
			case tc.wrappers >= 8:
				if !errors.Is(err, ErrRawEditInspectionExhausted) || got.Message != nil || got.Unresolved != nil {
					t.Fatalf("exhaustion: %#v %v", got, err)
				}
			case tc.edit:
				if err != nil || got.Message != nil || got.Unresolved != nil {
					t.Fatalf("edit: %#v %v", got, err)
				}
			default:
				if err != nil || got.Message == nil || got.Message.Text == nil || *got.Message.Text != "ordinary" {
					t.Fatalf("ordinary content: %#v %v", got, err)
				}
			}
		})
	}
}

func TestImageFixtureAndDescriptor(t *testing.T) {
	image := &waE2E.ImageMessage{Caption: proto.String(" caption "), Mimetype: proto.String("image/jpeg"), FileLength: proto.Uint64(12), DirectPath: proto.String("/mms/image/file"), MediaKey: bytes.Repeat([]byte{1}, 32), FileSHA256: bytes.Repeat([]byte{2}, 32), FileEncSHA256: bytes.Repeat([]byte{3}, 32), URL: proto.String("https://untrusted.example/image"), JPEGThumbnail: []byte{9, 8, 7}}
	got := normalize(t, fixture(&waE2E.Message{ImageMessage: image}, false)).Message
	if got == nil || got.Image == nil || got.Text == nil || *got.Text != " caption " || got.Image.Size == nil || *got.Image.Size != 12 {
		t.Fatalf("image: %#v", got)
	}
	if err := ValidateImageReference(got.Image.Reference); err != nil {
		t.Fatal(err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(got.Image.Reference.DownloadReference, "wa-image:v1:"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("untrusted.example")) || bytes.Contains(raw, []byte("thumbnail")) {
		t.Fatalf("unsafe descriptor: %s", raw)
	}
	image.Caption = nil
	image.Mimetype = nil
	image.FileLength = nil
	image.DirectPath = nil
	image.MediaKey = nil
	image.FileSHA256 = nil
	image.FileEncSHA256 = nil
	missing := normalize(t, fixture(&waE2E.Message{ImageMessage: image}, false)).Message
	if missing == nil || missing.Text != nil || missing.Image == nil || missing.Image.MIMEType != "" || missing.Image.Size != nil {
		t.Fatalf("missing metadata dropped: %#v", missing)
	}
	if err := ValidateImageReference(missing.Image.Reference); err != nil {
		t.Fatal(err)
	}
	image.FileLength = proto.Uint64(maxSafeJSONInteger + 1)
	large := normalize(t, fixture(&waE2E.Message{ImageMessage: image}, false)).Message
	if large.Image.Size != nil || ValidateImageReference(large.Image.Reference) != nil {
		t.Fatalf("unsafe public image size: %#v", large.Image)
	}
}

func TestOwnContentOfQuoteForwardAndEphemeral(t *testing.T) {
	body := &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("own"), ContextInfo: &waE2E.ContextInfo{QuotedMessage: &waE2E.Message{Conversation: proto.String("quoted secret")}, ForwardingScore: proto.Uint32(2)}}}
	evt := fixture(body, false)
	evt.IsEphemeral = true
	got := normalize(t, evt).Message
	if got == nil || got.Text == nil || *got.Text != "own" {
		t.Fatalf("own content: %#v", got)
	}
	encoded, _ := json.Marshal(got)
	if bytes.Contains(encoded, []byte("quoted")) || bytes.Contains(encoded, []byte("forward")) || bytes.Contains(encoded, []byte("expire")) {
		t.Fatalf("unexpected metadata: %s", encoded)
	}
}

func TestExcludedFixtures(t *testing.T) {
	cases := map[string]func(*events.Message){
		"group":          func(e *events.Message) { e.Info.IsGroup = true },
		"group JID":      func(e *events.Message) { e.Info.Chat = types.NewJID("1", types.GroupServer) },
		"view once":      func(e *events.Message) { e.IsViewOnce = true },
		"edit":           func(e *events.Message) { e.IsEdit = true },
		"edit attribute": func(e *events.Message) { e.Info.Edit = types.EditAttributeMessageEdit },
		"delete":         func(e *events.Message) { e.RawMessage = &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{}} },
		"reaction":       func(e *events.Message) { e.Message = &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{}} },
		"video":          func(e *events.Message) { e.Message = &waE2E.Message{VideoMessage: &waE2E.VideoMessage{}} },
		"mixed video":    func(e *events.Message) { e.Message.VideoMessage = &waE2E.VideoMessage{} },
		"audio":          func(e *events.Message) { e.Message = &waE2E.Message{AudioMessage: &waE2E.AudioMessage{}} },
		"document":       func(e *events.Message) { e.Message = &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{}} },
		"sticker":        func(e *events.Message) { e.Message = &waE2E.Message{StickerMessage: &waE2E.StickerMessage{}} },
		"empty":          func(e *events.Message) { e.Message = &waE2E.Message{Conversation: proto.String("")} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			e := fixture(&waE2E.Message{Conversation: proto.String("text")}, false)
			mutate(e)
			got := normalize(t, e)
			if got.Message != nil || got.Unresolved != nil {
				t.Fatalf("unexpected delivery: %#v", got)
			}
		})
	}
	editedHistory := fixture(&waE2E.Message{Conversation: proto.String("already edited")}, false)
	if got := normalize(t, editedHistory).Message; got == nil || *got.Text != "already edited" {
		t.Fatalf("normal history edit: %#v", got)
	}
}

// UT-MSG-07 (decision 2026-10-10): a missing or invalid timestamp is an unknown date, not an error: the content is
// still normalized, the source event is untouched and no date (neither 0 nor the reception time) is invented.
func TestUTMSG07InvalidTimestampBecomesUnknownDateAndKeepsTheContent(t *testing.T) {
	for _, timestamp := range []time.Time{{}, time.Unix(0, 0), time.Unix(-1, 0), time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC), time.Unix(1<<62, 0)} {
		evt := fixture(&waE2E.Message{Conversation: proto.String("recover me")}, false)
		evt.Info.Timestamp = timestamp
		original := evt.Message
		got, err := Normalize(evt, own, types.JID{}, nil)
		if err != nil || got.Message == nil || got.Message.Timestamp != nil || got.Message.Text == nil || *got.Message.Text != "recover me" || evt.Message != original {
			t.Fatalf("timestamp=%v got=%#v err=%v", timestamp, got, err)
		}
		raw, err := json.Marshal(got.Message)
		if err != nil || strings.Contains(string(raw), "timestamp") {
			t.Fatalf("an unknown date must be absent from the JSON, got %s (%v)", raw, err)
		}
		if ValidTimestamp(timestamp) {
			t.Fatalf("%v must not be a valid timestamp", timestamp)
		}
	}
	if !ValidTimestamp(time.Unix(1, 0)) || !ValidTimestamp(time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("the boundaries of the valid range were rejected")
	}
}

// UT-MSG-09 / IT-MSG-09: a message from 1970 plus one second is real history and is not filtered by age.
func TestOldHistoryIsNotFilteredByAge(t *testing.T) {
	old := fixture(&waE2E.Message{Conversation: proto.String("old")}, false)
	old.Info.Timestamp = time.Unix(1, 0)
	if normalize(t, old).Message == nil {
		t.Fatal("old history filtered")
	}
}

func TestStableMessageIdentityAndVerifiedLID(t *testing.T) {
	base := fixture(&waE2E.Message{Conversation: proto.String("one")}, false)
	first := normalize(t, base).Message.ID
	variants := []*events.Message{fixture(&waE2E.Message{Conversation: proto.String("two")}, true), fixture(&waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}, false)}
	variants[0].Info.Timestamp = time.Unix(1, 0)
	variants[1].Info.Chat.Device = 5
	for _, evt := range variants {
		if id := normalize(t, evt).Message.ID; id != first {
			t.Fatalf("unstable identity: %s != %s", id, first)
		}
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(first, "wa-message:v1:"))
	if err != nil {
		t.Fatal(err)
	}
	want := `["9007199254740993@lid","9007199254740995@lid","Ab:C/9"]`
	if string(raw) != want {
		t.Fatalf("tuple %s", raw)
	}
	for _, parts := range [][3]string{{own.String(), peer.String(), "a:b"}, {own.String(), peer.String(), "a|b"}, {peer.String(), own.String(), "Ab:C/9"}} {
		id, _ := MessageID(parts[0], parts[1], parts[2])
		if id == first {
			t.Fatalf("collision %v", parts)
		}
	}
	pn := types.NewJID("12345678901234567890", types.DefaultUserServer)
	pn.Device = 3
	lid := peer
	lid.Device = 8
	evt := fixture(&waE2E.Message{Conversation: proto.String("mapped")}, false)
	evt.Info.Chat = pn
	unresolved := normalize(t, evt)
	if unresolved.Unresolved == nil || unresolved.Message != nil || unresolved.Unresolved.ChatJID != pn.String() {
		t.Fatalf("unresolved: %#v", unresolved)
	}
	mapping := VerifiedLIDs{pn.ToNonAD(): lid}
	resolved, err := Normalize(evt, own, types.JID{}, mapping)
	if err != nil || resolved.Message == nil || resolved.Message.ChatID != peer.String() {
		t.Fatalf("mapping: %#v %v", resolved, err)
	}
	evt.Info.SenderAlt = lid
	alternate := normalize(t, evt).Message
	if alternate == nil || alternate.ID != resolved.Message.ID {
		t.Fatalf("alternate: %#v", alternate)
	}
	ownPN := types.NewJID("999", types.DefaultUserServer)
	if _, err := Normalize(evt, ownPN, types.JID{}, mapping); !errors.Is(err, ErrInvalidIdentity) {
		t.Fatalf("own PN accepted: %v", err)
	}
}

func TestMessageIDRejectsLossyIdentity(t *testing.T) {
	for _, invalid := range []string{string([]byte{0xff}), string([]byte{0xfe})} {
		for _, parts := range [][3]string{{invalid + "@lid", peer.String(), "message"}, {own.String(), invalid + "@lid", "message"}, {own.String(), peer.String(), invalid}} {
			if _, err := MessageID(parts[0], parts[1], parts[2]); !errors.Is(err, ErrInvalidIdentity) {
				t.Fatalf("invalid UTF-8 identity accepted: %v", parts)
			}
		}
	}
	protocolID := "Pedido Ñ/東京"
	id, err := MessageID(own.String(), peer.String(), protocolID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(id, "wa-message:v1:"))
	if err != nil || string(raw) != `["9007199254740993@lid","9007199254740995@lid","Pedido Ñ/東京"]` {
		t.Fatalf("valid non-ASCII protocol ID changed: %s %v", raw, err)
	}
	evt := fixture(&waE2E.Message{Conversation: proto.String("content")}, false)
	evt.Info.ID = string([]byte{0xff})
	if _, err := Normalize(evt, own, types.JID{}, nil); !errors.Is(err, ErrInvalidIdentity) {
		t.Fatalf("normalization accepted invalid protocol ID: %v", err)
	}
	evt.Info.ID = "message"
	badJID := types.NewJID(string([]byte{0xfe}), types.HiddenUserServer)
	if _, err := Normalize(evt, badJID, types.JID{}, nil); !errors.Is(err, ErrInvalidIdentity) {
		t.Fatalf("normalization accepted invalid account: %v", err)
	}
	evt.Info.Chat = badJID
	if _, err := Normalize(evt, own, types.JID{}, nil); !errors.Is(err, ErrInvalidIdentity) {
		t.Fatalf("normalization accepted invalid chat: %v", err)
	}
}

func TestDeliveryIDCollisionAndFailures(t *testing.T) {
	zero := bytes.Repeat([]byte{0}, 16)
	one := bytes.Repeat([]byte{1}, 16)
	pendingID := "wa-delivery:v1:" + strings.Repeat("00", 16)
	n := 0
	id, err := NewDeliveryID(bytes.NewReader(append(zero, one...)), func(candidate string) (bool, error) { n++; return candidate == pendingID, nil })
	if err != nil || n != 2 || id == pendingID || id != "wa-delivery:v1:"+strings.Repeat("01", 16) {
		t.Fatalf("id=%s checks=%d err=%v", id, n, err)
	}
	if _, err := NewDeliveryID(bytes.NewReader(nil), func(string) (bool, error) { return false, nil }); err == nil {
		t.Fatal("short random source accepted")
	}
	marker := errors.New("lookup failed")
	if _, err := NewDeliveryID(bytes.NewReader(zero), func(string) (bool, error) { return false, marker }); !errors.Is(err, marker) {
		t.Fatal(err)
	}
}

func TestImageDescriptorRejectsUnsafeOrIncoherentInput(t *testing.T) {
	msg := normalize(t, fixture(&waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}, false)).Message
	valid := msg.Image.Reference
	for name, change := range map[string]func(*imageDescriptor){
		"wrong account":   func(d *imageDescriptor) { d.AccountID = peer.String() },
		"URL path":        func(d *imageDescriptor) { d.DirectPath = "https://evil.test/image" },
		"short media key": func(d *imageDescriptor) { d.MediaKey = base64.StdEncoding.EncodeToString([]byte{1}) },
		"overflow size":   func(d *imageDescriptor) { d.FileLength = "18446744073709551616" },
	} {
		t.Run(name, func(t *testing.T) {
			raw, _ := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(valid.DownloadReference, "wa-image:v1:"))
			var d imageDescriptor
			_ = json.Unmarshal(raw, &d)
			change(&d)
			raw, _ = json.Marshal(d)
			invalid := ImageReference{MessageID: valid.MessageID, DownloadReference: "wa-image:v1:" + base64.RawURLEncoding.EncodeToString(raw)}
			if ValidateImageReference(invalid) == nil {
				t.Fatal("accepted invalid descriptor")
			}
		})
	}
	if err := ValidateImageReference(ImageReference{MessageID: "other", DownloadReference: valid.DownloadReference}); err == nil {
		t.Fatal("accepted wrong external message ID")
	}
}

func TestImageDescriptorStrictSchema(t *testing.T) {
	id, err := MessageID(own.String(), peer.String(), "message")
	if err != nil {
		t.Fatal(err)
	}
	prefix := fmt.Sprintf(`{"accountId":%q,"messageId":%q`, own.String(), id)
	for name, raw := range map[string][]byte{
		"empty key":           []byte(prefix + `,"mediaKey":""}`),
		"null key":            []byte(prefix + `,"mediaKey":null}`),
		"wrong type":          []byte(prefix + `,"mediaKey":12}`),
		"empty hash":          []byte(prefix + `,"fileSha256":""}`),
		"null encrypted hash": []byte(prefix + `,"fileEncSha256":null}`),
		"empty length":        []byte(prefix + `,"fileLength":""}`),
		"noncanonical length": []byte(prefix + `,"fileLength":"01"}`),
		"empty mime":          []byte(prefix + `,"mimeType":""}`),
		"duplicate account":   []byte(fmt.Sprintf(`{"accountId":"wrong@lid","accountId":%q,"messageId":%q}`, own.String(), id)),
		"wrong key case":      []byte(fmt.Sprintf(`{"ACCOUNTID":%q,"messageId":%q}`, own.String(), id)),
		"invalid UTF-8":       append(append([]byte(prefix+`,"mimeType":"`), 0xff), []byte(`"}`)...),
	} {
		t.Run(name, func(t *testing.T) {
			ref := ImageReference{MessageID: id, DownloadReference: "wa-image:v1:" + base64.RawURLEncoding.EncodeToString(raw)}
			if err := ValidateImageReference(ref); err == nil {
				t.Fatal("malformed descriptor accepted")
			}
		})
	}
	ordered := []byte(fmt.Sprintf(`{"fileLength":"0","messageId":%q,"accountId":%q}`, id, own.String()))
	ref := ImageReference{MessageID: id, DownloadReference: "wa-image:v1:" + base64.RawURLEncoding.EncodeToString(ordered)}
	if err := ValidateImageReference(ref); err != nil {
		t.Fatalf("valid reordered fields rejected: %v", err)
	}
}

// UT-IMG-02: only canonical public message IDs name files and deletions.
func TestValidateMessageIDAcceptsOnlyCanonicalIDs(t *testing.T) {
	id, err := MessageID("123@lid", "456@lid", "ABC")
	if err != nil || ValidateMessageID(id) != nil {
		t.Fatalf("canonical id rejected: %v", err)
	}
	for _, bad := range []string{"", "wa-message:v1:", "wa-message:v1:***", "../../etc/passwd", id + "=", "wa-message:v2:" + id[len("wa-message:v1:"):], "wa-message:v1:" + base64.RawURLEncoding.EncodeToString([]byte(`["x@s.whatsapp.net","456@lid","a"]`))} {
		if ValidateMessageID(bad) == nil {
			t.Fatalf("%q was accepted", bad)
		}
	}
}
