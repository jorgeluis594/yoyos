package normalization

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
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
	body := &waE2E.Message{Conversation: proto.String("  intact  ")}
	history, err := (&whatsmeow.Client{}).ParseWebMessage(peer, &waWeb.WebMessageInfo{
		Key:     &waCommon.MessageKey{RemoteJID: proto.String(peer.String()), ID: proto.String("Ab:C/9")},
		Message: body, MessageTimestamp: proto.Uint64(1_600_000_000),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := normalize(t, history).Message; !reflect.DeepEqual(got, normalize(t, fixture(body, false)).Message) {
		t.Fatalf("parsed history differs: %#v", got)
	}
	for _, outgoing := range []bool{false, true} {
		live := fixture(body, outgoing)
		history := fixture(body, outgoing)
		got := normalize(t, live).Message
		want := normalize(t, history).Message
		if !reflect.DeepEqual(got, want) || got == nil {
			t.Fatalf("source mismatch: %#v %#v", got, want)
		}
		if got.Text == nil || *got.Text != "  intact  " || got.Timestamp != 1_600_000_000_000 || got.WhatsAppMessageID != "Ab:C/9" {
			t.Fatalf("lost content: %#v", got)
		}
		if outgoing && got.Direction != "outgoing" || !outgoing && got.Direction != "incoming" {
			t.Fatalf("direction: %s", got.Direction)
		}
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

func TestTimestampFailurePreservesSource(t *testing.T) {
	for _, timestamp := range []time.Time{{}, time.Unix(-1, 0), time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)} {
		evt := fixture(&waE2E.Message{Conversation: proto.String("recover me")}, false)
		evt.Info.Timestamp = timestamp
		original := evt.Message
		got, err := Normalize(evt, own, types.JID{}, nil)
		if !errors.Is(err, ErrInvalidTimestamp) || got.Message != nil || evt.Message != original {
			t.Fatalf("timestamp=%v got=%#v err=%v", timestamp, got, err)
		}
	}
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

func TestDeliveryIDCollisionAndReplay(t *testing.T) {
	zero := bytes.Repeat([]byte{0}, 16)
	one := bytes.Repeat([]byte{1}, 16)
	pendingID := "wa-delivery:v1:" + strings.Repeat("00", 16)
	n := 0
	id, err := NewDeliveryID(bytes.NewReader(append(zero, one...)), func(candidate string) (bool, error) { n++; return candidate == pendingID, nil })
	if err != nil || n != 2 || id == pendingID || id != "wa-delivery:v1:"+strings.Repeat("01", 16) {
		t.Fatalf("id=%s checks=%d err=%v", id, n, err)
	}
	replay := id
	if replay != id {
		t.Fatal("replay changed")
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
