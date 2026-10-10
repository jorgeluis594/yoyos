package connection

import (
	"context"
	"errors"
	"net"
	"sync/atomic"
	"time"

	"go.mau.fi/whatsmeow"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/socket"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"yoyos-whatsapp/internal/protocolstore"
)

// Receiving is the durable receive path: it captures encrypted children before
// decryption, decides whether the handler may acknowledge, and classifies faults.
type Receiving interface {
	PreDecrypt(context.Context, *types.MessageInfo, *waBinary.Node) (context.Context, error)
	Handle(context.Context, any) bool
	Finished(context.Context, *types.MessageInfo, error)
	SetProcessor(protocolstore.RecoveryProcessor)
}

// NewWhatsmeowTransport uses the pinned client with a device whose stores and
// generation have already been authorized by the native storage controller.
// With a receive path it enables the decrypted-event buffer and synchronous
// acknowledgements, and does not trust those flags alone: the handler result
// is what releases the acknowledgement.
func NewWhatsmeowTransport(device *store.Device, localFailure func() Code, receiving ...Receiving) Transport {
	client := whatsmeow.NewClient(device, nil)
	client.EnableAutoReconnect = false
	client.InitialAutoReconnect = false
	client.DisableLoginAutoReconnect = true
	client.UseRetryMessageStore = false
	var receive Receiving
	if len(receiving) > 0 && receiving[0] != nil {
		receive = receiving[0]
		client.EnableDecryptedEventBuffer = true
		client.SynchronousAck = true
		client.PreDecryptMessage = receive.PreDecrypt
		client.MessageReceiveFinished = receive.Finished
		receive.SetProcessor(client)
	}
	return &whatsmeowTransport{receive: receive, client: client, dial: client.ConnectContext, unlink: client.Logout, socketConnected: client.IsConnected, socketID: client.CurrentSocketID, loginReconnect: make(chan struct{}, 1), localFailure: localFailure}
}

type whatsmeowTransport struct {
	receive         Receiving
	client          *whatsmeow.Client
	dial            func(context.Context) error
	unlink          func(context.Context) error
	socketConnected func() bool
	socketID        func() uint64
	loginReconnect  chan struct{}
	localFailure    func() Code
	pairedSocketID  atomic.Uint64
	handedOff       atomic.Bool
}

func (t *whatsmeowTransport) stopped() Code {
	if t.localFailure != nil {
		return t.localFailure()
	}
	return ""
}

func (t *whatsmeowTransport) Stop() { t.client.Disconnect() }

// Logout asks WhatsApp to unlink this device. The pinned client deletes its own store afterwards;
// the container refuses that deletion with NativeLogoutRequired (native owns retirement), and
// that refusal comes only after the server accepted the request, so it counts as confirmation.
func (t *whatsmeowTransport) Logout(ctx context.Context) error {
	if t.client != nil && t.client.Store.ID == nil {
		return whatsmeow.ErrNotLoggedIn // nothing linked: there is no login to wait for
	}
	if t.client != nil {
		if err := t.authenticated(ctx); err != nil {
			return err
		}
	}
	return confirmedUnlink(t.unlink(ctx))
}

