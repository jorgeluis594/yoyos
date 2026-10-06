---
version: 1
slug: "apps-core-app-routes-delivery-settings-tsx"
primary_target: "apps/core/app/routes/delivery-settings.tsx"
related_targets: ["apps/core/app/routes/private-layout.tsx"]
---

# Delivery settings

Operate, web only; preserves incumbent compact caramel. Independent home/store/agency flags and courier rows share a complete versioned save. Version-0 defaults disable all modalities with null pickup. Disabling retains its point; supplied pickup requires complete trimmed name/address, with blank optional instructions normalized to null. Couriers can be added/removed only while unsaved; persisted rows support rename/deactivation and remain present when inactive. Local keys never enter requests; confirmed saves replace them with canonical IDs. Conflicts preserve all rows, flags, and pickup fields until explicit reload. Successful saves reset canonical fields/version. Pending or unhydrated controls are disabled; alert/status feedback and aria-current/Check navigation remain.

The configuration uses three accessible tabs: store, home and agency. Each tab shows its enabled state separately from selection; only the selected panel is visible. Drafts and native validation remain mounted across tabs. Saving reveals the first invalid input's panel before browser focus, and an agency without enabled couriers brings its panel into view. One footer saves all three modalities, identifies unsaved changes, and hides stale success feedback after editing. Scope copy explains the single pickup point, per-order destination and minimum enabled courier.

Validated in Chromium at 1280 and 390px, with agency also inspected in dark mode. New evidence is `.impeccable/review/delivery-tabs-{store,home,agency}-{desktop,mobile}.png` and `.impeccable/review/delivery-tabs-agency-{desktop,mobile}-dark.png`. Existing review captures remain historical references.

Core lint, typecheck, unit tests and the four delivery E2E journeys passed. The settings journey covers keyboard tabs, draft preservation, cross-tab required-field focus, complete saves, courier lifecycle and version conflicts in Spanish and Portuguese.
