---
version: 1
slug: "apps-core-app-routes-order-detail-tsx"
primary_target: "apps/core/app/routes/order-detail.tsx"
related_targets: ["apps/core/src/features/orders/presentation/store-delivery-form.tsx"]
---

# Store delivery on order detail

Operate surface, web only; inherits compact caramel. Editable orders support store assignment/replacement with recipient name/phone, optional identity document, and a customer charge decision. The server records an immutable pickup-point snapshot. Delivery cost and customer charge appear separately; no zero-placeholder tariff is substituted.

Production cost resolution defaults to unavailable. E2E supplies only that capability through fresh server context; real authentication, configuration, and persistence remain exercised.

Reviewer `/root/order_finish_review` disposition: ship for the captured light-mode saved editable replacement state; no material fixes. Uncaptured states and dark mode remain visual limitations.

Evidence: `.impeccable/review/store-order-desktop.png`, `.impeccable/review/store-order-mobile.png`. `apps/core/tests/e2e/store-delivery.spec.ts` and full core E2E passed; final lint, typecheck and unit checks passed.
