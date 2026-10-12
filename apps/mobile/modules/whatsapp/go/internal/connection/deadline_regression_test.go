package connection

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/types/events"
	"yoyos-whatsapp/internal/protocolstore"
)

type reviewStorage struct{}

func (reviewStorage) ReadState(string) (string, error)         { panic("unexpected storage") }
func (reviewStorage) ApplyChanges(string) (string, error)      { panic("unexpected storage") }
func (reviewStorage) BeginFreshSession(string) (string, error) { panic("unexpected storage") }

type reviewRoundTrip func(*http.Request) (*http.Response, error)

func (f reviewRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestManualLoginReconnectIsHandled(t *testing.T) {
	if got := classify(&events.ManualLoginReconnect{}); got == "" {
		t.Fatal("515 ManualLoginReconnect is ignored")
	}
}
func TestDeadlineCancelsActualDial(t *testing.T) {
	device, err := protocolstore.NewFirstLinkDevice(reviewStorage{}, "g", 1000, 1000)
	if err != nil {
		t.Fatal(err)
	}
	transport := NewWhatsmeowTransport(device, nil).(*whatsmeowTransport)
	entered := make(chan struct{})
	canceled := make(chan struct{})
	transport.client.SetPreLoginHTTPClient(&http.Client{Transport: reviewRoundTrip(func(r *http.Request) (*http.Response, error) {
		close(entered)
		<-r.Context().Done()
		close(canceled)
		return nil, r.Context().Err()
	})})
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 10)}
	c := New(func() (Transport, error) { return transport, nil }, func(Event) {}, clock)
	defer c.Close()
	c.Prepare(false)
	c.Connect()
	<-entered
	clock.WaitTimer(t)
	clock.Advance(31 * time.Second)
	select {
	case <-canceled:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("deadline calls Disconnect before cancel: actual dial remains uncanceled")
	}
}

// Expired clock with a delayed timer models a resumed scheduler observing a result first.
func TestLateConnectedRechecksDeadline(t *testing.T) {
	clock := &testClock{now: time.Unix(0, 0), created: make(chan struct{}, 10)}
	transport := newTransport()
	out := make(chan Event, 10)
	c := New(func() (Transport, error) { return transport, nil }, func(e Event) { out <- e }, clock)
	defer c.Close()
	c.Prepare(true)
	c.Connect()
	ch := started(t, transport)
	receive(t, out)
	clock.WaitTimer(t)
	clock.mu.Lock()
	clock.now = clock.now.Add(31 * time.Second)
	clock.mu.Unlock()
	ch <- TransportEvent{Kind: "connected"}
	e := receive(t, out)
	if e.State == Connected {
		t.Fatal("connected accepted after expired monotonic deadline")
	}
}

type gatedClock struct {
	entered, release chan struct{}
	calls            int
	mu               sync.Mutex
}

func (c *gatedClock) Now() time.Time {
	c.mu.Lock()
	c.calls++
	first := c.calls == 1
	c.mu.Unlock()
	if first {
		close(c.entered)
		<-c.release
	}
	return time.Now()
}
func (c *gatedClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

type failedTransport struct{ returned chan struct{} }

func (t *failedTransport) Run(context.Context, chan<- TransportEvent) error {
	close(t.returned)
	return RunError{Code: SessionStorageFailed}
}
func (t *failedTransport) Stop() {}

func TestRetiredStorageFailureDoesNotStopReplacement(t *testing.T) {
	clock := &gatedClock{entered: make(chan struct{}), release: make(chan struct{})}
	old, fresh := &failedTransport{returned: make(chan struct{})}, newTransport()
	created := 0
	c := New(func() (Transport, error) {
		created++
		if created == 1 {
			return old, nil
		}
		return fresh, nil
	}, func(Event) {}, clock)
	c.Prepare(true)
	c.Connect()
	<-clock.entered
	<-old.returned
	c.Disconnect()
	c.Connect()
	started(t, fresh)
	close(clock.release)
	time.Sleep(10 * time.Millisecond)
	if code := c.Connect(); code != "" {
		t.Fatalf("replacement rejected: %s", code)
	}
	c.Close()
}
