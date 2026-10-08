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

The Android instrumented storage suite runs through `connectedDebugAndroidTest`; `scripts/check-android-probe.sh` separately kills and restarts the process at each publication phase and induces actual `ENOSPC` before a second-copy write. The Swift storage suite is in the `WhatsAppBridgeTests` package target; the workflow runs its process-kill case separately across eight invocations. These tests require native CI because the local machine lacks Android SDK and full Xcode. Passing a build or generating bindings alone does not prove storage runtime behavior; the WA-02 evidence report lists each assigned case and its native result.
