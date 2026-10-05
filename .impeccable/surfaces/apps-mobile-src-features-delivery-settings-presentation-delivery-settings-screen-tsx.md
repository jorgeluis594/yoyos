---
version: 1
slug: "settings-presentation-delivery-settings-screen-tsx"
primary_target: "apps/mobile/src/features/delivery-settings/presentation/delivery-settings-screen.tsx"
related_targets: []
---

# Native delivery settings

Operate, seller-facing independent home/store enablement; inherits PRODUCT.md’s platform conventions and DESIGN.md’s compact caramel hierarchy. Native Switch sections, labeled pickup fields, scroll/keyboard accommodation, and safe areas adapt the shared task. Spanish and Brazilian Portuguese are supported.

Both methods start disabled, pickup point null, version 0. Complete pickup values are trimmed; disabling retains the point. Complete settings saves use expectedVersion. Conflicts preserve both flags and fields and block saving until explicit reload; successful confirmation replaces fields/version. Tests cover retained points, conflict/language changes, validation, and duplicate submission prevention.

The mobile app’s web tab bar stays in normal flow, wraps its fourth tab, and uses minimum 48-unit controls.

Reviewer `home_settings_review`: ship for native code/accessibility/i18n scope. Lint/typecheck, core unit, mobile Jest, and focused web E2E passed. No native captures: adb devices is empty and Android emulator SDK/Xcode simulator are unavailable. Native visual review and device E2E remain pending; unit tests provide behavioral evidence only.
