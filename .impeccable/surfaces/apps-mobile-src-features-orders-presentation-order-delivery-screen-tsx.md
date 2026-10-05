---
version: 1
slug: "ures-orders-presentation-order-delivery-screen-tsx"
primary_target: "apps/mobile/src/features/orders/presentation/order-delivery-screen.tsx"
related_targets: ["apps/mobile/src/features/orders/presentation/order-detail-screen.tsx"]
---

# Native delivery assignment

Operate; inherits compact caramel and native conventions. Active pending orders choose enabled home/store/agency methods; agency-only settings default to agency. Home requires address/district, with optional instructions. Shared recipient/identity/charge and per-method drafts persist across choices, distinct from buyer data. Agency offers active couriers only; an inactive historical ID stays unselected without automatic replacement. Agency destination is required (max500), along with national_id/passport/foreign_id and a document preserving leading zeros. Identity remains optional for home/store. Server-authored destination snapshots and cost display separately from customer charge on detail.

Unavailable cost preserves drafts. Focus refresh updates settings while preserving home/recipient edits; disabled methods cannot save. Pending submissions prevent duplicates; server race responses lock changes. COURIER_UNAVAILABLE refreshes options without erasing drafts or navigating. Historical courier/agency snapshots remain visible on detail; shipped orders expose no editor. Successful save returns to refetched detail, hiding stale content on error with retry.

Spanish/Portuguese and tests cover behavior. Full mobile Jest passed after source changes; focused screen tests passed after the extra draft test. Typecheck passed; lint had zero errors and three baseline warnings. Reviewer `agency_order_native_review`: RECAPTURE; no native code/visual/E2E approval. Native detector skipped. OS phone light/dark, enlarged-text, keyboard/recovery, and tablet evidence if shipped is missing; SDK/simulator/device unavailable. Native visual/device E2E acceptance remains pending.
