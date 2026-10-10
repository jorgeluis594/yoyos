package protocolstore

import (
	"encoding/base64"
	"encoding/json"
	"math"
)

// The recovery budget counts the serialized pending entry as the native writer
// stores it, its encryption overhead, and any reserve needed to complete its
// identity later. Downloaded image bytes never enter this buffer.
const (
	// EncryptionOverheadBytes is the AES-GCM nonce and tag added to the entry.
	EncryptionOverheadBytes int64 = 12 + 16
	// RecordSeparatorBytes covers the delimiter between serialized entries.
	RecordSeparatorBytes int64 = 1
	// IdentityReserveBytes bounds the normalized message a pendingLid entry may
	// later gain: a 16 KiB image descriptor plus identifiers and fixed fields.
	IdentityReserveBytes int64 = 18 * 1024
)

// Decision is the outcome of checking an admission against the budget.
type Decision int

const (
	// Admit fits now.
	Admit Decision = iota
	// Wait fits an empty buffer but not beside the current entries.
	Wait
	// Reject cannot fit even in an empty buffer; freeing space never helps.
	Reject
)

// Decide checks one entry or a whole batch atomically: the batch is admitted
// exactly at the limit and rejected one byte beyond it, never partially.
func Decide(limit, used int64, sizes ...int64) Decision {
	var total int64
	for _, size := range sizes {
		if size < 0 || total > math.MaxInt64-size {
			return Reject
		}
		total += size
	}
	switch {
	case total > limit:
		return Reject
	case used > limit-total:
		return Wait
	default:
		return Admit
	}
}

// EntrySize is the number of budget bytes one pending entry occupies.
func EntrySize(p PendingInsert) (int64, error) {
	record := PendingRecord{PendingInsert: p, CreatedRevision: "18446744073709551615", CreatedOrdinal: new(uint32)}
	*record.CreatedOrdinal = math.MaxUint32
	raw, err := json.Marshal(record)
	if err != nil {
		return 0, failure(StateInvalid, "pending entry cannot be measured")
	}
	size := int64(len(raw)) + EncryptionOverheadBytes + RecordSeparatorBytes
	if p.IdentityState == "pendingLid" {
		size += IdentityReserveBytes + plaintextBytes(p.Recovery)
	}
	return size, nil
}

// plaintextBytes bounds the text a later normalized message can carry.
func plaintextBytes(r Recovery) int64 {
	var total int64
	for _, item := range r.Items {
		total += int64(base64.StdEncoding.DecodedLen(len(item.PlaintextBase64)))
	}
	return total
}

// UsedBytes sums the budget occupied by a set of pending records.
func UsedBytes(pending []PendingRecord) (int64, error) {
	var used int64
	for _, record := range pending {
		size, err := EntrySize(record.PendingInsert)
		if err != nil {
			return 0, err
		}
		used += size
	}
	return used, nil
}
