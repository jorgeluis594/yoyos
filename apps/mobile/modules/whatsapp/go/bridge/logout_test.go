package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/connection"
	"yoyos-whatsapp/internal/protocolstate"
)

// pairedSession opens a first-link session whose pairing is stored, with two pending entries
// from the same account: one whose PN/LID mapping is stored (entry 0) and one without (entry 1).
func pairedSession(t *testing.T) (*ConnectionSession, *linkStorage, *DeliverySession, *deliverySink) {
	t.Helper()
	native := &linkStorage{records: map[string]protocolstate.Record{}}
	delivery, sink := openDeliveryOn(t, native)
	opened := OpenConnectionWithDelivery(native, connectionSink{}, delivery, "gen", "", 10<<20, 10<<20)
	if opened.Code != "" {
		t.Fatal(opened.Code)
	}
	t.Cleanup(func() { opened.Session.Close() })
	opened.Session.controller.SetUnlinkTransport(func() (connection.Transport, error) { return &offlineUnlink{}, nil })
	device := pairedDevice(opened.Session.device)
	if err := device.Container.PutDevice(context.Background(), device); err != nil {
		t.Fatal(err)
	}
	native.mu.Lock()
	native.pending = append(native.pending, pendingEntry(t, 1, "con mapping"), pendingEntry(t, 2, "sin mapping"))
	native.pending[1].Recovery.MessageInfoJSON = `{"version":1,"accountId":"123@lid","id":"p2","chat":"34700@s.whatsapp.net","sender":"34700@s.whatsapp.net","timestampSeconds":1700000000}`
	native.mu.Unlock()
	return opened.Session, native, delivery, sink
}

func storeMapping(t *testing.T, session *ConnectionSession, lid, pn string) {
	t.Helper()
	protocol, _ := session.accountStore()
	if err := protocol.PutLIDMapping(context.Background(), types.JID{User: lid, Server: types.HiddenUserServer}, types.JID{User: pn, Server: types.DefaultUserServer}); err != nil {
		t.Fatal(err)
	}
}

// IT-ID-09, IT-OUT-06: the mappings already verifiable are completed before the session is
// retired; the remaining entries stay pending under their original account.
func TestITID09ITOUT06ResolvesAvailableMappingsBeforeLogoutAndKeepsTheRest(t *testing.T) {
	session, native, _, _ := pairedSession(t)
	storeMapping(t, session, "9001", "34600")
	if code := session.Logout(); code != "REMOTE_LOGOUT_UNCONFIRMED" {
		t.Fatalf("logout returned %q", code)
	}
	if native.state(0) != "resolved" || native.state(1) != "pendingLid" {
		t.Fatalf("states %q %q", native.state(0), native.state(1))
	}
	native.mu.Lock()
	defer native.mu.Unlock()
	if len(native.pending) != 2 || native.pending[0].AccountID != "123@lid" || native.pending[1].AccountID != "123@lid" {
		t.Fatal("pending entries were lost or reassigned")
	}
}

// IT-INI-07: a session that never connected can log out; the remote unlink cannot be verified,
// and the stopped session refuses a new link until native retires it and opens another.
func TestITINI07LogoutFromPartialInitializationIsUnconfirmedAndBlocksRelink(t *testing.T) {
	session, _, _, _ := pairedSession(t)
	if code := session.Logout(); code != "REMOTE_LOGOUT_UNCONFIRMED" {
		t.Fatalf("logout returned %q", code)
	}
	if code := session.Connect(); code != "SESSION_STATE_INVALID" {
		t.Fatalf("connect after logout returned %q", code)
	}
	if session.State() != "disconnected" {
		t.Fatal(session.State())
	}
}

// IT-OUT-05: a repeat is a local success and does not claim a remote result.
func TestITOUT05RepeatedLogoutIsLocalSuccess(t *testing.T) {
	session, _, _, _ := pairedSession(t)
	first, second := session.Logout(), session.Logout()
	if first != "REMOTE_LOGOUT_UNCONFIRMED" || second != "" {
		t.Fatalf("%q %q", first, second)
	}
	if code := (*ConnectionSession)(nil).Logout(); code != "NOT_INITIALIZED" {
		t.Fatal(code)
	}
}

// IT-ID-10, IT-OUT-06: after logout the previous account's entries are still delivered and can be
// confirmed with no active account, and no storage write is made on behalf of any session.
func TestITID10PreviousAccountEntriesRecoverAndConfirmAfterLogout(t *testing.T) {
	session, native, delivery, sink := pairedSession(t)
	storeMapping(t, session, "9001", "34600")
	if code := session.Logout(); code != "REMOTE_LOGOUT_UNCONFIRMED" {
		t.Fatal(code)
	}
	session.Close()
	native.mu.Lock()
	revision := native.revision
	native.mu.Unlock()
	delivery.SetConsumer("after-logout")
	delivery.Start()
	d := sink.next(t)
	if d.Payload.DeliveryID != deliveryID(1) {
		t.Fatalf("delivered %q", d.Payload.DeliveryID)
	}
	if code := delivery.Confirm(d.Payload.DeliveryID); code != "" {
		t.Fatalf("confirm returned %q", code)
	}
	if native.state(1) != "pendingLid" {
		t.Fatal("the entry without a mapping was resolved without its account")
	}
	native.mu.Lock()
	defer native.mu.Unlock()
	if native.revision != revision {
		t.Fatal("recovery or confirmation wrote protocol state")
	}
}

