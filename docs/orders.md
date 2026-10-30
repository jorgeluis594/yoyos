# Orders

An order records what a buyer takes from a company: items, payments, delivery and fulfillment. The technical concept is `Order` in core, shared and mobile; "Ventas" is only the interface label.

Sources of truth:

- Domain and lifecycle: `apps/core/src/features/orders/domain/order.ts` and `order-state-machine.ts`.
- JSON contracts: `shared/contracts/orders.ts`.
- HTTP adapter: `apps/core/src/features/orders/presentation/api-routes.ts`.
- Persistence: `apps/core/prisma/schema.prisma` (`Order`, `OrderItem`, `Payment`, `OrderBuyer`, `OrderMessage`, `ChatMessageOutcome`).

## Origin

Each order has one source, derived from stored data:

| Source | Origin |
| --- | --- |
| `manual` | Created by a seller in core web or mobile. |
| `whatsapp` | Created from an incoming chat message, whose later messages may add, remove or change its items while it is open; see [message-to-order](message-to-order.md). |
| `catalog` | Created by a buyer from the public catalog; it has no seller until the seller takes it. |

Every other order requires a seller, taken from the authenticated session.

## Identity and number

- The client generates the order UUID and keeps it across every attempt of one creation. Reason: a retry after an uncertain response must not create a second order.
- The database guarantees UUID uniqueness. A repeated ID returns `ORDER_ALREADY_EXISTS` and changes nothing (no second payment or stock deduction). An existing order is never returned as a new success. No separate idempotency key exists.
- Each company numbers its orders sequentially starting at 1001 (`Company.nextOrderNumber`); the number is what sellers and buyers see.

## Amounts and historical data

- Core reads current catalog prices and computes every subtotal and total with `shared/money.ts`. Amounts sent or shown by a client are never persisted. Reason: the catalog is the only price authority.
- No expected price is sent for items and there is no `PRICE_CHANGED` error: if the catalog changed while the cart was built, the stored total can differ from the one shown. The client shows the amounts core returns.
- An order uses one currency; mixing currencies returns `CURRENCY_MISMATCH`. Amounts that exceed the storage range are rejected, never truncated.
- Items copy product name, the variant's combination (option names and values, in the option order of that moment), SKU and unit price at creation. Later catalog edits do not change them, and deleting a product does not cascade to orders that reference it.
- The copied combination is stored as a JSON object whose keys are inserted in option order, and readers show it in that order. Reason: orders, checkout, sale catalog and catalog cart keep one record shape (rejected: an explicit list of name and value pairs). Accepted cost: an option whose name is made only of digits («2024») is listed first, because JSON objects put integer-like keys before the others.
- Items of a variant deactivated later keep working: the order is shown, paid with stock deduction and cancelled with stock restoration, which do not filter by variant status. New orders cannot include it ([Products](products.md)).
- Core resolves all the variants of an order in one batched lookup and inserts the items in variant order. Reason: a product save that changes combinations locks variants in the same order, so the two cannot deadlock. A variant deleted between that lookup and the insert fails the order item's foreign key and answers `VARIANT_NOT_FOUND` with its `variantId`; message-to-order treats it as a retryable failure instead, because its next scan no longer finds the variant.
- Each variant appears once per order, with its total quantity.
- An order always has at least one item. Chat messages can add items, remove an item, set its quantity or replace its variant (merging into the same variant if present), each recalculating subtotals and totals; removing the only item is refused. No route edits the items of an existing order from web or mobile.
- `total = itemsTotal + deliveryCharge`.

## Mentioned price

An item may keep the price the buyer mentioned in a chat (`mentionedPrice: { amount, units } | null` in `shared/contracts/orders.ts`; columns `mentionedPriceAmount` and `mentionedPriceUnits` on `OrderItem`, both or none, amount positive, units 1 to 99). The currency is the order's. It never changes the unit price, subtotal or total; its rules, including how a price for several units is read as per unit or for the lot, are in [message-to-order](message-to-order.md#rules).

