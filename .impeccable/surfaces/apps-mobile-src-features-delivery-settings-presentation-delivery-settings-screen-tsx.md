---
version: 1
slug: "settings-presentation-delivery-settings-screen-tsx"
primary_target: "apps/mobile/src/features/delivery-settings/presentation/delivery-settings-screen.tsx"
related_targets: []
---

# Native delivery settings

Operate; preserves compact caramel and native conventions. Spanish/Portuguese labeled fields/Switches independently enable home/store/agency. Scroll, keyboard, safe areas, max640 form width, and minimum 48-unit controls accommodate native use. Version-0 defaults disable all modalities with null pickup; disabling retains its point. Complete pickup name/address are trimmed; blank optional instructions normalize to null. Courier rows support unsaved add/remove, persisted rename/deactivation, and retained inactive rows. Local keys are excluded from requests; confirmed saves restore canonical IDs. Complete versioned saves preserve every row, flag, and pickup field on conflict until explicit reload; success resets canonical fields/version. Mobile web tabs remain in normal flow and wrap the fourth tab.

Final configured core/mobile lint, typecheck, and complete unit suites passed on 2026-10-06. Mobile lint retains three baseline warnings and zero errors. Complete integration/browser suites passed at 1289627; later changes are documentation/captures.

Final reviewer `/root/native_delivery_finish`: ship only for reviewed Android phone interfaces/journeys on Samsung A56 in Expo Go, without material UI fixes or new visual direction. Earlier recapture is superseded within this scope. Actual light/dark, text scale1.3, keyboard, scrolled regions, selectors, and recovery evidence is sufficient without a Cartesian matrix. Evidence: `.impeccable/review/android-settings-light.png`, `android-store-settings-dark.png`, `android-settings-large-text.png`, `android-settings-keyboard-dark.png`, plus current recaptures b1e6e08/c263bfe and original `android-*.png` captures.

User explicitly deferred iOS: “no es necesario probar en IOs por ahra”. iOS, tablet, and distributed runtime stability are outside approval. One NativeRNScreens incident remains open; six tab changes and three background cycles did not reproduce it. No runtime fix or resolution is claimed.
