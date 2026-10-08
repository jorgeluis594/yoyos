package protocolstate

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	"go.mau.fi/whatsmeow/types"
)

const MaxSessionBytes = 16 << 20

// Value JSON gains another Base64 layer; the envelope limit remains authoritative.
const MaxRecordBytes = 3*(MaxSessionBytes/4) - 1
const MaxKeyBytes = 2048

type Record struct {
	RecordType  string `json:"recordType"`
	RecordKey   string `json:"recordKey"`
	ValueBase64 string `json:"valueBase64"`
}
type envelope struct {
	ProtocolSchemaVersion int      `json:"protocolSchemaVersion"`
	Records               []Record `json:"records"`
}

// Decode accepts only the closed v1 catalog and returns validated raw value bytes.
func Decode(data []byte) ([]Record, error) {
	if len(data) > MaxSessionBytes {
		return nil, errors.New("session too large")
	}
	var e envelope
	if err := strict(data, &e); err != nil {
		return nil, err
	}
	canonical, _ := json.Marshal(e)
	if !bytes.Equal(data, canonical) {
		return nil, errors.New("noncanonical session JSON")
	}
	if e.ProtocolSchemaVersion != 1 || e.Records == nil {
		return nil, errors.New("invalid session envelope")
	}
	seen := map[string]bool{}
	inverse := map[string]string{}
	for _, r := range e.Records {
		key, err := DecodeKey(r.RecordType, r.RecordKey)
		if err != nil {
			return nil, err
		}
		pair := r.RecordType + "\x00" + r.RecordKey
		if seen[pair] {
			return nil, errors.New("duplicate record")
		}
		seen[pair] = true
		if len(r.ValueBase64) > base64.StdEncoding.EncodedLen(MaxRecordBytes) {
			return nil, errors.New("record too large")
		}
		value, err := base64.StdEncoding.DecodeString(r.ValueBase64)
		if err != nil || base64.StdEncoding.EncodeToString(value) != r.ValueBase64 {
			return nil, errors.New("noncanonical value base64")
		}
		if err := ValidateValue(r.RecordType, value); err != nil {
			return nil, fmt.Errorf("%s: %w", r.RecordType, err)
		}
		if r.RecordType == "lid-mapping" {
			var v LIDMapping
			_ = strict(value, &v)
			if old, ok := inverse[v.LID]; ok && old != key[0] {
				return nil, errors.New("inverse LID mapping conflict")
			}
			inverse[v.LID] = key[0]
		}
	}
	return e.Records, nil
}

func Encode(records []Record) ([]byte, error) {
	if records == nil {
		records = []Record{}
	}
	data, err := json.Marshal(envelope{1, records})
	if err != nil {
		return nil, err
	}
	if _, err = Decode(data); err != nil {
		return nil, err
	}
	return data, nil
}

