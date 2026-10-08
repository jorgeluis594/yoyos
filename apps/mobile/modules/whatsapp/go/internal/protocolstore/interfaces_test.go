package protocolstore

import (
	"bytes"
	"context"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
	"google.golang.org/protobuf/proto"
)

func TestPrekeyHighwaterUploadAndRemoval(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	generated, e := s.GetOrGenPreKeys(ctx, 3)
	if e != nil || len(generated) != 3 {
		t.Fatal(e, len(generated))
	}
	same, e := s.GetOrGenPreKeys(ctx, 2)
	if e != nil || same[0].KeyID != 1 || same[1].KeyID != 2 {
		t.Fatal("did not reuse unuploaded", e)
	}
	if e = s.MarkPreKeysAsUploaded(ctx, 2); e != nil {
		t.Fatal(e)
	}
	count, e := s.UploadedPreKeyCount(ctx)
	if e != nil || count != 2 {
		t.Fatal(count, e)
	}
	if e = s.RemovePreKey(ctx, 3); e != nil {
		t.Fatal(e)
	}
	next, e := s.GenOnePreKey(ctx)
	if e != nil || next.KeyID != 4 {
		t.Fatal("reused removed max", next, e)
	}
	if _, e = s.GetPreKey(ctx, 3); e != nil {
		t.Fatal(e)
	}
	count, e = s.UploadedPreKeyCount(ctx)
	if e != nil || count != 3 {
		t.Fatal(count, e)
	}
	codeIs(t, s.MarkPreKeysAsUploaded(ctx, 99), InvalidRequest)
	if _, e = s.GetOrGenPreKeys(ctx, 1<<24); e == nil {
		t.Fatal("unbounded prekey request accepted")
	} else {
		codeIs(t, e, SessionFull)
	}
	restored := openTest(t, n)
	next, e = restored.GenOnePreKey(ctx)
	if e != nil || next.KeyID != 5 {
		t.Fatal("highwater lost on reopen", next, e)
	}
}
func TestSignalMigrationAndBulkAtomicity(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	pn := types.NewJID("123", types.DefaultUserServer)
	lid := types.NewJID("456", types.HiddenUserServer)
	old := pn.SignalAddressUser() + ":2"
	newAddr := lid.SignalAddressUser() + ":2"
	if e := s.PutSession(ctx, old, []byte{1}); e != nil {
		t.Fatal(e)
	}
	if e := s.PutIdentity(ctx, old, [32]byte{1}); e != nil {
		t.Fatal(e)
	}
	if e := s.PutSenderKey(ctx, "group@g.us", old, []byte{2}); e != nil {
		t.Fatal(e)
	}
	before := len(n.calls)
	if e := s.MigratePNToLID(ctx, pn, lid); e != nil {
		t.Fatal(e)
	}
	if len(n.calls) != before+1 || len(n.calls[len(n.calls)-1].ProtocolChanges) != 6 {
		t.Fatal("migration not atomic")
	}
	if v, e := s.GetSession(ctx, old); e != nil || v != nil {
		t.Fatal("old session survived", e)
	}
	if v, e := s.GetSession(ctx, newAddr); e != nil || !bytes.Equal(v, []byte{1}) {
		t.Fatal("new session absent", e)
	}
	if v, e := s.GetSenderKey(ctx, "group@g.us", newAddr); e != nil || !bytes.Equal(v, []byte{2}) {
		t.Fatal("new sender key absent", e)
	}
	trusted, e := s.IsTrustedIdentity(ctx, newAddr, [32]byte{1})
	if e != nil || !trusted {
		t.Fatal("new identity absent", e)
	}
	if e = s.PutManySessions(ctx, map[string][]byte{"123:1": {1}, "invalid address": {2}}); e == nil {
		t.Fatal("invalid bulk accepted")
	}
	if v, _ := s.GetSession(ctx, "123:1"); v != nil {
		t.Fatal("partial bulk persisted")
	}
}
func TestAuxiliaryStoreRoundTrips(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	user := types.NewJID("123", types.DefaultUserServer)
	if changed, prev, e := s.PutPushName(ctx, user, "push"); e != nil || !changed || prev != "" {
		t.Fatal(changed, prev, e)
	}
	if changed, prev, e := s.PutPushName(ctx, user, "push"); e != nil || changed || prev != "" {
		t.Fatal(changed, prev, e)
	}
	if e := s.PutContactName(ctx, user, "first", "full"); e != nil {
		t.Fatal(e)
	}
	if e := s.PutManyRedactedPhones(ctx, []store.RedactedPhoneEntry{{JID: user, RedactedPhone: "••80"}}); e != nil {
		t.Fatal(e)
	}
	contact, e := s.GetContact(ctx, user)
	if e != nil || !contact.Found || contact.FirstName != "first" || contact.FullName != "full" || contact.RedactedPhone != "••80" {
		t.Fatal(contact, e)
	}
	all, e := s.GetAllContacts(ctx)
	if e != nil || len(all) != 1 {
		t.Fatal(all, e)
	}
	if e = s.PutMutedUntil(ctx, user, store.MutedForever); e != nil {
		t.Fatal(e)
	}
	if e = s.PutPinned(ctx, user, true); e != nil {
		t.Fatal(e)
	}
	if e = s.PutWASARootSecretID(ctx, user, "root"); e != nil {
		t.Fatal(e)
	}
	setting, e := s.GetChatSettings(ctx, user)
	if e != nil || !setting.Found || !setting.Pinned || !setting.MutedUntil.Equal(store.MutedForever) {
		t.Fatal(setting, e)
	}
	root, e := s.GetWASARootSecretID(ctx, user)
	if e != nil || root != "root" {
		t.Fatal(root, e)
	}
	if e = s.PutNCTSalt(ctx, []byte{1, 2}); e != nil {
		t.Fatal(e)
	}
	salt, e := s.GetNCTSalt(ctx)
	if e != nil || !bytes.Equal(salt, []byte{1, 2}) {
		t.Fatal(salt, e)
	}
	if e = s.DeleteNCTSalt(ctx); e != nil {
		t.Fatal(e)
	}
	salt, e = s.GetNCTSalt(ctx)
	if e != nil || salt != nil {
		t.Fatal(salt, e)
	}
}
func TestAppStateKeysVersionsMACsAndSecrets(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	key := store.AppStateSyncKey{Data: []byte{1}, Fingerprint: []byte{8, 1, 16, 2}, Timestamp: 20}
	if e := s.PutAppStateSyncKey(ctx, []byte{1}, key); e != nil {
		t.Fatal(e)
	}
	stale := key
	stale.Timestamp = 10
	stale.Data = []byte{9}
	if e := s.PutAppStateSyncKey(ctx, []byte{1}, stale); e != nil {
		t.Fatal(e)
	}
	got, e := s.GetAppStateSyncKey(ctx, []byte{1})
	if e != nil || !bytes.Equal(got.Data, key.Data) {
		t.Fatal(got, e)
	}
	latest, e := s.GetLatestAppStateSyncKeyID(ctx)
	if e != nil || !bytes.Equal(latest, []byte{1}) {
		t.Fatal(latest, e)
	}
	all, e := s.GetAllAppStateSyncKeys(ctx)
	if e != nil || len(all) != 1 {
		t.Fatal(all, e)
	}
	newer := key
	newer.Timestamp = 30
	newer.Data = []byte{3}
	if e = s.PutAppStateSyncKey(ctx, []byte{2}, newer); e != nil {
		t.Fatal(e)
	}
	all, e = s.GetAllAppStateSyncKeys(ctx)
	if e != nil || len(all) != 2 || all[0].Timestamp != 30 || all[1].Timestamp != 20 {
		t.Fatal("app state keys not newest first", all, e)
	}
	latest, e = s.GetLatestAppStateSyncKeyID(ctx)
	if e != nil || !bytes.Equal(latest, []byte{2}) {
		t.Fatal("wrong latest key", latest, e)
	}
	var hash [128]byte
	hash[0] = 3
	if e = s.PutAppStateVersion(ctx, "regular", 2, hash); e != nil {
		t.Fatal(e)
	}
	version, gotHash, e := s.GetAppStateVersion(ctx, "regular")
	if e != nil || version != 2 || gotHash != hash {
		t.Fatal(version, e)
	}
	index := bytes.Repeat([]byte{1}, 32)
	value := bytes.Repeat([]byte{2}, 32)
	if e = s.PutAppStateMutationMACs(ctx, "regular", 2, []store.AppStateMutationMAC{{IndexMAC: index, ValueMAC: value}}); e != nil {
		t.Fatal(e)
	}
	mac, e := s.GetAppStateMutationMAC(ctx, "regular", index)
	if e != nil || !bytes.Equal(mac, value) {
		t.Fatal(mac, e)
	}
	if e = s.DeleteAppStateMutationMACs(ctx, "regular", [][]byte{index}); e != nil {
		t.Fatal(e)
	}
	mac, e = s.GetAppStateMutationMAC(ctx, "regular", index)
	if e != nil || mac != nil {
		t.Fatal(mac, e)
	}
	if e = s.DeleteAppStateVersion(ctx, "regular"); e != nil {
		t.Fatal(e)
	}
	version, _, e = s.GetAppStateVersion(ctx, "regular")
	if e != nil || version != 0 {
		t.Fatal(version, e)
	}
	chat := types.NewJID("123", types.DefaultUserServer)
	sender := types.NewJID("456", types.HiddenUserServer)
	if e = s.PutMessageSecret(ctx, chat, sender, "m", []byte{7}); e != nil {
		t.Fatal(e)
	}
	secret, real, e := s.GetMessageSecret(ctx, chat, sender, "m")
	if e != nil || !bytes.Equal(secret, []byte{7}) || real != sender {
		t.Fatal(secret, real, e)
	}
	senderPN := types.NewJID("456", types.DefaultUserServer)
	if e = s.PutLIDMapping(ctx, sender, senderPN); e != nil {
		t.Fatal(e)
	}
	secret, real, e = s.GetMessageSecret(ctx, chat, senderPN, "m")
	if e != nil || !bytes.Equal(secret, []byte{7}) || real != sender {
		t.Fatal("alternate secret lookup", secret, real, e)
	}
	codeIs(t, s.PutMessageSecret(ctx, chat, sender, "", nil), InvalidRequest)
}
func TestPrivacyPrecedenceAndDeviceBoundary(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	user := types.NewJID("123", types.DefaultUserServer)
	if e := s.PutPrivacyTokens(ctx, store.PrivacyToken{User: user, Token: []byte{1}, Timestamp: time.Unix(20, 0)}); e != nil {
		t.Fatal(e)
	}
	if e := s.PutPrivacyTokens(ctx, store.PrivacyToken{User: user, Token: []byte{2}, Timestamp: time.Unix(10, 0)}); e != nil {
		t.Fatal(e)
	}
	got, e := s.GetPrivacyToken(ctx, user)
	if e != nil || !bytes.Equal(got.Token, []byte{1}) {
		t.Fatal(got, e)
	}
	removed, e := s.DeleteExpiredPrivacyTokens(ctx, time.Unix(21, 0))
	if e != nil || removed != 1 {
		t.Fatal(removed, e)
	}
	got, e = s.GetPrivacyToken(ctx, user)
	if e != nil || got != nil {
		t.Fatal(got, e)
	}
	lid := types.NewJID("123", types.HiddenUserServer)
	if e = s.PutLIDMapping(ctx, lid, user); e != nil {
		t.Fatal(e)
	}
	if e = s.PutPrivacyTokens(ctx, store.PrivacyToken{User: lid, Token: []byte{3}, Timestamp: time.Unix(30, 0)}); e != nil {
		t.Fatal(e)
	}
	got, e = s.GetPrivacyToken(ctx, user)
	if e != nil || got.User != user || !bytes.Equal(got.Token, []byte{3}) {
		t.Fatal("alternate token lookup", got, e)
	}
	codeIs(t, s.PutDevice(ctx, &store.Device{}), InvalidRequest)
	codeIs(t, s.DeleteDevice(ctx, &store.Device{}), NativeLogoutRequired)
	d := validDevice()
	if e = s.PutDevice(ctx, d); e != nil {
		t.Fatal(e)
	}
	if !d.Initialized || d.Container != s || d.LIDs != s || d.Sessions != s {
		t.Fatal("device stores not attached after commit")
	}
	changed := *d
	otherID := types.NewJID("999", types.DefaultUserServer)
	changed.ID = &otherID
	codeIs(t, s.PutDevice(ctx, &changed), InvalidRequest)
	v, _, e := s.get(ctx, "device")
	if e != nil || v == nil {
		t.Fatal("saved device missing", e)
	}
	other := openTest(t, n)
	recovered, e := other.RestoreDevice(ctx)
	if e != nil || recovered == nil || !recovered.Initialized || recovered.Container != other || recovered.Sessions != other {
		t.Fatal("device restore failed", e)
	}
}
func validDevice() *store.Device {
	id := types.NewJID("123", types.DefaultUserServer)
	var n, i, p [32]byte
	n[0] = 1
	i[0] = 2
	p[0] = 3
	var sig [64]byte
	sig[0] = 4
	details, _ := proto.Marshal(&waAdv.ADVDeviceIdentity{RawID: proto.Uint32(1)})
	return &store.Device{NoiseKey: keys.NewKeyPairFromPrivateKey(n), IdentityKey: keys.NewKeyPairFromPrivateKey(i), SignedPreKey: &keys.PreKey{KeyPair: *keys.NewKeyPairFromPrivateKey(p), KeyID: 7, Signature: &sig}, AdvSecretKey: bytes.Repeat([]byte{1}, 32), ID: &id, LID: types.NewJID("123", types.HiddenUserServer), Account: &waAdv.ADVSignedDeviceIdentity{Details: details, AccountSignatureKey: bytes.Repeat([]byte{1}, 32), AccountSignature: bytes.Repeat([]byte{1}, 64), DeviceSignature: bytes.Repeat([]byte{1}, 64)}}
}
func TestResponseValidationAndNativeCodes(t *testing.T) {
	for _, code := range []Code{InvalidRequest, StaleGeneration, SessionRevisionMismatch, BufferFull, SessionFull, StorageFailed, StateInvalid} {
		t.Run(string(code), func(t *testing.T) {
			n := &controlledStorage{errCode: code}
			s := openTest(t, n)
			e := s.PutNCTSalt(context.Background(), []byte{1})
			codeIs(t, e, code)
		})
	}
	for _, raw := range []string{`{"contractVersion":1,"success":true,"success":true,"data":{}}`, `{"contractVersion":2,"success":true,"data":{}}`, `{"contractVersion":1,"success":true,"data":{},"error":{"code":"STATE_INVALID","message":"x"}}`} {
		_, e := decodeResponse[applied](raw, payloadLimit(1))
		codeIs(t, e, StateInvalid)
	}
}
func TestBulkWritesScopedDeletesAndLIDReads(t *testing.T) {
	n := &controlledStorage{}
	s := openTest(t, n)
	ctx := context.Background()
	if e := s.PutManySessions(ctx, map[string][]byte{"123:1": {1}, "123:2": {2}, "456:1": {3}}); e != nil {
		t.Fatal(e)
	}
	many, e := s.GetManySessions(ctx, []string{"123:1", "missing:1"})
	if e != nil || !bytes.Equal(many["123:1"], []byte{1}) || many["missing:1"] != nil {
		t.Fatal(many, e)
	}
	has, e := s.HasSession(ctx, "123:2")
	if e != nil || !has {
		t.Fatal(has, e)
	}
	if e = s.DeleteAllSessions(ctx, "123"); e != nil {
		t.Fatal(e)
	}
	has, e = s.HasSession(ctx, "123:2")
	if e != nil || has {
		t.Fatal(has, e)
	}
	has, e = s.HasSession(ctx, "456:1")
	if e != nil || !has {
		t.Fatal(has, e)
	}
	if e = s.PutIdentity(ctx, "123:1", [32]byte{1}); e != nil {
		t.Fatal(e)
	}
	if e = s.PutIdentity(ctx, "456:1", [32]byte{2}); e != nil {
		t.Fatal(e)
	}
	if e = s.DeleteAllIdentities(ctx, "123"); e != nil {
		t.Fatal(e)
	}
	trusted, e := s.IsTrustedIdentity(ctx, "456:1", [32]byte{1})
	if e != nil || trusted {
		t.Fatal("other phone identity changed", trusted, e)
	}
	one := types.NewJID("123", types.DefaultUserServer)
	two := types.NewJID("456", types.DefaultUserServer)
	lid1 := types.NewJID("789", types.HiddenUserServer)
	lid2 := types.NewJID("987", types.HiddenUserServer)
	if e = s.PutManyLIDMappings(ctx, []store.LIDMapping{{PN: one, LID: lid1}, {PN: two, LID: lid2}}); e != nil {
		t.Fatal(e)
	}
	lids, e := s.GetManyLIDsForPNs(ctx, []types.JID{one, two})
	if e != nil || lids[one] != lid1 || lids[two] != lid2 {
		t.Fatal(lids, e)
	}
	if e = s.PutAllContactNames(ctx, []store.ContactEntry{{JID: one, FirstName: "one", FullName: "One"}, {JID: two, FirstName: "two", FullName: "Two"}}); e != nil {
		t.Fatal(e)
	}
	if changed, prev, e := s.PutBusinessName(ctx, one, "shop"); e != nil || !changed || prev != "" {
		t.Fatal(changed, prev, e)
	}
	if changed, prev, e := s.PutBusinessName(ctx, one, "store"); e != nil || !changed || prev != "shop" {
		t.Fatal(changed, prev, e)
	}
	contact, e := s.GetContact(ctx, one)
	if e != nil || contact.FirstName != "one" || contact.BusinessName != "store" {
		t.Fatal(contact, e)
	}
	if e = s.PutArchived(ctx, one, true); e != nil {
		t.Fatal(e)
	}
	settings, e := s.GetChatSettings(ctx, one)
	if e != nil || !settings.Archived {
		t.Fatal(settings, e)
	}
}
func TestDeviceAttachesOnlyAfterDurableSave(t *testing.T) {
	n := &controlledStorage{errCode: StorageFailed}
	s := openTest(t, n)
	d := validDevice()
	codeIs(t, s.PutDevice(context.Background(), d), StorageFailed)
	if d.Initialized || d.Container != nil || d.Sessions != nil {
		t.Fatal("failed device save attached stores")
	}
}
