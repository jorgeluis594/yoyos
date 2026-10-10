package connection

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type mediaTestTransport struct {
	*testTransport
	downloads chan MediaRequest
}

func (m *mediaTestTransport) DownloadMedia(ctx context.Context, request MediaRequest, _ MediaFile) error {
	m.downloads <- request
	<-ctx.Done()
	return ctx.Err()
}

func connectedMedia(t *testing.T) (*Controller, *mediaTestTransport, chan<- TransportEvent) {
	t.Helper()
	transport := &mediaTestTransport{testTransport: newTransport(), downloads: make(chan MediaRequest, 4)}
	c := New(func() (Transport, error) { return transport, nil }, func(Event) {}, nil)
	t.Cleanup(func() { c.Close() })
	c.Prepare(true)
	if c.Connect() != "" {
		t.Fatal("connect rejected")
	}
	channel := started(t, transport.testTransport)
	channel <- TransportEvent{Kind: "connected"}
	for c.State() != Connected {
		time.Sleep(time.Millisecond)
	}
	return c, transport, channel
}

// UT-IMG-05: media is only available while a generation is connected.
func TestMediaLeaseRequiresAConnectedGeneration(t *testing.T) {
	transport := &mediaTestTransport{testTransport: newTransport(), downloads: make(chan MediaRequest, 1)}
	c := New(func() (Transport, error) { return transport, nil }, func(Event) {}, nil)
	t.Cleanup(func() { c.Close() })
	c.Prepare(true)
	if _, err := c.AcquireMedia(c.AdmitMedia()); !errors.Is(err, ErrMediaUnavailable) {
		t.Fatalf("lease without a connection: %v", err)
	}
	c.Connect()
	channel := started(t, transport.testTransport)
	if _, err := c.AcquireMedia(c.AdmitMedia()); !errors.Is(err, ErrMediaUnavailable) {
		t.Fatal("a connecting generation must not serve media")
	}
	channel <- TransportEvent{Kind: "connected"}
	for c.State() != Connected {
		time.Sleep(time.Millisecond)
	}
	if _, err := c.AcquireMedia(c.AdmitMedia()); err != nil {
		t.Fatal(err)
	}
}

// A transport that cannot download never produces a lease.
func TestMediaLeaseNeedsAMediaTransport(t *testing.T) {
	plain := newTransport()
	c := New(func() (Transport, error) { return plain, nil }, func(Event) {}, nil)
	t.Cleanup(func() { c.Close() })
	c.Prepare(true)
	c.Connect()
	started(t, plain) <- TransportEvent{Kind: "connected"}
	for c.State() != Connected {
		time.Sleep(time.Millisecond)
	}
	if _, err := c.AcquireMedia(c.AdmitMedia()); !errors.Is(err, ErrMediaUnavailable) {
		t.Fatal("lease for a transport without media support")
	}
}

// UT-IMG-15: retiring the generation cancels the transfer immediately and publication loses.
func TestMediaLeaseRetirementCancelsAndBlocksPublication(t *testing.T) {
	c, transport, _ := connectedMedia(t)
	lease, err := c.AcquireMedia(c.AdmitMedia())
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { result <- lease.Download(lease.Context(), MediaRequest{DirectPath: "/v/x"}, nil) }()
	if request := <-transport.downloads; request.DirectPath != "/v/x" {
		t.Fatalf("request %+v", request)
	}
	c.Disconnect()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("download ended with %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("retirement did not cancel the transfer")
	}
	published := false
	if err := lease.Publish(func() error { published = true; return nil }); !errors.Is(err, ErrMediaRetired) || published {
		t.Fatalf("published after retirement: %v", err)
	}
}

// Publication that wins the race runs to completion before the retirement is applied.
func TestMediaPublishIsOrderedBeforeRetirement(t *testing.T) {
	c, _, _ := connectedMedia(t)
	lease, _ := c.AcquireMedia(c.AdmitMedia())
	inside, release := make(chan struct{}), make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	var order []string
	var mu sync.Mutex
	go func() {
		defer wg.Done()
		_ = lease.Publish(func() error {
			close(inside)
			<-release
			mu.Lock()
			order = append(order, "published")
			mu.Unlock()
			return nil
		})
	}()
	<-inside
	done := make(chan struct{})
	go func() { c.Disconnect(); mu.Lock(); order = append(order, "retired"); mu.Unlock(); close(done) }()
	time.Sleep(30 * time.Millisecond)
	close(release)
	wg.Wait()
	<-done
	if len(order) != 2 || order[0] != "published" {
		t.Fatalf("order %v", order)
	}
}

// UT-IMG-16: a request admitted under a generation never gets a later one.
func TestMediaAdmissionBindsToItsGeneration(t *testing.T) {
	c, transport, channel := connectedMedia(t)
	admitted := c.AdmitMedia()
	if !admitted.Connected {
		t.Fatal("admission did not see the connection")
	}
	c.Disconnect()
	if c.Connect() != "" {
		t.Fatal("reconnect rejected")
	}
	_ = channel
	_ = transport
	// The controller reuses the same test transport instance, so wait for its new run.
	next := started(t, transport.testTransport)
	next <- TransportEvent{Kind: "connected"}
	for c.State() != Connected {
		time.Sleep(time.Millisecond)
	}
	if _, err := c.AcquireMedia(admitted); !errors.Is(err, ErrMediaUnavailable) {
		t.Fatal("queued request got a newer generation")
	}
	if _, err := c.AcquireMedia(c.AdmitMedia()); err != nil {
		t.Fatalf("a fresh admission must work: %v", err)
	}
	if _, err := c.AcquireMedia(MediaAdmission{}); err != nil {
		t.Fatalf("admitted while disconnected may use the connected generation: %v", err)
	}
}
