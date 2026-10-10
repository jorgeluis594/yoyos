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
	return &whatsmeowTransport{receive: receive, client: client, dial: client.ConnectContext, socketConnected: client.IsConnected, socketID: client.CurrentSocketID, loginReconnect: make(chan struct{}, 1), localFailure: localFailure}
}

type whatsmeowTransport struct {
	receive         Receiving
	client          *whatsmeow.Client
	dial            func(context.Context) error
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
