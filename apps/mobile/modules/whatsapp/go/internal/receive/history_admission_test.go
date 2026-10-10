package receive

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/history"
	"yoyos-whatsapp/internal/identity"
)

const bigBuffer = 4 << 20

func defaultRemote(n *native) *remoteStub { return newRemote(n.log, history.DefaultLimits()) }

// supportedBatch has a mapping, messages that depend on it, a direct LID chat and content that is out of scope.
func supportedBatch() *waHistorySync.HistorySync {
	phone := "34600@s.whatsapp.net"
	reaction := textMessage("r1", "77@lid", 1700000009, "")
	reaction.Message.Message = &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{Text: proto.String("👍")}}
	b := batchOf(
		conversationOf(phone, textMessage("a1", phone, 1700000001, "one"), textMessage("a2", phone, 1700000002, "two")),
		conversationOf("77@lid", textMessage("b1", "77@lid", 1700000003, "three"), reaction),
		conversationOf("99-1@g.us", textMessage("g1", "99-1@g.us", 1700000004, "group")),
	)
	b.PhoneNumberToLidMappings = []*waHistorySync.PhoneNumberToLIDMapping{lidMapping(phone, "600@lid")}
	return b
}

// IT-HIS-01: every supported message and the protocol change it depends on publish together, before the first emission.
func TestITHIS01AdmitsTheWholeBatchAndItsChangesBeforeEmitting(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	consumer := h.snapshotConsumer("c1")
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch1", supportedBatch()))
	if !grant.ack(t) {
		t.Fatal("a durable notification may be acknowledged")
	}
	messages, captures := n.historyEntries()
	if messages != 0 || captures != 1 {
		t.Fatalf("only the capture exists before the batch is admitted: %d %d", messages, captures)
	}
	h.mustDrain()

	n.mu.Lock()
	batchRequests := 0
	var batch int
	for i, r := range n.requests {
		if len(r.PendingInserts) > 0 && r.PendingInserts[0].Source == "history" && r.PendingInserts[0].IdentityState == "resolved" {
			batchRequests++
			batch = i
		}
	}
	request := n.requests[batch]
	n.mu.Unlock()
	if batchRequests != 1 || len(request.PendingInserts) != 3 {
		t.Fatalf("one publication carries the 3 supported messages: %d publications, %d inserts", batchRequests, len(request.PendingInserts))
	}
	mapped := false
	for _, change := range request.ProtocolChanges {
		mapped = mapped || change.RecordType == "lid-mapping"
	}
	if !mapped {
		t.Fatal("the mapping is published in the same commit as its dependents")
	}
	for _, insert := range request.PendingInserts[:2] {
		if insert.IdentityState != "resolved" {
			t.Fatalf("messages that depend on the mapping resolve with it: %+v", insert.IdentityState)
		}
	}
	first := consumer.take(t)
	consumer.mu.Lock()
	durable := consumer.durable[0]
	consumer.mu.Unlock()
	if durable != 3 {
		t.Fatalf("all 3 messages were durable when the first was emitted, got %d", durable)
	}
	steps := n.log.snapshot()
	if indexOf(steps, "emit", 0) < indexOf(steps, "commit", indexOf(steps, "commit", 0)+1) {
		t.Fatalf("emission before the batch commit: %v", steps)
	}
	if first.ID == "" {
		t.Fatal("empty delivery")
	}
	select {
	case a := <-h.admitted:
		if a {
			t.Fatal("nothing waits for identity")
		}
	case <-time.After(time.Second):
		t.Fatal("admission not reported")
	}
}

func brokenMessage() *waHistorySync.HistorySyncMsg {
	broken := textMessage("bad", "555@lid", 1700000002, "mine")
	broken.Message.Key.FromMe = proto.Bool(true)
	broken.Message.OriginalSelfAuthorUserJIDString = proto.String("a:b:c@s.whatsapp.net")
	return broken
}

