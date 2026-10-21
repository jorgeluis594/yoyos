# WhatsApp native module

This local Expo module links Go/whatsmeow into Android and iOS and gives Yoyos a durable, confirmable stream of WhatsApp text and image messages received on the phone. Credentials, decryption and reception stay on the phone; the module sends nothing to the Yoyos backend and exposes no way to send a WhatsApp message.

Product rules and the end-to-end flow are in [`docs/whatsapp.md`](../../../../docs/whatsapp.md). The Go library's internal architecture is in [`docs/whatsapp-go-library-architecture.md`](../../../../docs/whatsapp-go-library-architecture.md).

## Public API

`import { WhatsApp, createWhatsAppClient } from "@mobile/modules/whatsapp"` (`types.ts`, `client.ts`). Every operation returns `Result<T, { code, message }>`; consumers decide by `code`, never by `message` (a fixed sentence per code).

| Method | What it does |
| --- | --- |
| `initialize(options?)` | Opens the encrypted container and the stored session without connecting; applies `options` (see Configuration); publishes the current `connectionChanged`. Idempotent for equal options; different options while a connection is requested → `INVALID_INPUT`. |
| `connect()` | Requests a connection. Without a stored session it starts QR linking (`qr` events); with one it reconnects. One request, one client, no duplicate sockets. |
| `disconnect()` | Ends the request; session and pending entries are kept. |
| `logout()` | Asks WhatsApp to unlink this device, then retires the local credentials. `REMOTE_LOGOUT_UNCONFIRMED` means the local session was retired but the server did not confirm. Pending entries keep their account and stay confirmable. |
| `addListener("messageReceived", fn)` | Becomes the single consumer (a newer subscription replaces the older one). Each event is `{ deliveryId, message }`. |
| `confirmMessageStored(deliveryId)` | Call after the app committed the message in its own durable store. Durably retires the pending entry (idempotent; an absent id succeeds). It is not an upload to core and deletes no image. |
| `downloadImage(reference)` / `deleteDownloadedImage(messageId)` | Download, verify and keep a private image file (`file://` URI, MIME and size); reuse without network; delete. Independent of the connection and of the recovery budget. |
| `addListener("qr" \| "connectionChanged" \| "error", fn)` | `qr`: `{ value, expiresAt }` for the current link attempt; `connectionChanged`: `disconnected, connecting, awaitingQr, connected, reconnecting, sessionExpired`; `error`: `{ code, message }` for faults that happen outside a call. A new listener receives the current state/QR once. |

The API deliberately has **no** send, list, queue or upload operation (`wa14.contract.test.ts` pins the exact method set and the native methods the client may reach). The consumer owns persistence and any upload to core.

Error codes (identical in `types.ts`, `client.ts` and the Go bridge): `MODULE_UNAVAILABLE`, `NOT_INITIALIZED`, `INVALID_INPUT`, `INVALID_NATIVE_RESPONSE`, `NATIVE_CALL_FAILED`, `CONNECTION_FAILED`, `SESSION_EXPIRED`, `SESSION_STORAGE_FAILED`, `SESSION_STORAGE_LIMIT_REACHED`, `SESSION_STATE_INVALID`, `IDENTITY_UNAVAILABLE`, `ACCOUNT_NOT_CONNECTED`, `RECOVERY_BUFFER_FULL`, `HISTORY_LIMIT_REACHED`, `STORAGE_LIMIT_REACHED`, `IMAGE_UNAVAILABLE`, `IMAGE_DOWNLOAD_FAILED`, `IMAGE_DELETE_FAILED`, `REMOTE_LOGOUT_UNCONFIRMED`. `RECOVERY_BUFFER_FULL`, `HISTORY_LIMIT_REACHED` and `IDENTITY_UNAVAILABLE` can also arrive as informational `error` events without ending the connection.

`ReceivedMessage.timestamp` is optional (Unix milliseconds). When WhatsApp's own time is missing, zero, negative, beyond year 9999 or not a safe JSON integer, the key is omitted: the date is unknown. It is never `0` and never the reception time.

## Configuration

Two global budgets, both per installation (not per account): the recovery buffer (`maxRecoveryBufferBytes`, 10 MiB by default) and the private image directory (`maxImageStorageBytes`, 50 MiB by default). Yoyos sets the first with `EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB` (read in `src/composition/whatsapp.ts`; unset means 10 MiB; a defined value that is not a canonical positive integer fails with `INVALID_WHATSAPP_RECOVERY_BUFFER_MIB`, never a silent default). Go and the native layers never read `.env`.

- Options are persisted in the encrypted container. To change them, call `disconnect()` and then `initialize(newOptions)`; the next `connect()` uses them. Different options while a connection, QR, reconnection or buffer-full pause is requested are refused with `INVALID_INPUT`.
- **Reducing a limit never deletes data.** Pending entries above a reduced recovery budget stay readable, resolvable and confirmable; complete image files above a reduced image budget stay readable and deletable, and new downloads get `STORAGE_LIMIT_REACHED` until there is room.
- Android declares a foreground service of type `remoteMessaging` in the module manifest; iOS needs 16.4 or later. The library never asks for notification permission.

History batches have fixed internal bounds (`history.DefaultLimits()`, not WhatsApp limits and not configurable): 16 MiB downloaded input, 32 MiB inflated, nesting depth 32, about 160 MiB estimated parser heap, 2048 conversations, 20000 messages, 20000 mappings and push names, 1 MiB per message record. A batch must also fit the recovery buffer whole; raising the buffer changes none of these bounds.

