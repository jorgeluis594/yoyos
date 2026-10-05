---
version: 1
slug: "settings-presentation-delivery-settings-screen-tsx"
primary_target: "apps/mobile/src/features/delivery-settings/presentation/delivery-settings-screen.tsx"
related_targets: []
---

# Native delivery settings

Operate; preserves compact caramel and native conventions. Spanish/Portuguese labeled fields/Switches independently enable home/store/agency. Scroll, keyboard, safe areas, max640 form width, and minimum 48-unit controls accommodate native use. Version-0 defaults disable all modalities with null pickup; disabling retains its point. Complete pickup name/address are trimmed; blank optional instructions normalize to null. Courier rows support unsaved add/remove, persisted rename/deactivation, and retained inactive rows. Local keys are excluded from requests; confirmed saves restore canonical IDs. Complete versioned saves preserve every row, flag, and pickup field on conflict until explicit reload; success resets canonical fields/version. Mobile web tabs remain in normal flow and wrap the fourth tab.

Core/mobile lint/typecheck, focused web E2E, and focused settings Jest passed after required-marker label queries were corrected. Full suite previously passed 198 tests with two query failures; corrected focused results do not establish a full rerun.

Reviewer `agency_settings_native_review`: recapture. Code/fidelity review stopped at missing iOS/Android phone evidence; no code approval. No device/simulator: adb only, no Android SDK; Xcode CommandLineTools only. Native light/dark, enlarged-text, keyboard captures and device E2E remain pending. Browser captures cannot substitute. Pending evidence is accepted until prepared, not full acceptance.