// IT-HIS-02: a supported message that cannot be normalized rejects the whole batch: nothing is
// published, not even the mapping, and no receipt or deletion releases the remote source.
func TestITHIS02ANormalizationFailureLeavesNoPartialAdmission(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	app := h.subscribe("c1")
	live := h.receive("live-1", "earlier content")
	delivered := app.take(t)

	phone := "34600@s.whatsapp.net"
	b := batchOf(conversationOf(phone, textMessage("a1", phone, 1700000001, "ok")), conversationOf("555@lid", textMessage("c1", "555@lid", 1700000001, "ok"), brokenMessage()))
	b.PhoneNumberToLidMappings = []*waHistorySync.PhoneNumberToLIDMapping{lidMapping(phone, "600@lid")}
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/bad", b))
	grant.ack(t)
	h.mustDrain()

	select {
	case code := <-h.rejected:
		if code != history.CodeInvalid {
			t.Fatalf("want an invalid-batch rejection, got %s", code)
		}
	case <-time.After(time.Second):
		t.Fatal("the rejection is reported")
	}
	if messages, captures := n.historyEntries(); messages != 0 || captures != 0 {
		t.Fatalf("no partial admission and no lingering capture: %d messages, %d captures", messages, captures)
	}
	if n.hasRecord("lid-mapping") {
		t.Fatal("the protocol change of a rejected batch must not be published")
	}
	if _, _, stages, receipts, deletes := remote.counts(); stages != 0 || receipts != 0 || deletes != 0 {
		t.Fatalf("a rejected batch is neither staged, receipted nor deleted: %d %d %d", stages, receipts, deletes)
	}
	if n.pendingCount() != 1 {
		t.Fatalf("the earlier pending entry is preserved, got %d entries", n.pendingCount())
	}
	app.none(t)
	// the rejected batch is not retried by this process
	fetches, _, _, _, _ := remote.counts()
	h.mustDrain()
	if again, _, _, _, _ := remote.counts(); again != fetches {
		t.Fatalf("a rejected batch is not fetched again: %d then %d", fetches, again)
	}
	if err := h.coord.Confirm(delivered.ID); err != nil || !live.ack(t) {
		t.Fatalf("the earlier delivery still confirms: %v", err)
	}
}

// IT-HIS-02: a failing publication leaves the capture and no part of the batch; a later life admits it whole.
func TestITHIS02AWriteFailureLeavesNoPartialAdmissionAndRecovers(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
	grant.ack(t)
	n.set(func() { n.failApply = errBoom })
	if err := h.drain(context.Background()); err == nil {
		t.Fatal("a failed publication fails the pass")
	}
	select {
	case <-h.failures:
	case <-time.After(time.Second):
		t.Fatal("a storage failure is reported as a local failure")
	}
	if messages, captures := n.historyEntries(); messages != 0 || captures != 1 || n.hasRecord("lid-mapping") {
		t.Fatalf("nothing of the batch survives and the capture stays: %d %d", messages, captures)
	}
	if _, _, _, receipts, deletes := remote.counts(); receipts != 0 || deletes != 0 {
		t.Fatalf("the remote source is untouched: %d %d", receipts, deletes)
	}

	n.set(func() { n.failApply = nil })
	next := newHistoryLife(t, n, bigBuffer, remote)
	next.mustDrain()
	if messages, captures := n.historyEntries(); messages != 3 || captures != 0 {
		t.Fatalf("the whole batch is admitted by the next life: %d %d", messages, captures)
	}
}

// IT-HIS-02: an unreadable store is a failure to report, never "no mapping" or "no captures".
func TestITHIS02AReadFailureIsNotAbsence(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", supportedBatch()))
	grant.ack(t)
	n.set(func() { n.failRead = errBoom })
	if err := h.drain(context.Background()); err == nil {
		t.Fatal("an unreadable ledger fails the pass")
	}
	select {
	case <-h.failures:
	case <-time.After(time.Second):
		t.Fatal("reported as a local failure")
	}
	if fetches, _, _, _, _ := remote.counts(); fetches != 0 {
		t.Fatalf("nothing is downloaded while the ledger cannot be trusted: %d", fetches)
	}
}

// probeSizes measures, on a throwaway container, the budget the capture, one live entry and the
// whole batch occupy, so a test can place the limit exactly between them.
func probeSizes(t *testing.T, batch *waHistorySync.HistorySync) (capture, live, total int64) {
	t.Helper()
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	h.subscribe("probe")
	h.receive("live-probe", "hello")
	eventually(t, "live entry", func() bool { return n.pendingCount() == 1 })
	live = sizeOf(t, n.entry(t, 0))
	grant, _ := h.capture("notif-probe", remote.serve(t, "/v/probe", batch))
	grant.ack(t)
	capture = sizeOf(t, n.entry(t, 1))
	h.mustDrain()
	n.mu.Lock()
	for _, p := range n.pending {
		if p.Source == "history" && len(p.Message) > 0 {
			total += sizeOf(t, p)
		}
	}
	n.mu.Unlock()
	return
}

