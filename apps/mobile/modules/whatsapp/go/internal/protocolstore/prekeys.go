package protocolstore

import (
	"context"
	"encoding/base64"
	"math"
	"sort"
	"strconv"

	"go.mau.fi/whatsmeow/util/keys"
	"yoyos-whatsapp/internal/protocolstate"
)

func (t *txn) prekeyState() (protocolstate.PreKeyState, error) {
	key, _ := protocolstate.EncodeKey("prekey-state")
	r, ok := t.records[recordID("prekey-state", key)]
	if !ok {
		return protocolstate.PreKeyState{Version: 1, NextID: 1}, nil
	}
	b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
	v, e := protocolstate.DecodeValue("prekey-state", b)
	if e != nil {
		return protocolstate.PreKeyState{}, e
	}
	return *v.(*protocolstate.PreKeyState), nil
}
func validatePrekeyRecords(records map[string]protocolstate.Record) error {
	t := &txn{records: records}
	state, err := t.prekeyState()
	if err != nil {
		return err
	}
	stateKey, _ := protocolstate.EncodeKey("prekey-state")
	_, hasState := records[recordID("prekey-state", stateKey)]
	prekeys := scanMap(records, "prekey")
	if len(prekeys) > 0 && !hasState {
		return failure(StateInvalid, "prekeys without highwater state")
	}
	for _, r := range prekeys {
		parts, err := protocolstate.DecodeKey("prekey", r.RecordKey)
		if err != nil {
			return err
		}
		id, err := strconv.ParseUint(parts[0], 10, 32)
		if err != nil || id >= state.NextID {
			return failure(StateInvalid, "prekey beyond highwater")
		}
	}
	return nil
}
func (s *Store) GenOnePreKey(ctx context.Context) (*keys.PreKey, error) {
	var out *keys.PreKey
	e := s.stage(ctx, func(t *txn) error {
		st, e := t.prekeyState()
		if e != nil {
			return e
		}
		if st.NextID > math.MaxUint32 {
			return failure(SessionFull, "prekey IDs exhausted")
		}
		out = keys.NewPreKey(uint32(st.NextID))
		st.NextID++
		st.UploadedThrough = out.KeyID
		if e = t.put("prekey", protocolstate.PreKey{Version: 1, PrivateKey: out.Priv[:], Uploaded: true}, strconv.FormatUint(uint64(out.KeyID), 10)); e != nil {
			return e
		}
		return t.put("prekey-state", st)
	})
	return out, e
}
func (s *Store) GetOrGenPreKeys(ctx context.Context, count uint32) ([]*keys.PreKey, error) {
	if count > protocolstate.MaxSessionBytes/128 {
		return nil, failure(SessionFull, "requested prekeys exceed session budget")
	}
	var out []*keys.PreKey
	e := s.stage(ctx, func(t *txn) error {
		ids := []uint32{}
		items := map[uint32]protocolstate.PreKey{}
		for _, r := range scanMap(t.records, "prekey") {
			b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
			v, e := protocolstate.DecodeValue("prekey", b)
			if e != nil {
				return e
			}
			p, _ := protocolstate.DecodeKey("prekey", r.RecordKey)
			id64, _ := strconv.ParseUint(p[0], 10, 32)
			id := uint32(id64)
			if !v.(*protocolstate.PreKey).Uploaded {
				ids = append(ids, id)
				items[id] = *v.(*protocolstate.PreKey)
			}
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		out = make([]*keys.PreKey, 0, count)
		for _, id := range ids {
			if uint32(len(out)) == count {
				break
			}
			out = append(out, makePrekey(id, items[id].PrivateKey))
		}
		if uint32(len(out)) == count {
			return nil
		}
		st, e := t.prekeyState()
		if e != nil {
			return e
		}
		needed := uint64(count) - uint64(len(out))
		if needed > uint64(math.MaxUint32)-st.NextID+1 {
			return failure(SessionFull, "prekey IDs exhausted")
		}
		for uint32(len(out)) < count {
			id := uint32(st.NextID)
			key := keys.NewPreKey(id)
			if e = t.put("prekey", protocolstate.PreKey{Version: 1, PrivateKey: key.Priv[:]}, strconv.FormatUint(st.NextID, 10)); e != nil {
				return e
			}
			out = append(out, key)
			st.NextID++
		}
		return t.put("prekey-state", st)
	})
	return out, e
}
func makePrekey(id uint32, priv []byte) *keys.PreKey {
	var p [32]byte
	copy(p[:], priv)
	return &keys.PreKey{KeyPair: *keys.NewKeyPairFromPrivateKey(p), KeyID: id}
}
func (s *Store) GetPreKey(ctx context.Context, id uint32) (*keys.PreKey, error) {
	v, _, e := s.get(ctx, "prekey", strconv.FormatUint(uint64(id), 10))
	if e != nil || v == nil {
		return nil, e
	}
	return makePrekey(id, v.(*protocolstate.PreKey).PrivateKey), nil
}
func (s *Store) RemovePreKey(ctx context.Context, id uint32) error {
	return s.del(ctx, "prekey", strconv.FormatUint(uint64(id), 10))
}
func (s *Store) MarkPreKeysAsUploaded(ctx context.Context, upToID uint32) error {
	return s.stage(ctx, func(t *txn) error {
		st, e := t.prekeyState()
		if e != nil {
			return e
		}
		if uint64(upToID) >= st.NextID {
			return malformed("prekey upload highwater beyond generated keys")
		}
		if upToID > st.UploadedThrough {
			st.UploadedThrough = upToID
		}
		for _, r := range scanMap(t.records, "prekey") {
			p, _ := protocolstate.DecodeKey("prekey", r.RecordKey)
			id64, _ := strconv.ParseUint(p[0], 10, 32)
			if id64 > uint64(upToID) {
				continue
			}
			b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
			v, e := protocolstate.DecodeValue("prekey", b)
			if e != nil {
				return e
			}
			key := v.(*protocolstate.PreKey)
			if !key.Uploaded {
				key.Uploaded = true
				if e = t.put("prekey", key, p[0]); e != nil {
					return e
				}
			}
		}
		return t.put("prekey-state", st)
	})
}
func (s *Store) UploadedPreKeyCount(ctx context.Context) (int, error) {
	rows, e := s.scan(ctx, "prekey")
	if e != nil {
		return 0, e
	}
	n := 0
	for _, r := range rows {
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		v, e := protocolstate.DecodeValue("prekey", b)
		if e != nil {
			return 0, e
		}
		if v.(*protocolstate.PreKey).Uploaded {
			n++
		}
	}
	return n, nil
}
