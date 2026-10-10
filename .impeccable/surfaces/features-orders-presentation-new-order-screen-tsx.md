---
version: 1
slug: "features-orders-presentation-new-order-screen-tsx"
primary_target: "apps/mobile/src/features/orders/presentation/new-order-screen.tsx"
related_targets: ["apps/mobile/src/features/orders/presentation/order-items-card.tsx","apps/mobile/src/features/orders/presentation/order-payment-card.tsx","apps/mobile/src/features/orders/presentation/translations.ts"]
---

# Nueva venta — revisión en tarjetas y estado de pago

Mode: Operate. Sellers review merchandise, customer, payment and delivery before saving. Preserve Caramelo sobrio, Inter, native navigation, es/pt-BR, existing money/domain operations and pending-attempt recovery.

## Round 2026-10-09
Three HTML-rendered comps (no image generation available): `.impeccable/mocks/new-order-v2/{a-cards,b-flat,c-ticket}.png`, sources in `src/`. User picked **A · Tarjetas agrupadas + hoja inferior** on the decision page. Approved comp: `.impeccable/mocks/new-order-v2/a-cards.png`.

## Direction contract
- Review stage groups Productos, Cliente, Pago, Entrega, Resumen as flat bordered cards (card radius 8, padding 16, no shadow).
- Products card (`order-items-card.tsx`): 44 tile with initial + quantity badge, name semibold, `Atributo: valor`, `qty × unit`, right-aligned tabular line total; inset single separators; footer units · referencial + amount; "Editar" returns to selection.
- Payment card (`order-payment-card.tsx`): status first via two-option radio segment Pendiente | Pagado. Domain has only pending/paid (no partial status); advances remain under Pendiente as "Registrar adelanto".
- Pagado opens a bottom sheet (transparent Modal, overlay radius 12): amount prefilled with remaining total, method chips, receipt slot, Confirmar pago. Paid mode is explicit (`paidPaymentId`), never inferred while typing; an amount below the remaining total is saved as an advance and stays Pendiente. Choosing Pendiente removes the sheet payment.

## Open
- Receipt upload is a disabled placeholder: image upload endpoint exists, but seller/manual payment evidence and the create-order payment contract carry no `receiptImageId`; mobile lacks an image picker.
- No native capture: no emulator/device available. Android/iOS rendering, dark/light, large text and keyboard over the sheet unverified.
- The dock with total from comp A was not built; save stays at the end of Resumen.
