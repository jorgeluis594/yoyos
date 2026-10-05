---
version: 1
slug: "ures-orders-presentation-order-delivery-screen-tsx"
primary_target: "apps/mobile/src/features/orders/presentation/order-delivery-screen.tsx"
related_targets: ["apps/mobile/src/features/orders/presentation/order-detail-screen.tsx"]
---

# Native delivery assignment

Operate; inherits compact caramel and native conventions. Active pending orders choose enabled home/store methods. Home requires address/district, with optional instructions. Editable recipient, optional native-picker identity, and charge decision persist across choices, distinct from buyer data. Server-authored destination snapshots and cost display separately from customer charge on detail.

Unavailable cost preserves drafts. Focus refresh updates settings while preserving home/recipient edits; disabled methods cannot save. Pending submissions prevent duplicates; server race responses lock changes. Successful save returns to refetched detail, hiding stale content on error with retry.

Spanish/Portuguese and native home tests cover behavior; full Jest, lint and typecheck passed. Code/accessibility/i18n review complete with no material fixes; disposition is recapture because no native captures were supplied. SDK/simulator/device unavailable. Native visual review and device E2E remain explicitly pending; full acceptance is unverified.