func EncodeKey(recordType string, parts ...string) (string, error) {
	if parts == nil {
		parts = []string{}
	}
	raw, err := json.Marshal(parts)
	if err != nil {
		return "", err
	}
	key := base64.RawURLEncoding.EncodeToString(raw)
	if _, err = DecodeKey(recordType, key); err != nil {
		return "", err
	}
	return key, nil
}
func DecodeKey(recordType, key string) ([]string, error) {
	if len(key) > MaxKeyBytes {
		return nil, errors.New("key too large")
	}
	raw, err := base64.RawURLEncoding.DecodeString(key)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != key || !utf8.Valid(raw) {
		return nil, errors.New("noncanonical key base64")
	}
	var parts []string
	if err := strict(raw, &parts); err != nil {
		return nil, err
	}
	if parts == nil {
		return nil, errors.New("null key tuple")
	}
	canonical, _ := json.Marshal(parts)
	if !bytes.Equal(raw, canonical) {
		return nil, errors.New("noncanonical key tuple")
	}
	n := 0
	switch recordType {
	case "device", "prekey-state", "nct-salt":
	case "identity", "signal-session", "prekey", "app-state-key", "app-state-version", "contact", "chat-setting", "privacy-token", "lid-mapping", "retry-hash":
		n = 1
	case "sender-key", "app-state-mac":
		n = 2
	case "message-secret":
		n = 3
	default:
		return nil, errors.New("unknown record type")
	}
	if len(parts) != n {
		return nil, errors.New("invalid key tuple length")
	}
	for i, p := range parts {
		if p == "" || len(p) > 512 || !utf8.ValidString(p) {
			return nil, errors.New("invalid key component")
		}
		switch recordType {
		case "identity", "signal-session":
			if err := signalAddress(p); err != nil {
				return nil, err
			}
		case "sender-key":
			if i == 1 {
				if err := signalAddress(p); err != nil {
					return nil, err
				}
			}
		case "prekey":
			if _, err := decimal(p, 32, false); err != nil {
				return nil, err
			}
		case "app-state-key":
			if i == 0 {
				if _, err := binaryComponent(p, 1, 256); err != nil {
					return nil, err
				}
			}
		case "app-state-mac":
			if i == 1 {
				if _, err := binaryComponent(p, 32, 32); err != nil {
					return nil, err
				}
			}
		case "retry-hash":
			if _, err := binaryComponent(p, 32, 32); err != nil {
				return nil, err
			}
		case "contact", "chat-setting", "privacy-token", "lid-mapping":
			if err := validJID(p); err != nil {
				return nil, err
			}
			if recordType == "lid-mapping" {
				j, _ := types.ParseJID(p)
				if j.Server != types.DefaultUserServer || j.Device != 0 || j.RawAgent != 0 {
					return nil, errors.New("mapping key is not PN")
				}
			}
		case "message-secret":
			if i < 2 {
				if err := validJID(p); err != nil {
					return nil, err
				}
			}
		}
	}
	return parts, nil
}
func binaryComponent(s string, min, max int) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || base64.StdEncoding.EncodeToString(b) != s || len(b) < min || len(b) > max {
		return nil, errors.New("invalid binary component")
	}
	return b, nil
}
func decimal(s string, bits int, allowZero bool) (uint64, error) {
	n, err := strconv.ParseUint(s, 10, bits)
	if err != nil || strconv.FormatUint(n, 10) != s || (!allowZero && n == 0) {
		return 0, errors.New("noncanonical decimal")
	}
	return n, nil
}
func validJID(s string) error {
	j, err := types.ParseJID(s)
	if err != nil || j.User == "" || j.Server == "" || j.String() != s {
		return errors.New("invalid JID")
	}
	return nil
}

// strict checks duplicate object members at every depth before decoding typed JSON.
func strict(data []byte, out any) error {
	if !utf8.Valid(data) {
		return errors.New("invalid UTF-8")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	if err := walk(d, 0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing JSON")
	}
	d = json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}
func walk(d *json.Decoder, depth int) error {
	if depth > 64 {
		return errors.New("JSON nesting too deep")
	}
	t, err := d.Token()
	if err != nil {
		return err
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			k, err := d.Token()
			if err != nil {
				return err
			}
			s, ok := k.(string)
			if !ok || seen[s] {
				return errors.New("duplicate JSON field")
			}
			seen[s] = true
			if err := walk(d, depth+1); err != nil {
				return err
			}
		}
	case '[':
		for d.More() {
			if err := walk(d, depth+1); err != nil {
				return err
			}
		}
	default:
		return errors.New("unexpected JSON delimiter")
	}
	_, err = d.Token()
	return err
}

func signalAddress(s string) error {
	cut := strings.LastIndexByte(s, ':')
	if cut <= 0 || strings.ContainsAny(s[:cut], "@/\\") {
		return errors.New("invalid Signal address")
	}
	if _, err := decimal(s[cut+1:], 32, true); err != nil {
		return err
	}
	return nil
}
