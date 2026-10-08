package protocolstore

import (
	"context"
	"encoding/base64"
	"sort"
	"time"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/protocolstate"
)

func (s *Store) PutAppStateSyncKey(ctx context.Context, id []byte, key store.AppStateSyncKey) error {
	return s.stage(ctx, func(t *txn) error {
		v, found, e := t.value("app-state-key", binaryKey(id))
		if e != nil {
			return e
		}
		if found && v.(*protocolstate.AppStateKey).Timestamp >= key.Timestamp {
			return nil
		}
		return t.put("app-state-key", protocolstate.AppStateKey{Version: 1, Data: key.Data, Fingerprint: key.Fingerprint, Timestamp: key.Timestamp}, binaryKey(id))
	})
}
func (s *Store) GetAppStateSyncKey(ctx context.Context, id []byte) (*store.AppStateSyncKey, error) {
	v, _, e := s.get(ctx, "app-state-key", binaryKey(id))
	if e != nil || v == nil {
		return nil, e
	}
	k := v.(*protocolstate.AppStateKey)
	return &store.AppStateSyncKey{Data: append([]byte(nil), k.Data...), Fingerprint: append([]byte(nil), k.Fingerprint...), Timestamp: k.Timestamp}, nil
}
func (s *Store) GetAllAppStateSyncKeys(ctx context.Context) ([]*store.AppStateSyncKey, error) {
	rows, e := s.scan(ctx, "app-state-key")
	if e != nil {
		return nil, e
	}
	out := make([]*store.AppStateSyncKey, 0, len(rows))
	for _, r := range rows {
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		v, e := protocolstate.DecodeValue("app-state-key", b)
		if e != nil {
			return nil, e
		}
		k := v.(*protocolstate.AppStateKey)
		out = append(out, &store.AppStateSyncKey{Data: append([]byte(nil), k.Data...), Fingerprint: append([]byte(nil), k.Fingerprint...), Timestamp: k.Timestamp})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp > out[j].Timestamp })
	return out, nil
}
func (s *Store) GetLatestAppStateSyncKeyID(ctx context.Context) ([]byte, error) {
	rows, e := s.scan(ctx, "app-state-key")
	if e != nil {
		return nil, e
	}
	var id []byte
	var latest int64
	var latestKey string
	found := false
	for _, r := range rows {
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		v, e := protocolstate.DecodeValue("app-state-key", b)
		if e != nil {
			return nil, e
		}
		if !found || v.(*protocolstate.AppStateKey).Timestamp > latest || (v.(*protocolstate.AppStateKey).Timestamp == latest && r.RecordKey > latestKey) {
			p, e := protocolstate.DecodeKey("app-state-key", r.RecordKey)
			if e != nil {
				return nil, e
			}
			id, e = base64.StdEncoding.DecodeString(p[0])
			if e != nil {
				return nil, e
			}
			latest = v.(*protocolstate.AppStateKey).Timestamp
			latestKey = r.RecordKey
			found = true
		}
	}
	return id, nil
}
func (s *Store) PutAppStateVersion(ctx context.Context, name string, version uint64, hash [128]byte) error {
	return s.put(ctx, "app-state-version", protocolstate.AppStateVersion{Version: 1, Number: version, Hash: hash[:]}, name)
}
func (s *Store) GetAppStateVersion(ctx context.Context, name string) (uint64, [128]byte, error) {
	var h [128]byte
	v, _, e := s.get(ctx, "app-state-version", name)
	if e != nil || v == nil {
		return 0, h, e
	}
	item := v.(*protocolstate.AppStateVersion)
	copy(h[:], item.Hash)
	return item.Number, h, nil
}
func (s *Store) DeleteAppStateVersion(ctx context.Context, name string) error {
	return s.del(ctx, "app-state-version", name)
}
func (s *Store) PutAppStateMutationMACs(ctx context.Context, name string, version uint64, mutations []store.AppStateMutationMAC) error {
	return s.stage(ctx, func(t *txn) error {
		for _, m := range mutations {
			if e := t.put("app-state-mac", protocolstate.AppStateMAC{Version: 1, MutationVersion: version, ValueMAC: m.ValueMAC}, name, binaryKey(m.IndexMAC)); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) DeleteAppStateMutationMACs(ctx context.Context, name string, indexMACs [][]byte) error {
	return s.stage(ctx, func(t *txn) error {
		for _, m := range indexMACs {
			if e := t.del("app-state-mac", name, binaryKey(m)); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) GetAppStateMutationMAC(ctx context.Context, name string, indexMAC []byte) ([]byte, error) {
	v, _, e := s.get(ctx, "app-state-mac", name, binaryKey(indexMAC))
	if e != nil || v == nil {
		return nil, e
	}
	return append([]byte(nil), v.(*protocolstate.AppStateMAC).ValueMAC...), nil
}
func contactInfo(v any, found bool) types.ContactInfo {
	if !found {
		return types.ContactInfo{}
	}
	c := v.(*protocolstate.Contact)
	return types.ContactInfo{Found: true, FirstName: c.FirstName, FullName: c.FullName, PushName: c.PushName, BusinessName: c.BusinessName, RedactedPhone: c.RedactedPhone}
}
func (s *Store) GetContact(ctx context.Context, user types.JID) (types.ContactInfo, error) {
	v, found, e := s.get(ctx, "contact", user.String())
	if e != nil {
		return types.ContactInfo{}, e
	}
	return contactInfo(v, found), nil
}
func (s *Store) GetAllContacts(ctx context.Context) (map[types.JID]types.ContactInfo, error) {
	rows, e := s.scan(ctx, "contact")
	if e != nil {
		return nil, e
	}
	out := map[types.JID]types.ContactInfo{}
	for _, r := range rows {
		p, e := protocolstate.DecodeKey("contact", r.RecordKey)
		if e != nil {
			return nil, e
		}
		jid, e := types.ParseJID(p[0])
		if e != nil {
			return nil, e
		}
		b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
		v, e := protocolstate.DecodeValue("contact", b)
		if e != nil {
			return nil, e
		}
		out[jid] = contactInfo(v, true)
	}
	return out, nil
}
func (s *Store) changeContact(ctx context.Context, user types.JID, fn func(*protocolstate.Contact)) (bool, error) {
	changed := false
	e := s.stage(ctx, func(t *txn) error {
		v, found, e := t.value("contact", user.String())
		if e != nil {
			return e
		}
		c := &protocolstate.Contact{Version: 1}
		if found {
			c = v.(*protocolstate.Contact)
		}
		before := *c
		fn(c)
		if before == *c {
			return nil
		}
		changed = true
		return t.put("contact", c, user.String())
	})
	return changed, e
}
func (s *Store) PutPushName(ctx context.Context, user types.JID, name string) (bool, string, error) {
	var prev string
	changed, e := s.changeContact(ctx, user, func(c *protocolstate.Contact) { prev = c.PushName; c.PushName = name })
	if !changed {
		prev = ""
	}
	return changed, prev, e
}
func (s *Store) PutBusinessName(ctx context.Context, user types.JID, name string) (bool, string, error) {
	var prev string
	changed, e := s.changeContact(ctx, user, func(c *protocolstate.Contact) { prev = c.BusinessName; c.BusinessName = name })
	if !changed {
		prev = ""
	}
	return changed, prev, e
}
func (s *Store) PutContactName(ctx context.Context, user types.JID, firstName, fullName string) error {
	_, e := s.changeContact(ctx, user, func(c *protocolstate.Contact) { c.FullName = fullName; c.FirstName = firstName })
	return e
}
func (s *Store) PutAllContactNames(ctx context.Context, contacts []store.ContactEntry) error {
	return s.stage(ctx, func(t *txn) error {
		for _, item := range contacts {
			v, found, e := t.value("contact", item.JID.String())
			if e != nil {
				return e
			}
			c := &protocolstate.Contact{Version: 1}
			if found {
				c = v.(*protocolstate.Contact)
			}
			c.FirstName = item.FirstName
			c.FullName = item.FullName
			if e = t.put("contact", c, item.JID.String()); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) PutManyRedactedPhones(ctx context.Context, entries []store.RedactedPhoneEntry) error {
	return s.stage(ctx, func(t *txn) error {
		for _, item := range entries {
			v, found, e := t.value("contact", item.JID.String())
			if e != nil {
				return e
			}
			c := &protocolstate.Contact{Version: 1}
			if found {
				c = v.(*protocolstate.Contact)
			}
			c.RedactedPhone = item.RedactedPhone
			if e = t.put("contact", c, item.JID.String()); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) chatSetting(ctx context.Context, chat types.JID, fn func(*protocolstate.ChatSetting)) error {
	return s.stage(ctx, func(t *txn) error {
		v, found, e := t.value("chat-setting", chat.String())
		if e != nil {
			return e
		}
		c := &protocolstate.ChatSetting{Version: 1}
		if found {
			c = v.(*protocolstate.ChatSetting)
		}
		fn(c)
		return t.put("chat-setting", c, chat.String())
	})
}
func (s *Store) PutMutedUntil(ctx context.Context, chat types.JID, until time.Time) error {
	return s.chatSetting(ctx, chat, func(c *protocolstate.ChatSetting) {
		if until.IsZero() {
			c.MutedUntil = ""
		} else {
			c.MutedUntil = until.UTC().Format(time.RFC3339Nano)
		}
	})
}
func (s *Store) PutPinned(ctx context.Context, chat types.JID, pinned bool) error {
	return s.chatSetting(ctx, chat, func(c *protocolstate.ChatSetting) { c.Pinned = pinned })
}
func (s *Store) PutArchived(ctx context.Context, chat types.JID, archived bool) error {
	return s.chatSetting(ctx, chat, func(c *protocolstate.ChatSetting) { c.Archived = archived })
}
func (s *Store) PutWASARootSecretID(ctx context.Context, chat types.JID, id types.MessageID) error {
	return s.chatSetting(ctx, chat, func(c *protocolstate.ChatSetting) { c.WASARootSecretID = string(id) })
}
func (s *Store) GetWASARootSecretID(ctx context.Context, chat types.JID) (types.MessageID, error) {
	v, _, e := s.get(ctx, "chat-setting", chat.String())
	if e != nil || v == nil {
		return "", e
	}
	return types.MessageID(v.(*protocolstate.ChatSetting).WASARootSecretID), nil
}
func (s *Store) GetChatSettings(ctx context.Context, chat types.JID) (types.LocalChatSettings, error) {
	v, _, e := s.get(ctx, "chat-setting", chat.String())
	if e != nil || v == nil {
		return types.LocalChatSettings{}, e
	}
	c := v.(*protocolstate.ChatSetting)
	out := types.LocalChatSettings{Found: true, Pinned: c.Pinned, Archived: c.Archived}
	if c.MutedUntil != "" {
		out.MutedUntil, e = time.Parse(time.RFC3339Nano, c.MutedUntil)
	}
	return out, e
}
