---
version: 1
slug: "apps-core-app-routes-delivery-settings-tsx"
primary_target: "apps/core/app/routes/delivery-settings.tsx"
related_targets: ["apps/core/app/routes/private-layout.tsx"]
---

# Delivery settings

Operate surface, web only. Inherits the compact caramel system in DESIGN.md. Sellers configure one store pickup point; initial state is disabled, null point, version 0. Disabling retains the configured point. A supplied point requires complete name/address with trimmed values; optional instructions normalize to null when blank.

Saving uses optimistic version checks. A conflict retains the draft and disables saving until explicit full reload. Successful confirmation resets fields and version to the saved response. Pending controls are disabled; feedback uses alert/status roles.

Navigation exposes the settings entry with aria-current and a visible Check for the active page. Reviewer’s sole fix was applied; final desktop/mobile recaptures confirm the fix; reviewer scored it resolved (ship).

Evidence: `.impeccable/review/delivery-settings-desktop.png`, `.impeccable/review/delivery-settings-mobile.png`; E2E: `apps/core/tests/e2e/delivery-settings.spec.ts`.
