package connection

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
)

type mediaRoundTrip func(*http.Request) (*http.Response, error)

func (f mediaRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// realMediaTransport is the pinned client against the local protocol server, with a controlled
// media HTTP transport. Nothing here talks to WhatsApp.
func realMediaTransport(t *testing.T, roundTrip mediaRoundTrip) *whatsmeowTransport {
	t.Helper()
	wa := newFakeWA(t)
	jid := types.NewJID("media", types.DefaultUserServer)
	transport := NewWhatsmeowTransport(&store.Device{ID: &jid, NoiseKey: keys.NewKeyPair(), PreKeys: openAuthStore{}, PrivacyTokens: openAuthStore{}}, nil).(*whatsmeowTransport)
	wa.point(transport.client)
	transport.client.SetMediaHTTPClient(&http.Client{Transport: roundTrip})
	if err := transport.client.ConnectContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	wa.next().success(t)
	t.Cleanup(transport.client.Disconnect)
	return transport
}

var mediaRequest = MediaRequest{DirectPath: "/v/t62/abc?ccb=11-4&oh=x", MediaKey: make([]byte, 32), FileSHA256: make([]byte, 32), FileEncSHA256: make([]byte, 32)}

// UT-IMG-10 with the pinned client: the 60 s deadline covers the client's own retries, which wait
// with timers that honor the context, and cancellation ends a stalled transfer at once.
func TestPinnedClientRetriesShareTheOperationDeadline(t *testing.T) {
	var attempts atomic.Int32
	var urls []string
	transport := realMediaTransport(t, func(r *http.Request) (*http.Response, error) {
		attempts.Add(1)
		urls = append(urls, r.URL.String())
		return &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
	})
	file := newMemoryFile()
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := transport.DownloadMedia(ctx, mediaRequest, file)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("download ended with %v", err)
	}
	if elapsed := time.Since(started); elapsed > 4*time.Second {
		t.Fatalf("retries outlived the operation deadline: %v", elapsed)
	}
	if attempts.Load() < 2 {
		t.Fatalf("the client did not retry inside the deadline: %d", attempts.Load())
	}
	// M2: the path is used as emitted, with its query, and the hash is appended to it.
	if !strings.HasPrefix(urls[0], "https://media-a.invalid/v/t62/abc?ccb=11-4&oh=x&hash=") {
		t.Fatalf("unexpected media URL %q", urls[0])
	}
}

func TestPinnedClientStalledTransferIsCancelledImmediately(t *testing.T) {
	entered := make(chan struct{})
	transport := realMediaTransport(t, func(r *http.Request) (*http.Response, error) {
		close(entered)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- transport.DownloadMedia(ctx, mediaRequest, newMemoryFile()) }()
	<-entered
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation was not immediate")
	}
}