// IT-HIS-03: a batch that fits the budget but not beside the other pending entries waits for
// their confirmations; the store stays usable meanwhile.
func TestITHIS03WaitsForConfirmationsWithoutHoldingTheWriter(t *testing.T) {
	b := supportedBatch()
	capture, live, total := probeSizes(t, b)
	limit := capture + total + live/2 // fits alone beside the capture, not beside the live entry

	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, limit, remote)
	app := h.subscribe("c1")
	liveGrant := h.receive("live-1", "hello")
	delivered := app.take(t)
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", b))
	grant.ack(t)

	done := make(chan error, 1)
	go func() { done <- h.drain(context.Background()) }()
	select {
	case err := <-done:
		t.Fatalf("the batch must wait for space, finished with %v", err)
	case <-time.After(200 * time.Millisecond):
	}
	if messages, _ := n.historyEntries(); messages != 0 {
		t.Fatalf("no partial admission while waiting: %d", messages)
	}
	// the writer lock is free: a store read returns, and a confirmation goes through
	read := make(chan error, 1)
	go func() { _, err := h.store.GetBufferedEvent(context.Background(), [32]byte{9}); read <- err }()
	select {
	case err := <-read:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("the waiting batch holds the store")
	}
	if err := h.coord.Confirm(delivered.ID); err != nil {
		t.Fatal(err)
	}
	if !liveGrant.ack(t) {
		t.Fatal("the confirmation retires the live entry")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the confirmation did not wake the waiting batch")
	}
	if messages, captures := n.historyEntries(); messages != 3 || captures != 0 {
		t.Fatalf("the batch is admitted whole after the wait: %d %d", messages, captures)
	}
	if h.capacity.Load() != 0 || h.oversize.Load() != 0 {
		t.Fatal("waiting for history space neither pauses nor stops live reception")
	}
}

// IT-HIS-03: a retired generation (disconnect, logout or local failure) ends the wait and cannot admit late.
func TestITHIS03ARetiredGenerationCannotAdmitLate(t *testing.T) {
	b := supportedBatch()
	capture, live, total := probeSizes(t, b)
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, capture+total+live/2, remote)
	app := h.subscribe("c1")
	h.receive("live-1", "hello")
	delivered := app.take(t)
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/batch", b))
	grant.ack(t)

	ctx, retire := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- h.drain(ctx) }()
	time.Sleep(150 * time.Millisecond)
	retire()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("the wait ends with the generation: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("retiring the generation did not end the wait")
	}
	if err := h.coord.Confirm(delivered.ID); err != nil {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond)
	if messages, captures := n.historyEntries(); messages != 0 || captures != 1 {
		t.Fatalf("no late admission, the capture stays for the next generation: %d %d", messages, captures)
	}
	if _, _, stages, receipts, _ := remote.counts(); stages != 0 || receipts != 0 {
		t.Fatalf("a retired generation stages and acknowledges nothing: %d %d", stages, receipts)
	}
}

var _ = identity.Resolved