// authenticated connects when needed and waits for the login to complete, so the unlink
// request is not sent over a socket the server has not accepted yet.
func (t *whatsmeowTransport) authenticated(ctx context.Context) error {
	ready, refused := make(chan struct{}, 1), make(chan struct{}, 1)
	handler := t.client.AddEventHandler(func(event any) {
		switch event.(type) {
		case *events.Connected:
			select {
			case ready <- struct{}{}:
			default:
			}
		case *events.LoggedOut, *events.ConnectFailure, *events.Disconnected, *events.StreamReplaced:
			select {
			case refused <- struct{}{}:
			default:
			}
		}
	})
	defer t.client.RemoveEventHandler(handler)
	if t.client.IsLoggedIn() {
		return nil
	}
	if !t.socketConnected() {
		if err := t.dial(ctx); err != nil {
			return err
		}
	}
	select {
	case <-ready:
		return nil
	case <-refused:
		return errors.New("connection closed before the login completed")
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Quiesce makes the connected client withhold acknowledgements: with no handler left after
// the run ended, the pinned client would confirm deliveries that never reached the receiver.
func (t *whatsmeowTransport) Quiesce() {
	t.client.AddEventHandlerWithSuccessStatus(rejectDeliveries)
}

func confirmedUnlink(err error) error {
	var failure *protocolstore.Error
	if errors.As(err, &failure) && failure.Code == protocolstore.NativeLogoutRequired {
		return nil
	}
	return err
}
func (t *whatsmeowTransport) Reconnect() {
	select {
	case t.loginReconnect <- struct{}{}:
	default:
	}
}
func (t *whatsmeowTransport) Run(ctx context.Context, out chan<- TransportEvent) error {
	client := t.client
	handler := client.AddEventHandler(func(event any) {
		kind := classify(event)
		if kind == "" {
			return
		}
		switch value := event.(type) {
		case *events.Disconnected:
			// Once pairing succeeded, the pairing socket closing is the start of
			// the handoff even if the dependency lost its 515. The same one-shot
			// flag as the 515 decides which of the two redials.
			if value.SocketID != 0 && value.SocketID == t.pairedSocketID.Load() {
				if !t.handedOff.CompareAndSwap(false, true) {
					return
				}
				kind = "loginReconnect"
			}
		case *events.ManualLoginReconnect:
			// The pinned queue drains stream:error after the socket closed, so the
			// pairing socket's 515 is honored once even when no socket is current.
			paired := value.SocketID != 0 && value.SocketID == t.pairedSocketID.Load()
			current := value.SocketID != 0 && value.SocketID == t.socketID()
			if paired {
				if !t.handedOff.CompareAndSwap(false, true) {
					return
				}
			} else if !current {
				return
			}
		case *events.Connected:
			if value.SocketID == 0 || value.SocketID == t.pairedSocketID.Load() || value.SocketID != t.socketID() || !t.socketConnected() {
				return
			}
		}
		if code := t.stopped(); code != "" {
			select {
			case out <- TransportEvent{Kind: "localFailure", Error: code}:
			case <-ctx.Done():
			}
			return
		}
		if paired, ok := event.(*events.PairSuccess); ok {
			t.pairedSocketID.Store(paired.SocketID)
			t.handedOff.Store(false)
		}
		select {
		case out <- TransportEvent{Kind: kind}:
		case <-ctx.Done():
		}
	})
	defer client.RemoveEventHandler(handler)
	if t.receive != nil {
		receiver := client.AddEventHandlerWithSuccessStatus(func(event any) bool { return t.receive.Handle(ctx, event) })
		defer client.RemoveEventHandler(receiver)
	}
	var qr <-chan whatsmeow.QRChannelItem
	if client.Store.ID == nil {
		channel, err := client.GetQRChannel(ctx)
		if err != nil {
			return err
		}
		qr = channel
	}
	connectDone := make(chan error, 1)
	go func() { connectDone <- t.dial(ctx) }()
	reconnecting, reconnectPending := false, false
	startReconnect := func() {
		connectDone = make(chan error, 1)
		reconnecting = true
		go func(done chan<- error) {
			client.Disconnect()
			if err := ctx.Err(); err != nil {
				done <- err
				return
			}
			done <- t.dial(ctx)
		}(connectDone)
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.loginReconnect:
			if connectDone == nil {
				startReconnect()
			} else if !reconnecting {
				reconnectPending = true
			}
		case err := <-connectDone:
			if err != nil {
				if code := t.stopped(); code != "" {
					return RunError{Code: code}
				}
				if code := storageCode(err); code != "" {
					return RunError{Code: code}
				}
				var network net.Error
				return RunError{Retry: errors.Is(err, socket.ErrDialFailed) || errors.As(err, &network)}
			}
			// ConnectContext establishes the socket; authentication and QR continue via events.
			connectDone = nil
			if reconnectPending {
				reconnectPending = false
				startReconnect()
			}
		case item, open := <-qr:
			if !open {
				qr = nil
				continue
			}
			switch item.Event {
			case whatsmeow.QRChannelEventCode:
				qrEvent, valid := codeEvent(item, time.Now())
				if !valid {
					continue
				}
				select {
				case out <- qrEvent:
				case <-ctx.Done():
					return ctx.Err()
				}
			case whatsmeow.QRChannelSuccess.Event:
				qr = nil
			default:
				if code := t.stopped(); code != "" {
					return RunError{Code: code}
				}
				if code := storageCode(item.Error); code != "" {
					return RunError{Code: code}
				}
				return RunError{Retry: false}
			}
		}
	}
}

func codeEvent(item whatsmeow.QRChannelItem, now time.Time) (TransportEvent, bool) {
	if item.Code == "" || !now.Before(item.ExpiresAt) {
		return TransportEvent{}, false
	}
	return TransportEvent{Kind: "qr", QR: item.Code, ExpiresAt: item.ExpiresAt}, true
}

func storageCode(err error) Code {
	var failure *protocolstore.Error
	if !errors.As(err, &failure) {
		return ""
	}
	switch failure.Code {
	case protocolstore.SessionFull:
		return SessionStorageLimitReached
	case protocolstore.StateInvalid:
		return SessionStateInvalid
	default:
		return SessionStorageFailed
	}
}

func classify(event any) string {
	switch value := event.(type) {
	case *events.Connected:
		return "connected"
	case *events.PairSuccess:
		return "authenticating"
	case *events.ManualLoginReconnect:
		return "loginReconnect"
	case *events.Disconnected:
		return "networkFailure"
	case *events.LoggedOut:
		return "revoked"
	case *events.ConnectFailure:
		if value.Reason.IsLoggedOut() {
			return "revoked"
		}
		if value.Reason == events.ConnectFailureInternalServerError || value.Reason == events.ConnectFailureExperimental || value.Reason == events.ConnectFailureServiceUnavailable {
			return "networkFailure"
		}
		return "permanentFailure"
	case *events.ClientOutdated, *events.StreamReplaced:
		return "permanentFailure"
	default:
		return ""
	}
}

// NewUnlinkTransport builds the client that connects only to request the unlink. The server
// starts the offline queue as soon as the client is active, before the request can be sent, and
// this client has no durable receive path. It therefore processes nothing: the pre-decrypt hook
// rejects every message before any decryption or Signal state change, synchronous acknowledgements
// wait for handlers, and a handler rejects them all. Encrypted messages are neither decrypted nor
// acknowledged, but after a successful logout the device is unlinked and the server discards that
// queue: it is lost to Yoyos and is not redelivered. Only if the local retirement then fails and the
// session survives can a later connection receive it again. Notifications and the paths that run
// before the hook may still write to the store being retired or be acknowledged. Whatsmeow offers
// no way to stay passive, which would avoid the queue altogether.
func NewUnlinkTransport(device *store.Device, localFailure func() Code) Transport {
	transport := NewWhatsmeowTransport(device, localFailure).(*whatsmeowTransport)
	client := transport.client
	client.SynchronousAck = true
	client.EnableDecryptedEventBuffer = true // a panic while receiving then withholds the acknowledgement
	client.PreDecryptMessage = func(context.Context, *types.MessageInfo, *waBinary.Node) (context.Context, error) {
		return nil, errUnlinkOnly
	}
	client.AddEventHandlerWithSuccessStatus(rejectDeliveries)
	return transport
}

var errUnlinkOnly = errors.New("this connection only unlinks the device")

// rejectDeliveries fails every event that carries content to acknowledge. The dispatcher stops at
// the first handler that fails, so connection lifecycle events pass: the handlers that watch the
// login, the logout and the socket must still run.
func rejectDeliveries(event any) bool {
	switch event.(type) {
	case *events.Connected, *events.Disconnected, *events.LoggedOut, *events.ConnectFailure, *events.StreamReplaced,
		*events.ClientOutdated, *events.ManualLoginReconnect, *events.PairSuccess, *events.StreamError, *events.TemporaryBan,
		*events.KeepAliveTimeout, *events.KeepAliveRestored:
		return true
	}
	return false
}
