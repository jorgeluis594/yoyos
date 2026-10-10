package protocolstore

import (
	"context"
	"encoding/base64"
	"sort"
	"strings"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/protocolstate"
)

var _ store.AllStores = (*Store)(nil)
var _ store.DeviceContainer = (*Store)(nil)

func (s *Store) PutIdentity(ctx context.Context, address string, key [32]byte) error {
	return s.put(ctx, "identity", binary(key[:]), address)
}
func (s *Store) DeleteIdentity(ctx context.Context, address string) error {
	return s.del(ctx, "identity", address)
}
func (s *Store) IsTrustedIdentity(ctx context.Context, address string, key [32]byte) (bool, error) {
	v, found, e := s.get(ctx, "identity", address)
	if e != nil {
		return false, e
	}
	if !found {
		return true, nil
	}
	return string(v.(*protocolstate.Binary).Data) == string(key[:]), nil
}
func (s *Store) DeleteAllIdentities(ctx context.Context, phone string) error {
	return s.deletePhone(ctx, "identity", phone)
}
func (s *Store) GetSession(ctx context.Context, address string) ([]byte, error) {
	v, _, e := s.get(ctx, "signal-session", address)
	if e != nil || v == nil {
		return nil, e
	}
	return append([]byte(nil), v.(*protocolstate.Binary).Data...), nil
}
func (s *Store) HasSession(ctx context.Context, address string) (bool, error) {
	_, found, e := s.get(ctx, "signal-session", address)
	return found, e
}
func (s *Store) GetManySessions(ctx context.Context, addresses []string) (map[string][]byte, error) {
	if len(addresses) == 0 {
		return nil, nil
	}
	out := make(map[string][]byte, len(addresses))
	for _, a := range addresses {
		v, e := s.GetSession(ctx, a)
		if e != nil {
			return nil, e
		}
		out[a] = v
	}
	return out, nil
}
func (s *Store) PutSession(ctx context.Context, address string, session []byte) error {
	return s.put(ctx, "signal-session", binary(session), address)
}
func (s *Store) PutManySessions(ctx context.Context, sessions map[string][]byte) error {
	return s.stage(ctx, func(t *txn) error {
		addresses := make([]string, 0, len(sessions))
		for a := range sessions {
			addresses = append(addresses, a)
		}
		sort.Strings(addresses)
		for _, a := range addresses {
			if e := t.put("signal-session", binary(sessions[a]), a); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) DeleteSession(ctx context.Context, address string) error {
	return s.del(ctx, "signal-session", address)
}
func (s *Store) DeleteAllSessions(ctx context.Context, phone string) error {
	return s.deletePhone(ctx, "signal-session", phone)
}
func (s *Store) deletePhone(ctx context.Context, typ, phone string) error {
	return s.stage(ctx, func(t *txn) error {
		for _, r := range scanMap(t.records, typ) {
			parts, e := protocolstate.DecodeKey(typ, r.RecordKey)
			if e != nil {
				return e
			}
			idx := 0
			if typ == "sender-key" {
				idx = 1
			}
			if strings.HasPrefix(parts[idx], phone+":") {
				if e = t.del(typ, parts...); e != nil {
					return e
				}
			}
		}
		return nil
	})
}
func (s *Store) MigratePNToLID(ctx context.Context, pn, lid types.JID) error {
	p, l := pn.SignalAddressUser(), lid.SignalAddressUser()
	return s.stage(ctx, func(t *txn) error {
		for _, typ := range []string{"signal-session", "identity", "sender-key"} {
			for _, r := range scanMap(t.records, typ) {
				parts, e := protocolstate.DecodeKey(typ, r.RecordKey)
				if e != nil {
					return e
				}
				idx := 0
				if typ == "sender-key" {
					idx = 1
				}
				if strings.HasPrefix(parts[idx], p+":") {
					b, e := base64.StdEncoding.DecodeString(r.ValueBase64)
					if e != nil {
						return e
					}
					value, e := protocolstate.DecodeValue(typ, b)
					if e != nil {
						return e
					}
					old := append([]string(nil), parts...)
					parts[idx] = l + strings.TrimPrefix(parts[idx], p)
					if e = t.put(typ, value, parts...); e != nil {
						return e
					}
					if e = t.del(typ, old...); e != nil {
						return e
					}
				}
			}
		}
		return nil
	})
}
func (s *Store) PutSenderKey(ctx context.Context, group, user string, session []byte) error {
	return s.put(ctx, "sender-key", binary(session), group, user)
}
func (s *Store) GetSenderKey(ctx context.Context, group, user string) ([]byte, error) {
	v, _, e := s.get(ctx, "sender-key", group, user)
	if e != nil || v == nil {
		return nil, e
	}
	return append([]byte(nil), v.(*protocolstate.Binary).Data...), nil
}
func (s *Store) PutDevice(ctx context.Context, d *store.Device) error {
	if d == nil || d.LID.ToNonAD().String() != s.accountID {
		return malformed("device LID does not match active account")
	}
	v, e := protocolstate.DeviceFromStore(d)
	if e != nil {
		return malformed("device must have native authorized linked credentials")
	}
	return s.stage(ctx, func(t *txn) error {
		old, found, e := t.value("device")
		if e != nil {
			return e
		}
		if found && old.(*protocolstate.Device).ID != v.ID {
			return malformed("device ID change requires native session creation")
		}
		if e := t.put("device", v); e != nil {
			return e
		}
		t.afterCommit = append(t.afterCommit, func() { s.AttachDevice(d) })
		return nil
	})
}
func (s *Store) AttachDevice(d *store.Device) {
	d.SetAllStores(s)
	d.LIDs = s
	d.Container = s
	d.Initialized = true
}
func (s *Store) RestoreDevice(ctx context.Context) (*store.Device, error) {
	v, _, e := s.get(ctx, "device")
	if e != nil || v == nil {
		return nil, e
	}
	d, e := v.(*protocolstate.Device).ToStore()
	if e != nil {
		return nil, e
	}
	if d.LID.ToNonAD().String() != s.accountID {
		return nil, failure(StateInvalid, "stored device account mismatch")
	}
	s.AttachDevice(d)
	return d, nil
}
func (s *Store) DeleteDevice(context.Context, *store.Device) error {
	return failure(NativeLogoutRequired, "device deletion requires native controller logout")
}
func (s *Store) PutManyLIDMappings(ctx context.Context, mappings []store.LIDMapping) error {
	return s.stage(ctx, func(t *txn) error {
		if len(mappings) == 0 {
			return nil
		}
		// One index for the whole batch: a history sync carries thousands of mappings.
		index, e := lidIndexOf(t)
		if e != nil {
			return e
		}
		for _, m := range mappings {
			if e := index.put(t, m.LID, m.PN); e != nil {
				return e
			}
		}
		t.afterCommit = append(t.afterCommit, s.notifyMappings)
		return nil
	})
}

// CheckLIDMappings reports, without staging anything, the refusal that PutManyLIDMappings would
// raise for the same mappings, so a hostile batch can be rejected before it latches the store.
func (s *Store) CheckLIDMappings(ctx context.Context, mappings []store.LIDMapping) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped != nil {
		return s.stopped
	}
	t := &txn{owner: s, active: true, records: s.records}
	index, e := lidIndexOf(t)
	if e != nil {
		return e
	}
	for _, m := range mappings {
		if e := index.check(m.LID, m.PN); e != nil {
			return e
		}
	}
	return nil
}

// lidIndex mirrors the stored PN-to-LID records in both directions.
type lidIndex struct{ byPN, byLID map[string]string }

func lidIndexOf(t *txn) (*lidIndex, error) {
	index := &lidIndex{byPN: map[string]string{}, byLID: map[string]string{}}
	for _, r := range scanMap(t.records, "lid-mapping") {
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		v, e := protocolstate.DecodeValue("lid-mapping", b)
		if e != nil {
			return nil, e
		}
		p, e := protocolstate.DecodeKey("lid-mapping", r.RecordKey)
		if e != nil {
			return nil, e
		}
		lid := v.(*protocolstate.LIDMapping).LID
		index.byPN[p[0]], index.byLID[lid] = lid, p[0]
	}
	return index, nil
}

// check applies one mapping to the index with putLID's rules and refuses an inverse conflict.
func (x *lidIndex) check(lid, pn types.JID) error {
	lid, pn = lid.ToNonAD(), pn.ToNonAD()
	if other, ok := x.byLID[lid.String()]; ok && other != pn.String() {
		return malformed("inverse LID mapping conflict")
	}
	if previous, ok := x.byPN[pn.String()]; ok {
		delete(x.byLID, previous)
	}
	x.byPN[pn.String()], x.byLID[lid.String()] = lid.String(), pn.String()
	return nil
}

func (x *lidIndex) put(t *txn, lid, pn types.JID) error {
	if e := x.check(lid, pn); e != nil {
		return e
	}
	lid, pn = lid.ToNonAD(), pn.ToNonAD()
	v := protocolstate.LIDMapping{Version: 1, LID: lid.String()}
	if _, e := protocolstate.EncodeValue("lid-mapping", v); e != nil {
		return e
	}
	return t.put("lid-mapping", v, pn.String())
}
func (s *Store) PutLIDMapping(ctx context.Context, lid, pn types.JID) error {
	return s.stage(ctx, func(t *txn) error {
		if e := putLID(t, lid, pn); e != nil {
			return e
		}
		t.afterCommit = append(t.afterCommit, s.notifyMappings)
		return nil
	})
}
func putLID(t *txn, lid, pn types.JID) error {
	lid, pn = lid.ToNonAD(), pn.ToNonAD()
	key, e := protocolstate.EncodeKey("lid-mapping", pn.String())
	if e != nil {
		return e
	}
	v := protocolstate.LIDMapping{Version: 1, LID: lid.String()}
	if _, e = protocolstate.EncodeValue("lid-mapping", v); e != nil {
		return e
	}
	for _, r := range scanMap(t.records, "lid-mapping") {
		if r.RecordKey == key {
			continue
		}
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		other, e := protocolstate.DecodeValue("lid-mapping", b)
		if e != nil {
			return e
		}
		if other.(*protocolstate.LIDMapping).LID == v.LID {
			return malformed("inverse LID mapping conflict")
		}
	}
	return t.put("lid-mapping", v, pn.String())
}
func (s *Store) GetLIDForPN(ctx context.Context, pn types.JID) (types.JID, error) {
	v, _, e := s.get(ctx, "lid-mapping", pn.ToNonAD().String())
	if e != nil || v == nil {
		return types.EmptyJID, e
	}
	lid, e := types.ParseJID(v.(*protocolstate.LIDMapping).LID)
	lid.Device = pn.Device
	return lid, e
}
func (s *Store) GetPNForLID(ctx context.Context, lid types.JID) (types.JID, error) {
	records, e := s.scan(ctx, "lid-mapping")
	if e != nil {
		return types.EmptyJID, e
	}
	for _, r := range records {
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		v, e := protocolstate.DecodeValue("lid-mapping", b)
		if e != nil {
			return types.EmptyJID, e
		}
		if v.(*protocolstate.LIDMapping).LID == lid.ToNonAD().String() {
			p, e := protocolstate.DecodeKey("lid-mapping", r.RecordKey)
			if e != nil {
				return types.EmptyJID, e
			}
			pn, e := types.ParseJID(p[0])
			pn.Device = lid.Device
			return pn, e
		}
	}
	return types.EmptyJID, nil
}
func (s *Store) GetManyLIDsForPNs(ctx context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	out := map[types.JID]types.JID{}
	for _, pn := range pns {
		lid, e := s.GetLIDForPN(ctx, pn)
		if e != nil {
			return nil, e
		}
		if !lid.IsEmpty() {
			out[pn] = lid
		}
	}
	return out, nil
}