// IT-HIS-01: every kind of protocol effect of a batch (salt, push names, message secrets, settings and the
// companion nonce) is staged inside the admission transaction and published with it, never before.
func TestITHIS01EveryProtocolEffectPublishesWithTheBatch(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)

	withSecret := textMessage("s1", "77@lid", 1700000001, "secret holder")
	withSecret.Message.MessageSecret = make([]byte, 32)
	b := batchOf(conversationOf("77@lid", withSecret))
	b.NctSalt = []byte("salt-0123456789")
	b.CompanionMetaNonce = proto.String("nonce-1")
	b.GlobalSettings = &waHistorySync.GlobalSettings{}
	push := &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_PUSH_NAME.Enum(),
		Pushnames: []*waHistorySync.Pushname{{ID: proto.String("34600@s.whatsapp.net"), Pushname: proto.String("Ana")}}}

	first, _ := h.capture("notif-1", remote.serve(t, "/v/full", b))
	second, _ := h.capture("notif-2", remote.serve(t, "/v/push", push))
	first.ack(t)
	second.ack(t)
	before := len(n.requests)
	for _, kind := range []string{"nct-salt", "message-secret", "contact", "device"} {
		if n.hasRecord(kind) {
			t.Fatalf("%s must not be published before the batch is admitted", kind)
		}
	}
	h.mustDrain()
	if messages, captures := n.historyEntries(); messages != 1 || captures != 0 {
		t.Fatalf("%d %d", messages, captures)
	}
	n.mu.Lock()
	published := n.requests[before:]
	n.mu.Unlock()
	if len(published) != 2 {
		t.Fatalf("one publication per batch, got %d", len(published))
	}
	kinds := map[string]bool{}
	for _, change := range published[0].ProtocolChanges {
		kinds[change.RecordType] = true
	}
	for _, kind := range []string{"nct-salt", "message-secret", "device", "retry-hash"} {
		if !kinds[kind] {
			t.Fatalf("the first batch publishes %s with its messages: %v", kind, kinds)
		}
	}
	if len(published[0].PendingInserts) != 1 {
		t.Fatal("and its message")
	}
	pushKinds := map[string]bool{}
	for _, change := range published[1].ProtocolChanges {
		pushKinds[change.RecordType] = true
	}
	if !pushKinds["contact"] || !pushKinds["retry-hash"] {
		t.Fatalf("a push-name batch publishes its contacts with its marker: %v", pushKinds)
	}
}

// hostileStageBatch is valid for Prepare — the group is out of scope — but staging its message
// secret fails in the store: the key exceeds the record key limit.
func hostileStageBatch() *waHistorySync.HistorySync {
	group := textMessage(strings.Repeat("g", 3000), "99-1@g.us", 1700000004, "group")
	group.Message.Key.FromMe = proto.Bool(true)
	group.Message.MessageSecret = make([]byte, 32)
	phone := "34600@s.whatsapp.net"
	b := batchOf(conversationOf(phone, textMessage("a1", phone, 1700000001, "fine")), conversationOf("99-1@g.us", group))
	b.PhoneNumberToLidMappings = []*waHistorySync.PhoneNumberToLIDMapping{lidMapping(phone, "600@lid")}
	return b
}

// IT-HIS-02: content the store refuses while staging rejects that batch cleanly and durably: the
// capture is released, the store is not latched, live reception is not stopped, and a restart does not repeat it.
func TestITHIS02AContentRefusedWhileStagingRejectsTheBatchCleanly(t *testing.T) {
	n := newNative()
	remote := defaultRemote(n)
	h := newHistoryLife(t, n, bigBuffer, remote)
	app := h.subscribe("c1")
	grant, _ := h.capture("notif-1", remote.serve(t, "/v/hostile", hostileStageBatch()))
	grant.ack(t)

	if err := h.drain(context.Background()); err != nil {
		t.Fatalf("a rejected batch is not a failed pass: %v", err)
	}
	select {
	case code := <-h.rejected:
		if code != history.CodeInvalid {
			t.Fatalf("want an invalid-batch rejection, got %s", code)
		}
	case <-time.After(time.Second):
		t.Fatal("the rejection is reported")
	}
	select {
	case err := <-h.failures:
		t.Fatalf("a rejected batch must not stop live reception: %v", err)
	default:
	}
	if reason := h.store.StopReason(); reason != nil {
		t.Fatalf("the store must not be latched: %v", reason)
	}
	if messages, captures := n.historyEntries(); messages != 0 || captures != 0 || n.hasRecord("lid-mapping") || n.hasRecord("message-secret") {
		t.Fatalf("nothing of the batch survives and the capture is released: %d %d", messages, captures)
	}
	if _, _, _, receipts, deletes := remote.counts(); receipts != 0 || deletes != 0 {
		t.Fatalf("the remote batch is left alone: %d %d", receipts, deletes)
	}
	// live reception still works in the same store
	live := h.receive("live-after", "still here")
	d := app.take(t)
	if err := h.coord.Confirm(d.ID); err != nil || !live.ack(t) {
		t.Fatalf("live content after the rejection: %v", err)
	}
	// and a restart does not repeat the failure
	fetches, _, _, _, _ := remote.counts()
	next := newHistoryLife(t, n, bigBuffer, remote)
	next.mustDrain()
	if after, _, _, _, _ := remote.counts(); after != fetches {
		t.Fatalf("the rejected batch is not processed again: %d -> %d", fetches, after)
	}
	select {
	case err := <-next.failures:
		t.Fatalf("the next life must not fail: %v", err)
	default:
	}
}
