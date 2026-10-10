package receive

import (
	"bytes"
	"compress/zlib"
	"context"
	"crypto/sha256"
	"fmt"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/delivery"
	"yoyos-whatsapp/internal/history"
	"yoyos-whatsapp/internal/protocolstore"
)

// remoteStub is the server and the client network calls of a history sync: what the phone
// uploaded, and each step the processor takes against it, logged in the order of the
// native steps. The parser and the stores are the pinned dependency's own.
type remoteStub struct {
	mu        sync.Mutex
	log       *eventLog
	client    *whatsmeow.Client
	limits    history.Limits
	batches   map[string][]byte // direct path -> bytes as uploaded (compressed)
	gate      chan struct{}     // when set, Fetch waits for it
	fetchErr  error
	receiptEr error
	deleteErr error
	onReceipt func()
	onDelete  func()

	fetches, parses, stages, receipts, deletes int
	running, maxRunning                        int
}

func (r *remoteStub) Fetch(ctx context.Context, n *waE2E.HistorySyncNotification) ([]byte, error) {
	r.mu.Lock()
	r.fetches++
	r.running++
	if r.running > r.maxRunning {
		r.maxRunning = r.running
	}
	gate, err, data := r.gate, r.fetchErr, r.batches[n.GetDirectPath()]
	r.mu.Unlock()
	r.log.add("fetch")
	defer func() { r.mu.Lock(); r.running--; r.mu.Unlock() }()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if err != nil {
		return nil, err
	}
	// The download honors the limit its context carries, as the patched dependency does.
	return history.Fetch(ctx, n.GetInitialHistBootstrapInlinePayload(), func(ctx context.Context) ([]byte, error) {
		if limit, ok := whatsmeow.MediaDownloadLimit(ctx); ok && int64(len(data)) > limit {
			return nil, whatsmeow.ErrMediaDownloadLimit
		}
		return data, nil
	}, r.limits)
}

func (r *remoteStub) Parse(chat types.JID, web *waWeb.WebMessageInfo) (*events.Message, error) {
	r.mu.Lock()
	r.parses++
	r.mu.Unlock()
	return r.client.ParseWebMessage(chat, web)
}

func (r *remoteStub) Stage(ctx context.Context, batch *waHistorySync.HistorySync) error {
	r.mu.Lock()
	r.stages++
	r.mu.Unlock()
	r.log.add("stage")
	return r.client.StageHistorySync(ctx, batch)
}

func (r *remoteStub) Receipt(_ context.Context, id types.MessageID) error {
	r.mu.Lock()
	r.receipts++
	err, hook := r.receiptEr, r.onReceipt
	r.mu.Unlock()
	if hook != nil {
		hook()
	}
	r.log.add("receipt")
	return err
}

func (r *remoteStub) Delete(context.Context, *waE2E.HistorySyncNotification) error {
	r.mu.Lock()
	r.deletes++
	err, hook := r.deleteErr, r.onDelete
	r.mu.Unlock()
	if hook != nil {
		hook()
	}
	r.log.add("delete")
	return err
}

func (r *remoteStub) counts() (fetches, parses, stages, receipts, deletes int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.fetches, r.parses, r.stages, r.receipts, r.deletes
}

// historyLife is a process life with the history processor attached.
type historyLife struct {
	*life
	remote   *remoteStub
	rejected chan history.Code
	admitted chan bool
	failures chan error
}

// newHistoryLife builds a life over a shared container; remote is shared too, like the server.
func newHistoryLife(t *testing.T, n *native, bufferLimit int64, remote *remoteStub) *historyLife {
	t.Helper()
	l := newLife(t, n, bufferLimit)
	h := &historyLife{life: l, remote: remote, rejected: make(chan history.Code, 8), admitted: make(chan bool, 8), failures: make(chan error, 8)}
	device := &store.Device{ID: ownDevice.ID, LID: ownDevice.LID}
	l.store.AttachDevice(device)
	remote.mu.Lock()
	remote.client = whatsmeow.NewClient(device, nil)
	remote.mu.Unlock()
	l.recv.hooks.HistoryRejected = func(c history.Code) { h.rejected <- c }
	l.recv.hooks.HistoryAdmitted = func(pending bool) { h.admitted <- pending }
	l.recv.hooks.LocalFailure = func(err error) { h.failures <- err }
	l.recv.EnableHistory(remote, l.store, remote.limits)
	l.coord.Start()
	return h
}

func newRemote(log *eventLog, limits history.Limits) *remoteStub {
	return &remoteStub{log: log, limits: limits, batches: map[string][]byte{}}
}

