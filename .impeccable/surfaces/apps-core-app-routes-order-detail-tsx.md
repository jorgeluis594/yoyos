---
version: 1
slug: "apps-core-app-routes-order-detail-tsx"
primary_target: "apps/core/app/routes/order-detail.tsx"
related_targets: ["apps/core/src/features/orders/presentation/delivery-form.tsx"]
---

# Delivery on order detail

Operate, web only; inherits compact caramel. Editable orders choose enabled store/home delivery, preserving shared recipient and charge fields. Home requires address/district; instructions are optional. Server-authored historical snapshots and recorder attribution display per method. Controlled delivery/configuration fields wait for client hydration before accepting edits. Cost/charge remain separate; production cost resolution defaults unavailable without a zero-placeholder tariff.

E2E injects only cost capability via fresh server context, exercising real authentication/configuration/persistence. `apps/core/tests/e2e/store-delivery.spec.ts` covers store→home, missing district, unavailable draft retention, cleared pickup, Portuguese reopening, and shipped locks.

Reviewer requested 48px mobile selects; `max-md:min-h-touch` applied. Reviewer scored the select-target fix resolved in both mobile recaptures (ship at that scope). Full core E2E, lint, typecheck and unit checks passed. Visual evidence covers light mode only; dark/uncaptured states remain unapproved.

Captures: `.impeccable/review/home-order-desktop.png`, `.impeccable/review/home-order-mobile.png`, `.impeccable/review/store-order-desktop.png`, `.impeccable/review/store-order-mobile.png`.
