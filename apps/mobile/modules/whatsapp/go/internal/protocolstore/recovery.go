package protocolstore

import (
	"context"
	"encoding/base64"
	"time"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"yoyos-whatsapp/internal/protocolstate"
)

func (s *Store) PutMessageSecrets(ctx context.Context, inserts []store.MessageSecretInsert) error {
	return s.stage(ctx, func(t *txn) error {
		for _, v := range inserts {
			if v.Chat.IsEmpty() || v.Sender.IsEmpty() || v.ID == "" || len(v.Secret) == 0 {
				return malformed("incomplete message secret")
			}
			chat, sender := v.Chat.ToNonAD(), v.Sender.ToNonAD()
			key, e := protocolstate.EncodeKey("message-secret", chat.String(), sender.String(), string(v.ID))
			if e != nil {
				return e
			}
			if _, exists := t.records[recordID("message-secret", key)]; exists {
				continue
			}
			if e = t.put("message-secret", binary(v.Secret), chat.String(), sender.String(), string(v.ID)); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) PutMessageSecret(ctx context.Context, chat, sender types.JID, id types.MessageID, secret []byte) error {
	return s.PutMessageSecrets(ctx, []store.MessageSecretInsert{{Chat: chat, Sender: sender, ID: id, Secret: secret}})
}
func (s *Store) GetMessageSecret(ctx context.Context, chat, sender types.JID, id types.MessageID) ([]byte, types.JID, error) {
	chat, sender = chat.ToNonAD(), sender.ToNonAD()
	chats := []types.JID{chat}
	senders := []types.JID{sender}
	if alt, e := s.alternate(ctx, chat); e != nil {
		return nil, types.EmptyJID, e
	} else if !alt.IsEmpty() {
		chats = append(chats, alt)
	}
	if alt, e := s.alternate(ctx, sender); e != nil {
		return nil, types.EmptyJID, e
	} else if !alt.IsEmpty() {
		senders = append(senders, alt)
	}
	for _, c := range chats {
		for _, u := range senders {
			v, _, e := s.get(ctx, "message-secret", c.String(), u.String(), string(id))
			if e != nil {
				return nil, types.EmptyJID, e
			}
			if v != nil {
				return append([]byte(nil), v.(*protocolstate.Binary).Data...), u, nil
			}
		}
	}
	return nil, types.EmptyJID, nil
}
func (s *Store) alternate(ctx context.Context, jid types.JID) (types.JID, error) {
	if jid.Server == types.DefaultUserServer {
		return s.GetLIDForPN(ctx, jid)
	}
	if jid.Server == types.HiddenUserServer {
		return s.GetPNForLID(ctx, jid)
	}
	return types.EmptyJID, nil
}
func (s *Store) PutPrivacyTokens(ctx context.Context, tokens ...store.PrivacyToken) error {
	return s.stage(ctx, func(t *txn) error {
		for _, item := range tokens {
			jid := item.User.ToNonAD().String()
			v, found, e := t.value("privacy-token", jid)
			if e != nil {
				return e
			}
			if found && v.(*protocolstate.PrivacyToken).Timestamp > item.Timestamp.Unix() {
				continue
			}
			out := protocolstate.PrivacyToken{Version: 1, Token: item.Token, Timestamp: item.Timestamp.Unix()}
			if !item.SenderTimestamp.IsZero() {
				ts := item.SenderTimestamp.Unix()
				out.SenderTimestamp = &ts
			} else if found {
				out.SenderTimestamp = v.(*protocolstate.PrivacyToken).SenderTimestamp
			}
			if e = t.put("privacy-token", out, jid); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) GetPrivacyToken(ctx context.Context, user types.JID) (*store.PrivacyToken, error) {
	user = user.ToNonAD()
	choices := []types.JID{user}
	if alt, e := s.alternate(ctx, user); e != nil {
		return nil, e
	} else if !alt.IsEmpty() {
		choices = append(choices, alt)
	}
	var result *store.PrivacyToken
	for _, jid := range choices {
		v, _, e := s.get(ctx, "privacy-token", jid.String())
		if e != nil {
			return nil, e
		}
		if v == nil {
			continue
		}
		p := v.(*protocolstate.PrivacyToken)
		if result == nil || p.Timestamp > result.Timestamp.Unix() {
			result = &store.PrivacyToken{User: user, Token: append([]byte(nil), p.Token...), Timestamp: time.Unix(p.Timestamp, 0)}
			if p.SenderTimestamp != nil {
				result.SenderTimestamp = time.Unix(*p.SenderTimestamp, 0)
			}
		}
	}
	return result, nil
}
func (s *Store) DeleteExpiredPrivacyTokens(ctx context.Context, cutoff time.Time) (int64, error) {
	var count int64
	e := s.stage(ctx, func(t *txn) error {
		for _, r := range scanMap(t.records, "privacy-token") {
			b, _ := base64.StdEncoding.DecodeString(r.ValueBase64)
			v, e := protocolstate.DecodeValue("privacy-token", b)
			if e != nil {
				return e
			}
			if v.(*protocolstate.PrivacyToken).Timestamp < cutoff.Unix() {
				p, _ := protocolstate.DecodeKey("privacy-token", r.RecordKey)
				if e = t.del("privacy-token", p...); e != nil {
					return e
				}
				count++
			}
		}
		return nil
	})
	return count, e
}
func (s *Store) PutNCTSalt(ctx context.Context, salt []byte) error {
	return s.put(ctx, "nct-salt", binary(salt))
}
func (s *Store) GetNCTSalt(ctx context.Context) ([]byte, error) {
	v, _, e := s.get(ctx, "nct-salt")
	if e != nil || v == nil {
		return nil, e
	}
	return append([]byte(nil), v.(*protocolstate.Binary).Data...), nil
}
func (s *Store) DeleteNCTSalt(ctx context.Context) error { return s.del(ctx, "nct-salt") }

// The pinned receive hook does not yet supply validated pending metadata to this store.
func (s *Store) PutBufferedEvent(context.Context, [32]byte, []byte, time.Time) error {
	return unsupported("pending recovery metadata and native preparation required")
}
func (s *Store) GetBufferedEvent(context.Context, [32]byte) (*store.BufferedEvent, error) {
	return nil, unsupported("pending recovery lookup requires receive context")
}
func (s *Store) ClearBufferedEventPlaintext(context.Context, [32]byte) error {
	return unsupported("native pending confirmation owns recovery content")
}
func (s *Store) DeleteOldBufferedHashes(context.Context) error {
	return unsupported("pending-aware retry hash cleanup requires native recovery state")
}
func (*Store) GetOutgoingEvent(context.Context, types.JID, types.JID, types.MessageID) (string, []byte, error) {
	return "", nil, failure(OutgoingUnsupported, "UseRetryMessageStore must remain false")
}
func (*Store) AddOutgoingEvent(context.Context, types.JID, types.MessageID, string, []byte) error {
	return failure(OutgoingUnsupported, "UseRetryMessageStore must remain false")
}
func (*Store) DeleteOldOutgoingEvents(context.Context) error {
	return failure(OutgoingUnsupported, "UseRetryMessageStore must remain false")
}
