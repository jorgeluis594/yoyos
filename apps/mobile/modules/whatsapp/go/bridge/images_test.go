package bridge

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/connection"
	"yoyos-whatsapp/internal/images"
	"yoyos-whatsapp/internal/normalization"
)

const imageAccount = "123@lid"

// mediaTransport is a connected transport whose downloads are scripted.
type mediaTransport struct {
	download func(ctx context.Context, request connection.MediaRequest, file connection.MediaFile) error
	events   chan<- connection.TransportEvent
	started  chan struct{}
	once     sync.Once
	calls    int
	mu       sync.Mutex
}

func (m *mediaTransport) Run(ctx context.Context, events chan<- connection.TransportEvent) error {
	events <- connection.TransportEvent{Kind: "connected"}
	<-ctx.Done()
	return ctx.Err()
}
func (m *mediaTransport) Stop() {}
func (m *mediaTransport) DownloadMedia(ctx context.Context, request connection.MediaRequest, file connection.MediaFile) error {
	m.mu.Lock()
	m.calls++
	m.mu.Unlock()
	return m.download(ctx, request, file)
}
func (m *mediaTransport) networkCalls() int { m.mu.Lock(); defer m.mu.Unlock(); return m.calls }

func connectedImageSession(t *testing.T, transport *mediaTransport, imageSession *ImageSession) *ConnectionSession {
	t.Helper()
	device := &store.Device{LID: types.JID{User: "123", Device: 1, Server: types.HiddenUserServer}}
	session := &ConnectionSession{device: device}
	session.controller = connection.New(func() (connection.Transport, error) { return transport, nil }, func(connection.Event) {}, nil)
	session.controller.Prepare(true)
	t.Cleanup(func() { session.Close() })
	session.AttachImages(imageSession)
	if code := session.Connect(); code != "" {
		t.Fatal(code)
	}
	for session.State() != "connected" {
		time.Sleep(time.Millisecond)
	}
	return session
}

func imageReference(t *testing.T, wid string, plain []byte) (string, string) {
	t.Helper()
	id, err := normalization.MessageID(imageAccount, "456@lid", wid)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(plain)
	key := bytes.Repeat([]byte{3}, 32)
	enc := bytes.Repeat([]byte{4}, 32)
	raw, _ := json.Marshal(map[string]string{
		"accountId": imageAccount, "messageId": id, "mimeType": "image/jpeg", "directPath": "/v/t62/" + wid,
		"mediaKey": base64.StdEncoding.EncodeToString(key), "fileSha256": base64.StdEncoding.EncodeToString(sum[:]),
		"fileEncSha256": base64.StdEncoding.EncodeToString(enc), "fileLength": itoa(len(plain)),
	})
	return id, "wa-image:v1:" + base64.RawURLEncoding.EncodeToString(raw)
}

func itoa(n int) string { raw, _ := json.Marshal(n); return string(raw) }

func jpeg(n int) []byte {
	out := bytes.Repeat([]byte{0x11}, n)
	copy(out, []byte{0xFF, 0xD8, 0xFF, 0xE0})
	return out
}

func writeAll(plain []byte) func(context.Context, connection.MediaRequest, connection.MediaFile) error {
	return func(_ context.Context, _ connection.MediaRequest, file connection.MediaFile) error {
		_, err := file.Write(plain)
		return err
	}
}

func openImageSession(t *testing.T, limit int64) (*ImageSession, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "images")
	opened := OpenImages(dir, limit)
	if opened.Code != "" {
		t.Fatal(opened.Code)
	}
	return opened.Session, dir
}

// IT-IMG-01, IT-IMG-05, IT-IMG-06 through the bridge: no automatic connection, then a verified file.
func TestITIMG05And06BridgeDownloadNeedsTheOriginAccountAndPublishesBeforeReturning(t *testing.T) {
	plain := jpeg(2048)
	id, ref := imageReference(t, "one", plain)
	imageSession, dir := openImageSession(t, 1<<20)
	if result := imageSession.Download(id, ref); result.Code != "ACCOUNT_NOT_CONNECTED" {
		t.Fatalf("without a session: %+v", result)
	}
	transport := &mediaTransport{download: writeAll(plain)}
	session := connectedImageSession(t, transport, imageSession)
	result := imageSession.Download(id, ref)
	if result.Code != "" || result.MimeType != "image/jpeg" || result.Size != 2048 || filepath.Dir(result.Path) != dir {
		t.Fatalf("download: %+v", result)
	}
	if got, err := os.ReadFile(result.Path); err != nil || !bytes.Equal(got, plain) {
		t.Fatalf("published file: %v", err)
	}
	other, _ := normalization.MessageID("999@lid", "456@lid", "x")
	foreign, _ := json.Marshal(map[string]string{"accountId": "999@lid", "messageId": other, "directPath": "/v/x", "mediaKey": base64.StdEncoding.EncodeToString(make([]byte, 32)), "fileSha256": base64.StdEncoding.EncodeToString(make([]byte, 32)), "fileEncSha256": base64.StdEncoding.EncodeToString(make([]byte, 32))})
	if result := imageSession.Download(other, "wa-image:v1:"+base64.RawURLEncoding.EncodeToString(foreign)); result.Code != "ACCOUNT_NOT_CONNECTED" {
		t.Fatalf("another account's image used this connection: %+v", result)
	}
	_ = session
}

