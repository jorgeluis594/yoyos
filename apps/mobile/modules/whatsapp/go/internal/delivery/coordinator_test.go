package delivery

import (
	"errors"
	"testing"
	"time"
)

// UT-DEL-06: one delivery at a time, by numeric revision then ordinal, skipping unresolved identities.
func TestUTDEL06DeliversOneByNumericRevisionAndOrdinalSkippingPendingIdentity(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(3, "10", 0, "resolved"), record(2, "9", 1, "resolved"), record(9, "9", 0, "pendingLid"), record(1, "9", 0, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	if got := out.next(t); got != "a:"+did(1) {
		t.Fatalf("first delivery %s", got)
	}
	out.quiet(t)
	for i, want := range []int{2, 3} {
		if err := c.Confirm(did([]int{1, 2}[i])); err != nil {
			t.Fatal(err)
		}
		if got := out.next(t); got != "a:"+did(want) {
			t.Fatalf("delivery %d was %s", i, got)
		}
		out.quiet(t)
	}
	if err := c.Confirm(did(3)); err != nil {
		t.Fatal(err)
	}
	out.quiet(t)
}

// UT-DEL-07: retirement waits for durable success; a valid absent ID is idempotent success.
func TestUTDEL07ConfirmWaitsForDurableRetireAndAbsentIDSucceeds(t *testing.T) {
	ledger := &fakeLedger{retireGate: make(chan struct{}), retireEnter: make(chan string, 4)}
	ledger.add(record(1, "5", 0, "resolved"), record(2, "5", 1, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	out.next(t)
	done := make(chan error, 1)
	go func() { done <- c.Confirm(did(1)) }()
	<-ledger.retireEnter
	out.quiet(t) // the second delivery is not released before the writer succeeds
	close(ledger.retireGate)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got := out.next(t); got != "a:"+did(2) {
		t.Fatalf("released %s", got)
	}
	if err := c.Confirm(did(77)); err != nil {
		t.Fatalf("valid absent ID must be idempotent: %v", err)
	}
	if err := c.Confirm(did(1)); err != nil {
		t.Fatalf("repeated confirmation: %v", err)
	}
	out.quiet(t)
}

// UT-DEL-08: malformed IDs are rejected; a failed write or read is never absence; a lost response is repeatable.
func TestUTDEL08RejectsMalformedAndDoesNotTreatFailureAsAbsence(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"), record(2, "5", 1, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	out.next(t)
	for _, bad := range []string{"", "wa-delivery:v1:XYZ", "wa-delivery:v1:" + did(1)[15:] + "0", "other"} {
		if !errors.Is(c.Confirm(bad), ErrInvalidDeliveryID) {
			t.Fatalf("accepted %q", bad)
		}
	}
	boom := errors.New("write failed")
	ledger.mu.Lock()
	ledger.retireErr = boom
	ledger.mu.Unlock()
	if err := c.Confirm(did(1)); !errors.Is(err, boom) {
		t.Fatalf("failure hidden: %v", err)
	}
	out.quiet(t) // still the same uncertain delivery; the next one stays held
	ledger.mu.Lock()
	ledger.retireErr = nil
	ledger.mu.Unlock()
	if err := c.Confirm(did(1)); err != nil {
		t.Fatal(err)
	}
	if got := out.next(t); got != "a:"+did(2) {
		t.Fatalf("got %s", got)
	}
	// The response of a durable retirement was lost: the repeat succeeds and frees nothing else.
	if err := c.Confirm(did(1)); err != nil {
		t.Fatal(err)
	}
	out.quiet(t)
}

// UT-DEL-08 (uncertain write): the published state decides whether the delivery is still owed.
func TestUTDEL08RereadsPublishedStateAfterUncertainRetire(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"), record(2, "5", 1, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	out.next(t)
	ledger.mu.Lock()
	ledger.retireErr = errors.New("response lost")
	ledger.mu.Unlock()
	if c.Confirm(did(1)) == nil {
		t.Fatal("expected the failure to be reported")
	}
	// The write actually landed: the reread releases the next delivery without a second confirmation.
	ledger.mu.Lock()
	ledger.records = ledger.records[1:]
	ledger.mu.Unlock()
	c.kick()
	if got := out.next(t); got != "a:"+did(2) {
		t.Fatalf("got %s", got)
	}
}

// UT-DEL-09: repeated or foreign confirmations never release the current delivery.
func TestUTDEL09ForeignAndRepeatedConfirmationsKeepCurrentTurn(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"), record(2, "5", 1, "resolved"), record(3, "5", 2, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	out.next(t)
	for range 3 {
		if err := c.Confirm(did(99)); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.Confirm(did(3)); err != nil { // a later entry is not the current turn
		t.Fatal(err)
	}
	out.quiet(t)
	if err := c.Confirm(did(1)); err != nil {
		t.Fatal(err)
	}
	if got := out.next(t); got != "a:"+did(2) {
		t.Fatalf("got %s", got)
	}
	if err := c.Confirm(did(1)); err != nil {
		t.Fatal(err)
	}
	out.quiet(t)
}

// UT-SUB-01: registering waits for prepared storage and then selects the in-flight or next pending delivery.
func TestUTSUB01ConsumerRegistrationWaitsForPreparedStorage(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a")) // before initialize completes
	out.quiet(t)
	if ledger.readCount() != 0 {
		t.Fatal("storage read before it was prepared")
	}
	c.Start()
	if got := out.next(t); got != "a:"+did(1) {
		t.Fatalf("got %s", got)
	}
}

// UT-SUB-02: replacing the consumer re-emits the same delivery without another ledger read.
func TestUTSUB02ReplacementReemitsSameDeliveryWithoutAnotherRead(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"), record(2, "5", 1, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	out.next(t)
	reads := ledger.readCount()
	c.SetConsumer(out.consumer("b"))
	if got := out.next(t); got != "b:"+did(1) {
		t.Fatalf("got %s", got)
	}
	if ledger.readCount() != reads {
		t.Fatal("replacement asked the buffer for another record")
	}
	out.quiet(t)
}

// UT-SUB-03: a replaced subscription's remove() is ignored and its queued emissions are dropped.
func TestUTSUB03StaleRemoveAndQueuedEmissionAreIgnored(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"))
	c, logs := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.SetConsumer(out.consumer("b"))
	c.Start()
	if got := out.next(t); got != "b:"+did(1) {
		t.Fatalf("the replaced consumer received %s", got)
	}
	c.RemoveConsumer("a")
	out.quiet(t)
	if stops, _ := logs.snapshot(); len(stops) != 0 {
		t.Fatalf("stale remove stopped reception: %v", stops)
	}
	if err := c.Confirm(did(1)); err != nil {
		t.Fatal(err)
	}
}

// UT-SUB-04: a late confirmation from the previous consumer is honored by delivery ID.
func TestUTSUB04LateConfirmationFromReplacedConsumerIsAccepted(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"), record(2, "5", 1, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	out.next(t)
	c.SetConsumer(out.consumer("b"))
	out.next(t)
	if err := c.Confirm(did(1)); err != nil { // issued by the callback that started under "a"
		t.Fatal(err)
	}
	if got := out.next(t); got != "b:"+did(2) {
		t.Fatalf("got %s", got)
	}
	if err := c.Confirm(did(1)); err != nil { // "b" persisted the same message concurrently
		t.Fatal(err)
	}
	out.quiet(t)
}

// UT-SUB-05: confirmation racing a replacement neither starts two traversals nor waits for a retired delivery.
func TestUTSUB05ConfirmAndReplacementDoNotDuplicateTraversal(t *testing.T) {
	ledger := &fakeLedger{retireGate: make(chan struct{}), retireEnter: make(chan string, 4)}
	ledger.add(record(1, "5", 0, "resolved"), record(2, "5", 1, "resolved"))
	c, _ := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	out.next(t)
	done := make(chan error, 1)
	go func() { done <- c.Confirm(did(1)) }()
	<-ledger.retireEnter
	c.SetConsumer(out.consumer("b")) // during the retirement
	out.quiet(t)                     // the delivery being retired is not re-emitted
	close(ledger.retireGate)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got := out.next(t); got != "b:"+did(2) {
		t.Fatalf("got %s", got)
	}
	out.quiet(t)
	// After the retirement, replacing again re-emits only the delivery that is still owed.
	c.SetConsumer(out.consumer("c"))
	if got := out.next(t); got != "c:"+did(2) {
		t.Fatalf("got %s", got)
	}
	out.quiet(t)
}

// UT-SUB-07: a new subscription recovers locally and never touches an explicit stop.
func TestUTSUB07SubscribingRecoversLocallyWithoutResumingNetwork(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"))
	c, logs := started(t, ledger, 1<<20)
	c.Start()
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	out.next(t)
	if stops, resumes := logs.snapshot(); len(stops) != 0 || resumes != 0 {
		t.Fatalf("subscription changed connection state: %v %d", stops, resumes)
	}
}

// UT-SUB-08: a failed callback keeps the pending delivery and does not loop.
func TestUTSUB08FailedCallbackKeepsPendingAndStopsEmission(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"))
	c, logs := started(t, ledger, 1<<20)
	out := newSink()
	out.fail = errors.New("runtime destroyed")
	c.SetConsumer(out.consumer("a"))
	c.Start()
	eventually(t, "stop reported", func() bool { s, _ := logs.snapshot(); return len(s) == 1 && s[0] == ConsumerFailed })
	time.Sleep(100 * time.Millisecond)
	if s, _ := logs.snapshot(); len(s) != 1 {
		t.Fatalf("repeated errors: %v", s)
	}
	if out.count() != 0 || ledger.readCount() > 1 || len(ledger.records) != 1 {
		t.Fatal("failed delivery was retried, dropped or reread in a loop")
	}
	out.mu.Lock()
	out.fail = nil
	out.mu.Unlock()
	c.SetConsumer(out.consumer("b")) // a new subscription recovers locally
	if got := out.next(t); got != "b:"+did(1) {
		t.Fatalf("got %s", got)
	}
}

// IT-SUB-06 (coordinator level): removing the active consumer keeps the delivery and stops reception once.
func TestITSUB06RemovingActiveConsumerKeepsDeliveryAndRecoversOnResubscribe(t *testing.T) {
	ledger := &fakeLedger{}
	ledger.add(record(1, "5", 0, "resolved"))
	c, logs := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	out.next(t)
	c.RemoveConsumer("a")
	if s, _ := logs.snapshot(); len(s) != 1 || s[0] != NoConsumer {
		t.Fatalf("stops %v", s)
	}
	time.Sleep(60 * time.Millisecond)
	if len(ledger.records) != 1 {
		t.Fatal("pending discarded without a consumer")
	}
	c.SetConsumer(out.consumer("b"))
	if got := out.next(t); got != "b:"+did(1) {
		t.Fatalf("got %s", got)
	}
}

// A read failure is reported as such, never as an empty buffer.
func TestReadFailureStopsReceptionWithoutEmptyingBuffer(t *testing.T) {
	ledger := &fakeLedger{readErr: errRead}
	ledger.add(record(1, "5", 0, "resolved"))
	c, logs := started(t, ledger, 1<<20)
	out := newSink()
	c.SetConsumer(out.consumer("a"))
	c.Start()
	eventually(t, "read failure", func() bool { s, _ := logs.snapshot(); return len(s) == 1 && s[0] == ReadFailed })
	out.quiet(t)
}
