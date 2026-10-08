# WhatsApp native module (WA-01)

This local Expo module links Go/whatsmeow into Android and iOS. Its current `probe` method is a build diagnostic: it constructs an unconnected whatsmeow client, calls a native callback, and returns the callback value or a sanitized error. Session, QR, message reception, and persistence belong to later WA tasks.

## Pinned inputs

| Input | Version |
| --- | --- |
| Go | 1.26.5 |
| whatsmeow | `v0.0.0-20261006124319-9399289b022b` |
| gomobile and gobind | `golang.org/x/mobile v0.0.0-20260908204917-8b95e45f8d3e` |
| Android SDK / NDK | API 36, build-tools 36.0.0 / NDK 27.1.12297006; minimum API 24 |
| iOS | minimum 16.4; full Xcode and CocoaPods required |
| Expo / React Native | existing `apps/mobile/pnpm-lock.yaml` (Expo 57.0.24 / RN 0.86.3) |

Run an explicit dependency setup before building; the build script uses `GOTOOLCHAIN=local` and `GOPROXY=off` and never installs an SDK or upgrades dependencies:

```sh
cd apps/mobile/modules/whatsapp/go
GOTOOLCHAIN=local go mod download all
GOTOOLCHAIN=local go test ./bridge
GOTOOLCHAIN=local go vet ./bridge
cd ..
./scripts/build-go.sh android  # or ios, all
```

Build Android before Gradle and iOS before CocoaPods. The script removes the requested old artifact before checking prerequisites, patches a copy of the pinned whatsmeow source outside Go's cache, builds in `.generated/`, verifies the Android ABI entries, then publishes generated artifacts. It writes effective tool/source details to ignored `.generated/build-info.txt`. `android/libs/WhatsAppGo.aar`, `ios/Frameworks/WhatsAppGo.xcframework`, and tool binaries are ignored. A failed generation must stop the consuming build.

Android binds `arm64-v8a` and `x86_64` with Java package prefix `expo.modules.whatsapp.go`; iOS binds device arm64 and simulator arm64/amd64 with Objective-C prefix `YYWhatsAppGo`. The module is registered as `WhatsApp` on both platforms. Any Go, patch, or native binding change requires regeneration followed by rebuilding the app. Expo Go cannot load it.

## Validation

`go test` exercises callback values, errors, and invalid input inside Go. `index.test.ts` exercises missing module and boundary responses. The Android instrumented test calls the actual AAR on an emulator; native CI also builds the iOS app and its XCFramework on arm64 and amd64 simulator hosts. Generated bindings and a successful compile alone do not prove callback execution. Physical Android arm64 and iOS device runtime checks remain unexecuted without hardware.
