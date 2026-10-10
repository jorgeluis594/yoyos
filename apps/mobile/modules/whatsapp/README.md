# WhatsApp native module

This local Expo module links Go/whatsmeow into Android and iOS and gives Yoyos a durable, confirmable stream of WhatsApp text and image messages received on the phone. Credentials, decryption and reception stay on the phone; the module sends nothing to the Yoyos backend and exposes no way to send a WhatsApp message. The sections below are written per task (WA-01 … WA-13); this first part is the consolidated contract as of WA-14 and the evidence behind it.

> **Status.** Everything described as run was run with Go (`-race`), `go vet`, Jest, TypeScript and ESLint against a controlled transport and in-memory/native test doubles. **Nothing was built or run on Android or iOS, on a simulator, on a phone or against real WhatsApp** (see "Not measured" and "Known limitations" below). No claim of compatibility with real WhatsApp is made.

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

The API deliberately has **no** send, list, queue or upload operation (IT-API-07; `wa14.contract.test.ts` pins the exact method set and the native methods the client may reach). The consumer owns persistence and any upload to core.

Error codes (19, identical in `types.ts`, `client.ts` and the Go bridge test): `MODULE_UNAVAILABLE`, `NOT_INITIALIZED`, `INVALID_INPUT`, `INVALID_NATIVE_RESPONSE`, `NATIVE_CALL_FAILED`, `CONNECTION_FAILED`, `SESSION_EXPIRED`, `SESSION_STORAGE_FAILED`, `SESSION_STORAGE_LIMIT_REACHED`, `SESSION_STATE_INVALID`, `IDENTITY_UNAVAILABLE`, `ACCOUNT_NOT_CONNECTED`, `RECOVERY_BUFFER_FULL`, `HISTORY_LIMIT_REACHED`, `STORAGE_LIMIT_REACHED`, `IMAGE_UNAVAILABLE`, `IMAGE_DOWNLOAD_FAILED`, `IMAGE_DELETE_FAILED`, `REMOTE_LOGOUT_UNCONFIRMED`. `RECOVERY_BUFFER_FULL`, `HISTORY_LIMIT_REACHED` and `IDENTITY_UNAVAILABLE` can also arrive as informational `error` events without ending the connection.

## Configuration

Two global budgets, both per installation: the recovery buffer (`maxRecoveryBufferBytes`, 10 MiB by default) and the private image directory (`maxImageStorageBytes`, 50 MiB by default). Yoyos sets the first with `EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB` (read in `src/composition/whatsapp.ts`; an invalid value fails with `INVALID_WHATSAPP_RECOVERY_BUFFER_MIB`, never a silent default). Go and the native layers never read `.env`. Details, update rules and "reducing a limit never deletes data" are in "WA-11 persisted budgets". Android additionally declares the foreground service (`remoteMessaging`) in the module manifest; iOS needs 16.4 or later. The library never asks for notification permission.

## Rebuild and test

Pinned inputs are listed below. After any change to Go, a patch or a binding: `./scripts/prepare-go-dependencies.sh`, then `./scripts/build-go.sh android|ios|all`, then rebuild the app (Expo Go cannot load the module). Non-native checks, from the repository root:

```sh
sh apps/mobile/modules/whatsapp/scripts/test-go.sh     # go test -race ./..., go vet, patched whatsmeow tests
pnpm --dir apps/mobile typecheck && pnpm --dir apps/mobile lint
pnpm --dir apps/mobile exec jest modules/whatsapp src/composition/whatsapp-options
sh apps/mobile/modules/whatsapp/scripts/trace-evidence.sh --check   # reruns the tests, regenerates the 242-case matrix, fails if TRACEABILITY.md is stale
sh apps/mobile/modules/whatsapp/scripts/measure-go.sh              # Go-side snapshot costs, no -race
```

## Guarantees

- **At-least-once, ordered, confirmable delivery.** A message is acknowledged to WhatsApp only after: protocol and content commit → `messageReceived` → the consumer's own commit → `confirmMessageStored` (durable retirement) → handler success. A crash, a failed callback, a removed consumer or a lost confirmation keeps the entry; it is delivered again after a restart. Delivery is one entry at a time, ordered by revision and ordinal. **Not exactly-once:** the consumer must be idempotent by `message.id` (the controlled journeys use such a consumer).
- **Atomicity.** Session changes and the recoverable content they belong to are committed together or not at all; the native container is published through a synced replacement, and reading never recreates an empty container.
- **Local custody.** Credentials, the Signal session and decrypted content never leave the phone; keys are non-exportable (Android Keystore) or device-only (iOS Keychain); the container and images are private and excluded from backup. The module has no HTTP client, no listening port and no server receiver (checked by source tests).
- **Bounded resources.** Recovery buffer, session, history batch and image directory have explicit byte budgets; exceeding one pauses reception or refuses the item with a public code and never drops pending data. Reducing a budget never deletes data.
- **No sensitive diagnostics.** Public messages are one fixed sentence per code; native errors, panic values and callback failures are mapped to codes at the boundary; Go writes no log; the only native log lines are four `NSLog` calls that print an `errno`/`OSStatus`; the Android notification is a fixed title with no text, extras or actions (IT-SEG-01).
- **Unlink and account change.** `logout()` resolves stored PN/LID mappings first, asks WhatsApp to unlink within 15 s and retires credentials; messages still queued on the server at that moment are not delivered; pending entries of the old account remain confirmable.

## Limits (not promised)

- No reception while the iOS app is suspended and nothing wakes it; on Android reception relies on a foreground service that the OS may still stop (Doze, battery settings and process kill are **not** measured). No boot receiver, alarm or job.
- No guarantee that WhatsApp offers history or offline messages after a reconnect, no complete remote history, no exactly-once delivery, no sending, no media other than still images, no several accounts at once.
- No performance threshold has been agreed; the measurements below are reported, not judged. Nothing here proves interoperability with the real WhatsApp service, which may change its protocol.
- If the app is distributed through Google Play, the foreground-service justification for `remoteMessaging` must be documented first (not done).

## Evidence (WA-14)