- Order detail on web and mobile shows «El cliente mencionó S/ 30.00 por unidad», or «… S/ 50.00 por 3» when the buyer priced several units together, under the unit price and in the same money format, only when the mentioned amount differs from the unit price times its units. Web shows it in the item's row under the variant and price line; mobile in the item card under the price and in the item's accessibility label. The order list and the buyer's checkout never show it.
- Reason it differs from the price comparison declined for manual sales: that compared the price shown to the seller with the stored one; this note records what the buyer said, which the seller may have to settle in the chat.

## Lifecycle

An order has three independent dimensions plus a derived status:

| Dimension | Values | Rule |
| --- | --- | --- |
| Payment | `pending`, `paid` | `paid` when confirmed payments cover the total. Reported (buyer) payments do not count until confirmed. |
| Stock | `stockDeducted` | Stock is deducted at most once per order. |
| Delivery | `pending`, `shipped`, `delivered` | Shipping or delivering requires a covered payment and deducted stock. |
| Status | `active`, `cancelled`, `completed` | `completed` when delivered and paid; otherwise `active` unless cancelled. |

- An order is created `active`, unpaid, undelivered, without deducted stock and without reserving stock. Reason: creating an order is a record of intent; stock moves only when it is paid.
- Registering a payment deducts stock when payments cover the total, or when the seller asks for it on a partial payment (`deductStockIfPartial`; see [Payments](#payments) for when clients offer it). Deduction is conditional on available units and all variants are processed in a stable order inside the payment transaction; a shortage returns `INSUFFICIENT_STOCK` and rolls everything back.
- Voiding a confirmed payment can return the order from `completed` to `active`.
- Delivery details (home, agency or store pickup) can change only while delivery is `pending`; afterwards they return `DELIVERY_LOCKED`.
- A dispatch date can be scheduled only while delivery is `pending`.
- Cancelling is allowed only while delivery is `pending`. Cancelling publishes `order_cancelled`, whose handler restores deducted stock.
- Payment is recorded in Yoyos; no external charge is processed. Because orders never reserve stock, a sale can be rejected for stock after the seller already received money outside the app; the database transaction cannot undo that.

## Payments

A payment is either a buyer report («Ya pagué» with a receipt, from the [checkout](checkout.md#payment)) or a payment recorded by the seller. Each one is a variant of `Payment` stored in the same row; the variant data and its transitions live in `orders/domain/payment.ts`.

| State | Meaning | Reached by | Counts toward the balance |
| --- | --- | --- | --- |
| `reported` | The buyer says they paid; carries only a receipt | Buyer report | No |
| `confirmed` | Verified by the seller, with amount and method | Approving a report, or a manual payment | Yes |
| `rejected` | The seller did not accept the receipt | Rejecting a report | No |
| `voided` | A confirmed payment recorded by mistake | Voiding | No |

Transitions: `reported → confirmed`, `reported → rejected`, `confirmed → voided`. `rejected` and `voided` are final; existing records keep their state.

- **Who sets the amount:** the buyer does not declare amount or method. Approving turns the report into a confirmed payment with the same receipt and the amount and method the seller typed. Reason: only the seller knows what arrived.
- **Approve** applies the stock rule of [Lifecycle](#lifecycle); `INSUFFICIENT_STOCK` records nothing and the report stays pending.
- **Reject** applies only to a pending report. It keeps the receipt, report date, who rejected it, when, and an optional reason (trimmed, empty means none, at most 200 characters) that the buyer sees. It changes neither the received amount, the balance, stock nor completion. Reason: a wrong receipt must not stay pending forever nor block the buyer. Rejected is final: a mistaken rejection is solved by the buyer sending the receipt again, which creates a new report; the rejected one stays in the history.
- **Repeated decisions:** repeating the same decision on the same payment returns the first result and writes nothing. Approving again with the same amount and method returns that confirmation, even with a different `deductStockIfPartial`; rejecting again returns the original rejection and reason, whatever reason the retry carries; a buyer report resent with the id and receipt of a rejected payment returns the rejection. A different decision is refused: approving a rejected payment, rejecting a confirmed or voided one, or approving with another amount or method answers `409 PAYMENT_CONFLICT`; voiding a rejected or reported payment answers `409 INVALID_TRANSITION`. Clients show both codes as «Este pago ya fue revisado.» and reload. Reason: a retry after an uncertain response must never create a second payment or overwrite a decision.
- **Concurrency:** approve, reject and void lock the order row and update the payment only if its stored status is still the expected one, so decisions from two tabs or web and mobile are serialized.
- **Cancelled order:** reports cannot be approved or rejected (`409 ORDER_CANCELLED`) and no manual payment is recorded; a pending report stays visible, read-only.
- **Several reports:** each report is decided on its own. The checkout lets the buyer have one pending report at a time, as a display rule; core does not refuse a second report.
- **Partial stock choice:** clients offer «Descontar stock aunque sea abono parcial» only when stock is not yet deducted and the typed amount is below the pending balance (`offersPartialStockDeduction` in `shared/orders-payment.ts`, used by web and mobile); a hidden box sends `deductStockIfPartial: false`. Reason: when the amount covers the balance stock is deducted anyway, so the box only adds noise. It compares with the balance, not the total, so earlier payments count.
- Only the seller of the order's company can approve, reject, record or void; an order of another company answers as missing.

### Web «Pagos» card

- Three cells: Total (with «Incluye entrega» when there is a delivery charge), Recibido and Pendiente, which adds «Pago por revisar» while a report is pending and the order is not cancelled. The overpayment notice stays.
- «Historial de pagos», newest first, one row per payment. Reported: receipt thumbnail, «Pago reportado, pendiente de revisión», report date, «Ver captura», **Rechazar** and **Aprobar**, with no amount or method because the buyer does not declare them. Confirmed: amount and method, «Pago confirmado», «Ver captura» when it came from a report, **Anular pago**. Rejected: «Pago rechazado», date, reason and «Ver captura», no actions. Voided: «Pago anulado», no actions.
- The manual payment is a separate secondary action at the end, «¿Te pagaron por fuera? Registrar pago», shown only while the order is not cancelled and Pendiente is above zero; it opens its own form. A report can still be approved with a zero balance. Reason: one form per decision, so the seller never confuses a report with a manual payment.
- **Aprobar** from the row opens a short dialog with «Importe recibido» prefilled with the balance, «Medio de pago» and the partial stock box under the rule above. **Rechazar** asks «¿Rechazar este comprobante?» with «Motivo (opcional, lo verá el comprador)».
- The thumbnail and «Ver captura» open «Comprobante de pago», a dialog with the receipt fitted to the screen instead of a new tab. For a pending report it shows the pending balance, **Rechazar** and **Aprobar**; each turns the dialog's decision area into its form while the receipt stays visible (on a phone, a reduced copy stays fixed above the fields). Errors show inside the dialog; after a decision it closes, «Pago actualizado.» shows in the card and focus goes to the decided row. If the receipt cannot load, the dialog says «No se pudo cargar la captura.» with **Reintentar**. Closing without deciding records nothing. Reason: the seller decides with the evidence in view and without losing the order.
- In a cancelled order the rows are read-only and «Pago por revisar» is not shown; **Anular pago** stays available on the web.
- Thumbnails, «Ver captura» and the row actions have accessible names that include the row's date and time, so several rows never share a name.

### Mobile

- The order detail keeps its layout: «Registrar pago», «Ver pagos», and **Revisar comprobante** on each report, which opens the review sheet; the receipt opens outside the app.
- The review sheet approves with «Confirmar pago» and adds **Rechazar** with the same optional reason, inside the same sheet. The partial stock box follows the same rule in the review and register sheets.
- Rejected payments show «Pago rechazado» with date, reason and «Ver captura», never as confirmed. The summary shows «Pago por revisar» under «Saldo pendiente» while a report is pending and the order is not cancelled.
- Voiding is not offered in a cancelled order on mobile, unlike the web.

## Creating an order

`POST /api/orders` is the single creation endpoint. The client sends only its own data: the order UUID, `variantId` and positive integer `quantity` per item (at least one, no repeated variants), and optionally:

- `payments`: each with a client-generated `paymentId`, amount, method (`digital_wallet` or `bank_transfer`) and `deductStockIfPartial`.
- `delivery`: a rated delivery selection plus the `expectedPrice` the seller reviewed.
- `deliverImmediately`: confirms a hand-over delivery at creation.
- `scheduledDispatchDate`.

Company, seller, prices, totals, statuses and dates come from core; extra fields are rejected. Creation, delivery, payments, stock deduction and delivery confirmation run in one transaction: all succeed or none persist. Reason: a half-created sale (for example, paid but without stock deducted) would leave inventory and cash out of sync. The use case is `createCompleteOrder` (`application/create-complete-order.ts`); it reuses the public order operations inside the same transaction instead of a separate implementation.

The endpoint also accepts the fixed body `payment: { method: "digital_wallet" }` with `delivery: { method: "handover" }`, which registers an immediate sale paid in full and delivered by hand (`registerImmediateSale`). `POST /api/orders/pending` and `POST /api/orders/immediate-sale` remain for clients that still call them.

Every order, from any source, is created with its buyer checkout enabled, so its link exists from the start ([Checkout · Link and access](checkout.md#link-and-access)).

Every successful creation returns `201` with `orderAggregateSchema`.

### Errors

Errors use the envelope `{ code, error, issues? }`; `issues` points to the affected item by `index` or `variantId` when core knows it. Clients pick visible messages by `code`, never by the `error` text.

| Situation | HTTP and code |
| --- | --- |
| Malformed body, query or ID | `400 INVALID_INPUT` |
| Body is not JSON / larger than 100 kB | `415 UNSUPPORTED_MEDIA_TYPE` / `413 PAYLOAD_TOO_LARGE` |
| Business rule broken / mixed currencies | `422 INVALID_ORDER` / `422 CURRENCY_MISMATCH` |
| Variant not available in the company, or deactivated (see [Products](products.md)) | `404 VARIANT_NOT_FOUND` with `variantId`; clients mark the item «ya no está disponible» |
| Not enough stock | `409 INSUFFICIENT_STOCK` (nothing persists) |
| Repeated order ID | `409 ORDER_ALREADY_EXISTS` |
| Delivery already progressed / payment not covered | `409 DELIVERY_LOCKED` / `409 PAYMENT_REQUIRED` |
| Known persistence failure | `503 SERVICE_UNAVAILABLE` |

An order of another company responds exactly as a missing one.

### Uncertain responses

A lost response, a technical error or `ORDER_ALREADY_EXISTS` does not prove the order failed. The client reads `GET /api/orders/:id/aggregate` and checks company, ID and expected result. If it is `ORDER_NOT_FOUND`, the client may resend with the same ID; it never generates a new ID to resolve an uncertain attempt.

## Other operations

All under `/api/orders`, authenticated, scoped to the session company and sent with `Cache-Control: no-store`:

| Operation | Route |
| --- | --- |
| List with filters (view `all`/`unpaid`/`undelivered`, search, created dates, delivery status, courier, scheduled dispatch, shipped dates), 20 per page | `GET /mixed` |
| Read one order | `GET /:id/aggregate` |
| Search sellable products | `GET /catalog` |
| Register / void a payment | `POST /:id/payments`, `POST /:id/payments/:paymentId/void` |
| Reject a buyer report (body `{ reason: string \| null }`) | `POST /:id/payments/:paymentId/reject` |
| Set delivery / update shipping and dispatch date | `PUT /:id/delivery`, `PATCH /:id/shipping` |
| Deduct stock, ship, deliver, cancel | `POST /:id/deduct-stock`, `/ship`, `/deliver`, `/cancel` |
| Read the buyer checkout link (idempotent, used by mobile; `409 SUBDOMAIN_REQUIRED` or `409 ORDER_CANCELLED`) | `POST /:orderId/checkout-link` |

`GET /` and `GET /:id` serve the older completed-sales contract (`orderSchema`, `listOrdersResponseSchema`).

Day filters select whole inclusive days in `America/Lima`, converted to UTC instants with an inclusive start and exclusive end (`shared/orders-date.ts`); dates are displayed in Lima too. Reason: sellers operate in Peru and the filter must match the time shown, regardless of the phone's zone.

## Layers

- **Core** owns pricing, stock, authorization, company isolation (RLS) and historical copies. Routes and React Router actions validate input with Zod once and call the orders use cases; they never receive company or seller from the client.
- **Mobile** owns interaction, the temporary cart, the shown total and recovery of uncertain confirmations. It imports shared contracts, `Money` and `Result`, never core entities.
- Orders call the products feature to search catalog and deduct stock; they do not write products tables directly.

## Mobile sales flow

- "Nueva venta" holds two stages, products and review, in one route so the selection survives moving between them. The cart is in memory only: leaving with items asks to discard them; there is no persistent draft.
- Products are searched by name; a variant is chosen and a quantity set. The shown price and stock guide the seller but do not reserve units. Only active variants, and products with at least one, are offered, in saved option and value order. A search returns up to 20 products with all their active variants, which is accepted at current catalog sizes.
- Variants and items show their combination as «Talla: M · Color: Azul» on mobile and «M · Azul» on web ([Products · Combination text](products.md#combination-text)).
- A sale rejected with `VARIANT_NOT_FOUND`, sent directly or from the queue, returns to the review stage with the item marked «L / Azul ya no está disponible.»; the seller removes or changes it and confirms again.
- The review stage sets payments, delivery, delivered/pending and scheduled dispatch date. Marking the order delivered requires the balance to be covered and quantities within the shown stock. Payments that would deduct stock at creation (they cover the total, or one deducts stock if partial) also require quantities within the shown stock. When such payments meet short stock on a pending order, the review stage warns and Save opens «No hay stock suficiente», listing each short item; «Guardar como pendiente» drops the covering «Pagado» payment, clears `deductStockIfPartial` on the remaining ones, drops advances (last first) while the rest still covers the total (the dialog then says the amount removed, to register again once restocked; `paymentsWithoutStockDeduction`) and sends the same order, and «Volver» sends nothing. A delivered order with short stock stays blocked: the review stage warns and disables saving. Each line above the shown stock says how many units are available and that the order can be saved but not fully paid or dispatched until restocked. A pending order without such payments saves regardless of stock.
- Confirming requires a connection. While offline the cart stays editable.
- The order detail reloads when the screen gains focus, after **Obtener enlace** (so items and total next to the link are current), and when a seller notice for that chat arrives while it is open, at most once every 2 s.
- Before sending, mobile stores the request in a per-company queue in secure storage (`infrastructure/pending-order-confirmation.ts`); if it cannot store it, it does not send. A double tap and the background sync share one request per sale.
- When the result is uncertain, the sale stays queued and the seller can keep selling. The queue is sent automatically on sign-in, on returning to the app, on reconnecting and with exponential backoff with full jitter (up to 5 minutes). Each attempt first reads the ID in core and resends only on `ORDER_NOT_FOUND`.
- A definitive rejection during sync stops retries; the sale appears in "Nueva venta" for review and is saved again with the same order and payment IDs. The queue survives restart and sign-out and is shown only in its company. An unreadable stored sale is shown as an error that can be discarded without blocking new sales.
- If the total registered by core differs from the shown total, mobile shows both right after completing or recovering that attempt, so the seller adjusts the charge outside the app. Opening the order later shows only the registered total.
