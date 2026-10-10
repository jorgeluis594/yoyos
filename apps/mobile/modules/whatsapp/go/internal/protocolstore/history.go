package protocolstore

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

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

// HistoryBatch is everything one history sync publishes together.
type HistoryBatch struct {
	// Marker identifies the notification's batch; it is committed with the batch so that
	// a repeated admission after an interruption is recognized and never duplicates it.
	Marker [32]byte
	// Capture is the delivery ID of the notification entry that stays pending beside the batch.
	Capture string
	// Stage applies the protocol effects of the batch (mappings, secrets, salts, settings)
	// with the stores of the context it receives; they publish with the inserts or not at all.
	Stage   func(context.Context) error
	Inserts []PendingInsert
}

// AdmitHistoryBatch publishes protocol changes, every pending insert and the batch marker in
// one native commit, or none of them. A batch that cannot fit beside its own capture entry is
// refused as an oversize BufferFull; one that fits only after confirmations is refused as a
// waiting BufferFull. Neither refusal latches the store: nothing was staged yet.
func (s *Store) AdmitHistoryBatch(ctx context.Context, batch HistoryBatch) error {
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
	err := s.historyCapacityLocked(batch)
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
		if err := batch.Stage(tctx); err != nil {
			s.stopped = storageError(err)
			return s.stopped
		}
	}
	for _, insert := range batch.Inserts {
		insert.Message = append(json.RawMessage(nil), insert.Message...)
		insert.Recovery.Items = append([]RecoveryItem(nil), insert.Recovery.Items...)
		t.pending = append(t.pending, insert)
	}
	if err := t.put("retry-hash", protocolstate.RetryHash{Version: 1, InsertTimeMS: time.Now().UnixMilli(), ServerTimeSeconds: time.Now().Unix()}, marker); err != nil {
		s.stopped = storageError(err)
		return s.stopped
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
