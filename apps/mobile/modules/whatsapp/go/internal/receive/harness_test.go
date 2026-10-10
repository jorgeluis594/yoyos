package receive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/delivery"
	"yoyos-whatsapp/internal/protocolstate"
	"yoyos-whatsapp/internal/protocolstore"
)

// native is the durable container shared by every simulated process life. It
// implements the writer contracts and records the order of durable steps.
type native struct {
	mu         sync.Mutex
	revision   uint64
	sessionRev uint64
	records    map[string]protocolstate.Record
	pending    []protocolstore.PendingRecord
	log        *eventLog
	failApply  error                        // returned by ApplyChanges before anything is published
	failIdent  error                        // like failApply, only for publications that complete an identity
	failRead   error                        // returned by ReadPending
	failRetire error                        // returned by RetirePending before anything is published
	loseRetire bool                         // publishes the retirement but loses the reply
	applyGate  func()                       // runs inside ApplyChanges, before publication
	requests   []protocolstore.ApplyRequest // every publication that was accepted, in order
}

type eventLog struct {
	mu    sync.Mutex
	steps []string
}

func (l *eventLog) add(step string) { l.mu.Lock(); l.steps = append(l.steps, step); l.mu.Unlock() }
func (l *eventLog) snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.steps...)
}
func (l *eventLog) count(step string) (n int) {
	for _, s := range l.snapshot() {
		if s == step {
			n++
		}
	}
	return
}

func newNative() *native {
	return &native{records: map[string]protocolstate.Record{}, log: &eventLog{}}
}

const account = "123@lid"

func ok(data any) string {
	raw, _ := json.Marshal(map[string]any{"contractVersion": 1, "success": true, "data": data})
	return string(raw)
}
func rejected(code string) string {
	raw, _ := json.Marshal(map[string]any{"contractVersion": 1, "success": false, "error": map[string]string{"code": code, "message": "rejected"}})
	return string(raw)
}

func (n *native) ReadState(string) (string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	var session any
	if n.sessionRev != 0 {
		records := []protocolstate.Record{}
		for _, r := range n.records {
			records = append(records, r)
		}
		session = map[string]any{"accountId": account, "protocolSchemaVersion": 1, "records": records}
	}
	return ok(map[string]any{"revision": fmt.Sprint(n.revision), "sessionRevision": fmt.Sprint(n.sessionRev), "session": session, "pending": append([]protocolstore.PendingRecord{}, n.pending...)}), nil
}

