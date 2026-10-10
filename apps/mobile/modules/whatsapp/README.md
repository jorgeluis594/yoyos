# WhatsApp native module (WA-01)

This local Expo module links Go/whatsmeow into Android and iOS. Its current `probe` method is a build diagnostic: it constructs an unconnected whatsmeow client, calls a native callback, and returns the callback value or a sanitized error. Session, QR, and message reception belong to later WA tasks. The WA-02 storage writers below are internal and are not yet connected to the public API.

## Pinned inputs

| Input | Version |
| --- | --- |
| Go | 1.26.5 |
| whatsmeow | `v0.0.0-20261006124319-9399289b022b` |
| gomobile and gobind | `golang.org/x/mobile v0.0.0-20260908204917-8b95e45f8d3e` |
| Android SDK / NDK | API 36, build-tools 36.0.0 / NDK 27.1.12297006; minimum API 24 |
| iOS | minimum 16.4; full Xcode and CocoaPods required |
| Expo / React Native | existing `apps/mobile/pnpm-lock.yaml` (Expo 57.0.24 / RN 0.86.3) |

## Observed native matrix

The first controlled Android runtime passed in [CI run 37774770222](https://github.com/jorgeluis594/yoyos/actions/runs/37774770222), PR head `c918484` (Actions checkout source `ee307df`). `build-info.txt` from that run records Go 1.26.5, the pinned whatsmeow and x/mobile revisions, Temurin JDK 17.0.20.1, Gradle 9.3.1, and both Go tool modules via `go version -m`. The evaluated app **and** module use compile SDK 36, build tools 36.0.0, NDK 27.1.12297006, minimum API 24, target API 36, and ABI filters `arm64-v8a,x86_64`; the release APK manifest and native-library inventory agree. Android CI ran `go test -race ./bridge`, `go vet ./bridge`, `build-go.sh android`, Expo prebuild, `:app:assembleRelease`, two `:yoyos-whatsapp:connectedDebugAndroidTest` cases on an API 35 x86_64 emulator, then installed/launched the app and found `bridge-ok` in its UI.

The WA-01 dependency head `c918484` also passed the `macos-26` iOS simulator job in [CI run 37774770222](https://github.com/jorgeluis594/yoyos/actions/runs/37774770222), from Actions checkout source `ee307df`. Its artifact records Go 1.26.5, Xcode 26.4.1 (17E202), iOS SDK 26.4, CocoaPods 1.17.0, and the pinned x/mobile tool revision. The Release Expo app binary contains arm64 and x86_64 simulator slices with minimum iOS 16.4, confirmed by `lipo` and `vtool`. CI ran `build-go.sh ios`, the Swift XCTest callback value/error case, Expo prebuild and CocoaPods, then built, installed and launched the app in the ARM simulator; screenshot recognition found `bridge-ok`. An earlier [CI run 37747233055](https://github.com/jorgeluis594/yoyos/actions/runs/37747233055) passed the same tests on both ARM and Intel simulators at PR head `12cd0d2`. The generated XCFramework also includes the requested arm64 device slice, but device execution remains untested.

Run an explicit dependency setup before building; the build script uses `GOTOOLCHAIN=local` and `GOPROXY=off` and never installs an SDK or upgrades dependencies:

```sh
cd apps/mobile/modules/whatsapp
./scripts/prepare-go-dependencies.sh
cd go
GOTOOLCHAIN=local go test ./bridge
GOTOOLCHAIN=local go vet ./bridge
cd ..
./scripts/build-go.sh android  # or ios, all
```

Build Android before Gradle and iOS before CocoaPods. The script removes the requested old artifact before checking prerequisites, patches a copy of the pinned whatsmeow source outside Go's cache, builds in `.generated/`, verifies the Android ABI entries, then publishes generated artifacts. It writes effective tool/source details to ignored `.generated/build-info.txt`. `android/libs/WhatsAppGo.aar`, `ios/Frameworks/WhatsAppGo.xcframework`, and tool binaries are ignored. A failed generation must stop the consuming build.

Android binds `arm64-v8a` and `x86_64` with Java package prefix `expo.modules.whatsapp.go`; iOS binds device arm64 and simulator arm64/amd64 with Objective-C prefix `YYWhatsAppGo`. The module is registered as `WhatsApp` on both platforms. Any Go, patch, or native binding change requires regeneration followed by rebuilding the app. Expo Go cannot load it.

## Validation

`go test` exercises callback values, errors, and invalid input inside Go. `index.test.ts` exercises missing module and boundary responses. The Android instrumented test calls the actual AAR on an emulator; native CI also builds the iOS app and its XCFramework on arm64 and amd64 simulator hosts. Generated bindings and a successful compile alone do not prove callback execution. Physical Android arm64 and iOS device runtime checks remain unexecuted without hardware.

## WA-02 encrypted storage

`android/src/main/java/expo/modules/whatsapp/NativeStateStore.kt` and `ios/Storage/NativeStateStore.swift` contain the internal encrypted snapshot writers. They publish `state.bin` through a synced `state.next`, persist a trusted read bound before a larger revision, and keep session keys separate from the recovery key. Android uses nonexportable Android Keystore AES keys and a secure creation marker; iOS keeps the creation record and AES keys in device-only Keychain items. The storage directory is private and excluded from backup. The writers are internal to the native module; WA-03 will connect them to Go protocol stores.

The Android instrumented storage suite runs through `connectedDebugAndroidTest`; `scripts/check-android-probe.sh` separately kills and restarts the process at each publication phase and induces actual `ENOSPC` before a second-copy write. The iOS storage suite uses an XCTest target hosted by the isolated Expo probe app so its real Keychain calls have an application identifier; the Swift package separately tests the Go callback. Native CI also runs iOS process-kill recovery and a bounded APFS `ENOSPC` case. These tests require native CI because the local machine lacks Android SDK and full Xcode. Passing a build or generating bindings alone does not prove storage runtime behavior; [the WA-02 evidence report](WA-02-VALIDATION.md) lists each assigned case and its native result.

## WA-06 confirmable delivery

`go/internal/delivery` owns the only delivery traversal. It emits one pending entry at a time, ordered by numeric `createdRevision` then `createdOrdinal` and shared by local recovery and new receptions, and it waits for `confirmMessageStored` before releasing the next. Unresolved (`pendingLid`) entries are skipped here; WA-07 resolves them. The coordinator keeps only the delivery in flight; the native container remains the single durable source, so it also recovers entries of another or unlinked account, with an invalid session and without a network (`bridge.OpenDelivery` takes no generation or credentials).

`go/internal/receive` connects the patched whatsmeow receive path (`EnableDecryptedEventBuffer`, `SynchronousAck`, `PreDecryptMessage`, `MessageReceiveFinished`) without trusting those flags alone. The ACK permission is the handler result, and it is granted only after this order: protocol and content commit → `messageReceived` → consumer commit → durable retirement → handler success. Unsupported or malformed content stores only the metadata retry marker. A stopped generation, a removed consumer, or a failed callback keeps the pending entry and interrupts the wait; nothing waits for a future consumer commit.

The recovery budget (`protocolstore.EntrySize`, 10 MiB by default) counts the serialized entry, encryption overhead, a record separator and, for `pendingLid`, an identity reserve; downloaded image bytes are never counted. `Decide` admits exactly the limit and rejects one byte more, also for a batch. A temporarily full buffer pauses reception (`RECOVERY_BUFFER_FULL`) and resumes only when the rejected entry would fit; an entry larger than the whole budget stops reception without waiting for space. The paused generation is rebuilt from the last confirmed revision.

Native layer (written, **not compiled or run** here: no gradle, xcodebuild, simulator or phone):

- `NativeStateStore.readPending` / `retirePending` (Kotlin and Swift) implement `DeliveryStorage` on the same writer: `ReadPending({"contractVersion":1})` → `{contractVersion:1,success:true,data:{revision,pending:[...]}}` and `RetirePending({"contractVersion":1,"deliveryId"})` → `data:{revision,removed}`. Success means durable publication, a valid absent ID succeeds with `removed:false` and publishes nothing, and neither needs a generation, session key or network.
- `WhatsAppModule` (both platforms) opens `OpenDelivery`/`Start` from `initialize` even when the session is invalid, passes the delivery session to `OpenConnectionWithDelivery`, and implements `confirmMessageStored`, `setMessageConsumer` and `removeMessageConsumer`. `OnDelivery(json)` forwards `messageReceived` (with its `consumer` token) and throws when the JavaScript runtime is gone, which keeps the entry and stops reception once; `OnDestroy` removes the consumer. Replacing a consumer is one `setMessageConsumer` with the new token; `client.ts` never calls `removeMessageConsumer` first.
- Source tests: `StateStoreInstrumentedTest` (Android) and `StateStoreTests` (iOS) cover retirement, idempotence, invalid requests and the missing session key.

## WA-09 logout and account change

`ConnectionSession.Logout()` (Go) is the first half of `logout()`; native retirement is the second.

1. `Controller.Logout` invalidates the generation (reception stops, late QR/state events are dropped; `connect`/`disconnect` requested meanwhile wait for it, in admission order) and keeps the socket open only to ask for the unlink.
2. `ResolveIdentities` applies every PN/LID mapping already stored, durably, before credentials go. If that fails, nothing is unlinked or retired and the public storage code is returned.
3. `Client.Logout` is requested with a 15 s deadline (`connection.LogoutTimeout`, injectable clock). The pinned client deletes its device only after the server accepted the request, and the container refuses that deletion with `NativeLogoutRequired`; only that refusal (or a nil error) counts as confirmation. Anything else, including the timeout, is `REMOTE_LOGOUT_UNCONFIRMED`. Credentials are never restored.
4. Native then runs the existing `endSession` (publish `session: null` + `sessionKeysToDelete`, delete the key, retire the marker). `open()` completes an interrupted cleanup and refuses to link until it finishes; `K_recovery` and the active session key are never retired. Pending entries keep their original `accountId` and are recovered/confirmed with no connection, whatever account is active.
5. A finished session refuses `Connect()` (`SESSION_STATE_INVALID`); native opens a new one, with a new `K_session`, after retirement. A repeat on a finished session is a local success that certifies nothing remote. Simultaneous JavaScript calls share one native call; on-device they also serialize on the runtime lock, so a call that arrives after the first finished is that idempotent local success.

### Revocation after a restart (design, completed with WA-12)

The server revoking the session (`LoggedOut`) only publishes `sessionExpired` and blocks `connect()` with `SESSION_EXPIRED` in the same runtime; it never deletes credentials or the key. The container schema has no revocation field and this task does not add one. A restart needs none: the stored session is revoked server-side, so the next explicit `connect()` receives `LoggedOut` again and returns to `sessionExpired` with no QR. What WA-12 must persist is the *intent*: revocation, like `disconnect()`, `logout()` and a local fault, must clear `receiveRequested` so a recreated Android service does not reconnect in a loop. If WA-12 wants `sessionExpired` visible without a connection attempt, the additive option is `session.revoked: true` written through the same writer and cleared by `endSession`; that needs a contract version decision and is not implemented here.

### Review fixes

- **No live socket:** `Controller.SetUnlinkTransport` builds a client without a receive path that connects, waits for the login (`events.Connected`) and sends `remove-companion-device`, all inside the same 15 s. A revoked session is not reconnected. Failure or timeout is `REMOTE_LOGOUT_UNCONFIRMED`.
- **After `disconnect()` or revocation:** native `logout` reopens the stored session without network (`forLogout`) before calling `Logout`, so mappings are resolved first. Unreadable credentials (`SESSION_STATE_INVALID`) cannot be resolved and still allow retirement; any other open failure keeps the credentials.
- **Acknowledgement window:** a live transport is `Quiesce`d when logout starts: its handler rejects every delivery, so nothing is acknowledged without the receive path. Deliveries captured meanwhile stay durable and the server redelivers them.
- **History of the previous account (WA-08 debt):** this branch does not contain WA-08's history capture. The previous account's captured history must be retired by the WA-11 integration, which merges WA-08 and WA-10: it must keep that capture under its original `accountId`, exclude it from the new account's budgets and resolution (the resolver already filters by account), and drain it with the confirm/delete paths that need no credentials. WA-09 retires only session and key and never touches pending or history records.

- **Offline queue (M3):** the server starts the offline queue when the unlink client turns active, before the unlink can be sent, and whatsmeow cannot stay passive. `NewUnlinkTransport` therefore rejects every encrypted message: `PreDecryptMessage` returns an error (no decryption, no Signal state change, no acknowledgement; the patched client documents this), `SynchronousAck` holds acknowledgements until handlers return and a handler returns `false`. Chosen over the durable receive path, which would capture messages for an account being retired and consume budget. **What this means for the user:** messages that were still queued on the server when `logout()` ran are **not** delivered to Yoyos and are **not** redelivered later: unlinking the device makes the server discard that queue. Only messages already stored as pending in Yoyos are preserved. If the local retirement fails afterwards and the session survives, a later `connect()` may receive the queue again. Callers that cannot lose messages should `connect()` and let delivery drain before calling `logout()`.
- **Known minor limits (m7, m8):** notifications (`encrypt`, `server_sync`, `devices`, `picture`) and the paths that run before the hook (LID/PN mapping, push name, business name, session migration, `unavailable` placeholders) can still write to the store being retired or be acknowledged without touching message content or the pending ledger. A late `Disconnected` from a cancelled socket can end the unlink wait early, which only yields `REMOTE_LOGOUT_UNCONFIRMED` (safe).
- **Known revocation (m4):** native passes it with `markRevoked()` when it reopens the session for logout, so no connection is made; the unlink wait also ends at `LoggedOut`/`ConnectFailure`/`Disconnected` instead of the full 15 s. A failed logout on a revoked session re-announces `sessionExpired` rather than `disconnected` (m5).

Native layer (`logout` in `WhatsAppModule.kt` / `.swift` now calls `session.logout()` before `stop()` and `endSession`): written, **not compiled or run**.

## WA-10 private image files

`downloadImage(reference)` and `deleteDownloadedImage(messageId)` are served by `internal/images` (Go) behind `bridge.ImageSession`. The directory (`whatsapp/images`, already created by the state stores: private, outside backups and caches) and its byte budget are independent of the connection, the session writer and the delivery coordinator; no lock is shared with confirmations, and logout never touches the files.

- **Descriptor:** `ParseDescriptor` reuses the `normalization` contract (prefix, 16 KiB, exact fields, coherent IDs, 32-byte keys/hashes, decimal uint64, media-only `directPath`) and a malformed one is `INVALID_INPUT`. Only `directPath` and the keys reach the pinned client, whose own media hosts are the only ones used. A well-formed descriptor missing any download datum is `IMAGE_UNAVAILABLE`, with no network.
- **Order of a download:** parse → queue turn → a complete file is verified (SHA-256 against the descriptor, size > 0, MIME sniffed from the bytes: JPEG, PNG, GIF, WebP, BMP, HEIC/HEIF, AVIF) and reused with no network, even after logout or with another account; an invalid complete file is `IMAGE_UNAVAILABLE` and stays until `deleteDownloadedImage`. Otherwise the origin account must be connected (`ACCOUNT_NOT_CONNECTED`; nothing connects automatically and no media re-upload is requested) → budget reservation → download/decrypt into `<hash>.part` (0600) → close → verify again → rename to `<hash>.img` inside `MediaLease.Publish` → return. File names are `sha256(messageId)`; no identifier is a path.
- **Budget (`maxImageStorageBytes`, 50 MiB default):** every file on disk (complete, foreign, or a partial whose removal failed) plus the active download, counted at the larger of its reservation and its real size. The reservation is the maximum encrypted temporary size for the declared length (`(L/16+1)*16+10`), or all remaining space when unknown; a declaration that cannot fit is `STORAGE_LIMIT_REACHED` before any network. The temporary file is a `limitedFile`: `Write`, `WriteAt`, `Truncate` and `Allocate` are checked against the budget, so a false length cannot widen it. It is never an `*os.File`, so the client cannot preallocate behind its back.
- **Time:** one 60 s deadline per operation on an injectable clock, started at the queue turn and shared by the client's internal host/retry loop; timeout is `IMAGE_DOWNLOAD_FAILED`. The wrapper never retries on its own.
- **Concurrency:** downloads and deletes run one at a time in admission order. A request records the generation it was admitted under (`AdmitMedia`); at its turn `AcquireMedia` refuses a retired generation even if another connected meanwhile (`ACCOUNT_NOT_CONNECTED`), but a complete file is still reused first. Retiring a generation (disconnect, logout, pause, reconnect) cancels the active transfer directly through the lease context, without waiting for the queue. `Publish` runs under the controller lock, so publication and retirement are totally ordered: if the publication ran first the file stays; if the retirement ran first nothing is published and the partial is removed.
- **Failures:** a failed download removes its partial; if that removal fails the real size keeps counting (`Stats().CleanupFailures`) and the cause is joined to the error. Opening removes leftover partials with the same rule and keeps complete files. Deleting an absent file succeeds; any other filesystem error is `IMAGE_DELETE_FAILED` and the bytes keep counting.
- **Error mapping:** 403/404/410 and a missing path are `IMAGE_UNAVAILABLE`; hash/HMAC failures are `IMAGE_UNAVAILABLE`; limits are `STORAGE_LIMIT_REACHED`; cancellation, timeout and I/O are `IMAGE_DOWNLOAD_FAILED`.
- **Native glue:** `initialize` opens the `ImageSession` (`ensureImages`) with the saved `maxImageStorageBytes`, attaches it to every connection session, and `downloadImage`/`deleteDownloadedImage` call it outside the runtime lock and answer `{uri: file://…, mimeType, size}`. This layer is written, **not compiled or run** (no Gradle, Xcode, simulator or phone here). The JavaScript client accepts only a `file://` URI, an `image/*` MIME and a positive size.
- **Not in WA-10:** applying a changed limit while a cancelled download is still cleaning up (WA-11), HTTP upload to core (consumer), and any claim about real WhatsApp servers: every download here ran against a controlled transport.

### WA-10 review fixes

- **B1 – native dispatch:** Expo's default `AsyncFunction` queue is one thread/serial queue shared by every function, so a 60 s download there would hold `confirmMessageStored`, `disconnect` and `logout` and make the cancellation wait. `downloadImage` and `deleteDownloadedImage` now run as a Kotlin `Coroutine` on `ImageOperations`' own dispatcher (a cached pool) and on a Swift concurrent `ImageOperations.queue` (`runOnQueue`). Proofs here: Go `TestB1DisconnectAndLogoutDoNotWaitForADownload` (confirm, disconnect and logout finish while a transfer is stalled and the transfer is cancelled at once), the TS test that `disconnect`/`logout` reach native while a download never settles, and source tests `ImageOperationsInstrumentedTest` / `ImageOperationsTests` (two blocking operations run together, off the caller). The native tests and the dispatch itself are **not compiled or run**.
- **M1 – session token:** `MediaAdmission` carries a process-unique controller id besides the generation, so a request queued under session S1 gets `ACCOUNT_NOT_CONNECTED` on S2 even when both are at generation 1.
- **M2 – `directPath` query:** the pinned client builds `https://<host><directPath>&hash=…`, so a path with its query (`?ccb=…&oh=…`) is accepted as emitted. Still rejected: no leading `/`, `//`, `://`, `#`, backslash, spaces/control characters and `.`/`..` segments. Verified against the real client: the media URL it requests is `…/abc?ccb=11-4&oh=x&hash=…`.
- **m1:** `ErrInvalidMediaHMAC`/`ErrTooShortFile` are no longer mapped to `IMAGE_UNAVAILABLE`: after a failed host the pinned client appends the next host's body without rewinding, so they can follow a transient failure and stay `IMAGE_DOWNLOAD_FAILED`. SHA-256 mismatches stay `IMAGE_UNAVAILABLE`.
- **m2:** subdirectories (recursively) count against the budget. **m3:** BMP needs reserved bytes zero and a known DIB header size. **m4:** the temporary file is `<hash>.<random>.part`; stuck ones are counted and removed by an explicit delete.
- **m5:** `TestPinnedClientRetriesShareTheOperationDeadline` and `…StalledTransferIsCancelledImmediately` drive the real pinned client (local protocol server for `media_conn`, controlled media HTTP transport): its own retries stop at the operation deadline and cancellation is immediate. The 60 s value itself is still covered with the injected clock.