// offlineUnlink stands for a connection that cannot reach WhatsApp: tests never use the network.
type offlineUnlink struct {
	asked   int
	confirm bool
}

func (o *offlineUnlink) Run(ctx context.Context, _ chan<- connection.TransportEvent) error {
	<-ctx.Done()
	return ctx.Err()
}
func (o *offlineUnlink) Stop() {}
func (o *offlineUnlink) Logout(context.Context) error {
	o.asked++
	if o.confirm {
		return nil
	}
	return errors.New("offline")
}

// M2: with no live socket the unlink is still requested, through a connection made for it.
func TestM2LogoutWithoutLiveSocketRequestsUnlinkThroughOwnConnection(t *testing.T) {
	session, _, _, _ := pairedSession(t)
	unlink := &offlineUnlink{confirm: true}
	session.controller.SetUnlinkTransport(func() (connection.Transport, error) { return unlink, nil })
	if code := session.Logout(); code != "" || unlink.asked != 1 {
		t.Fatalf("code %q asked %d", code, unlink.asked)
	}
}

// M1: after disconnect the Go session is closed. Native logout opens the stored session again
// (no network) and resolves the verifiable mappings before retiring credentials.
func TestM1LogoutAfterDisconnectReopensStoredSessionAndResolvesMappings(t *testing.T) {
	session, native, delivery, _ := pairedSession(t)
	storeMapping(t, session, "9001", "34600")
	session.Close() // what disconnect() does natively
	if native.state(0) != "pendingLid" {
		t.Fatal("the closed session still resolved")
	}
	reopened := OpenConnectionWithDelivery(native, connectionSink{}, delivery, "gen-logout", "123@lid", 10<<20, 10<<20)
	if reopened.Code != "" {
		t.Fatalf("reopen: %s", reopened.Code)
	}
	defer reopened.Session.Close()
	unlink := &offlineUnlink{}
	reopened.Session.controller.SetUnlinkTransport(func() (connection.Transport, error) { return unlink, nil })
	if code := reopened.Session.Logout(); code != "REMOTE_LOGOUT_UNCONFIRMED" || unlink.asked != 1 {
		t.Fatalf("code %q asked %d", code, unlink.asked)
	}
	if native.state(0) != "resolved" || native.state(1) != "pendingLid" {
		t.Fatalf("states %q %q", native.state(0), native.state(1))
	}
}

// IT-ID-10 with another account active: the previous account's entries are neither resolved with
// the new account's data nor confirmed through its connection.
func TestITID10OtherActiveAccountNeitherResolvesNorWritesForPreviousEntries(t *testing.T) {
	session, native, delivery, sink := pairedSession(t) // the active account is 123@lid
	native.mu.Lock()
	native.pending = nil
	for _, id := range []int{1, 2} {
		entry := pendingEntry(t, id, "cuenta anterior")
		entry.AccountID = "999@lid" // the previous account
		entry.Recovery.MessageInfoJSON = strings.Replace(entry.Recovery.MessageInfoJSON, "123@lid", "999@lid", 1)
		native.pending = append(native.pending, entry)
	}
	native.pending[0].IdentityState = "resolved"
	native.pending[0].Message = json.RawMessage(`{"id":"wa-message:v1:m1","accountId":"999@lid","whatsappMessageId":"m1","chatId":"555@lid","direction":"incoming","timestamp":1,"text":"hola"}`)
	native.mu.Unlock()
	storeMapping(t, session, "9001", "34600")
	if code := session.ResolveIdentities(); code != "" {
		t.Fatal(code)
	}
	if native.state(1) != "pendingLid" {
		t.Fatal("an entry of another account was resolved with the active account")
	}
	native.mu.Lock()
	revision := native.revision
	native.mu.Unlock()
	delivery.SetConsumer("b")
	delivery.Start()
	d := sink.next(t)
	if d.Payload.DeliveryID != deliveryID(1) {
		t.Fatalf("delivered %q", d.Payload.DeliveryID)
	}
	if code := delivery.Confirm(d.Payload.DeliveryID); code != "" {
		t.Fatal(code)
	}
	native.mu.Lock()
	defer native.mu.Unlock()
	if native.revision != revision {
		t.Fatal("confirming the previous account's entry wrote through the active account")
	}
}

// m4: a revocation known to native is passed to Go, which then does not connect to unlink.
func TestM4KnownRevocationDoesNotConnectToUnlinkButStillResolvesMappings(t *testing.T) {
	session, native, _, _ := pairedSession(t)
	storeMapping(t, session, "9001", "34600")
	session.controller.SetUnlinkTransport(func() (connection.Transport, error) {
		t.Error("connected to unlink a revoked session")
		return nil, errors.New("no")
	})
	session.MarkRevoked()
	if code := session.Logout(); code != "REMOTE_LOGOUT_UNCONFIRMED" {
		t.Fatal(code)
	}
	if native.state(0) != "resolved" {
		t.Fatal("mappings were not completed")
	}
	(*ConnectionSession)(nil).MarkRevoked()
}
