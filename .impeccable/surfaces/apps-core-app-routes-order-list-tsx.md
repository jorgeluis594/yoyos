---
version: 1
slug: "apps-core-app-routes-order-list-tsx"
primary_target: "apps/core/app/routes/order-list.tsx"
related_targets: ["apps/core/app/components/ui/data-table.tsx", "apps/core/app/components/ui/filter-bar.tsx"]
---

# Order list

Shopify informs the scan hierarchy; Yoyos retains its existing caramel design system, components and responsive table reflow. The default Todos view opens all orders. Por cobrar and Por entregar support the seller's primary work; search by buyer name, phone or order number and customer/creation-date filters retrieve past sales without introducing period revenue metrics.

Columns are Cliente, Fecha, Unidades and Total. Customer groups identity, order number and phone with two interactive status icons for active orders. Coins represent payment; a truck represents delivery. A clock signals pending, an arrow shipped and a check resolved. Green means paid/delivered, warning means pending and information blue means shipped. Native details reveal the translated state or exact remaining balance on click, touch or keyboard; titles provide hover text. Completed and cancelled keep their terminal text with no operational icons. Units sum quantities, numbers align right and dates use Lima time.

Existing DataTable mobile roles reflow the same data into labeled rows. State badges retain compact intrinsic widths. Desktop cells align at the top and all payment badges share the same column edge. Mobile labels align with the first line of stacked values; indicators remain within customer metadata with touch-sized targets. Paid and delivered states use the existing success green; pending uses warning and shipped uses information blue. Evidence: apps/core/test-results/order-list-{desktop,intermediate,mobile}-{light,dark}.png and order-list-desktop-pt.png. Browser coverage includes partial payment, shipping, terminal/historical orders, work views, combined search/date filters and empty results.
