package protocolstore

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"

	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/protocolstate"
)

// Storage is the synchronous native writer boundary. Success means durable publication.
type Storage interface {
	ReadState(string) (string, error)
	ApplyChanges(string) (string, error)
}

type Code string

const (
	InvalidRequest          Code = "INVALID_REQUEST"
	StaleGeneration         Code = "STALE_GENERATION"
	SessionRevisionMismatch Code = "SESSION_REVISION_MISMATCH"
	BufferFull              Code = "BUFFER_FULL"
	SessionFull             Code = "SESSION_FULL"
	StorageFailed           Code = "STORAGE_FAILED"
	StateInvalid            Code = "STATE_INVALID"
	UncertainCommit         Code = "UNCERTAIN_COMMIT"
	RecoveryContextMissing  Code = "RECOVERY_CONTEXT_MISSING"
	OutgoingUnsupported     Code = "OUTGOING_UNSUPPORTED"
	NativeLogoutRequired    Code = "NATIVE_LOGOUT_REQUIRED"
)

type Error struct {
	Code    Code
	Message string
	native  bool
}

func (e *Error) Error() string                { return string(e.Code) + ": " + e.Message }
func failure(code Code, message string) error { return &Error{Code: code, Message: message} }

// The binding's JSON shapes are fixed here; native must independently validate all inputs.
type Change struct {
	Operation   string `json:"operation"`
	RecordType  string `json:"recordType"`
	RecordKey   string `json:"recordKey"`
	ValueBase64 string `json:"valueBase64,omitempty"`
}
type PendingInsert struct {
	DeliveryID    string          `json:"deliveryId"`
	AccountID     string          `json:"accountId"`
	Source        string          `json:"source"`
	IdentityState string          `json:"identityState"`
	Message       json.RawMessage `json:"message,omitempty"`
	Recovery      Recovery        `json:"recovery"`
}
type PendingRecord struct {
	PendingInsert
	CreatedRevision string `json:"createdRevision"`
	CreatedOrdinal  uint32 `json:"createdOrdinal"`
}
type Recovery struct {
	MessageInfoJSON string         `json:"messageInfoJson"`
	Items           []RecoveryItem `json:"items"`
}
type RecoveryItem struct {
	Format               string `json:"format"`
	PlaintextBase64      string `json:"plaintextBase64"`
	CiphertextHashBase64 string `json:"ciphertextHashBase64,omitempty"`
}
type PendingIdentityUpdate struct {
	DeliveryID    string          `json:"deliveryId"`
	IdentityState string          `json:"identityState"`
	Message       json.RawMessage `json:"message"`
}
type ApplyRequest struct {
	ContractVersion         int                     `json:"contractVersion"`
	GenerationID            string                  `json:"generationId"`
	AccountID               string                  `json:"accountId"`
	ExpectedSessionRevision string                  `json:"expectedSessionRevision"`
	ProtocolChanges         []Change                `json:"protocolChanges"`
	PendingInserts          []PendingInsert         `json:"pendingInserts"`
	PendingIdentityUpdates  []PendingIdentityUpdate `json:"pendingIdentityUpdates"`
}
type readData struct {
	Revision        string          `json:"revision"`
	SessionRevision string          `json:"sessionRevision"`
	Session         *session        `json:"session"`
	Pending         []PendingRecord `json:"pending"`
}
type session struct {
	AccountID             string                 `json:"accountId"`
	ProtocolSchemaVersion int                    `json:"protocolSchemaVersion"`
	Records               []protocolstate.Record `json:"records"`
}
type applied struct {
	Revision        string `json:"revision"`
	SessionRevision string `json:"sessionRevision"`
}
type response[T any] struct {
	ContractVersion int  `json:"contractVersion"`
	Success         bool `json:"success"`
	Data            *T   `json:"data,omitempty"`
	Error           *struct {
		Code    Code   `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// SessionBytes already includes value Base64; recoveryBytes includes pending JSON Base64.
// The remaining allowance covers binding and snapshot control metadata.
const bindingOverheadBytes = 8244 + 4096

func payloadLimit(recoveryBytes int64) uint64 {
	return uint64(protocolstate.MaxSessionBytes) + uint64(recoveryBytes) + bindingOverheadBytes
}

func decodeResponse[T any](raw string, limit uint64) (*T, error) {
	if uint64(len(raw)) > limit {
		return nil, failure(StateInvalid, "binding response too large")
	}
	if err := rejectDuplicateMembers([]byte(raw)); err != nil {
		return nil, failure(StateInvalid, "duplicate binding member")
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &top); err != nil {
		return nil, failure(StateInvalid, "invalid binding response")
	}
	var out response[T]
	d := json.NewDecoder(bytes.NewReader([]byte(raw)))
	d.DisallowUnknownFields()
	if err := d.Decode(&out); err != nil {
		return nil, failure(StateInvalid, "invalid binding response")
	}
	if _, err := d.Token(); err != io.EOF {
		return nil, failure(StateInvalid, "trailing binding response")
	}
	if out.ContractVersion != 1 {
		return nil, failure(StateInvalid, "unexpected contract version")
	}
	if out.Success {
		if out.Data == nil || out.Error != nil {
			return nil, failure(StateInvalid, "incoherent success")
		}
		if err := requireKeyMap(top, "contractVersion", "success", "data"); err != nil {
			return nil, err
		}
		switch any(*out.Data).(type) {
		case readData:
			if err := requireKeys(top["data"], "revision", "sessionRevision", "session", "pending"); err != nil {
				return nil, err
			}
		case applied:
			if err := requireKeys(top["data"], "revision", "sessionRevision"); err != nil {
				return nil, err
			}
		}
		return out.Data, nil
	}
	if out.Data != nil || out.Error == nil || out.Error.Message == "" {
		return nil, failure(StateInvalid, "incoherent error")
	}
	if err := requireKeyMap(top, "contractVersion", "success", "error"); err != nil {
		return nil, err
	}
	if err := requireKeys(top["error"], "code", "message"); err != nil {
		return nil, err
	}
	switch out.Error.Code {
	case InvalidRequest, StaleGeneration, SessionRevisionMismatch, BufferFull, SessionFull, StorageFailed, StateInvalid:
		return nil, &Error{Code: out.Error.Code, Message: out.Error.Message, native: true}
	default:
		return nil, failure(StateInvalid, "unknown storage error code")
	}
}
func requireKeys(raw json.RawMessage, keys ...string) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return failure(StateInvalid, "wrong binding members")
	}
	return requireKeyMap(m, keys...)
}
func requireKeyMap(m map[string]json.RawMessage, keys ...string) error {
	if len(m) != len(keys) {
		return failure(StateInvalid, "wrong binding members")
	}
	for _, key := range keys {
		if _, ok := m[key]; !ok {
			return failure(StateInvalid, "missing binding member")
		}
	}
	return nil
}
func rejectDuplicateMembers(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	if err := walkMembers(d, 0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return failure(StateInvalid, "trailing JSON")
	}
	return nil
}
func walkMembers(d *json.Decoder, depth int) error {
	if depth > 64 {
		return failure(StateInvalid, "JSON too deep")
	}
	tok, err := d.Token()
	if err != nil {
		return err
	}
	delim, ok := tok.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			key, err := d.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || seen[name] {
				return failure(StateInvalid, "duplicate JSON member")
			}
			seen[name] = true
			if err = walkMembers(d, depth+1); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	case '[':
		for d.More() {
			if err = walkMembers(d, depth+1); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	default:
		return failure(StateInvalid, "invalid JSON delimiter")
	}
}
func decimal(s string) (uint64, error) {
	n, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != s {
		return 0, failure(StateInvalid, "invalid revision")
	}
	return n, nil
}
func invoke(fn func(string) (string, error), request string) (raw string, err error) {
	defer func() {
		if recover() != nil {
			err = failure(StorageFailed, "native callback panicked")
		}
	}()
	return fn(request)
}

type Store struct {
	storage                             Storage
	generationID, accountID             string
	readRecoveryBytes, newRecoveryBytes int64
	mu                                  sync.Mutex
	revision, sessionRevision           uint64
	records                             map[string]protocolstate.Record
	stopped                             error
	readbackErr                         error
}
type txn struct {
	owner       *Store
	active      bool
	err         error
	records     map[string]protocolstate.Record
	changes     []Change
	pending     []PendingInsert
	updates     []PendingIdentityUpdate
	afterCommit []func()
}
type txnKey struct{}

func Open(storage Storage, generationID, accountID string, readRecoveryBytes, newRecoveryBytes int64) (*Store, error) {
	if storage == nil || generationID == "" || accountID == "" || readRecoveryBytes < 1 || newRecoveryBytes < 1 || readRecoveryBytes > 9007199254740991 || newRecoveryBytes > 9007199254740991 || readRecoveryBytes < newRecoveryBytes {
		return nil, failure(InvalidRequest, "storage, generation and account required")
	}
	account, err := types.ParseJID(accountID)
	if err != nil || account.String() != accountID || account.Server != types.HiddenUserServer || account.Device != 0 || account.RawAgent != 0 || account.User == "" {
		return nil, failure(InvalidRequest, "account ID must be canonical non-device LID")
	}
	s := &Store{storage: storage, generationID: generationID, accountID: accountID, readRecoveryBytes: readRecoveryBytes, newRecoveryBytes: newRecoveryBytes}
	if err := s.read(); err != nil {
		return nil, err
	}
	return s, nil
}
func (s *Store) read() error {
	raw, err := invoke(s.storage.ReadState, `{"contractVersion":1}`)
	if err != nil {
		return failure(StorageFailed, "ReadState invocation failed")
	}
	data, err := decodeResponse[readData](raw, payloadLimit(s.readRecoveryBytes))
	if err != nil {
		return err
	}
	rev, err := decimal(data.Revision)
	if err != nil {
		return err
	}
	sr, err := decimal(data.SessionRevision)
	if err != nil {
		return err
	}
	if sr > rev || data.Pending == nil {
		return failure(StateInvalid, "incoherent read state")
	}
	if err := validatePending(data.Pending, rev); err != nil {
		return err
	}
	records := map[string]protocolstate.Record{}
	if data.Session != nil {
		if sr == 0 || data.Session.AccountID != s.accountID || data.Session.ProtocolSchemaVersion != 1 || data.Session.Records == nil {
			return failure(StateInvalid, "wrong session account or schema")
		}
		blob, e := protocolstate.Encode(data.Session.Records)
		if e != nil {
			return failure(StateInvalid, "invalid session records")
		}
		checked, e := protocolstate.Decode(blob)
		if e != nil {
			return failure(StateInvalid, "invalid session records")
		}
		for _, r := range checked {
			records[recordID(r.RecordType, r.RecordKey)] = r
		}
	} else if sr != 0 {
		return failure(StateInvalid, "missing session at nonzero revision")
	}
	if err := validatePrekeyRecords(records); err != nil {
		return err
	}
	deviceKey, _ := protocolstate.EncodeKey("device")
	if r, ok := records[recordID("device", deviceKey)]; ok {
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		v, err := protocolstate.DecodeValue("device", b)
		if err != nil {
			return err
		}
		lid, err := types.ParseJID(v.(*protocolstate.Device).LID)
		if err != nil || lid.ToNonAD().String() != s.accountID {
			return failure(StateInvalid, "stored device account mismatch")
		}
	}
	s.revision, s.sessionRevision, s.records = rev, sr, records
	return nil
}
func validatePending(pending []PendingRecord, rev uint64) error {
	seen := map[string]bool{}
	positions := map[string]bool{}
	for _, p := range pending {
		if !validDeliveryID(p.DeliveryID) {
			return failure(StateInvalid, "invalid pending delivery ID")
		}
		if seen[p.DeliveryID] {
			return failure(StateInvalid, "duplicate pending delivery")
		}
		seen[p.DeliveryID] = true
		account, e := types.ParseJID(p.AccountID)
		if e != nil || account.String() != p.AccountID || account.Server != types.HiddenUserServer || account.Device != 0 || account.RawAgent != 0 {
			return failure(StateInvalid, "invalid pending account")
		}
		created, e := decimal(p.CreatedRevision)
		if e != nil || created == 0 || created > rev {
			return failure(StateInvalid, "invalid pending revision")
		}
		pos := p.CreatedRevision + ":" + strconv.FormatUint(uint64(p.CreatedOrdinal), 10)
		if positions[pos] {
			return failure(StateInvalid, "duplicate pending ordinal")
		}
		positions[pos] = true
		if p.Source != "live" && p.Source != "history" {
			return failure(StateInvalid, "invalid pending source")
		}
		if p.IdentityState != "pendingLid" && p.IdentityState != "resolved" {
			return failure(StateInvalid, "invalid pending identity state")
		}
		if p.IdentityState == "resolved" && (len(p.Message) == 0 || string(p.Message) == "null") {
			return failure(StateInvalid, "missing resolved message")
		}
		if p.IdentityState == "pendingLid" && len(p.Message) > 0 {
			return failure(StateInvalid, "provisional message identity")
		}
		if err := validateRecovery(p.Recovery); err != nil {
			return err
		}
		if !recoveryMatchesSource(p.Source, p.Recovery) {
			return failure(StateInvalid, "recovery source mismatch")
		}
	}
	return nil
}
func validDeliveryID(id string) bool {
	if !strings.HasPrefix(id, "wa-delivery:v1:") || len(id) != 47 {
		return false
	}
	suffix := strings.TrimPrefix(id, "wa-delivery:v1:")
	raw, e := hex.DecodeString(suffix)
	return e == nil && len(raw) == 16 && hex.EncodeToString(raw) == suffix
}
func validateRecovery(r Recovery) error {
	if r.MessageInfoJSON == "" || !json.Valid([]byte(r.MessageInfoJSON)) || len(r.Items) == 0 {
		return failure(StateInvalid, "invalid recovery metadata")
	}
	for _, item := range r.Items {
		raw, err := base64.StdEncoding.DecodeString(item.PlaintextBase64)
		if err != nil || len(raw) == 0 || base64.StdEncoding.EncodeToString(raw) != item.PlaintextBase64 {
			return failure(StateInvalid, "invalid recovery plaintext")
		}
		if item.Format == "history" {
			if item.CiphertextHashBase64 != "" {
				return failure(StateInvalid, "history recovery has ciphertext hash")
			}
			continue
		}
		if item.Format != "v2" && item.Format != "v3" {
			return failure(StateInvalid, "invalid recovery format")
		}
		hash, err := base64.StdEncoding.DecodeString(item.CiphertextHashBase64)
		if err != nil || len(hash) != 32 || base64.StdEncoding.EncodeToString(hash) != item.CiphertextHashBase64 {
			return failure(StateInvalid, "invalid ciphertext hash")
		}
	}
	return nil
}
func recoveryMatchesSource(source string, r Recovery) bool {
	for _, item := range r.Items {
		if source == "history" && item.Format != "history" || source == "live" && item.Format == "history" {
			return false
		}
	}
	return true
}
func (s *Store) StopReason() error    { s.mu.Lock(); defer s.mu.Unlock(); return s.stopped }
func (s *Store) ReadbackError() error { s.mu.Lock(); defer s.mu.Unlock(); return s.readbackErr }
func (s *Store) RereadConfirmed() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped == nil {
		return failure(InvalidRequest, "readback requires stopped generation")
	}
	// A stopped generation remains stopped even if readback succeeds.
	s.readbackErr = s.read()
	return s.readbackErr
}
func recordID(t, k string) string { return t + "\x00" + k }
func clone(in map[string]protocolstate.Record) map[string]protocolstate.Record {
	out := make(map[string]protocolstate.Record, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
func (s *Store) stage(ctx context.Context, mutate func(*txn) error) error {
	if t, ok := ctx.Value(txnKey{}).(*txn); ok {
		if t.owner != s || !t.active {
			return failure(InvalidRequest, "foreign transaction")
		}
		if t.err != nil {
			return t.err
		}
		t.err = mutate(t)
		return t.err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped != nil {
		return s.stopped
	}
	t := &txn{owner: s, active: true, records: clone(s.records)}
	if err := mutate(t); err != nil {
		return err
	}
	return s.commit(t)
}

// PreparePendingInsert stages a complete recovery record with protocol writes.
// Native assigns createdRevision/createdOrdinal and checks collisions under its writer.
func (s *Store) PreparePendingInsert(ctx context.Context, p PendingInsert) error {
	if !validDeliveryID(p.DeliveryID) || p.AccountID != s.accountID {
		return malformed("invalid pending identity")
	}
	if p.Source != "live" && p.Source != "history" {
		return malformed("invalid pending source")
	}
	if p.IdentityState != "pendingLid" && p.IdentityState != "resolved" {
		return malformed("invalid pending identity state")
	}
	if p.IdentityState == "pendingLid" && len(p.Message) > 0 {
		return malformed("provisional message identity")
	}
	if p.IdentityState == "resolved" && (len(p.Message) == 0 || string(p.Message) == "null" || !json.Valid(p.Message)) {
		return malformed("missing resolved message")
	}
	if err := validateRecovery(p.Recovery); err != nil {
		return malformed("invalid pending recovery")
	}
	if !recoveryMatchesSource(p.Source, p.Recovery) {
		return malformed("recovery source mismatch")
	}
	p.Message = append(json.RawMessage(nil), p.Message...)
	p.Recovery.Items = append([]RecoveryItem(nil), p.Recovery.Items...)
	return s.stage(ctx, func(t *txn) error {
		for _, other := range t.pending {
			if other.DeliveryID == p.DeliveryID {
				return malformed("duplicate pending insert")
			}
		}
		t.pending = append(t.pending, p)
		return nil
	})
}
func (s *Store) PreparePendingIdentityUpdate(ctx context.Context, p PendingIdentityUpdate) error {
	if !validDeliveryID(p.DeliveryID) || p.IdentityState != "resolved" || len(p.Message) == 0 || string(p.Message) == "null" || !json.Valid(p.Message) {
		return malformed("invalid pending identity update")
	}
	p.Message = append(json.RawMessage(nil), p.Message...)
	return s.stage(ctx, func(t *txn) error {
		for _, insert := range t.pending {
			if insert.DeliveryID == p.DeliveryID {
				return malformed("identity update targets new pending insert")
			}
		}
		for _, other := range t.updates {
			if other.DeliveryID == p.DeliveryID {
				return malformed("duplicate pending identity update")
			}
		}
		t.updates = append(t.updates, p)
		return nil
	})
}
func (s *Store) commit(t *txn) error {
	if len(t.changes) == 0 && len(t.pending) == 0 && len(t.updates) == 0 {
		return nil
	}
	if s.revision == ^uint64(0) || (len(t.changes) > 0 && s.sessionRevision == ^uint64(0)) {
		return failure(SessionFull, "revision exhausted")
	}
	records := make([]protocolstate.Record, 0, len(t.records))
	for _, r := range t.records {
		records = append(records, r)
	}
	if _, err := protocolstate.Encode(records); err != nil {
		return err
	}
	if err := validatePrekeyRecords(t.records); err != nil {
		return err
	}
	request := ApplyRequest{1, s.generationID, s.accountID, strconv.FormatUint(s.sessionRevision, 10), t.changes, t.pending, t.updates}
	if request.ProtocolChanges == nil {
		request.ProtocolChanges = []Change{}
	}
	if request.PendingInserts == nil {
		request.PendingInserts = []PendingInsert{}
	}
	if request.PendingIdentityUpdates == nil {
		request.PendingIdentityUpdates = []PendingIdentityUpdate{}
	}
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	if uint64(len(body)) > payloadLimit(s.newRecoveryBytes) {
		return failure(SessionFull, "binding request too large")
	}
	raw, callErr := invoke(s.storage.ApplyChanges, string(body))
	if callErr != nil {
		s.stopped = failure(UncertainCommit, "ApplyChanges invocation failed; readback required")
		s.records = nil
		s.readbackErr = s.read()
		return s.stopped
	}
	result, err := decodeResponse[applied](raw, payloadLimit(s.newRecoveryBytes))
	if err != nil {
		var e *Error
		if errors.As(err, &e) && e.native {
			s.stopped = err
			if e.Code == StorageFailed || e.Code == StateInvalid || e.Code == StaleGeneration || e.Code == SessionRevisionMismatch {
				s.records = nil
				s.readbackErr = s.read()
			}
			return err
		}
		s.stopped = failure(UncertainCommit, "invalid ApplyChanges response; readback required")
		s.records = nil
		s.readbackErr = s.read()
		return s.stopped
	}
	rev, e1 := decimal(result.Revision)
	sr, e2 := decimal(result.SessionRevision)
	expectedSR := s.sessionRevision
	if len(t.changes) > 0 {
		expectedSR++
	}
	if e1 != nil || e2 != nil || rev <= s.revision || sr != expectedSR {
		s.stopped = failure(UncertainCommit, "incoherent ApplyChanges revisions; readback required")
		s.records = nil
		s.readbackErr = s.read()
		return s.stopped
	}
	s.records = t.records
	s.revision = rev
	s.sessionRevision = sr
	for _, fn := range t.afterCommit {
		fn()
	}
	return nil
}
func (s *Store) get(ctx context.Context, recordType string, parts ...string) (any, bool, error) {
	key, err := protocolstate.EncodeKey(recordType, parts...)
	if err != nil {
		return nil, false, err
	}
	if t, ok := ctx.Value(txnKey{}).(*txn); ok {
		if t.owner != s || !t.active {
			return nil, false, failure(InvalidRequest, "foreign transaction")
		}
		r, exists := t.records[recordID(recordType, key)]
		if !exists {
			return nil, false, nil
		}
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		v, e := protocolstate.DecodeValue(recordType, b)
		return v, true, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped != nil {
		return nil, false, s.stopped
	}
	r, exists := s.records[recordID(recordType, key)]
	if !exists {
		return nil, false, nil
	}
	b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
	v, e := protocolstate.DecodeValue(recordType, b)
	return v, true, e
}
func (s *Store) put(ctx context.Context, recordType string, value any, parts ...string) error {
	return s.stage(ctx, func(t *txn) error { return t.put(recordType, value, parts...) })
}
func (t *txn) put(recordType string, value any, parts ...string) error {
	key, err := protocolstate.EncodeKey(recordType, parts...)
	if err != nil {
		return err
	}
	b, err := protocolstate.EncodeValue(recordType, value)
	if err != nil {
		return err
	}
	r := protocolstate.Record{RecordType: recordType, RecordKey: key, ValueBase64: base64.StdEncoding.EncodeToString(b)}
	t.records[recordID(recordType, key)] = r
	t.changes = append(t.changes, Change{Operation: "put", RecordType: recordType, RecordKey: key, ValueBase64: r.ValueBase64})
	return nil
}
func (s *Store) del(ctx context.Context, recordType string, parts ...string) error {
	return s.stage(ctx, func(t *txn) error { return t.del(recordType, parts...) })
}
func (t *txn) del(recordType string, parts ...string) error {
	key, err := protocolstate.EncodeKey(recordType, parts...)
	if err != nil {
		return err
	}
	if _, exists := t.records[recordID(recordType, key)]; !exists {
		return nil
	}
	delete(t.records, recordID(recordType, key))
	t.changes = append(t.changes, Change{Operation: "delete", RecordType: recordType, RecordKey: key})
	return nil
}
func (t *txn) value(recordType string, parts ...string) (any, bool, error) {
	key, err := protocolstate.EncodeKey(recordType, parts...)
	if err != nil {
		return nil, false, err
	}
	r, ok := t.records[recordID(recordType, key)]
	if !ok {
		return nil, false, nil
	}
	b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
	v, err := protocolstate.DecodeValue(recordType, b)
	return v, true, err
}
func (s *Store) scan(ctx context.Context, recordType string) ([]protocolstate.Record, error) {
	if t, ok := ctx.Value(txnKey{}).(*txn); ok {
		if t.owner != s || !t.active {
			return nil, failure(InvalidRequest, "foreign transaction")
		}
		return scanMap(t.records, recordType), nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped != nil {
		return nil, s.stopped
	}
	return scanMap(s.records, recordType), nil
}
func scanMap(m map[string]protocolstate.Record, typ string) []protocolstate.Record {
	out := []protocolstate.Record{}
	for _, r := range m {
		if r.RecordType == typ {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RecordKey < out[j].RecordKey })
	return out
}
func (s *Store) DoDecryptionTxn(ctx context.Context, fn func(context.Context) error) (err error) {
	if ctx.Value(txnKey{}) != nil {
		return failure(InvalidRequest, "nested transaction")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped != nil {
		return s.stopped
	}
	t := &txn{owner: s, active: true, records: clone(s.records)}
	defer func() {
		t.active = false
		if recover() != nil {
			err = failure(StorageFailed, "decryption transaction panicked")
		}
		if err != nil && s.stopped == nil {
			var local *Error
			if errors.As(err, &local) {
				s.stopped = err
			}
		}
	}()
	if err := fn(context.WithValue(ctx, txnKey{}, t)); err != nil {
		if len(t.changes) > 0 || len(t.pending) > 0 || len(t.updates) > 0 {
			return failure(StorageFailed, "decryption aborted after staged changes; rebuild client")
		}
		return err
	}
	if t.err != nil {
		return t.err
	}
	t.active = false
	return s.commit(t)
}
func binary(data []byte) protocolstate.Binary {
	return protocolstate.Binary{Version: 1, Data: append([]byte(nil), data...)}
}
func binaryKey(b []byte) string    { return base64.StdEncoding.EncodeToString(b) }
func malformed(msg string) error   { return failure(InvalidRequest, msg) }
func unsupported(msg string) error { return failure(RecoveryContextMissing, msg) }