**Traceability.** [`TRACEABILITY.md`](TRACEABILITY.md) (and `traceability.json`) cover all **242 cases (68 UT, 174 IT)** with task, file and test, and real status: 113 `pasa`, 101 `parcial`, 21 `no ejecutado-nativo`, 0 `falla`, 7 `no implementado`. They are generated by `scripts/trace-matrix.ts` (run through `scripts/trace-evidence.sh`), which walks the Go, Jest, Kotlin, Swift and shell tests, reads the results of a fresh `go test -json` and `jest --json`, and combines them with the declared links in `trace-links.json` (tests that cover a case without citing its ID, validated against the code; each `gap` states what stays undemonstrated). Assignment in the backlog is not coverage: `pasa` requires a non-native test that ran and passed and no platform requirement; `parcial` a demonstrated part; `no ejecutado-nativo` only Kotlin/Swift tests that cannot run here; `no implementado` no test. The script has its own Jest tests, and `--check` fails if the committed matrix is stale. Links and gaps were drafted by reading each test body against the case text, so they are a reviewable claim, not a proof; a human review of `trace-links.json` is still welcome.

**Controlled journeys** (durable, idempotent consumer; transport and native container are doubles): `go/internal/receive/journey_test.go` (live message, failed confirmation, restart and redelivery with no second effect, late PN/LID identity, deliveries left by an unlinked account) and `wa14.contract.test.ts` "controlled journey" (QR linking, live message, lost confirmation, restart, late identity, image download/delete, logout, new account). Journey map: linking, QR and reconnect → `internal/connection` tests; history batch → `internal/receive/history_*_test.go`; image download → `internal/images` and `bridge/images_test.go`; remote logout → `bridge/logout_test.go`. No single test spans the whole path with the real whatsmeow client.

**Security review (IT-SEG-01/02).** `go/bridge/security_test.go`: every error event is a public code with a fixed message; panics and errors carrying a canary inside storage, connection and delivery callbacks and in image inputs never reach an event, an open result or an image result; calls on nil sessions answer with codes and do not panic; Go sources contain no logging or printing. `wa14.contract.test.ts`: fixed diagnostics for every code, malformed events never echoed, listener failures neither propagate nor log, no QR outside its event; Kotlin/Swift logging and notification content scanned; no network client, upload path, database or listening port in the module.

**Go-side cost (IT-SEG-03).** `MEASUREMENTS.json`: go1.26.5 darwin/arm64, 10 CPUs (Apple M4), no `-race`. Sizes in MiB, times in ms (confirmation in µs: median / p95 / max). The container is an in-memory double, so **only the Go share is measured**. One run per scenario: open and read are single samples, the confirmation figures are over the confirmations of the scenario.

| Scenario | Session | Pending | `ReadState` payload | `ReadState` ms | Go heap peak opening | `ReadPending` ms | Go heap peak reading | Confirmed (twice each) | `RetirePending` µs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| small session, few messages | 0.0 | 0.0 | 0.1 | 0.1 | 1.2 | 0.1 | 0.2 | 20 | 1 / 2 / 6 |
| representative session, typical buffer | 2.0 | 0.6 | 2.6 | 4.0 | 11.3 | 2.6 | 4.2 | 500 | 1 / 53 / 404 |
| session near its 16 MiB allowance, empty buffer | 15.5 | 0.0 | 15.5 | 22.9 | 88.2 | 0.0 | 0.0 | — | — |
| buffer near its 10 MiB default, typical messages | 2.0 | 9.6 | 11.5 | 25.5 | 45.2 | 29.6 | 55.8 | 5000 | 4 / 425 / 12530 |
| buffer near its 10 MiB default, few large entries | 2.0 | 7.3 | 9.3 | 16.9 | 44.2 | 18.7 | 37.3 | 8 | 1 / 35 / 35 |
| both near their limits | 15.5 | 9.6 | 25.1 | 48.2 | 109.8 | 23.6 | 56.2 | 5000 | 4 / 695 / 15629 |

Reading: opening a store at the session limit held about 88 MiB of Go heap above baseline (≈5.7× the 15.5 MiB payload: the raw string, the parsed records and their decoded copies coexist) and, with session and buffer both near their limits, about 110 MiB; reading a near-10-MiB pending list peaks around 56 MiB. A confirmation exchange is a ~100-byte request and a ~60-byte reply that did not grow with the buffer; its tail latency (up to ~16 ms here) comes from the double and the scheduler. These figures say nothing about the device. History processing has its own measured peaks in "WA-08 history by atomic batch" (`TestITHIS09…`).

**Not measured** (no device, SDK or tooling): native encryption, `fsync`, atomic replacement and temporary-file space of `state.bin`/`state.next` (the transient on-disk space of a snapshot), Kotlin/Swift heap and process RSS, any Android/iOS latency, battery, Doze and process-kill behaviour (IT-AND-11), first-unlock access on iOS, and everything against real WhatsApp.

## Known limitations and minors (limitaciones y minors conocidos)

Source: the independent review comments on PRs #34, #35, #36, #45, #47, #48, #49, #51, #52, #53 and #54 (read with `gh api`, as of the WA-14 branch). Blockers and majors were fixed and re-verified in later rounds of each PR and are not repeated; what follows is every finding that ended as a minor, a nit or an observation, with its state **now**: **corregido** (fixed, in the PR's own later round or in WA-14), **aceptado** (the reviewer accepted it as a documented limit; no action planned) or **pendiente** (still open). "WA-14" in a note means the fix is part of this branch.

| PR | Task | Rounds | Final verdict |
| --- | --- | --- | --- |
| #34 | WA-03 stores and guarded receive | 1 | ACEPTADA (2 minors) |
| #35 | WA-05 QR connection | 4 (3 not accepted) | ACEPTADA |
| #36 | WA-04 normalization | 1 | ACEPTADA (1 informational minor) |
| #45 | WA-06 confirmable delivery | 4 (1 not accepted) | ACEPTADA |
| #47 | WA-07 late PN/LID identity | 2 (1 not accepted) | ACEPTADA |
| #48 | WA-08 history | 3 (2 not accepted) | ACEPTADA |
| #49 | WA-09 logout and account change | 3 (2 not accepted) | ACEPTADA |
| #51 | WA-10 private images | 4 (3 not accepted) | ACEPTADA |
| #52 | WA-11 budgets | 2 (1 not accepted) | ACEPTADA |
| #53 | WA-13 iOS resume | 4 (1 not accepted) | ACEPTADA |
| #54 | WA-12 Android service | 4 (2 not accepted) | ACEPTADA |

