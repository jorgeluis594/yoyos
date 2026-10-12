package protocolstore

import (
	"encoding/json"
	"sort"
	"strconv"
)

// DeliveryStorage is the native pending-entry boundary that works without a
// generation, session or network: recovery and confirmation only need the
// encrypted container. Success means the publication is durable.
type DeliveryStorage interface {
	ReadPending(string) (string, error)
	RetirePending(string) (string, error)
}

type pendingData struct {
	Revision string          `json:"revision"`
	Pending  []PendingRecord `json:"pending"`
}
type retired struct {
	Revision string `json:"revision"`
	Removed  bool   `json:"removed"`
}

// Ledger reads and retires pending deliveries of any account.
type Ledger struct {
	storage DeliveryStorage
	bytes   int64 // reliable read bound: never below the budget, and never reduced with it
}

// NewLedger reads with readBytes, the largest budget the container ever accepted, and admits
// against recoveryBytes, the configured one. Reducing the budget below what is stored must not
// reduce the read bound, or the snapshot that holds the excess could no longer be decoded and the
// excess could never be drained; the bound stays finite, so a response of arbitrary length is
// still refused.
func NewLedger(storage DeliveryStorage, readBytes, recoveryBytes int64) (*Ledger, error) {
	if storage == nil || recoveryBytes < 1 || readBytes < recoveryBytes || readBytes > 9007199254740991 {
		return nil, failure(InvalidRequest, "delivery storage, budget and a read bound not below it required")
	}
	return &Ledger{storage: storage, bytes: readBytes}, nil
}

// ValidDeliveryID reports whether a public delivery identifier is well formed.
func ValidDeliveryID(id string) bool { return validDeliveryID(id) }

// Pending rereads the published state ordered by numeric revision and ordinal.
// A failed read is an error and is never an empty list.
func (l *Ledger) Pending() ([]PendingRecord, error) {
	raw, err := invoke(l.storage.ReadPending, `{"contractVersion":1}`)
	if err != nil {
		return nil, failure(StorageFailed, "ReadPending invocation failed")
	}
	data, err := decodeResponse[pendingData](raw, payloadLimit(l.bytes))
	if err != nil {
		return nil, err
	}
	rev, err := decimal(data.Revision)
	if err != nil {
		return nil, err
	}
	if data.Pending == nil {
		return nil, failure(StateInvalid, "missing pending list")
	}
	if err := validatePending(data.Pending, rev); err != nil {
		return nil, err
	}
	SortPending(data.Pending)
	return data.Pending, nil
}

// SortPending orders by numeric revision, then ordinal; text order would put "10" before "9".
func SortPending(pending []PendingRecord) {
	sort.SliceStable(pending, func(i, j int) bool {
		a, _ := strconv.ParseUint(pending[i].CreatedRevision, 10, 64)
		b, _ := strconv.ParseUint(pending[j].CreatedRevision, 10, 64)
		if a != b {
			return a < b
		}
		return *pending[i].CreatedOrdinal < *pending[j].CreatedOrdinal
	})
}

// Retire durably removes the whole entry. A valid identifier with no pending
// entry succeeds with removed=false; unreadable state is an error, not absence.
func (l *Ledger) Retire(id string) (bool, error) {
	if !validDeliveryID(id) {
		return false, failure(InvalidRequest, "invalid delivery ID")
	}
	request, _ := json.Marshal(struct {
		ContractVersion int    `json:"contractVersion"`
		DeliveryID      string `json:"deliveryId"`
	}{1, id})
	raw, err := invoke(l.storage.RetirePending, string(request))
	if err != nil {
		return false, failure(StorageFailed, "RetirePending invocation failed")
	}
	result, err := decodeResponse[retired](raw, payloadLimit(l.bytes))
	if err != nil {
		return false, err
	}
	if _, err := decimal(result.Revision); err != nil {
		return false, err
	}
	return result.Removed, nil
}
