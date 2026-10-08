package protocolstate

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"google.golang.org/protobuf/proto"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
)

func filled(n int) []byte { return bytes.Repeat([]byte{0x42}, n) }
func TestRecordRoundTrips(t *testing.T) {
	one := int64(123)
	rows := []struct {
		typ   string
		key   []string
		value any
	}{
		{"identity", []string{"123:4"}, Binary{1, filled(32)}},
		{"signal-session", []string{"123:4"}, Binary{1, []byte{1, 2, 3}}},
		{"prekey", []string{"4294967295"}, PreKey{1, filled(32), true}},
		{"prekey-state", nil, PreKeyState{1, uint64(math.MaxUint32) + 1, math.MaxUint32}},
		{"sender-key", []string{"123@g.us", "456:2"}, Binary{1, []byte{3, 4}}},
		{"app-state-key", []string{base64.StdEncoding.EncodeToString([]byte{1, 2})}, AppStateKey{1, []byte{3}, []byte{8, 1, 16, 2}, 123}},
		{"app-state-version", []string{"regular"}, AppStateVersion{1, 2, filled(128)}},
		{"app-state-mac", []string{"regular", base64.StdEncoding.EncodeToString(filled(32))}, AppStateMAC{1, 2, filled(32)}},
		{"contact", []string{"123@s.whatsapp.net"}, Contact{1, "first", "full", "push", "business", "+1••80"}},
		{"chat-setting", []string{"123@s.whatsapp.net"}, ChatSetting{1, store.MutedForever.Format("2006-01-02T15:04:05.999999999Z07:00"), true, true, "root-id"}},
		{"message-secret", []string{"123@s.whatsapp.net", "456@lid", "msg"}, Binary{1, filled(32)}},
		{"privacy-token", []string{"123@s.whatsapp.net"}, PrivacyToken{1, []byte{1, 2}, 500, &one}},
		{"nct-salt", nil, Binary{1, filled(32)}},
		{"lid-mapping", []string{"123@s.whatsapp.net"}, LIDMapping{1, "456@lid"}},
		{"retry-hash", []string{base64.StdEncoding.EncodeToString(filled(32))}, RetryHash{1, 1000, 1}},
	}
	var records []Record
	for _, row := range rows {
		k, err := EncodeKey(row.typ, row.key...)
		if err != nil {
			t.Fatalf("%s key: %v", row.typ, err)
		}
		v, err := EncodeValue(row.typ, row.value)
		if err != nil {
			t.Fatalf("%s value: %v", row.typ, err)
		}
		decoded, err := DecodeValue(row.typ, v)
		if err != nil || !reflect.DeepEqual(reflect.ValueOf(decoded).Elem().Interface(), row.value) {
			t.Fatalf("%s typed roundtrip: %v", row.typ, err)
		}
		records = append(records, Record{row.typ, k, base64.StdEncoding.EncodeToString(v)})
	}
	encoded, err := Encode(records)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decode(encoded)
	if err != nil || !reflect.DeepEqual(got, records) {
		t.Fatalf("roundtrip: %v", err)
	}
}
func TestDevicePreservesPrivateKeysAndAccount(t *testing.T) {
	id := types.NewJID("123", "s.whatsapp.net")
	var n, i, p [32]byte
	copy(n[:], filled(32))
	i[0] = 3
	p[0] = 4
	var sig [64]byte
	copy(sig[:], filled(64))
	details, _ := proto.Marshal(&waAdv.ADVDeviceIdentity{RawID: proto.Uint32(1)})
	d := &store.Device{NoiseKey: keys.NewKeyPairFromPrivateKey(n), IdentityKey: keys.NewKeyPairFromPrivateKey(i), SignedPreKey: &keys.PreKey{KeyPair: *keys.NewKeyPairFromPrivateKey(p), KeyID: 7, Signature: &sig}, RegistrationID: 8, AdvSecretKey: filled(32), ID: &id, LID: types.NewJID("456", "lid"), Account: &waAdv.ADVSignedDeviceIdentity{Details: details, AccountSignature: filled(64), AccountSignatureKey: filled(32), DeviceSignature: filled(64)}, Platform: "platform", BusinessName: "biz", PushName: "push", LIDMigrationTimestamp: 9, CompanionMetaNonce: "nonce", FacebookUUID: uuid.MustParse("550e8400-e29b-41d4-a716-446655440000")}
	v, err := DeviceFromStore(d)
	if err != nil {
		t.Fatal(err)
	}
	data, err := EncodeValue("device", v)
	if err != nil {
		t.Fatal(err)
	}
	var saved Device
	if err = json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	restored, err := saved.ToStore()
	if err != nil {
		t.Fatal(err)
	}
	roundtrip, err := DeviceFromStore(restored)
	if err != nil || !reflect.DeepEqual(v, roundtrip) {
		t.Fatalf("device value fields lost: %v", err)
	}
	if !reflect.DeepEqual(d.NoiseKey.Priv, restored.NoiseKey.Priv) || !reflect.DeepEqual(d.IdentityKey.Priv, restored.IdentityKey.Priv) || !reflect.DeepEqual(d.SignedPreKey.Priv, restored.SignedPreKey.Priv) || !proto.Equal(d.Account, restored.Account) || restored.SignedPreKey.KeyID != 7 || restored.CompanionMetaNonce != "nonce" || restored.FacebookUUID != d.FacebookUUID {
		t.Fatal("device fields lost")
	}
	key, _ := EncodeKey("device")
	if _, err := Encode([]Record{{"device", key, base64.StdEncoding.EncodeToString(data)}}); err != nil {
		t.Fatal(err)
	}
}
func TestRejectMalformedRecords(t *testing.T) {
	key, _ := EncodeKey("lid-mapping", "123@s.whatsapp.net")
	val, _ := EncodeValue("lid-mapping", LIDMapping{1, "456@lid"})
	good := Record{"lid-mapping", key, base64.StdEncoding.EncodeToString(val)}
	otherKey, _ := EncodeKey("lid-mapping", "789@s.whatsapp.net")
	cases := [][]Record{
		{good, good},
		{good, {"lid-mapping", otherKey, good.ValueBase64}},
		{{"unknown", key, good.ValueBase64}},
		{{"lid-mapping", key + "=", good.ValueBase64}},
		{{"lid-mapping", key, strings.TrimRight(good.ValueBase64, "=")}},
	}
	for i, records := range cases {
		raw, _ := json.Marshal(envelope{1, records})
		if _, err := Decode(raw); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
	invalid := []string{
		`{"protocolSchemaVersion":1,"protocolSchemaVersion":1,"records":[]}`,
		`{"protocolSchemaVersion":1,"records":[],"extra":1}`,
		` {"protocolSchemaVersion":1,"records":[]}`,
		`{"protocolSchemaVersion":1,"records":[]} {}`,
		`{"protocolSchemaVersion":1,"records":[{"recordType":"device","recordKey":"W10","valueBase64":"e30=","valueBase64":"e30="}]}`,
	}
	for _, raw := range invalid {
		if _, err := Decode([]byte(raw)); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	if _, err := Decode(append([]byte(`{"protocolSchemaVersion":1,"records":[]}`), 0xff)); err == nil {
		t.Fatal("invalid UTF8 accepted")
	}
	if _, err := Decode(bytes.Repeat([]byte{' '}, MaxSessionBytes+1)); err == nil {
		t.Fatal("oversized session accepted")
	}
	binaryKey, _ := EncodeKey("signal-session", "123:1")
	oversized := Record{"signal-session", binaryKey, base64.StdEncoding.EncodeToString(filled(MaxRecordBytes + 1))}
	raw, _ := json.Marshal(envelope{1, []Record{oversized}})
	if _, err := Decode(raw); err == nil {
		t.Fatal("Base64 expansion accepted")
	}
}
func TestRejectValueAndKeyBoundaries(t *testing.T) {
	for _, key := range []string{"WzBd", "WyIwMSJd", "WyIrMSJd", "WyIxLjAiXQ"} {
		if _, err := DecodeKey("prekey", key); err == nil {
			t.Errorf("accepted prekey %s", key)
		}
	}
	if _, err := EncodeKey("retry-hash", base64.StdEncoding.EncodeToString(filled(31))); err == nil {
		t.Fatal("short hash accepted")
	}
	if _, err := DecodeKey("device", base64.RawURLEncoding.EncodeToString([]byte("null"))); err == nil {
		t.Fatal("null singleton accepted")
	}
	if _, err := EncodeKey("lid-mapping", "123:4@s.whatsapp.net"); err == nil {
		t.Fatal("device PN mapping accepted")
	}
	if _, err := EncodeValue("retry-hash", struct {
		Version           int    `json:"version"`
		Plaintext         []byte `json:"plaintext"`
		InsertTimeMS      int64  `json:"insertTimeMs"`
		ServerTimeSeconds int64  `json:"serverTimeSeconds"`
	}{1, []byte("body"), 1, 1}); err == nil {
		t.Fatal("retry plaintext accepted")
	}
	if _, err := EncodeValue("device", Device{Version: 1}); err == nil {
		t.Fatal("incomplete device accepted")
	}
	if _, err := EncodeValue("identity", Binary{1, filled(31)}); err == nil {
		t.Fatal("short identity accepted")
	}
	if _, err := EncodeValue("app-state-version", AppStateVersion{1, 0, filled(128)}); err == nil {
		t.Fatal("zero version accepted")
	}
	if _, err := EncodeValue("prekey-state", PreKeyState{1, 0, 0}); err == nil {
		t.Fatal("zero next ID accepted")
	}
	if _, err := EncodeValue("signal-session", Binary{1, filled(MaxRecordBytes)}); err == nil {
		t.Fatal("oversized record accepted")
	}
}