| PR | ID | Finding | State | Note |
| --- | --- | --- | --- | --- |
| #34 | m1 | The push-name preparation in `dispatchAppState` briefly assigns `cli.Store.PushName` and restores it, so an unsynchronised reader (e.g. `SendPresence`) could see an unconfirmed name; a copy of the `Device` would avoid it. | pendiente | `patches/pre-decrypt-context.patch` still does it; the window is short and the same unsynchronised-write pattern exists upstream. |
| #34 | m2 | The `appStateEventsOnly` guards for mute, archive and WASA secrets (`PutMessageSecrets`) have no recovery-matrix case of their own (only contact, pin, NCT and push name). | pendiente | Correct by inspection; no test added. |
| #35 | m1 | `PairSuccess` is injected in tests and never goes through `handlePairSuccess` (the `SocketID` context in `pair.go` is uncovered). | aceptado | Documented limit in the reviewer's last round. |
| #35 | m2 | If the paired socket closes without a 515, only the 30 s deadline noticed. | corregido | The paired socket's `Disconnected` starts the handover (`whatsmeow.go`). |
| #35 | m3 | `handedOff` used `Load` + `Store(true)` instead of `CompareAndSwap`. | corregido | CAS on the paired path. |
| #35 | m4 | Two simultaneous 515 on the live-socket path could both pass. | corregido | CAS also for the 515 of the paired socket (last round). |
| #35 | m5 | A bounded (5 s) block through lock order: `t.socketID()` is always evaluated, even for the paired 515, while `Client.Disconnect()` waits for the handler queue; evaluating `paired` first avoids it. | pendiente | `whatsmeow.go:177-178`. Bounded, never a deadlock. |
| #35 | m6 | `TestLoginReconnectDrainedAfterPairingSocketCloseStartsHandoff` no longer tests what its name says; it could be renamed. | aceptado | Name kept. |
| #36 | m1 | Direct `go test`/`go vet` in `go/` fails to compile `protocolstore` (needs the whatsmeow patches); the README should say `scripts/test-go.sh` is the only way. | corregido | WA-14: README "Rebuild and test" snippet replaced and a warning added. |
| #45 | m1 | Native I/O under the controller mutex in `ResumeCapacity`/`newTransport`. | corregido | Round 2 (`TestResumeCapacityDoesNotHoldControllerLockWhileBuilding`). |
| #45 | m2 | A read failure in `Receiver.Handle` was not classified as `SESSION_STORAGE_FAILED`. | corregido | Round 2 (`LocalFailure`). |
| #45 | m3 | No test of the real whatsmeow wiring (`decryptMessages`/`dispatchEvent`); `Await` blocks the queue. | aceptado | Mitigated; `receiving_test.go` covers flags and hooks, not a real decryption end to end. |
| #45 | n1 | `TestUTDEL08…` was intermittent. | corregido | Round 3 (500/500 with `-race`). |
| #45 | n2 | `CONSUMER_UNAVAILABLE` left `connect()` raw. | corregido | Translated to `NATIVE_CALL_FAILED`. |
| #45 | n3 | `ConnectionRuntime.emit` read unsynchronised (Swift/Kotlin). | corregido | `emitLock` (Swift) and `@Volatile` (Kotlin); residual in `definition()` fixed in round 4. |
| #45 | n4 | Native coverage is partial: nothing tests `setMessageConsumer`/`removeMessageConsumer`/`confirmMessageStored`, `OnDelivery` without runtime or `OnDestroy`. | pendiente | Needs Gradle/Xcode (**no ejecutado**); IT-API-08 and IT-SUB-06 stay `parcial` in the matrix. |
| #45 | n5 | A stale pause without generation guard: a `Finished` from an old transport can pause the new connection (self-corrects with one extra cycle). | aceptado | No action requested. |
| #45 | n6 | `TestUTSUB07…` intermittent (`Start()` before `SetConsumer`). | corregido | 200/200 afterwards. |
| #45 | o1 | The stop after `OnDestroy` is lazy; reflect it in the README/IT-SUB-06 evidence. | corregido | WA-14: README "WA-06" section. |
| #47 | m1 | A poisoned entry blocked the whole resolution pass. | corregido | Isolated as `Invalid`. |
| #47 | m2 | The local `s.pending` view ignored `PublishPendingIdentities`. | corregido | `TestPublishedIdentityRefreshesLocalPendingView`. |
| #47 | m3 | The ACK only happens on a later redelivery; undocumented. | corregido | Documented in `Receiver.Handle` and the PR; the journey test pins it. |
| #47 | m4 | A test comment promised a failed-commit case it did not test. | corregido | Round 2. |
| #47 | n1 | The 6× worst-case escape factor is applied to the whole plaintext, over-reserving for pending images. | aceptado | Conservative, no data loss. |
| #47 | n2 | `Invalid` entries stay pending indefinitely, occupy budget and are indistinguishable from entries waiting for a mapping (only `IDENTITY_UNAVAILABLE`). | pendiente | `Outcome.Invalid` is not consumed outside `identity`. |
| #47 | n3 | Native size measurement (re-serialised JSON; Android escapes `/`) can differ from `EntrySize` for resolved entries. | aceptado | Pre-existing (WA-03/06). |
| #48 | m1 | The memory estimate is not conservative against allocator size classes: `HeapInuse` ≈172 MiB against the 160 MiB bound (README says 154–158). | pendiente | `history/cost.go` unchanged. Heap *allocated* stays under the bound; process memory is not claimed. |
| #48 | m2 | The process peak exceeds the parser bound (inflated bytes + `compact` + ≈3.2× the budget) and was not measured on a device. | pendiente | Not measured here either (no device). |
| #48 | m3 | No end-to-end test of `whatsmeowHistory.Rollback` restoring the real nonce after `ErrHistoryTooLarge`/`ErrHistoryContent`. | pendiente | Only the "is called" test exists. |
| #48 | m4 | The previous account's capture had no retirement path (deferred to WA-09). | corregido | `Logout` and `history.Processor.Drain` retire it (WA-11 README). |
| #49 | m6 | The README promised redelivery of the offline queue after logout; the server discards it. | corregido | Documented in "WA-09". |
| #49 | m7 | whatsmeow paths before the hook still process and ACK with the unlink client; documentation suffices. | corregido | Documented as a known limit. |
| #49 | m8 | A late `Disconnected` from a cancelled socket can cut the unlink wait short; filtering by current `SocketID` was suggested. | aceptado | Safe outcome (`REMOTE_LOGOUT_UNCONFIRMED`). |
| #49 | n1 | Pre-existing race in `TestUnresolvedIdentityNeverGrantsAck` (writes `n.pending[0]` without the lock). | corregido | WA-14: write under `n.set`. |
| #51 | m10 | `binding_names_test.go` did not cover exported type names. | corregido | Covered since WA-11 (`TestExportedBridgeTypeNamesDoNotCollideWithJavaOrObjectiveC`). |
| #51 | m11 | One goroutine per queued image operation, no cap. | corregido | `images.MaxQueuedOperations` = 64. |
| #52 | n1 | `imageBudget` can be updated out of order by concurrent native `initialize` calls (only without the TypeScript facade, which serialises). | pendiente | `WhatsAppModule.kt` / `.swift` assign without a sequence. |
| #52 | n2 | The README claimed `INVALID_INPUT` always means "refused before anything changed", missing the `catch` branch that stops the runtime. | corregido | WA-14: README wording qualified. |
| #52 | nota | The pending set can exceed the configured budget up to `readBudget` after a larger earlier budget. | aceptado | Bounded and consistent with IT-CFG-07. |
| #53 | m1 | In the `release-after-k` matrix, `release()` did not wait for `Resume` before operation k, so the interleaving depended on the scheduler. | corregido | WA-14: `release()()` waits; the labelled interleaving is the one that runs. |
| #54 | r2 | `onDestroy` read `pendingStarts`, then set `serviceActive`; a `connect()` in between could be lost. | corregido | WA-14: both sides share `serviceFlagLock`. Kotlin **not compiled**; guarded by a source test. |
| #54 | r3 | A `startForeground` failure in `onCreate` is a configuration error, not recoverable. | aceptado | Documented in "WA-12". |
| #54 | s1 | An informational error without a request (`IDENTITY_UNAVAILABLE` after `initialize()` without `connect()`) withdrew the durable intent. | corregido | WA-14: only `CONNECTION_FAILED` settles the request (`ReceiveServicePolicy.endsRequestWithError`); JVM test, source test and a Go test pin the premise. |

