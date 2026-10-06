---
version: 1
slug: "apps-core-app-routes-order-list-tsx"
primary_target: "apps/core/app/routes/order-list.tsx"
related_targets: ["apps/core/app/components/ui/data-table.tsx", "apps/core/app/components/ui/filter-bar.tsx"]
---

# Order list

Shopify informs the scan hierarchy; Yoyos retains its existing caramel design system, components and responsive table reflow. The default Todos view opens all orders. Por cobrar and Por entregar support the seller's primary work; search by buyer name, phone or order number and customer/creation-date filters retrieve past sales without introducing period revenue metrics.

Columns are Cliente, Fecha, Unidades, Total, Pago and Entrega. Customer groups identity, order number and phone. Units sum quantities rather than distinct product lines. Payment and delivery remain independent for active orders; pending payment includes the exact remaining balance. Completed and cancelled orders display their terminal state beside customer identity and no pending payment/delivery cues. Numbers align right and dates use Lima time.

Existing DataTable mobile roles reflow the same data into labeled rows. State badges retain compact intrinsic widths. Desktop cells align at the top and all payment badges share the same column edge. Mobile labels align with the first line of stacked values; payment badges and balances share the same right edge as delivery. Paid and delivered states use the existing success green; pending uses warning and shipped uses information blue. Evidence: apps/core/test-results/order-list-{desktop,intermediate,mobile}-{light,dark}.png and order-list-desktop-pt.png. Browser coverage includes partial payment, shipping, terminal/historical orders, work views, combined search/date filters and empty results.
