---
version: 1
slug: "settings-presentation-delivery-settings-screen-tsx"
primary_target: "apps/mobile/src/features/delivery-settings/presentation/delivery-settings-screen.tsx"
related_targets: []
---

# Native delivery settings

Operate, seller-facing store pickup only; inherits PRODUCT.md’s platform conventions and DESIGN.md’s compact caramel hierarchy. Native Switch, labeled fields, scroll/keyboard accommodation, and safe areas adapt the shared task. Spanish and Brazilian Portuguese are supported.

Initial settings are disabled/null/version 0. Complete pickup values are trimmed; disabling retains the point. Optimistic saves use expectedVersion. Conflicts preserve fields and block saving until explicit reload; successful confirmation replaces fields/version. Tests cover retained points, conflict/language changes, validation, and duplicate submission prevention.

The mobile app’s web tab bar stays in normal flow, wraps its fourth tab, and uses minimum 48-unit controls.

Reviewer: ship at fixes scope; web wrapping, 48-unit targets, and translated error keys resolved. Lint, typecheck, and full mobile tests passed. No native captures: adb devices is empty and Android emulator SDK/Xcode simulator are unavailable. Native visual review and device E2E remain pending; unit tests provide behavioral evidence only.
