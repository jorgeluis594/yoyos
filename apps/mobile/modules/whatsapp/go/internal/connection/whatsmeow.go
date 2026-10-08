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
)

// NewWhatsmeowTransport uses the pinned client with a device whose stores and
// generation have already been authorized by the native storage controller.
func NewWhatsmeowTransport(device *store.Device) Transport {
	client := whatsmeow.NewClient(device, nil)
	client.EnableAutoReconnect = false
	client.InitialAutoReconnect = false
	client.DisableLoginAutoReconnect = true
	client.UseRetryMessageStore = false
	return &whatsmeowTransport{client: client}
}

type whatsmeowTransport struct{ client *whatsmeow.Client }

func (t *whatsmeowTransport) Stop() { t.client.Disconnect() }
func (t *whatsmeowTransport) Run(ctx context.Context, out chan<- TransportEvent) error {
	client := t.client
	handler := client.AddEventHandler(func(event any) {
		var item TransportEvent
		switch event.(type) {
		case *events.Connected:
			item.Kind = "connected"
		case *events.Disconnected:
			item.Kind = "networkFailure"
		case *events.LoggedOut:
			item.Kind = "revoked"
		case *events.ConnectFailure:
			failure := event.(*events.ConnectFailure)
			if failure.Reason.IsLoggedOut() {
				item.Kind = "revoked"
			} else if failure.Reason >= 500 {
				item.Kind = "networkFailure"
			} else {
				item.Kind = "permanentFailure"
			}
		case *events.ClientOutdated, *events.StreamReplaced:
			item.Kind = "permanentFailure"
		default:
			return
		}
		select {
		case out <- item:
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
				select {
				case out <- TransportEvent{Kind: "authenticating"}:
				case <-ctx.Done():
					return ctx.Err()
				}
			default:
				return RunError{Retry: false}
			}
		}
	}
}
