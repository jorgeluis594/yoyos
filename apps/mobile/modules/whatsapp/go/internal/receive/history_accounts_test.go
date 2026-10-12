package receive

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"testing"

	"yoyos-whatsapp/internal/history"
	"yoyos-whatsapp/internal/protocolstore"
)

const otherAccount = "999@lid"

// seedCapture adds the history capture an earlier account left behind: a notification entry that
// nobody delivers, owned by that account.
func seedCapture(n *native, id int, owner string, revision string, ordinal uint32) {
	info, _ := json.Marshal(map[string]any{"version": 1, "accountId": owner, "id": fmt.Sprint("hist", id), "chat": "555@lid", "sender": "555@lid",
		"timestampSeconds": 100, "messageType": protocolstore.HistoryNotificationType})
	rec := protocolstore.PendingRecord{CreatedRevision: revision, CreatedOrdinal: &ordinal}
	rec.DeliveryID, rec.AccountID, rec.Source, rec.IdentityState = did(id), owner, "history", "pendingLid"
	rec.Recovery = protocolstore.Recovery{MessageInfoJSON: string(info), Items: []protocolstore.RecoveryItem{{Format: "history", PlaintextBase64: base64.StdEncoding.EncodeToString([]byte("not-a-notification"))}}}
	n.mu.Lock()
	n.pending = append(n.pending, rec)
	if v, _ := parseRev(revision); v > n.revision {
		n.revision = v
	}
	n.mu.Unlock()
}

func (n *native) hasDelivery(id string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, p := range n.pending {
		if p.DeliveryID == id {
			return true
		}
	}
	return false
}

// WA-11 (debt of WA-08, deferred by WA-09; no UT/IT ID in the backlog): a session of one account
// retires the history captures of another and keeps everything else of it.
func TestWA11NewAccountRetiresThePreviousAccountsCaptures(t *testing.T) {
	n := newNative()
	seedCapture(n, 1, otherAccount, "5", 0)
	seed(n, 2, otherAccount, "5", 1, "resolved", 10) // a real message of the previous account
	seedCapture(n, 3, otherAccount, "5", 2)
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	grant, own := h.capture("notif-own", remote.serve(t, "/v/own", supportedBatch()))
	if !grant.ack(t) || own == "" {
		t.Fatal("the current account's notification is captured and acknowledged")
	}

	h.mustDrain()

	if n.hasDelivery(did(1)) || n.hasDelivery(did(3)) {
		t.Fatal("the previous account's captures must be retired")
	}
	if !n.hasDelivery(did(2)) {
		t.Fatal("a real message of the previous account stays pending, with its account")
	}
	if n.hasDelivery(own) {
		t.Fatal("the current account's capture is processed and released as usual")
	}
	if messages, captures := n.historyEntries(); captures != 0 || messages != 3 {
		t.Fatalf("only the current account's batch remains: %d messages, %d captures", messages, captures)
	}
	if _, _, stages, receipts, _ := remote.counts(); stages != 1 || receipts != 1 {
		t.Fatalf("the previous captures are never processed, no receipt for them: stages=%d receipts=%d", stages, receipts)
	}
}

// The purge compares accounts, so it never retires the current account's own capture, even when
// its batch cannot finish yet.
func TestWA11PurgeKeepsTheCurrentAccountsCapture(t *testing.T) {
	n := newNative()
	seedCapture(n, 1, otherAccount, "5", 0)
	l := newLife(t, n, bigBuffer)
	l.coord.Start()
	seedCapture(n, 2, account, "5", 1)

	retired, err := history.RetireCaptures(l.ledger, l.coord, func(owner string) bool { return owner != account })
	if err != nil || retired != 1 {
		t.Fatalf("retired=%d err=%v", retired, err)
	}
	if n.hasDelivery(did(1)) || !n.hasDelivery(did(2)) {
		t.Fatal("only the other account's capture goes")
	}
	again, err := history.RetireCaptures(l.ledger, l.coord, func(owner string) bool { return owner != account })
	if err != nil || again != 0 {
		t.Fatalf("a second pass is idempotent: %d %v", again, err)
	}
}

// A capture whose retirement fails stays captured and is reported; nothing else is lost.
func TestWA11PurgeFailureKeepsTheCaptureAndReports(t *testing.T) {
	n := newNative()
	seedCapture(n, 1, otherAccount, "5", 0)
	l := newLife(t, n, bigBuffer)
	n.set(func() { n.failRetire = errBoom })
	if _, err := history.RetireCaptures(l.ledger, l.coord, func(string) bool { return true }); err == nil {
		t.Fatal("a failed retirement is an error")
	}
	if !n.hasDelivery(did(1)) {
		t.Fatal("the capture stays")
	}
	n.set(func() { n.failRetire = nil })
	if retired, err := history.RetireCaptures(l.ledger, l.coord, func(string) bool { return true }); err != nil || retired != 1 {
		t.Fatalf("the next pass retires it: %d %v", retired, err)
	}
}