**Found while tracing the 242 cases (WA-14), still open:**

| Area | Finding | State |
| --- | --- | --- |
| IT-MSG-07 | `identity.classifyEvent` classifies `ErrInvalidTimestamp` (and invalid identity) as `Excluded`, so such a message is neither kept as recoverable content nor stops its batch; the case asks to stop that normalisation while keeping recovery and not to declare an affected batch complete. No test exercises it end to end. | pendiente (design decision for WA-04/WA-07) |
| IT-PRO-04 | The Go store tests did not check that the error text omits the panic value (only the whatsmeow patch tests did, outside the automatic matrix). | corregido: `protocolstore/diagnostics_test.go` (WA-14) |
| Snapshot memory | Opening a store held ≈5.7× the payload in Go heap (see Evidence). No threshold exists, so nothing fails; the figure matters for devices with little RAM and has not been measured on one. | pendiente (measurement on device) |
| iOS first unlock | Reading `state.bin` before first unlock must fail explicitly instead of recreating an empty container; no test, source or device, covers it (WA-13 note). | pendiente (device) |
| Native suites | Kotlin/Swift/instrumented tests (JVM `ReceiveServicePolicyTest`, `ReceiveIntentInstrumentedTest`, `StateStore*`, `ImageOperations*`, `BackgroundTaskGuardTests`) were written but **not compiled or run** in this task; the matrix lists 21 cases that only have such evidence and marks the rest of the platform-dependent cases `parcial`. | pendiente (native CI) |


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
sh scripts/test-go.sh          # go test -race ./..., go vet and the pinned whatsmeow tests, on a patched copy
./scripts/build-go.sh android  # or ios, all
```

Do not run `go test` or `go vet` directly inside `go/`: since WA-03 the module depends on whatsmeow patches (`patches/*.patch`: `store.WithAppStateRecoveryStage`, `store.WithPrecommittedProtocol`, `store.BufferedEventChild`, `store.ErrLocalStorage`, …), so `protocolstore` does not compile against the unpatched module in Go's cache. `scripts/test-go.sh` applies them to a temporary copy and is the only supported way to run the Go tests (WA-04 review minor, PR #36).

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
- `WhatsAppModule` (both platforms) opens `OpenDelivery`/`Start` from `initialize` even when the session is invalid, passes the delivery session to `OpenConnectionWithDelivery`, and implements `confirmMessageStored`, `setMessageConsumer` and `removeMessageConsumer`. `OnDelivery(json)` forwards `messageReceived` (with its `consumer` token) and throws when the JavaScript runtime is gone, which keeps the entry and stops reception once; `OnDestroy` removes the consumer. Replacing a consumer is one `setMessageConsumer` with the new token; `client.ts` never calls `removeMessageConsumer` first. **Stopping after `OnDestroy` is lazy** (WA-06 observation, PR #45): the consumer is removed at once, but the connection is only stopped by the first message that needs delivery, so with no live traffic it stays up until then; nothing is confirmed, acknowledged or lost meanwhile (IT-SUB-06).
- Source tests: `StateStoreInstrumentedTest` (Android) and `StateStoreTests` (iOS) cover retirement, idempotence, invalid requests and the missing session key.

## WA-08 history by atomic batch

A history sync is announced by an encrypted notification from the account's own phone. Everything is built on the existing buffer: no second queue, no spool.

**Order of one batch** (each step starts after the previous one is durable; the tests record every step where it happens):

1. *Capture.* In the decryption transaction, the notification plaintext is committed with the Signal state that consumed its ciphertext, as a pending entry that nobody delivers (`source: history`, `pendingLid`, no `message`, `messageType: history-notification`; `protocolstore.IsHistoryNotification`). It reuses the pending contract, so native storage needs no new kind. It costs no identity reserve.
2. *Notification ACK.* The handler grants it as soon as the capture is durable (`receive.Handle`); it does not wait for the batch or for the consumer. The capture is now the recoverable source, and the remote batch has not been touched.
3. *Download and inflate*, one batch at a time (`history.Processor`, serialized): input is cut at 16 MiB **while it is received** (`whatsmeow.WithMediaDownloadLimit`, declared sizes only shorten the wait), inline payloads count against the same limit, inflation is cut at 32 MiB **while it is produced**, before any parser.
4. *Decode* (`history.Decode`): counts, record sizes, estimated heap and depth are checked on the wire by walking the schema, without building objects. Fields the admission never reads (status messages, call logs, and everything in a conversation but its ID, messages and privacy token, such as group participants) are neither counted nor parsed.
5. *Prepare* (`history.Prepare`, no writes): the batch's PN→LID mappings are processed first and are what dependent messages are normalized with (`identity.ClassifyWeb`, the same rules as live content). Out-of-scope content is excluded; a supported message that cannot be normalized, an unreadable store or a mapping the store would refuse fails the whole batch. Preparation stops as soon as the entries exceed the recovery budget.
6. *Admission* (`protocolstore.AdmitHistoryBatch`): the protocol changes (`client.StageHistorySync`: mappings, secrets, salt, settings), every pending insert and a batch marker are one native commit or none. If the batch fits the budget only after confirmations it waits (`delivery.Coordinator.AwaitCapacity`) holding no store or writer lock and ending with the connection generation; if it cannot fit beside its own capture entry it is refused as `RECOVERY_BUFFER_FULL` without a retry.
7. *Release.* Only after the commit: the `hist_sync` receipt, then the remote deletion (best effort), then the capture's retirement. A failed receipt keeps the capture; the marker makes the retry skip the admission, so nothing is published twice.

`ManualHistorySyncDownload` and `DisableManualHistorySyncReceipt` only switch the dependency's automatic path off. The patch test `TestManualHistoryFlagsLeaveTheReceiptAndTheDownloadToTheCaller` checks, with controls, that the dependency neither queues the download nor sends the receipt; the order above is what protects the batch.

**Refusals** never stop live reception: the notification was acknowledged once it was durable and the capture is retired, so nothing retries it. They are reported as `error` events: `HISTORY_LIMIT_REACHED` (input, inflated size, depth, counts or a record over its bound), `RECOVERY_BUFFER_FULL` (the batch exceeds the buffer), and `NATIVE_CALL_FAILED` (invalid or permanently unavailable batch). Content that the store refuses while staging the batch's protocol effects (an oversize key, an incomplete secret) or that would exceed the session/binding limits is also a rejection: staging runs on a disposable transaction, so the store is not latched, live reception is not stopped, the capture is released and nothing repeats after a restart. Real storage failures stop the generation as for live messages and leave the capture. While a capture of the current account waits, only its own batch marker is kept past the 14-day retention; every other retry hash ages out normally, so session growth stays bounded. A capture of a previous account has no release path here: it keeps its budget until WA-09 retires it (registered for WA-09). Rejected batches are not recoverable from the server by this version.

**Limits** (`history.DefaultLimits`; internal v1 constants, not WhatsApp limits and not configurable by environment):

| Bound | Value | Why |
| --- | --- | --- |
| Input (downloaded or inline) | 16 MiB | contract |
| Inflated protobuf | 32 MiB | contract |
| Nesting depth | 32 | a text or image message needs 5 levels and each wrapper adds 2, so 32 admits up to 13 wrappers; checked on the wire by walking the schema before the parser runs (real history was not checked) |
| Estimated parser heap | 160 MiB | the bound that actually limits memory (`history/cost.go`): every parsed field is charged the size of its generated Go struct plus its slot (strings and bytes: payload plus a header; packed scalars: 8 bytes per input byte), by walking the schema before `Unmarshal`. Counting elements did not bound memory: an empty `messageAddOns` entry costs 3 bytes on the wire and ~500 bytes of heap. Measured peaks at the bound sit at 154–158 MiB, so the real worst case is about 1× the bound, i.e. ~5× the 32 MiB inflated limit |
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
| admit (limits check, binding payload + commit) | 3.2× of budget bytes | 3.4× | 3.3× | — |
| snapshot read (`ReadPending`) | 5.0× of budget bytes | 5.1× | 6.0× | — |

Parsed objects, not bytes, dominate: 32 MiB of protobuf is not 32 MiB of RAM. The snapshot read decodes every pending entry on each coordinator pass, so a full 10 MiB buffer costs roughly 50–60 MiB while read; that cost already existed and is now measured. Native peaks (Kotlin/Swift) were not measured.

**Not executed here:** Android/iOS builds, native tests, a device or phone, manual QA, and anything against the real WhatsApp service. Nothing in this section claims compatibility with real history syncs; the shape of real chunks and the limits above still need measuring on devices (the proposal stays open to adjustment, which must be documented here).

## WA-09 logout and account change

`ConnectionSession.Logout()` (Go) is the first half of `logout()`; native retirement is the second.

1. `Controller.Logout` invalidates the generation (reception stops, late QR/state events are dropped; `connect`/`disconnect` requested meanwhile wait for it, in admission order) and keeps the socket open only to ask for the unlink.
2. `ResolveIdentities` applies every PN/LID mapping already stored, durably, before credentials go. If that fails, nothing is unlinked or retired and the public storage code is returned.
3. `Client.Logout` is requested with a 15 s deadline (`connection.LogoutTimeout`, injectable clock). The pinned client deletes its device only after the server accepted the request, and the container refuses that deletion with `NativeLogoutRequired`; only that refusal (or a nil error) counts as confirmation. Anything else, including the timeout, is `REMOTE_LOGOUT_UNCONFIRMED`. Credentials are never restored.
4. Native then runs the existing `endSession` (publish `session: null` + `sessionKeysToDelete`, delete the key, retire the marker). `open()` completes an interrupted cleanup and refuses to link until it finishes; `K_recovery` and the active session key are never retired. Pending entries keep their original `accountId` and are recovered/confirmed with no connection, whatever account is active.
5. A finished session refuses `Connect()` (`SESSION_STATE_INVALID`); native opens a new one, with a new `K_session`, after retirement. A repeat on a finished session is a local success that certifies nothing remote. Simultaneous JavaScript calls share one native call; on-device they also serialize on the runtime lock, so a call that arrives after the first finished is that idempotent local success.

### Revocation after a restart (completed with WA-12)

The server revoking the session (`LoggedOut`) publishes `sessionExpired` and blocks `connect()` with `SESSION_EXPIRED` in the same runtime; it never deletes credentials or the key. The container schema still has no revocation field, and WA-12 did not add one: no contract-version change was needed.

What survives a destroyed and recreated process is the *intent*, in `androidService.receiveRequested`. Native withdraws it (durably, on the runtime's background thread, never on Go's) as soon as it sees `sessionExpired` or a local storage fault, exactly like `disconnect()` and `logout()` do. A recreated service therefore reads no intent and stops: it does not reconnect, starts no QR and deletes nothing. If the process died before the withdrawal was saved, the single recreated connection receives `LoggedOut` again, withdraws again and stops: no loop. An explicit `connect()` after the restart also reaches `sessionExpired` with no QR. Credentials leave only through `logout()`. `sessionExpired` is not visible without a connection attempt; the additive `session.revoked` option stays unimplemented. Go-side coverage: `TestWA12RecreatedControllerDoesNotRetryRevokedSession`.

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

### WA-10 second review fixes

- **M3 – ordered admission:** a concurrent native dispatch let `deleteDownloadedImage(X)` reach Go's queue before an earlier `downloadImage(X)`. `images.Service` is now split into `BeginDownload`/`BeginDelete` (validate and take the queue position, never block) and `Pending.Wait` (wait for the turn and run). Native admits from ONE dedicated serial thread/queue in call order and submits the long wait, from that same thread, to a fixed pool of 4 (`ImageOperations`), so waiters start in admission order, a stalled transfer does not delay admitting the next call, and Expo's shared queue is only used for a hop. Proofs: Go `TestM3AdmissionOrderIsFixedByBeginNotByWait` (waiters arriving in reverse order still run download→delete), plus native source tests for FIFO admission (not run). The assumption that Expo dispatches calls to that hop in JS call order (its default queue is serial) was read, not run.
- **m6:** at most `maxWaiters` (4) threads wait for Go's queue, whatever the number of pending calls (`waitersAreBounded` / `testWaitersAreBounded`, not run).
- **m7:** an unreadable foreign entry (directory or file) at startup is skipped and counted in `Stats().Unreadable` instead of failing `initialize`; `Stats().Files` counts regular files only.
- Every operation returned by `Begin*` must be waited for, or the queue stops; native always submits its wait.

### WA-10 third review fixes

- **B2 – reserved binding names:** `ImageOperation.Wait` was generated as Java `wait()`, which clashes with the final `Object.wait()`; the method is now `Outcome` (Kotlin, Swift and the native source tests updated). `bridge/binding_names_test.go` walks every exported method, interface method, package function and struct field of the package and fails on a name that, after gobind lower-cases it, collides with `java.lang.Object` (`wait`, `notify`, `notifyAll`, `getClass`, `hashCode`, `equals`, `toString`, `clone`, `finalize`, and `get/set/is<Field>` accessors), with `NSObject` (`description`, `hash`, `class`, `retain`, `release`, …) or starts an Objective-C ARC family (`init*`, `new*`, `copy*`, `mutableCopy*`, `alloc*`). The only collision in the package was `Wait`; no earlier-task name collided.
- **m9:** `Begin*` starts the operation's goroutine, which runs at its turn; `Wait` only reads the result. Progress no longer depends on the native pool calling `Wait` in order (`TestM9…`).

## WA-11 persisted budgets

Two budgets, both global to the installation (not per session, account or history batch): the recovery buffer (10 MiB by default) and the private image directory (50 MiB by default). Changing account does not multiply them; a larger recovery buffer does not raise the internal history/session limits or recover a remote batch that was refused or expired.

**Configuration (Yoyos composition, not the reusable module).** `src/composition/whatsapp.ts` reads `process.env.EXPO_PUBLIC_WHATSAPP_RECOVERY_BUFFER_MIB` statically (the only form Expo inlines), `whatsapp-options.ts` validates it and `createWhatsAppComposition` hands the module the **effective bytes** (`maxRecoveryBufferBytes`, `maxImageStorageBytes`). Unset means 10 MiB. A value that is defined and is not a canonical positive integer (empty, blank, `0`, negative, fraction, exponent, hexadecimal, padded, leading zero, text) or whose byte count is not a safe integer fails with `INVALID_WHATSAPP_RECOVERY_BUFFER_MIB`: there is no silent fallback and the module is not touched. Go and the native layers never read `.env` or the variable (a test scans their sources); changing it needs a new JavaScript bundle, not a Go rebuild.

**Persist and update.** `options` live in the encrypted container shared by iOS and Android and are published before `initialize` succeeds. After a successful `disconnect()`, `initialize(newOptions)` stops the session if needed, publishes the new `options` in the same revision (session and pending entries untouched) and the next `connect()` uses them; a restart restores the published `options` even without a session (`state.next` never supplies values). Equivalent options are idempotent; different options while a connection, QR, reconnection or buffer-full pause is requested are refused with `INVALID_INPUT`. The JavaScript client treats that refusal as "nothing changed" (the running module stays usable), but any other failure as uncertain: it forgets what it believed, and the next `initialize` reaches native, which rereads the published state (`state.bin`) and compares. Concurrent calls with equal options share one native call; a different change in flight is refused.

**Reducing a limit never deletes data.**

- *Pending entries.* Go admits against the configured budget but **reads** with the container's reliable read bound (`NativeStateStore.recoveryReadBound`, the largest budget ever accepted, persisted as `readBudget` and never reduced). `OpenDelivery(storage, sink, readBound, budget)` and `OpenConnectionWithDelivery(..., readBound, budget)` receive both (before this task the bridge was given the configured budget for both, so a snapshot larger than the reduced budget plus the 16 MiB session allowance could not be decoded and the excess could never drain). The bound is finite: a longer response is still refused. Entries above the new budget are delivered in order, confirmable and retire normally; a new admission gets `RECOVERY_BUFFER_FULL` (temporary, it waits for capacity) until the excess drained far enough for it to fit, and confirmations/option updates publish meanwhile.
- *Images.* `ImageSession.BeginSetLimit` takes a queue position in the image service: the change applies after every operation admitted before it, including the cleanup of a download that was cancelled by `disconnect` or the option change, and `initialize` reports success only after that. Native calls `beginSetLimit` while it holds the runtime lock and awaits `outcome()` **after** releasing it, so neither the writer nor confirmations wait. Complete files above a reduced limit stay readable, reusable without network and deletable; new downloads get `STORAGE_LIMIT_REACHED` before any network until deletions drain the excess.

- *Native admission rule (review M1).* `applyProtocolChanges` (Kotlin and Swift) applies the budget like Go's `Decide`: only publications that **insert** entries must keep the whole pending set within the configured budget. A publication that inserts nothing (identity resolution, protocol-only) is admitted while the set fits the reliable read bound, so `pendingLid` entries above a reduced budget still resolve when their mapping arrives, are delivered and drain; retirement never checked the budget. The Go test double (`native.nativeBudgetAllows`) applies exactly this rule (`TestM1PendingLidAboveAReducedBudgetResolvesDeliversAndDrains` fails with the old rule), and `reducedBudgetRefusesOnlyInsertions` / `testReducedBudgetRefusesOnlyInsertions` state it for the real stores (not run).
- *`initialize` hardening (review m1–m3).* `imageBudget` is updated only after Go confirmed the limit change, so a failed change is retried by the next `initialize`; the pending image operation is taken under the same lock hold that created it (a concurrent `initialize` cannot overwrite or await it); and after native stopped the session or published options, `INVALID_INPUT` is reported as `NATIVE_CALL_FAILED`, so the client treats it as uncertain and rereads instead of keeping the old options. `INVALID_INPUT` therefore means "refused before options were published": the failure path that has already stopped or published something is reported as `NATIVE_CALL_FAILED`. One narrow exception remains documented rather than closed (WA-11 review n2, PR #52): if the pre-publication `catch` branch stops the runtime (`ConnectionRuntime.stop()`) and the store then answers `INVALID_REQUEST`, `publicError` can translate it to `INVALID_INPUT` although the running connection was stopped. The values were validated first, so this needs a native fault; the TypeScript client treats any failure after a stop as uncertain only for codes other than `INVALID_INPUT`, so such a client keeps believing the old options until the next `initialize` rereads native state. `history.Processor.Drain` reuses the purge's read of the ledger for its first search (review m4).

**Previous-account history captures (WA-08 debt, deferred by WA-09).** A history notification is captured as a pending entry nobody delivers, owned by its account. Once that account logs out, its credentials and store are gone and the capture could never be processed, yet it kept holding the recovery budget. Now (1) `ConnectionSession.Logout` retires the captures of the account being unlinked once the logout succeeded or was unconfirmed (never when nothing was retired), and (2) `history.Processor.Drain` retires, before processing, every capture whose account is not the current one (only with a known current account) as the fallback after a crash between unlink and retirement or for a capture left by an earlier session. Matching is by the entry's own account, so accounts are never mixed; real messages of any account are never touched and stay deliverable/confirmable under their original `accountId`. Retirement failure leaves the capture and is retried by the next pass. Residual risk: a capture of the same account being processed by a generation still unwinding when logout runs may see its capture disappear; its batch then fails like any rejected one (the generation is already retired).

**Review minors folded in.** WA-10 m10: `binding_names_test.go` also checks exported *type* names (`Object`, `String`, `Error`, `NS*`, …). WA-10 m11: the image queue is bounded (`images.MaxQueuedOperations` = 64 admitted and unfinished; further downloads/deletes fail with `IMAGE_DOWNLOAD_FAILED`/`IMAGE_DELETE_FAILED` without parking a goroutine; a limit change is never refused). Pre-existing race (WA-07 base, PR #49 comment 6092982162): `recovery_test.go` armed `native.failRead` without the container lock while receive goroutines read it; all failure-injection writes now go through `native.set`.

Native glue (`recoveryReadBound`, the two `Open*` call sites, the deferred image-limit wait in both `initialize`) and the two source tests `recoveryReadBoundSurvivesReductionAndRestart` / `testRecoveryReadBoundSurvivesReductionAndRestart` are written, **not compiled or run** (no Gradle, Xcode, simulator or phone). Nothing here claims behaviour against real WhatsApp servers.

## WA-12 Android receive service

`WhatsAppService` (manifest: not exported, same process, `stopWithTask="false"`, `foregroundServiceType="remoteMessaging"`, permissions `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_REMOTE_MESSAGING`) keeps the single native client alive while no screen is. It owns no client: the process-wide `ConnectionRuntime` does, so Expo's `initialize()` adopts whatever the service restored (same options, no second controller, no new `connect()`).

- **Start:** `connect()` starts the service from the caller's context first, then opens Go and storage. The service publishes the generic notification (channel `whatsapp-connection`, low importance, id 7301, explicit immutable launch intent, no actions, no QR/account/message text) and calls `startForeground` before any heavy work; the typed variant is used from API 34 only. The library never requests `POST_NOTIFICATIONS`; a denied permission does not change the flow.
- **Refusal:** a synchronous refusal returns `CONNECTION_FAILED` before `connect()` accepts anything. A later refusal withdraws the intent, emits `error` then `connectionChanged: disconnected`, keeps session and pending data, and neither loops nor tries another service type.
- **Intent:** `androidService = { receiveRequested, accountId }`. QR linking publishes it in the same revision as the session; `connect()` arms it only for a usable stored session. `disconnect()`, `logout()` (before the unlink attempt), options changes, revocation and local faults withdraw it durably; if saving fails, execution still stops, the storage error is returned and the withdrawal is retried before any later start or restoration. `endSession` clears the whole field.
- **Recreation (`START_STICKY`, null intent):** after promotion, a background worker runs `restoreFromService`: one lock hold reads intent, session account, usability and revocation (`ReceiveServicePolicy.decideRestore`), restores `options` from the container and opens one generation. No intent, no session, another account, an unusable or revoked session stops the service (and withdraws a stale intent). No QR, no `.env`, no JavaScript, no consumer, no confirmation of pending messages; delivery stays paused until Expo sets a consumer. No recreation deadline is promised.
- **Not done on purpose:** no `BOOT_COMPLETED`, alarm or job; nothing saved in `onDestroy()`; removing the task or navigating does not stop the service.
- **Promotion refused in `onCreate`:** a `startForeground` failure there (invalid notification, channel, icon or type) is a configuration error, not recoverable at runtime: the service stops itself, withdraws the intent and keeps the data. AOSP may still report "did not then call startForeground()" for that start. A background-start refusal does not reach this path: `startForegroundService` throws in `connect()` and returns `CONNECTION_FAILED`.
- **Distribution:** if the app ships through Google Play, the foreground-service justification for `remoteMessaging` must be documented before distribution (not done here).

### Checks and status (WA-12)

Run in this task: Go `scripts/test-go.sh` (`go test -race`, `go vet`), `pnpm typecheck`, `pnpm lint` and Jest, including `android-service.source.test.ts`, which only reads the Kotlin and manifest sources. **Written but not executed:** `android/src/test/.../ReceiveServicePolicyTest.kt` (JVM), `android/src/androidTest/.../ReceiveIntentInstrumentedTest.kt`, and the Kotlin changes in `WhatsAppModule.kt`, `WhatsAppService.kt` and `NativeStateStore.kt`, which were **not compiled**. **No ejecutado:** Gradle/Android builds, emulator or phone, notification/permission behavior on real Android versions, Doze, battery settings, network loss and process-kill checks (IT-AND-11), merged-manifest inspection on a built APK, manual QA, anything against real WhatsApp.

## WA-13 iOS suspension and resumption

**What is implemented.** When the app leaves the foreground (`OnAppEntersBackground`) the iOS module calls `ConnectionSession.Suspend()` on a serial lifecycle queue; when it runs again (`OnAppEntersForeground`) it calls `Resume()`. `Controller.Suspend` retires the live generation (socket, backoff timer, QR) and remembers that a connection was requested; nothing is persisted for this, so a process kill ends the request exactly like before. `Controller.Resume` revalidates that request and starts **one** new attempt with fresh 30 s deadlines, `reconnecting` for a paired account and `connecting` for a first link (a QR from before the suspension is never restored; the new attempt offers its own). The transport is built outside the controller lock and kept only if the generation is unchanged afterwards, so a `disconnect()`, `connect()`, `logout()` or close while it is being built discards it without leaving a second client. Repeating either call is a no-op; an explicit `disconnect()` or `connect()` during the suspension replaces the pending resume; a revoked session or an earlier local fault is not retried (`SESSION_EXPIRED` is reported as an `error` event, a local fault was already reported when it happened).

**Late results.** Suspending bumps the generation, so a connection result, QR or network failure from the suspended attempt is dropped, an image download in flight is cancelled (`IMAGE_DOWNLOAD_FAILED`, no file published, partial removed) and one admitted for the old generation cannot run on the new one (`ACCOUNT_NOT_CONNECTED`). Complete image files, pending entries, the stored session and the recovery buffer are not touched by either call; pending entries stay confirmable while suspended. A request paused for recovery capacity stays paused through a suspension: `Resume` does not connect while the buffer is still full; if capacity returned meanwhile, `Resume` starts the deferred attempt, otherwise the usual `ResumeCapacity` does. A `Suspend` that arrives while `Resume` is building its attempt cancels that attempt in Go (no dependence on Swift's serial queue). A failure to build the attempt is published once as a `CONNECTION_FAILED` event; `Resume` returns a code only for a revoked session or an earlier local fault. On iOS the background hook wraps the suspend in `beginBackgroundTask`/`endBackgroundTask` (`BackgroundTaskGuard`, ended exactly once on completion or expiration); if iOS expires it first, the suspend runs when the app next executes, followed by its resume. Source test `BackgroundTaskGuardTests` is **not compiled or run**.

**Protected storage (unchanged from WA-02/WA-10).** `NativeStateStore.protect` marks the state directory and the images directory (where `.part` temporaries are created, inheriting its class) `completeUntilFirstUserAuthentication` and excluded from backup, inside the app's private directory. WA-13 adds no storage path and `Resume` neither rewrites nor recreates state. **Not demonstrated:** that a read before the first unlock after a restart fails explicitly instead of recreating an empty container. The code does not check protected-data availability and no test (source or device) covers it, so the acceptance item on first-unlock access remains open until it is observed on a device.

**Limits (by design, not omissions).** There is **no reception while the app is suspended**: no background mode, background task, push/VoIP/silent notification, `BGTaskScheduler`, location trick or server receiver is added or implied, and nothing here wakes iOS. Messages sent meanwhile are only seen if WhatsApp still offers them after `Resume` reconnects; this task does not promise they will be, nor interoperability with real WhatsApp. The consumer decides when to call `connect()`; the module only restores a request that existed when it was suspended.

**Tests.** Go: `internal/connection/suspend_test.go` (`TestITIOS01…`) and, through the bridge, `TestITIOS01SuspendCancelsAnInFlightDownload…`, `TestITIOS01PendingEntriesSurviveSuspendAndResume`, `TestITIOS01SuspendResumeOnAnUnopenedSession` (`go test -race`, `go vet`). TypeScript: `client.resume.test.ts`. **Not executed:** Swift compilation of the new lifecycle hooks, `xcodebuild`, a simulator or iPhone, observing a real suspension/resumption, the first-unlock behaviour on a device, and anything against WhatsApp. IT-IOS-01 is therefore implemented for the controlled, non-native parts only; its device half (state kept across a real suspend, access after first unlock, recovery on rerun) stays open.
