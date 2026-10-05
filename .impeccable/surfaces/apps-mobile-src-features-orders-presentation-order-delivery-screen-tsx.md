---
version: 1
slug: "ures-orders-presentation-order-delivery-screen-tsx"
primary_target: "apps/mobile/src/features/orders/presentation/order-delivery-screen.tsx"
related_targets: ["apps/mobile/src/features/orders/presentation/order-detail-screen.tsx"]
---

# Native store delivery assignment

Operate; inherits compact caramel and native platform conventions. Active pending orders support store assignment/replacement using the currently configured point. Recipient fields prefill from saved recipient or buyer contact but remain editable and distinct from buyer data. Optional identity uses the native option picker; customer charging uses a Switch. The server authors the pickup snapshot and cost, separately from customer charge.

Unavailable production cost resolution preserves the draft. Returning from configuration refreshes settings without replacing recipient edits. Pending submissions prevent duplicates; server race responses lock further changes. Successful save returns to detail, which refetches and hides stale content on error with retry.

Spanish/Portuguese translations and tests cover the flow. Lint, typecheck, and full Jest passed. Reviewer scored both listed code/UX fixes resolved (ship at that scope). No native captures or device E2E: SDK, simulator, and device unavailable. Native visual/E2E acceptance remains pending.
