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

## WA-08 history by atomic batch

A history sync is announced by an encrypted notification from the account's own phone. Everything is built on the existing buffer: no second queue, no spool.

**Order of one batch** (each step starts after the previous one is durable; the tests record every step where it happens):

1. *Capture.* In the decryption transaction, the notification plaintext is committed with the Signal state that consumed its ciphertext, as a pending entry that nobody delivers (`source: history`, `pendingLid`, no `message`, `messageType: history-notification`; `protocolstore.IsHistoryNotification`). It reuses the pending contract, so native storage needs no new kind. It costs no identity reserve.
2. *Notification ACK.* The handler grants it as soon as the capture is durable (`receive.Handle`); it does not wait for the batch or for the consumer. The capture is now the recoverable source, and the remote batch has not been touched.
3. *Download and inflate*, one batch at a time (`history.Processor`, serialized): input is cut at 16 MiB **while it is received** (`whatsmeow.WithMediaDownloadLimit`, declared sizes only shorten the wait), inline payloads count against the same limit, inflation is cut at 32 MiB **while it is produced**, before any parser.
4. *Decode* (`history.Decode`): counts, record sizes, total elements and depth are checked on the wire by walking the schema, without building objects. Fields the admission never reads (status messages, call logs, and everything in a conversation but its ID, messages and privacy token, such as group participants) are neither counted nor parsed.
5. *Prepare* (`history.Prepare`, no writes): the batch's PN→LID mappings are processed first and are what dependent messages are normalized with (`identity.ClassifyWeb`, the same rules as live content). Out-of-scope content is excluded; a supported message that cannot be normalized, an unreadable store or a mapping the store would refuse fails the whole batch. Preparation stops as soon as the entries exceed the recovery budget.
6. *Admission* (`protocolstore.AdmitHistoryBatch`): the protocol changes (`client.StageHistorySync`: mappings, secrets, salt, settings), every pending insert and a batch marker are one native commit or none. If the batch fits the budget only after confirmations it waits (`delivery.Coordinator.AwaitCapacity`) holding no store or writer lock and ending with the connection generation; if it cannot fit beside its own capture entry it is refused as `RECOVERY_BUFFER_FULL` without a retry.
7. *Release.* Only after the commit: the `hist_sync` receipt, then the remote deletion (best effort), then the capture's retirement. A failed receipt keeps the capture; the marker makes the retry skip the admission, so nothing is published twice.

`ManualHistorySyncDownload` and `DisableManualHistorySyncReceipt` only switch the dependency's automatic path off. The patch test `TestManualHistoryFlagsLeaveTheReceiptAndTheDownloadToTheCaller` checks, with controls, that the dependency neither queues the download nor sends the receipt; the order above is what protects the batch.

**Refusals** never stop live reception: the notification was acknowledged once it was durable and the capture is retired, so nothing retries it. They are reported as `error` events: `HISTORY_LIMIT_REACHED` (input, inflated size, depth, counts or a record over its bound), `RECOVERY_BUFFER_FULL` (the batch exceeds the buffer), and `NATIVE_CALL_FAILED` (invalid or permanently unavailable batch). Content that the store refuses while staging the batch's protocol effects (an oversize key, an incomplete secret) or that would exceed the session/binding limits is also a rejection: staging runs on a disposable transaction, so the store is not latched, live reception is not stopped, the capture is released and nothing repeats after a restart. Real storage failures stop the generation as for live messages and leave the capture. While a capture waits, batch markers are not purged by the 14-day retention. A capture of a previous account has no release path here; WA-09 owns that. Rejected batches are not recoverable from the server by this version.

**Limits** (`history.DefaultLimits`; internal v1 constants, not WhatsApp limits and not configurable by environment):

| Bound | Value | Why |
| --- | --- | --- |
| Input (downloaded or inline) | 16 MiB | contract |
| Inflated protobuf | 32 MiB | contract |
| Nesting depth | 32 | a text or image message needs 5 levels and each wrapper adds 2, so 32 admits up to 13 wrappers; checked on the wire by walking the schema before the parser runs (real history was not checked) |
| Elements | 1 500 000 | every field occurrence that will be parsed, at any depth and of any kind; this is what stops amplification through repeated fields nobody counts (a measured 31 MiB bomb of group participants used to build 6.5 M objects) |
| Conversations | 2048 | checked on the wire |
| Messages (all conversations) | 20000 | each parsed message costs about 2–8 KiB of heap, so this bound, not the byte limit, governs the parser's peak for small messages; the default 10 MiB buffer holds fewer than 15000 entries |
| Mappings / push names | 20000 each | checked on the wire |
| One message record | 1 MiB | exact payload length, checked on the wire |

The recovery budget is separate: a batch inside 16 MiB / 32 MiB can still be refused by a 10 MiB buffer, and raising the buffer changes none of the history limits.

**Measured peaks** (`TestITHIS09MeasuresTheRealPeakOfHistoryProcessing`, Go heap above baseline with a tight GC percentage; the test fails if a stage exceeds a ceiling set above these numbers). They are a regression guard and a measurement, not a bound on process memory, and they were taken on a development machine with in-memory test doubles for the native writer:

| Stage | Short texts (4800 entries) | 9000 tiny messages | 8 records near 900 KiB | Nested wrappers (out of scope) |
| --- | --- | --- | --- | --- |
| inflate | ~0× inflated | 0.4× | 1.7× | 0.5× |
| decode | 30× inflated | 61× | 1.0× | ~120× |
| prepare | 16× inflated | 27× | 3.2× | 7× |
| admit (binding payload + commit) | 0.8× of budget bytes | 0.7× | 2.8× | — |
| snapshot read (`ReadPending`) | 5.0× of budget bytes | 5.1× | 6.0× | — |

Parsed objects, not bytes, dominate: 32 MiB of protobuf is not 32 MiB of RAM. The snapshot read decodes every pending entry on each coordinator pass, so a full 10 MiB buffer costs roughly 50–60 MiB while read; that cost already existed and is now measured. Native peaks (Kotlin/Swift) were not measured.

**Not executed here:** Android/iOS builds, native tests, a device or phone, manual QA, and anything against the real WhatsApp service. Nothing in this section claims compatibility with real history syncs; the shape of real chunks and the limits above still need measuring on devices (the proposal stays open to adjustment, which must be documented here).
