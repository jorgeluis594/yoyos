package protocolstore

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
	"yoyos-whatsapp/internal/protocolstate"
)

// HistoryNotificationState is the receive-builder decision for a decrypted history sync
// notification: the notification is kept durably, as an entry nobody delivers, until its
// batch is admitted.
const HistoryNotificationState = "historyNotification"

// HistoryNotificationType marks the replay metadata of such an entry. The entry reuses the
// pending contract (source history, pendingLid, no message), so native storage needs no new kind.
const HistoryNotificationType = "history-notification"

// IsHistoryNotification reports whether a pending entry is a captured notification and not a message.
func IsHistoryNotification(p PendingInsert) bool {
	if p.Source != "history" || p.IdentityState != "pendingLid" || len(p.Message) > 0 {
		return false
	}
	var head struct {
		MessageType string `json:"messageType"`
	}
	return json.Unmarshal([]byte(p.Recovery.MessageInfoJSON), &head) == nil && head.MessageType == HistoryNotificationType
}

// captureHistoryNotification runs inside the decryption transaction: the notification's
// plaintext is committed with the Signal state that consumed its ciphertext.
func (s *Store) captureHistoryNotification(ctx context.Context, captured CapturedReceive, plaintext []byte, hash [32]byte, serverTime time.Time) error {
	var metadata map[string]json.RawMessage
	if err := json.Unmarshal([]byte(captured.MessageInfoJSON), &metadata); err != nil {
		return failure(StateInvalid, "invalid captured metadata")
	}
	metadata["messageType"], _ = json.Marshal(HistoryNotificationType)
	info, err := json.Marshal(metadata)
	if err != nil {
		return failure(StateInvalid, "invalid notification metadata")
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return failure(StorageFailed, "delivery ID generation failed")
	}
	p := PendingInsert{
		DeliveryID: "wa-delivery:v1:" + hex.EncodeToString(random[:]), AccountID: s.accountID,
		Source: "history", IdentityState: "pendingLid",
		Recovery: Recovery{MessageInfoJSON: string(info), Items: []RecoveryItem{{Format: "history", PlaintextBase64: base64.StdEncoding.EncodeToString(plaintext)}}},
	}
	if err := s.PreparePendingInsert(ctx, p); err != nil {
		return err
	}
	return s.putRetryHash(ctx, hash, serverTime)
}

// ErrHistoryAdmitted reports that the batch was already published: nothing is written again.
var ErrHistoryAdmitted = errors.New("history batch already admitted")

// ErrHistoryContent wraps a refusal caused by the content of a batch: staging its protocol effects
// failed deterministically (an oversize key, an incomplete secret…). Staging runs on a disposable
// transaction, so nothing was published and the store is left untouched and usable.
var ErrHistoryContent = errors.New("history batch content refused by the store")

// ErrHistoryTooLarge wraps a batch whose effects would exceed the session or binding limits.
var ErrHistoryTooLarge = errors.New("history batch exceeds the session storage limits")

// HistoryBatch is everything one history sync publishes together.
type HistoryBatch struct {
	// Marker identifies the notification's batch; it is committed with the batch so that
	// a repeated admission after an interruption is recognized and never duplicates it.
	Marker [32]byte
	// Capture is the delivery ID of the notification entry that stays pending beside the batch.
	Capture string
	// Stage applies the protocol effects of the batch (mappings, secrets, salts, settings)
	// with the stores of the context it receives; they publish with the inserts or not at all.
	Stage func(context.Context) error
	// Rollback undoes the in-memory side effects Stage may have had on its client when the batch
	// ends up not being published (a refusal after Stage, or a failed commit).
	Rollback func()
	Inserts  []PendingInsert
}

