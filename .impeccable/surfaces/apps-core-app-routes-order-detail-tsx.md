---
version: 1
slug: "apps-core-app-routes-order-detail-tsx"
primary_target: "apps/core/app/routes/order-detail.tsx"
related_targets: ["apps/core/src/features/orders/presentation/delivery-form.tsx"]
---

# Delivery on order detail

Operate, web only; inherits compact caramel. Editable orders choose enabled store/home/agency delivery, preserving shared recipient/identity/charge fields and per-method drafts. Agency-only configuration defaults to agency. Home requires address/district; instructions are optional. Agency offers only active couriers, requires destination text (max500) and national_id/passport/foreign_id plus document; document strings preserve leading zeros. Server-authored historical courier/destination snapshots and recorder attribution remain immutable. Stale courier deactivation recovers through real action revalidation without overwriting the prior snapshot. Assignment is restricted to pending, noncancelled, incomplete orders. Historical recipient text wraps long unbroken values without new length restrictions. Controlled delivery/configuration fields wait for client hydration before accepting edits. Cost/charge remain separate; production cost resolution defaults unavailable without a zero-placeholder tariff.

Store/home/agency assignment E2E injects only cost capability via fresh server context, exercising real authentication/configuration/persistence. `apps/core/tests/e2e/store-delivery.spec.ts` covers store→home, missing district, unavailable draft retention, cleared pickup, Portuguese reopening, and shipped locks.

Reviewer requested 48px mobile selects; `max-md:min-h-touch` applied. Reviewer scored the select-target fix resolved in both mobile recaptures (ship at that scope). Core lint/typecheck/unit passed; full Chromium E2E passed (20 tests) before final wrapping/duplicate-hint cleanup. Focused `apps/core/tests/e2e/agency-delivery.spec.ts` passed afterward, including long-text overflow and repeated stock deduction once. Detector ran once on both sources with no findings. Reviewer `agency_order_web_review`: ship, no material fixes; actual scope light mode 1280/390, with document-top/fullpage agency captures inspected. Dark/uncaptured states remain unapproved. Native agency UI was not implemented in this unit.

Captures: `.impeccable/review/agency-order-desktop.png`, `.impeccable/review/agency-order-mobile.png`, `.impeccable/review/home-order-desktop.png`, `.impeccable/review/home-order-mobile.png`, `.impeccable/review/store-order-desktop.png`, `.impeccable/review/store-order-mobile.png`.

Editable pending orders without a delivery snapshot show “Entrega por definir” / “Entrega a definir”; completed null-snapshot orders do not. `apps/core/tests/e2e/delivery-without-tariffs.spec.ts` starts real `src/server.ts` on port4174 with normal composition and no injected resolver. Authenticated UI configuration save/reload followed by rejected assignment preserves null delivery, total10, stock3, and the label after reopening—no fictional cost. Focused E2E and core lint/typecheck/unit passed.

Reviewer `undefined_delivery_web_review`: SHIP, no fixes, captured light-mode 1280/390 scope only. Root inspected document-top/fullpage `.impeccable/review/undefined-delivery-desktop.png` and `.impeccable/review/undefined-delivery-mobile.png`. Detector ran once on the route with no findings. Portuguese is source-only evidence; dark/uncaptured states remain unapproved.
