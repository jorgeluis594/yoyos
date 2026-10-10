package protocolstate

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
	"google.golang.org/protobuf/proto"
)

type Device struct {
	Version               int    `json:"version"`
	NoisePrivateKey       []byte `json:"noisePrivateKey"`
	IdentityPrivateKey    []byte `json:"identityPrivateKey"`
	SignedPreKeyPrivate   []byte `json:"signedPreKeyPrivate"`
	SignedPreKeyID        uint32 `json:"signedPreKeyId"`
	SignedPreKeySignature []byte `json:"signedPreKeySignature"`
	RegistrationID        uint32 `json:"registrationId"`
	AdvSecretKey          []byte `json:"advSecretKey"`
	ID                    string `json:"id"`
	LID                   string `json:"lid"`
	Account               []byte `json:"account"`
	Platform              string `json:"platform"`
	BusinessName          string `json:"businessName"`
	PushName              string `json:"pushName"`
	FacebookUUID          string `json:"facebookUuid"`
	LIDMigrationTimestamp int64  `json:"lidMigrationTimestamp"`
	CompanionMetaNonce    string `json:"companionMetaNonce"`
}

func (v *Device) validate() error {
	if v.Version != 1 || len(v.NoisePrivateKey) != 32 || len(v.IdentityPrivateKey) != 32 || len(v.SignedPreKeyPrivate) != 32 || len(v.SignedPreKeySignature) != 64 || len(v.AdvSecretKey) != 32 {
		return errors.New("invalid device credentials")
	}
	if err := validJID(v.ID); err != nil {
		return fmt.Errorf("device ID: %w", err)
	}
	if v.LID != "" {
		if err := validJID(v.LID); err != nil {
			return fmt.Errorf("device LID: %w", err)
		}
	}
	if v.FacebookUUID != "" {
		parsed, err := uuid.Parse(v.FacebookUUID)
		if err != nil || parsed.String() != v.FacebookUUID {
			return errors.New("invalid Facebook UUID")
		}
	}
	var account waAdv.ADVSignedDeviceIdentity
	if err := proto.Unmarshal(v.Account, &account); err != nil {
		return err
	}
	if len(account.Details) == 0 || len(account.AccountSignatureKey) != 32 || len(account.AccountSignature) != 64 || len(account.DeviceSignature) != 64 {
		return errors.New("invalid signed account")
	}
	var details waAdv.ADVDeviceIdentity
	if err := proto.Unmarshal(account.Details, &details); err != nil {
		return errors.New("invalid account details protobuf")
	}
	return nil
}
func DeviceFromStore(d *store.Device) (Device, error) {
	if d == nil || d.NoiseKey == nil || d.IdentityKey == nil || d.SignedPreKey == nil || d.NoiseKey.Priv == nil || d.IdentityKey.Priv == nil || d.SignedPreKey.Priv == nil || d.SignedPreKey.Signature == nil || d.ID == nil || d.Account == nil {
		return Device{}, errors.New("incomplete device")
	}
	account, err := proto.Marshal(d.Account)
	if err != nil {
		return Device{}, err
	}
	v := Device{Version: 1, NoisePrivateKey: d.NoiseKey.Priv[:], IdentityPrivateKey: d.IdentityKey.Priv[:], SignedPreKeyPrivate: d.SignedPreKey.Priv[:], SignedPreKeyID: d.SignedPreKey.KeyID, SignedPreKeySignature: d.SignedPreKey.Signature[:], RegistrationID: d.RegistrationID, AdvSecretKey: d.AdvSecretKey, ID: d.ID.String(), Account: account, Platform: d.Platform, BusinessName: d.BusinessName, PushName: d.PushName, LIDMigrationTimestamp: d.LIDMigrationTimestamp, CompanionMetaNonce: d.CompanionMetaNonce}
	if !d.LID.IsEmpty() {
		v.LID = d.LID.String()
	}
	if d.FacebookUUID != uuid.Nil {
		v.FacebookUUID = d.FacebookUUID.String()
	}
	return v, v.validate()
}
func (v Device) ToStore() (*store.Device, error) {
	if err := v.validate(); err != nil {
		return nil, err
	}
	id, _ := types.ParseJID(v.ID)
	var lid types.JID
	if v.LID != "" {
		lid, _ = types.ParseJID(v.LID)
	}
	var account waAdv.ADVSignedDeviceIdentity
	if err := proto.Unmarshal(v.Account, &account); err != nil {
		return nil, err
	}
	var noise, identity, prekey [32]byte
	copy(noise[:], v.NoisePrivateKey)
	copy(identity[:], v.IdentityPrivateKey)
	copy(prekey[:], v.SignedPreKeyPrivate)
	var sig [64]byte
	copy(sig[:], v.SignedPreKeySignature)
	var fb uuid.UUID
	if v.FacebookUUID != "" {
		fb, _ = uuid.Parse(v.FacebookUUID)
	}
	return &store.Device{NoiseKey: keys.NewKeyPairFromPrivateKey(noise), IdentityKey: keys.NewKeyPairFromPrivateKey(identity), SignedPreKey: &keys.PreKey{KeyPair: *keys.NewKeyPairFromPrivateKey(prekey), KeyID: v.SignedPreKeyID, Signature: &sig}, RegistrationID: v.RegistrationID, AdvSecretKey: append([]byte(nil), v.AdvSecretKey...), ID: &id, LID: lid, Account: &account, Platform: v.Platform, BusinessName: v.BusinessName, PushName: v.PushName, FacebookUUID: fb, LIDMigrationTimestamp: v.LIDMigrationTimestamp, CompanionMetaNonce: v.CompanionMetaNonce}, nil
}
