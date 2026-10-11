# Brother Print SDK for Android

This local Expo module uses Brother Print SDK for Android 4.13.2. `android/libs/BrotherPrintLibrary.aar` (from the SDK archive's `libs/`) and the SDK's `EULA.pdf` are committed to this repository so builds do not need to download the SDK again. They were downloaded after accepting Brother's EULA (https://support.brother.com/g/s/es/dev/en/mobilesdk/download/index.html). To update the SDK, accept the EULA again, download the new archive and replace both files.

The Android build requires this AAR. The module discovers and prints only with QL-810W over Wi-Fi using DK-1209 (62 × 29 mm) labels.

Brother's EULA section 2(c) conditions redistribution of its redistributable module on a commercial license. Confirm licensing and the required end-user terms before distributing an app that includes the AAR.