// IT-IMG-08 / IT-IMG-17: complete files survive disconnect, logout and closing the connection, and
// a stalled download never blocks confirmations or the session.
func TestITIMG17CompleteFilesSurviveLogoutAndDownloadsDoNotBlockConfirmations(t *testing.T) {
	plain := jpeg(512)
	id, ref := imageReference(t, "keep", plain)
	imageSession, _ := openImageSession(t, 1<<20)
	transport := &mediaTransport{download: writeAll(plain)}
	session := connectedImageSession(t, transport, imageSession)
	first := imageSession.Download(id, ref)
	if first.Code != "" {
		t.Fatal(first.Code)
	}
	// A different image stalls on the network while a pending entry is confirmed.
	stalled, stalledRef := imageReference(t, "slow", plain)
	release := make(chan struct{})
	started := make(chan struct{})
	transport.download = func(ctx context.Context, _ connection.MediaRequest, _ connection.MediaFile) error {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return ctx.Err()
	}
	finished := make(chan *ImageDownloadResult, 1)
	go func() { finished <- imageSession.Download(stalled, stalledRef) }()
	<-started
	storage := &pendingStorage{}
	storage.add(1)
	delivery, _ := openDelivery(t, storage)
	confirmed := make(chan string, 1)
	go func() { confirmed <- delivery.Confirm(deliveryID(1)) }()
	select {
	case code := <-confirmed:
		if code != "" || storage.count() != 0 {
			t.Fatalf("confirmation: %q", code)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("confirmation waited for the image download")
	}
	session.Disconnect() // retires the generation: the stalled transfer is cancelled
	if result := <-finished; result.Code != "IMAGE_DOWNLOAD_FAILED" {
		t.Fatalf("cancelled download: %+v", result)
	}
	session.Close()
	again := imageSession.Download(id, ref)
	if again.Code != "" || again.Path != first.Path || transport.networkCalls() != 2 {
		t.Fatalf("complete file not reused without a session: %+v calls=%d", again, transport.networkCalls())
	}
	if code := imageSession.Delete(id); code != "" || imageSession.Delete(id) != "" {
		t.Fatal("delete must be idempotent")
	}
}

func TestBridgeRejectsInvalidInputAndUninitializedSession(t *testing.T) {
	imageSession, _ := openImageSession(t, 1<<20)
	if result := imageSession.Download("wa-message:v1:x", "wa-image:v1:AAAA"); result.Code != "INVALID_INPUT" {
		t.Fatalf("%+v", result)
	}
	if imageSession.Delete("../../etc/passwd") != "INVALID_INPUT" {
		t.Fatal("delete accepted a path")
	}
	var missing *ImageSession
	if missing.Download("a", "b").Code != "NOT_INITIALIZED" || missing.Delete("a") != "NOT_INITIALIZED" || missing.SetLimit(1) {
		t.Fatal("nil session")
	}
	if OpenImages("", 1).Code == "" || OpenImages(t.TempDir(), 0).Code == "" {
		t.Fatal("invalid options accepted")
	}
}

// UT-IMG-04 mapping of the pinned client's own failures.
func TestClassifyDownloadSeparatesGoneCorruptAndTransient(t *testing.T) {
	for _, gone := range []error{whatsmeow.ErrMediaDownloadFailedWith403, whatsmeow.ErrMediaDownloadFailedWith404, whatsmeow.ErrMediaDownloadFailedWith410, whatsmeow.ErrNoURLPresent} {
		if !errors.Is(classifyDownload(gone), images.ErrGone) {
			t.Fatalf("%v is not gone", gone)
		}
	}
	for _, corrupt := range []error{whatsmeow.ErrInvalidMediaSHA256, whatsmeow.ErrInvalidMediaEncSHA256, whatsmeow.ErrInvalidMediaHMAC, whatsmeow.ErrTooShortFile} {
		if !errors.Is(classifyDownload(corrupt), images.ErrCorrupt) {
			t.Fatalf("%v is not corrupt", corrupt)
		}
	}
	transient := errors.New("connection reset")
	if got := classifyDownload(transient); got != transient || classifyDownload(nil) != nil {
		t.Fatal("transient failures must pass through")
	}
}