// AdmitHistoryBatch publishes protocol changes, every pending insert and the batch marker in
// one native commit, or none of them. A batch that cannot fit beside its own capture entry is
// refused as an oversize BufferFull; one that fits only after confirmations is refused as a
// waiting BufferFull. Neither refusal latches the store: nothing was staged yet.
func (s *Store) AdmitHistoryBatch(ctx context.Context, batch HistoryBatch) (err error) {
	seen := map[string]bool{}
	for _, insert := range batch.Inserts {
		if insert.Source != "history" || IsHistoryNotification(insert) || seen[insert.DeliveryID] {
			return malformed("invalid historical insert")
		}
		if err := s.validateInsert(insert); err != nil {
			return err
		}
		seen[insert.DeliveryID] = true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped != nil {
		return s.stopped
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	marker := base64.StdEncoding.EncodeToString(batch.Marker[:])
	if _, done := s.records[recordID("retry-hash", mustKey("retry-hash", marker))]; done {
		return ErrHistoryAdmitted
	}
	err = s.historyCapacityLocked(batch)
	if wait := new(*Error); errors.As(err, wait) && !(*wait).Oversize {
		// Retirements go through the ledger, not through this store: look at the published
		// entries before deciding that the batch still has to wait.
		if readErr := s.read(); readErr != nil {
			s.stopped = readErr
			return readErr
		}
		err = s.historyCapacityLocked(batch)
	}
	if err != nil {
		return err
	}
	t := &txn{owner: s, active: true, records: clone(s.records)}
	tctx := context.WithValue(ctx, txnKey{}, t)
	if batch.Stage != nil {
		defer func() {
			if err != nil && batch.Rollback != nil {
				batch.Rollback()
			}
		}()
		if err := batch.Stage(tctx); err != nil {
			// The transaction is disposable and Stage only stages in memory, so a failure is a
			// verdict on the batch (or the end of the context), never a storage fault.
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			return errors.Join(ErrHistoryContent, err)
		}
	}
	for _, insert := range batch.Inserts {
		insert.Message = append(json.RawMessage(nil), insert.Message...)
		insert.Recovery.Items = append([]RecoveryItem(nil), insert.Recovery.Items...)
		t.pending = append(t.pending, insert)
	}
	if err := t.put("retry-hash", protocolstate.RetryHash{Version: 1, InsertTimeMS: time.Now().UnixMilli(), ServerTimeSeconds: time.Now().Unix()}, marker); err != nil {
		return errors.Join(ErrHistoryContent, err)
	}
	if err := s.checkCommitLimits(t); err != nil {
		return err
	}
	t.active = false
	return s.commit(t)
}

func mustKey(recordType string, parts ...string) string {
	key, _ := protocolstate.EncodeKey(recordType, parts...)
	return key
}

// RecoveryBudget is the byte limit entries are admitted against.
func (s *Store) RecoveryBudget() int64 { return s.newRecoveryBytes }

// HistoryAdmitted reports whether the batch with this marker was already published.
func (s *Store) HistoryAdmitted(marker [32]byte) (bool, error) {
	v, found, err := s.get(context.Background(), "retry-hash", base64.StdEncoding.EncodeToString(marker[:]))
	return found && v != nil, err
}

func (s *Store) historyCapacityLocked(batch HistoryBatch) error {
	sizes := make([]int64, 0, len(batch.Inserts))
	var total int64
	for _, insert := range batch.Inserts {
		size, err := EntrySize(insert)
		if err != nil {
			return err
		}
		sizes = append(sizes, size)
		total += size
	}
	var capture, used int64
	for _, record := range s.pending {
		size, err := EntrySize(record.PendingInsert)
		if err != nil {
			return err
		}
		used += size
		if record.DeliveryID == batch.Capture {
			capture = size
		}
	}
	// The capture entry cannot leave before the batch is published, so the batch has to fit beside it.
	if Decide(s.newRecoveryBytes, capture, sizes...) != Admit {
		return &Error{Code: BufferFull, Message: "history batch exceeds recovery buffer", Needed: total, Oversize: true}
	}
	if Decide(s.newRecoveryBytes, used, sizes...) != Admit {
		return &Error{Code: BufferFull, Message: "recovery buffer is full", Needed: total}
	}
	return nil
}

// checkCommitLimits refuses, without latching the store, the batches whose staged state commit
// would stop the generation for: a session over its record limit or a payload over the binding limit.
func (s *Store) checkCommitLimits(t *txn) error {
	records := make([]protocolstate.Record, 0, len(t.records))
	for _, r := range t.records {
		records = append(records, r)
	}
	if _, err := protocolstate.Encode(records); err != nil {
		if errors.Is(err, protocolstate.ErrSessionTooLarge) {
			return errors.Join(ErrHistoryTooLarge, err)
		}
		return errors.Join(ErrHistoryContent, err)
	}
	if err := validatePrekeyRecords(t.records); err != nil {
		return errors.Join(ErrHistoryContent, err)
	}
	body, err := json.Marshal(s.applyRequest(t))
	if err != nil {
		return errors.Join(ErrHistoryContent, err)
	}
	if uint64(len(body)) > payloadLimit(s.newRecoveryBytes) {
		return errors.Join(ErrHistoryTooLarge, errors.New("binding payload too large"))
	}
	return nil
}

// HistoryMarker identifies the remote batch a notification announces for one account, independent
// of the message that carried it.
func HistoryMarker(account string, notification *waE2E.HistorySyncNotification) [32]byte {
	reduced := proto.Clone(notification).(*waE2E.HistorySyncNotification)
	if inline := reduced.GetInitialHistBootstrapInlinePayload(); inline != nil {
		digest := sha256.Sum256(inline)
		reduced.InitialHistBootstrapInlinePayload = digest[:]
	}
	raw, _ := proto.MarshalOptions{Deterministic: true}.Marshal(reduced)
	hash := sha256.New()
	hash.Write([]byte("wa-history-batch:v1\x00" + account + "\x00"))
	hash.Write(raw)
	var marker [32]byte
	copy(marker[:], hash.Sum(nil))
	return marker
}

// captureMarker is the batch marker a live capture of this store's account protects, if it reads.
func (s *Store) captureMarker(p PendingInsert) (string, bool) {
	if p.AccountID != s.accountID || !IsHistoryNotification(p) || len(p.Recovery.Items) != 1 {
		return "", false
	}
	plaintext, err := base64.StdEncoding.DecodeString(p.Recovery.Items[0].PlaintextBase64)
	if err != nil {
		return "", false
	}
	var message waE2E.Message
	if proto.Unmarshal(plaintext, &message) != nil || message.GetProtocolMessage().GetHistorySyncNotification() == nil {
		return "", false
	}
	marker := HistoryMarker(s.accountID, message.GetProtocolMessage().GetHistorySyncNotification())
	return base64.StdEncoding.EncodeToString(marker[:]), true
}