func (n *native) ApplyChanges(request string) (string, error) {
	var a protocolstore.ApplyRequest
	if err := json.Unmarshal([]byte(request), &a); err != nil {
		return "", err
	}
	n.mu.Lock()
	gate := n.applyGate
	n.mu.Unlock()
	if gate != nil {
		gate()
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.failApply != nil {
		return "", n.failApply
	}
	if n.failIdent != nil && len(a.PendingIdentityUpdates) > 0 {
		return "", n.failIdent
	}
	for _, c := range a.ProtocolChanges {
		key := c.RecordType + "\x00" + c.RecordKey
		if c.Operation == "put" {
			n.records[key] = protocolstate.Record{RecordType: c.RecordType, RecordKey: c.RecordKey, ValueBase64: c.ValueBase64}
		} else {
			delete(n.records, key)
		}
	}
	n.requests = append(n.requests, a)
	n.revision++
	if len(a.ProtocolChanges) > 0 {
		n.sessionRev = n.revision
	}
	for i, p := range a.PendingInserts {
		ordinal := uint32(i)
		n.pending = append(n.pending, protocolstore.PendingRecord{PendingInsert: p, CreatedRevision: fmt.Sprint(n.revision), CreatedOrdinal: &ordinal})
	}
	if len(a.PendingInserts) > 0 {
		n.log.add("commit")
	}
	for _, u := range a.PendingIdentityUpdates {
		for i := range n.pending {
			if n.pending[i].DeliveryID == u.DeliveryID {
				n.pending[i].IdentityState, n.pending[i].Message = u.IdentityState, u.Message
				n.log.add("identity")
			}
		}
	}
	return ok(map[string]string{"revision": fmt.Sprint(n.revision), "sessionRevision": fmt.Sprint(n.sessionRev)}), nil
}

func (n *native) ReadPending(string) (string, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.failRead != nil {
		return "", n.failRead
	}
	return ok(map[string]any{"revision": fmt.Sprint(n.revision), "pending": append([]protocolstore.PendingRecord{}, n.pending...)}), nil
}

func (n *native) RetirePending(request string) (string, error) {
	var r struct {
		DeliveryID string `json:"deliveryId"`
	}
	if err := json.Unmarshal([]byte(request), &r); err != nil {
		return "", err
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.failRetire != nil {
		return "", n.failRetire
	}
	removed := false
	for i, p := range n.pending {
		if p.DeliveryID == r.DeliveryID {
			n.pending = append(n.pending[:i:i], n.pending[i+1:]...)
			n.revision++
			removed = true
			n.log.add("retire")
			break
		}
	}
	if n.loseRetire && removed {
		n.loseRetire = false
		return "", errors.New("reply lost")
	}
	return ok(map[string]any{"revision": fmt.Sprint(n.revision), "removed": removed}), nil
}

// set changes failure-injection fields under the container lock: the receive goroutines read
// them while a test arms or disarms a failure.
func (n *native) set(change func()) { n.mu.Lock(); change(); n.mu.Unlock() }

func (n *native) pendingCount() int { n.mu.Lock(); defer n.mu.Unlock(); return len(n.pending) }

// life is one process life: store, coordinator and receiver over the same container.
type life struct {
	t        *testing.T
	native   *native
	store    *protocolstore.Store
	ledger   *protocolstore.Ledger
	coord    *delivery.Coordinator
	recv     *Receiver
	replayed int
	capacity atomic.Int32
	oversize atomic.Int32
	paused   atomic.Bool
	consumer *consumerApp
	stops    chan delivery.Cause
	resumes  chan struct{}
}

var ownDevice = &store.Device{ID: &types.JID{User: "123", Device: 1, Server: types.DefaultUserServer}, LID: types.JID{User: "123", Device: 1, Server: types.HiddenUserServer}}

func (l *life) ReplayRecoveredProtocol(context.Context, *types.MessageInfo, string, []byte) error {
	l.replayed++
	return nil
}

func newLife(t *testing.T, n *native, limit int64) *life {
	t.Helper()
	l := &life{t: t, native: n, stops: make(chan delivery.Cause, 8), resumes: make(chan struct{}, 8)}
	var err error
	if l.store, err = protocolstore.Open(n, "gen", account, limit, limit); err != nil {
		t.Fatal(err)
	}
	if l.ledger, err = protocolstore.NewLedger(n, limit, limit); err != nil {
		t.Fatal(err)
	}
	l.coord = delivery.New(l.ledger, limit, delivery.Hooks{
		Stop: func(c delivery.Cause, _ error) { l.stops <- c },
		Resume: func() { // like the controller, resuming does nothing unless it is paused
			if l.paused.Swap(false) {
				l.resumes <- struct{}{}
			}
		},
	})
	t.Cleanup(l.coord.Close)
	l.recv = New(ownDevice, l.ledger, l.coord, Hooks{
		Capacity:     func() { l.capacity.Add(1); l.paused.Store(true) },
		Oversize:     func() { l.oversize.Add(1) },
		LocalFailure: func(error) {},
	})
	l.recv.SetProcessor(l)
	return l
}

// consumerApp is the test consumer: it persists by message.id, so a repeated delivery has no second logical effect.
type consumerApp struct {
	mu        sync.Mutex
	log       *eventLog
	persisted map[string]bool
	effects   int
	emitted   chan delivery.Delivery
	autoAck   func(delivery.Delivery)
}

func newConsumerApp(log *eventLog) *consumerApp {
	return &consumerApp{log: log, persisted: map[string]bool{}, emitted: make(chan delivery.Delivery, 32)}
}

func (c *consumerApp) emit(d delivery.Delivery) error {
	c.log.add("emit")
	c.emitted <- d
	return nil
}

// persist is the consumer's own commit; repeating it for the same message is idempotent.
func (c *consumerApp) persist(d delivery.Delivery) {
	var m struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(d.Message, &m)
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.persisted[m.ID] {
		c.persisted[m.ID] = true
		c.effects++
	}
	c.log.add("persist")
}

func (c *consumerApp) take(t *testing.T) delivery.Delivery {
	t.Helper()
	select {
	case d := <-c.emitted:
		return d
	case <-time.After(2 * time.Second):
		t.Fatal("no delivery emitted")
		return delivery.Delivery{}
	}
}
func (c *consumerApp) none(t *testing.T) {
	t.Helper()
	select {
	case d := <-c.emitted:
		t.Fatalf("unexpected delivery %s", d.ID)
	case <-time.After(80 * time.Millisecond):
	}
}

func (l *life) subscribe(token string) *consumerApp {
	if l.consumer == nil {
		l.consumer = newConsumerApp(l.native.log)
	}
	l.coord.SetConsumer(delivery.Consumer{Token: token, Emit: l.consumer.emit})
	return l.consumer
}

type received struct {
	ctx   context.Context
	info  *types.MessageInfo
	err   error
	acked chan bool
}

// receive mirrors whatsmeow's order: capture, buffered decryption transaction, then the handler.
func (l *life) receive(id, text string) *received {
	l.t.Helper()
	return l.receiveFrom(id, text, types.JID{User: "555", Server: types.HiddenUserServer})
}

// receiveFrom is receive for a chat addressed by the given JID, such as a phone number.
func (l *life) receiveFrom(id, text string, chat types.JID) *received {
	l.t.Helper()
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: chat, Sender: chat}, ID: id, Timestamp: time.Unix(1700000000, 0)}
	node := &waBinary.Node{Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"v": "2", "type": "msg"}, Content: []byte("cipher-" + id)}}}
	plain, err := proto.Marshal(&waE2E.Message{Conversation: proto.String(text)})
	if err != nil {
		l.t.Fatal(err)
	}
	ctx, err := l.recv.PreDecrypt(context.Background(), info, node)
	if err != nil {
		l.t.Fatal(err)
	}
	r := &received{ctx: ctx, info: info, acked: make(chan bool, 1)}
	hash := [32]byte{}
	copy(hash[:], id)
	if _, err := l.store.GetBufferedEvent(ctx, hash); err != nil { // whatsmeow rereads the buffer before decrypting
		l.t.Fatal(err)
	}
	r.err = l.store.DoDecryptionTxn(store.WithBufferedEventChild(ctx, 0), func(tx context.Context) error {
		return l.store.PutBufferedEvent(tx, hash, plain, time.Unix(1700000001, 0))
	})
	if r.err != nil {
		l.recv.Finished(ctx, info, r.err)
		return r
	}
	go func() {
		granted := l.recv.Handle(ctx, &events.Message{Info: *info})
		if granted {
			l.native.log.add("ack")
		}
		r.acked <- granted
		l.recv.Finished(ctx, info, nil)
	}()
	return r
}

func (r *received) ack(t *testing.T) bool {
	t.Helper()
	select {
	case granted := <-r.acked:
		return granted
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not finish")
		return false
	}
}
func (r *received) stillWaiting(t *testing.T) {
	t.Helper()
	select {
	case granted := <-r.acked:
		t.Fatalf("handler finished early (granted=%v)", granted)
	case <-time.After(80 * time.Millisecond):
	}
}

var errBoom = errors.New("injected native failure")

func consumerOf(token string, app *consumerApp) delivery.Consumer {
	return delivery.Consumer{Token: token, Emit: app.emit}
}
func jsonUnmarshal(raw []byte, out any) error { return json.Unmarshal(raw, out) }

func infoFor(id, chat string) types.MessageInfo {
	jid, _ := types.ParseJID(chat)
	return types.MessageInfo{MessageSource: types.MessageSource{Chat: jid, Sender: jid}, ID: id}
}