## Build and test

Pinned inputs:

| Input | Version |
| --- | --- |
| Go | 1.26.5 |
| whatsmeow | `v0.0.0-20261006124319-9399289b022b` |
| gomobile and gobind | `golang.org/x/mobile v0.0.0-20260908204917-8b95e45f8d3e` |
| Android SDK / NDK | API 36, build-tools 36.0.0 / NDK 27.1.12297006; minimum API 24 |
| iOS | minimum 16.4; full Xcode and CocoaPods required |
| Expo / React Native | `apps/mobile/pnpm-lock.yaml` |

After any change to Go, a patch or a binding, regenerate the artifacts and rebuild the app (Expo Go cannot load the module). Build Android before Gradle and iOS before CocoaPods:

```sh
cd apps/mobile/modules/whatsapp
./scripts/prepare-go-dependencies.sh   # explicit, pinned dependency setup
sh scripts/test-go.sh                  # go test -race ./..., go vet and the pinned whatsmeow tests, on a patched copy
./scripts/build-go.sh android          # or ios, all
sh scripts/measure-go.sh               # Go-side snapshot costs, no -race (writes MEASUREMENTS.json)
```

Non-native checks from the repository root:

```sh
pnpm --dir apps/mobile typecheck && pnpm --dir apps/mobile lint
pnpm --dir apps/mobile exec jest modules/whatsapp src/composition/whatsapp-options
```

- Do not run `go test` or `go vet` directly inside `go/`: the module depends on whatsmeow patches (`patches/*.patch`), so `protocolstore` does not compile against the unpatched module in Go's cache. `scripts/test-go.sh` applies them to a temporary copy and is the only supported way to run the Go tests.
- The build script uses `GOTOOLCHAIN=local` and `GOPROXY=off` and never installs an SDK or upgrades dependencies. It patches a copy of the pinned whatsmeow source outside Go's cache, builds in `.generated/`, verifies the Android ABI entries, then publishes the artifacts; effective tool and source details go to the ignored `.generated/build-info.txt`. A failed generation must stop the consuming build.
- Android binds `arm64-v8a` and `x86_64` with Java package prefix `expo.modules.whatsapp.go`; iOS binds device arm64 and simulator arm64/amd64 with Objective-C prefix `YYWhatsAppGo`. The module is registered as `WhatsApp` on both platforms. `android/libs/WhatsAppGo.aar`, `ios/Frameworks/WhatsAppGo.xcframework` and tool binaries are not versioned.
- Android instrumented tests run with `connectedDebugAndroidTest`; `scripts/check-android-probe.sh` kills and restarts the process at each storage publication phase.

## Guarantees

- **At-least-once, ordered, confirmable delivery.** A message is acknowledged to WhatsApp only after: protocol and content commit → `messageReceived` → the consumer's own commit → `confirmMessageStored` (durable retirement) → handler success. A crash, a failed callback, a removed consumer or a lost confirmation keeps the entry; it is delivered again after a restart. Delivery is one entry at a time, ordered by revision and ordinal. **Not exactly-once:** the consumer must be idempotent by `message.id`.
- **Atomicity.** Session changes and the recoverable content they belong to are committed together or not at all, in one transaction of the native SQLite database (`whatsapp/state.db`); reading never recreates an empty container.
- **Local custody.** Credentials, the Signal session and decrypted content never leave the phone; keys are non-exportable (Android Keystore) or device-only (iOS Keychain); the container and images are private and excluded from backup. The module has no HTTP client, no listening port and no server receiver.
- **Bounded resources.** Recovery buffer, session, history batch and image directory have explicit byte budgets; exceeding one pauses reception or refuses the item with a public code and never drops pending data. Content that normalization declares out of scope (unsupported types, invalid identities) is excluded rather than kept. A supported message with an unknown date is persisted, delivered without `timestamp` and acknowledged like any other.
- **No sensitive diagnostics.** Public messages are one fixed sentence per code; native errors, panic values and callback failures are mapped to codes at the boundary; Go writes no log; the Android notification is a fixed title with no text, extras or actions.
- **Unlink and account change.** `logout()` resolves stored PN/LID mappings first, asks WhatsApp to unlink within 15 s and retires credentials; messages still queued on the server at that moment are not delivered; pending entries of the old account remain confirmable. History captures of the unlinked account are retired.
- **Android background reception.** `connect()` starts the foreground service `WhatsAppService`, which keeps the single client alive while no screen is. The connection intent is persisted; after the OS recreates the service it reconnects only if the intent, a usable session and the same account are present. `disconnect()`, `logout()`, revocation and local storage faults withdraw the intent. No boot receiver, alarm or job.
- **iOS suspension.** Leaving the foreground retires the live connection; returning starts one new attempt if a connection was requested. Pending entries, the stored session and image files are untouched by either.

## Limits (not promised)

- No reception while the iOS app is suspended and nothing wakes it; on Android reception relies on a foreground service that the OS may still stop (Doze, battery settings, process kill).
- No guarantee that WhatsApp offers history or offline messages after a reconnect, no complete remote history, no exactly-once delivery, no sending, no media other than still images, no several accounts at once. A history batch larger than the recovery buffer is refused and cannot be recovered from the server.
- No performance threshold has been agreed. Nothing here proves interoperability with the real WhatsApp service, which may change its protocol.
- If the app is distributed through Google Play, the foreground-service justification for `remoteMessaging` must be documented first.
