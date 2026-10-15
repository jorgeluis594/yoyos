---
version: 1
slug: "apps-core-app-routes-delivery-settings-tsx"
primary_target: "apps/core/app/routes/delivery-settings.tsx"
related_targets: ["apps/core/app/routes/private-layout.tsx"]
---

# Delivery settings

Operate, web only; preserves incumbent compact caramel. Independent home/store/agency flags and courier rows share a complete versioned save. Version-0 defaults disable all modalities with null pickup. Disabling retains its point; supplied pickup requires complete trimmed name/address, with blank optional instructions normalized to null. Couriers can be added/removed only while unsaved; persisted rows support rename/deactivation and remain present when inactive. Local keys never enter requests; confirmed saves replace them with canonical IDs. Conflicts preserve all rows, flags, and pickup fields until explicit reload. Successful saves reset canonical fields/version. Pending or unhydrated controls are disabled; alert/status feedback and aria-current/Check navigation remain.

The configuration follows the Shopify/Tiendanube settings pattern: one card lists store, home and agency as stacked rows, each with an icon, title, one-line description and a switch. A row reveals its settings only while offered: pickup fields for store, courier list and catalog for agency. A disabled store with a saved point shows a "kept" summary; incomplete pickup data stays visible so validation can focus it. One shared line links to the zones card when home or agency is on. The save button sits directly below the methods card it saves, before the separately saved "Zonas y tarifas de envío" card (`#delivery-zones`), and flags unsaved changes inline.

Validated in Chromium at 1280 and 390px, light and dark, via `.impeccable/review/delivery-methods-{store,home,agency}-{desktop,mobile}.png` and `delivery-methods-agency-{desktop,mobile}-dark.png`.

Core lint, typecheck, unit tests and the four delivery E2E journeys passed. The settings journey covers collapsed rows, draft preservation, required-field focus, complete saves, courier lifecycle and version conflicts in Spanish and Portuguese.
