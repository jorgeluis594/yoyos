# Protocol session records, v1

Pure Go codec for the pinned `go.mau.fi/whatsmeow` v0.0.0-20261006124319-9399289b022b store. The native writer and store adapter will use it after WA-02 acceptance. It does not publish, encrypt, authorize, or transact state.

A session is exactly `{protocolSchemaVersion:1,records:[...]}`. Each record has exactly `recordType`, `recordKey`, and `valueBase64`. `recordKey` is unpadded Base64url of a compact JSON array of string components; binary key components are standard padded Base64. `valueBase64` is standard padded Base64 of compact UTF-8 JSON with `version:1`. Go JSON byte slices use standard padded Base64. Duplicate records, unknown types/fields, noncanonical keys or values, and inverse LID conflicts fail decoding. The plaintext codec envelope is capped at 16 MiB. Decoded value JSON is capped at `3*(16 MiB/4)-1` bytes, derived from its outer Base64 expansion; the envelope check accounts for the actual keys, records, and JSON overhead. Keys are capped at 2048 bytes. Lengths are checked before Base64 decoding. JSON depth is capped at 64. Native admission must separately enforce the final 16 MiB encrypted serialized session budget, including ciphertext, Base64, nonce, and metadata; this codec does not enforce that budget.

| Type | Key components | Value fields after `version` |
| --- | --- | --- |
| `device` | `[]` | Private Noise/identity/signed-prekey bytes, signed-prekey ID/signature, registration ID, ADV secret, ID/LID JIDs, signed account protobuf, platform/business/push names, Facebook UUID, LID migration timestamp, companion nonce. `DeviceFromStore` and `ToStore` reconstruct public keys from private keys. |
| `identity`, `signal-session` | Signal address | `data` (32-byte identity public key or opaque serialized session) |
| `prekey` | canonical uint32 ID | `privateKey`, `uploaded` |
| `prekey-state` | `[]` | `nextId` (uint64, permits uint32 max + 1 exhaustion sentinel), `uploadedThrough` |
| `sender-key` | group Signal ID, sender Signal address | `data` (opaque serialized sender-key record) |
| `app-state-key` | binary key ID | `data`, protobuf `fingerprint`, `timestamp` (int64) |
| `app-state-version` | collection | `number` (nonzero uint64), `hash` (128 bytes) |
| `app-state-mac` | collection, 32-byte index MAC | `mutationVersion` (uint64), `valueMac` (32 bytes) |
| `contact` | JID | `firstName`, `fullName`, `pushName`, `businessName`, `redactedPhone` |
| `chat-setting` | JID | `mutedUntil` (UTC RFC3339Nano or empty), `pinned`, `archived`, `wasaRootSecretId` |
| `message-secret` | chat JID, sender JID, message ID | `data` (secret bytes; no message body) |
| `privacy-token` | JID | `token`, `timestamp` (Unix seconds), nullable `senderTimestamp` (Unix seconds) |
| `nct-salt` | `[]` | `data` (salt bytes) |
| `lid-mapping` | non-device PN JID | non-device `lid` JID; one-to-one inverse checked across records |
| `retry-hash` | 32-byte ciphertext hash | `insertTimeMs`, `serverTimeSeconds` only |

`retry-hash` is a metadata marker, not a consumer confirmation or plaintext cache. Recoverable plaintext belongs in native pending, coupled atomically with protocol changes by the later WA-03 adapter. This codec rejects a `plaintext` field. Outgoing retry events have no record type in v1; the later adapter must enforce the receive-only policy explicitly and fail any unexpected outgoing store operation.

`UT-FMT-07` has pure-codec coverage here. `IT-FMT-07` is only partially covered: native snapshot/binding validation, atomic application, recovery, account/generation checks, and platform tests remain pending.
