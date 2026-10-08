package connection

import (
	"context"
	"errors"
	"net"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/socket"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types/events"
	"yoyos-whatsapp/internal/protocolstore"
)

// NewWhatsmeowTransport uses the pinned client with a device whose stores and
// generation have already been authorized by the native storage controller.
func NewWhatsmeowTransport(device *store.Device, localFailure func() Code) Transport {
	client := whatsmeow.NewClient(device, nil)
	client.EnableAutoReconnect = false
	client.InitialAutoReconnect = false
	client.DisableLoginAutoReconnect = true
	client.UseRetryMessageStore = false
	return &whatsmeowTransport{client: client, localFailure: localFailure}
}

type whatsmeowTransport struct {
	client       *whatsmeow.Client
	localFailure func() Code
}

func (t *whatsmeowTransport) stopped() Code {
	if t.localFailure != nil {
		return t.localFailure()
	}
	return ""
}

func (t *whatsmeowTransport) Stop() { t.client.Disconnect() }
func (t *whatsmeowTransport) Run(ctx context.Context, out chan<- TransportEvent) error {
	client := t.client
	handler := client.AddEventHandler(func(event any) {
		kind := classify(event)
		if kind == "" {
			return
		}
		if code := t.stopped(); code != "" {
			select {
			case out <- TransportEvent{Kind: "localFailure", Error: code}:
			case <-ctx.Done():
			}
			return
		}
		select {
		case out <- TransportEvent{Kind: kind}:
		case <-ctx.Done():
		}
	})
	defer client.RemoveEventHandler(handler)
	var qr <-chan whatsmeow.QRChannelItem
	if client.Store.ID == nil {
		channel, err := client.GetQRChannel(ctx)
		if err != nil {
			return err
		}
		qr = channel
	}
	connectDone := make(chan error, 1)
	go func() { connectDone <- client.ConnectContext(ctx) }()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
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
		case item, open := <-qr:
			if !open {
				qr = nil
				continue
			}
			switch item.Event {
			case whatsmeow.QRChannelEventCode:
				select {
				case out <- TransportEvent{Kind: "qr", QR: item.Code, ExpiresAt: time.Now().Add(item.Timeout)}:
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
		return "networkFailure"
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
