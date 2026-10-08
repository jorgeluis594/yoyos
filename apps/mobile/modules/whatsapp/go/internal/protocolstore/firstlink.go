package protocolstore

import (
	"context"
	"encoding/base64"
	"encoding/json"
	mathRand "math/rand/v2"
	"sync"

	"go.mau.fi/util/random"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"
	"yoyos-whatsapp/internal/protocolstate"
)

type FirstLinkStorage interface {
	Storage
	BeginFreshSession(string) (string, error)
}

type firstLinkContainer struct {
	mu                                  sync.Mutex
	storage                             FirstLinkStorage
	generationID                        string
	readRecoveryBytes, newRecoveryBytes int64
	linked                              *Store
}

// NewFirstLinkDevice mirrors pinned sqlstore.NewDevice's credential generation.
// The first durable write occurs only after whatsmeow verifies the pair and knows its LID.
func NewFirstLinkDevice(storage FirstLinkStorage, generationID string, readRecoveryBytes, newRecoveryBytes int64) (*store.Device, error) {
	if storage == nil || generationID == "" || readRecoveryBytes < newRecoveryBytes || newRecoveryBytes < 1 {
		return nil, malformed("invalid first-link storage")
	}
	device := &store.Device{
		Log:      waLog.Noop,
		NoiseKey: keys.NewKeyPair(), IdentityKey: keys.NewKeyPair(),
		RegistrationID: mathRand.Uint32(), AdvSecretKey: random.Bytes(32),
		Container: &firstLinkContainer{storage: storage, generationID: generationID, readRecoveryBytes: readRecoveryBytes, newRecoveryBytes: newRecoveryBytes},
	}
	device.SignedPreKey = device.IdentityKey.CreateSignedPreKey(1)
	return device, nil
}

func (c *firstLinkContainer) PutDevice(ctx context.Context, device *store.Device) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.linked != nil {
		return c.linked.PutDevice(ctx, device)
	}
	if device == nil || device.ID == nil || device.ID.IsEmpty() || device.LID.IsEmpty() {
		return malformed("verified pair JID and LID required")
	}
	account := device.LID.ToNonAD().String()
	v, err := protocolstate.DeviceFromStore(device)
	if err != nil {
		return malformed("invalid paired device")
	}
	key, err := protocolstate.EncodeKey("device")
	if err != nil {
		return err
	}
	value, err := protocolstate.EncodeValue("device", v)
	if err != nil {
		return err
	}
	record := protocolstate.Record{RecordType: "device", RecordKey: key, ValueBase64: base64.StdEncoding.EncodeToString(value)}
	if _, err = protocolstate.Encode([]protocolstate.Record{record}); err != nil {
		return err
	}
	request, _ := json.Marshal(struct {
		ContractVersion int                  `json:"contractVersion"`
		GenerationID    string               `json:"generationId"`
		AccountID       string               `json:"accountId"`
		Device          protocolstate.Record `json:"device"`
	}{1, c.generationID, account, record})
	var result *applied
	for attempt := 0; attempt < 2; attempt++ {
		raw, callErr := invoke(c.storage.BeginFreshSession, string(request))
		if callErr == nil {
			result, callErr = decodeResponse[applied](raw, payloadLimit(c.newRecoveryBytes))
		}
		if callErr == nil {
			break
		}
		if typed, ok := callErr.(*Error); ok && typed.native && typed.Code != StorageFailed {
			return callErr
		}
		if attempt == 1 {
			return failure(UncertainCommit, "first-link publication uncertain")
		}
	}
	if result.Revision == "" || result.SessionRevision == "" {
		return failure(StateInvalid, "missing first-link revisions")
	}
	linked, err := Open(c.storage, c.generationID, account, c.readRecoveryBytes, c.newRecoveryBytes)
	if err != nil {
		return err
	}
	if linked.sessionRevision == 0 || len(linked.records) != 1 || linked.records[recordID(record.RecordType, record.RecordKey)] != record {
		return failure(StateInvalid, "first-link device not published")
	}
	linked.AttachDevice(device)
	c.linked = linked
	return nil
}

func (*firstLinkContainer) DeleteDevice(context.Context, *store.Device) error {
	return failure(NativeLogoutRequired, "native controller owns first-link cleanup")
}

var _ store.DeviceContainer = (*firstLinkContainer)(nil)