func compress(t testing.TB, raw []byte) []byte {
	t.Helper()
	var out bytes.Buffer
	w := zlib.NewWriter(&out)
	if _, err := w.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// serve uploads a batch and returns the notification that announces it.
func (r *remoteStub) serve(t testing.TB, path string, batch *waHistorySync.HistorySync) *waE2E.HistorySyncNotification {
	t.Helper()
	raw, err := proto.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	return r.serveRaw(t, path, raw)
}

func (r *remoteStub) serveRaw(t testing.TB, path string, raw []byte) *waE2E.HistorySyncNotification {
	t.Helper()
	data := compress(t, raw)
	sum := sha256.Sum256(data)
	r.mu.Lock()
	r.batches[path] = data
	r.mu.Unlock()
	return &waE2E.HistorySyncNotification{
		DirectPath: proto.String(path), FileEncSHA256: sum[:], FileSHA256: sum[:], FileLength: proto.Uint64(uint64(len(data))),
		SyncType: waE2E.HistorySyncType_INITIAL_BOOTSTRAP.Enum(), ChunkOrder: proto.Uint32(1),
	}
}

// capture takes a history notification through the whole receive path up to and including
// the handler: it returns the handler's grant and the capture's delivery ID.
func (l *life) capture(id string, n *waE2E.HistorySyncNotification) (*received, string) {
	l.t.Helper()
	chat := types.JID{User: "123", Server: types.HiddenUserServer}
	info := &types.MessageInfo{MessageSource: types.MessageSource{Chat: chat, Sender: types.JID{User: "123", Device: 1, Server: types.HiddenUserServer}, IsFromMe: true},
		ID: id, Category: "peer", Timestamp: time.Unix(1700000000, 0)}
	node := &waBinary.Node{Content: []waBinary.Node{{Tag: "enc", Attrs: waBinary.Attrs{"v": "2", "type": "msg"}, Content: []byte("cipher-" + id)}}}
	plain, err := proto.Marshal(&waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type: waE2E.ProtocolMessage_HISTORY_SYNC_NOTIFICATION.Enum(), HistorySyncNotification: n}})
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
	if _, err := l.store.GetBufferedEvent(ctx, hash); err != nil {
		l.t.Fatal(err)
	}
	r.err = l.store.DoDecryptionTxn(store.WithBufferedEventChild(ctx, 0), func(tx context.Context) error {
		return l.store.PutBufferedEvent(tx, hash, plain, time.Unix(1700000001, 0))
	})
	if r.err != nil {
		l.recv.Finished(ctx, info, r.err)
		return r, ""
	}
	go func() {
		granted := l.recv.Handle(ctx, &events.Message{Info: *info})
		if granted {
			l.native.log.add("ack")
		}
		r.acked <- granted
		l.recv.Finished(ctx, info, nil)
	}()
	return r, l.captureID()
}

// captureID is the delivery ID of the newest captured notification in the container.
func (l *life) captureID() string {
	l.native.mu.Lock()
	defer l.native.mu.Unlock()
	for i := len(l.native.pending) - 1; i >= 0; i-- {
		if l.native.pending[i].Source == "history" && len(l.native.pending[i].Message) == 0 {
			return l.native.pending[i].DeliveryID
		}
	}
	return ""
}

func (n *native) historyEntries() (messages, captures int) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, p := range n.pending {
		if p.Source != "history" {
			continue
		}
		if len(p.Message) == 0 && p.IdentityState == "pendingLid" && bytes.Contains([]byte(p.Recovery.MessageInfoJSON), []byte("history-notification")) {
			captures++
		} else {
			messages++
		}
	}
	return
}

func (n *native) hasRecord(recordType string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, r := range n.records {
		if r.RecordType == recordType {
			return true
		}
	}
	return false
}

func (l *historyLife) drain(ctx context.Context) error { return l.recv.history.Drain(ctx) }

func (l *historyLife) mustDrain() {
	l.t.Helper()
	if err := l.drain(context.Background()); err != nil {
		l.t.Fatalf("drain: %v", err)
	}
}

// emitSnapshot is a consumer that records how many entries were durable at each emission.
type emitSnapshot struct {
	mu      sync.Mutex
	durable []int
	ids     chan delivery.Delivery
}

func (l *historyLife) snapshotConsumer(token string) *emitSnapshot {
	s := &emitSnapshot{ids: make(chan delivery.Delivery, 64)}
	l.coord.SetConsumer(delivery.Consumer{Token: token, Emit: func(d delivery.Delivery) error {
		messages, _ := l.native.historyEntries()
		s.mu.Lock()
		s.durable = append(s.durable, messages)
		s.mu.Unlock()
		l.native.log.add("emit")
		s.ids <- d
		return nil
	}})
	return s
}

func (s *emitSnapshot) take(t *testing.T) delivery.Delivery {
	t.Helper()
	select {
	case d := <-s.ids:
		return d
	case <-time.After(3 * time.Second):
		t.Fatal("no delivery emitted")
		return delivery.Delivery{}
	}
}

func textMessage(id, chat string, at uint64, body string) *waHistorySync.HistorySyncMsg {
	return &waHistorySync.HistorySyncMsg{Message: &waWeb.WebMessageInfo{
		Key:              &waCommon.MessageKey{RemoteJID: proto.String(chat), FromMe: proto.Bool(false), ID: proto.String(id)},
		MessageTimestamp: proto.Uint64(at),
		Message:          &waE2E.Message{Conversation: proto.String(body)},
	}}
}

func conversationOf(chat string, messages ...*waHistorySync.HistorySyncMsg) *waHistorySync.Conversation {
	return &waHistorySync.Conversation{ID: proto.String(chat), Messages: messages}
}

func batchOf(conversations ...*waHistorySync.Conversation) *waHistorySync.HistorySync {
	return &waHistorySync.HistorySync{SyncType: waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(), Conversations: conversations}
}

func lidMapping(pn, lid string) *waHistorySync.PhoneNumberToLIDMapping {
	return &waHistorySync.PhoneNumberToLIDMapping{PnJID: proto.String(pn), LidJID: proto.String(lid)}
}

func numbered(prefix, chat string, n int, body string) []*waHistorySync.HistorySyncMsg {
	var out []*waHistorySync.HistorySyncMsg
	for i := 0; i < n; i++ {
		out = append(out, textMessage(fmt.Sprintf("%s%d", prefix, i), chat, uint64(1700000100+i), body))
	}
	return out
}

func indexOf(steps []string, step string, from int) int {
	for i := from; i < len(steps); i++ {
		if steps[i] == step {
			return i
		}
	}
	return -1
}

func sizeOf(t *testing.T, p protocolstore.PendingRecord) int64 {
	t.Helper()
	size, err := protocolstore.EntrySize(p.PendingInsert)
	if err != nil {
		t.Fatal(err)
	}
	return size
}
