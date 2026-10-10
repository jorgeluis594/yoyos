package connection

import (
	"context"
	"sync"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"go.mau.fi/whatsmeow/util/keys"
	"yoyos-whatsapp/internal/protocolstore"
)

type fakeReceiving struct {
	mu        sync.Mutex
	grant     bool
	handled   chan context.Context
	captured  int
	finished  []error
	processor protocolstore.RecoveryProcessor
}

func (f *fakeReceiving) PreDecrypt(ctx context.Context, _ *types.MessageInfo, _ *waBinary.Node) (context.Context, error) {
	f.mu.Lock()
	f.captured++
	f.mu.Unlock()
	return ctx, nil
}
func (f *fakeReceiving) Handle(ctx context.Context, event any) bool {
	if _, ok := event.(*events.Message); ok {
		f.handled <- ctx
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.grant
}
func (f *fakeReceiving) Finished(_ context.Context, _ *types.MessageInfo, err error) {
	f.mu.Lock()
	f.finished = append(f.finished, err)
	f.mu.Unlock()
}
func (f *fakeReceiving) SetProcessor(p protocolstore.RecoveryProcessor) { f.processor = p }

func receivingTransport(t *testing.T, f *fakeReceiving) *whatsmeowTransport {
	t.Helper()
	jid := types.NewJID("review", types.DefaultUserServer)
	transport := NewWhatsmeowTransport(&store.Device{ID: &jid, NoiseKey: keys.NewKeyPair()}, nil, f).(*whatsmeowTransport)
	transport.dial = func(ctx context.Context) error { return nil }
	return transport
}

// Real client wiring: the receive path flags, hooks and the success-status handler are installed on the pinned client.
func TestNewWhatsmeowTransportInstallsDurableReceivePath(t *testing.T) {
	f := &fakeReceiving{handled: make(chan context.Context, 4)}
	transport := receivingTransport(t, f)
	client := transport.client
	if !client.EnableDecryptedEventBuffer || !client.SynchronousAck || client.PreDecryptMessage == nil || client.MessageReceiveFinished == nil {
		t.Fatal("durable receive flags or hooks missing")
	}
	if f.processor != protocolstore.RecoveryProcessor(client) {
		t.Fatal("the client is not the protocol replay processor")
	}
	// Without a receiving path the client keeps the plain behavior.
	plain := NewWhatsmeowTransport(&store.Device{ID: transport.client.Store.ID, NoiseKey: keys.NewKeyPair()}, nil).(*whatsmeowTransport)
	if plain.client.EnableDecryptedEventBuffer || plain.client.SynchronousAck || plain.client.PreDecryptMessage != nil {
		t.Fatal("receive path enabled without a receiver")
	}
}

// The handler result decides the dispatch outcome, with the Run context, and is removed with the run.
func TestHandlerResultGatesDispatchAndStopsWithRun(t *testing.T) {
	f := &fakeReceiving{handled: make(chan context.Context, 4)}
	transport := receivingTransport(t, f)
	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan TransportEvent, 8)
	done := make(chan error, 1)
	go func() { done <- transport.Run(ctx, out) }()
	internals := transport.client.DangerousInternals()
	deadline := time.Now().Add(2 * time.Second)
	var failed bool
	for time.Now().Before(deadline) {
		failed = internals.DispatchEvent(&events.Message{})
		select {
		case handled := <-f.handled:
			if handled.Err() != nil {
				t.Fatal("handler context already canceled")
			}
			deadline = time.Time{}
		default:
			time.Sleep(5 * time.Millisecond)
			continue
		}
		break
	}
	if !failed {
		t.Fatal("a refused ACK permission did not fail the dispatch")
	}
	f.mu.Lock()
	f.grant = true
	f.mu.Unlock()
	if internals.DispatchEvent(&events.Message{}) {
		t.Fatal("a granted ACK permission failed the dispatch")
	}
	<-f.handled
	cancel()
	<-done
	before := len(f.handled)
	internals.DispatchEvent(&events.Message{})
	if len(f.handled) != before {
		t.Fatal("handler outlived the run")
	}
}

// The real decrypt entry point invokes the capture hook and always reports the end of the receive.
func TestDecryptMessagesRunsCaptureAndFinishedHooks(t *testing.T) {
	f := &fakeReceiving{handled: make(chan context.Context, 4)}
	transport := receivingTransport(t, f)
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: types.NewJID("1", types.HiddenUserServer), Sender: types.NewJID("1", types.HiddenUserServer)}, ID: "m"}
	node := &waBinary.Node{Tag: "message"}
	_ = transport.client.DangerousInternals().DecryptMessages(context.Background(), info, node)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.captured != 1 || len(f.finished) != 1 {
		t.Fatalf("hooks ran captured=%d finished=%d", f.captured, len(f.finished))
	}
}

// m1: resuming reads native state without holding the controller lock.
func TestResumeCapacityDoesNotHoldControllerLockWhileBuilding(t *testing.T) {
	first := newTransport()
	building := make(chan struct{})
	release := make(chan struct{})
	count := 0
	c := New(func() (Transport, error) {
		count++
		if count == 1 {
			return first, nil
		}
		close(building)
		<-release
		return newTransport(), nil
	}, func(Event) {}, nil)
	defer c.Close()
	c.Prepare(true)
	c.Connect()
	started(t, first)
	c.PauseForCapacity()
	go c.ResumeCapacity()
	<-building
	returned := make(chan struct{})
	go func() { c.Disconnect(); close(returned) }()
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("Disconnect blocked behind native I/O during resume")
	}
	close(release)
	time.Sleep(50 * time.Millisecond)
	if c.State() != Disconnected {
		t.Fatalf("a stale resume restarted the connection: %s", c.State())
	}
}
