# Orders

An order records what a buyer takes from a company: items, payments, delivery and fulfillment. The technical concept is `Order` in core, shared and mobile; "Ventas" is only the interface label.

Sources of truth:

- Domain and lifecycle: `apps/core/src/features/orders/domain/order.ts` and `order-state-machine.ts`.
- JSON contracts: `shared/contracts/orders.ts`.
- HTTP adapter: `apps/core/src/features/orders/presentation/api-routes.ts`.
- Persistence: `apps/core/prisma/schema.prisma` (`Order`, `OrderItem`, `Payment`, `OrderBuyer`, `OrderMessage`).

## Origin

Each order has one source, derived from stored data:

| Source | Origin |
| --- | --- |
| `manual` | Created by a seller in core web or mobile. |
| `whatsapp` | Created from an incoming chat message; see [message-to-order](message-to-order.md). |
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
- Items copy product name, variant attributes, SKU and unit price at creation. Later catalog edits do not change them, and deleting a product does not cascade to orders that reference it.
- Each variant appears once per order, with its total quantity.
- `total = itemsTotal + deliveryCharge`.

## Lifecycle

An order has three independent dimensions plus a derived status:

| Dimension | Values | Rule |
| --- | --- | --- |
| Payment | `pending`, `paid` | `paid` when confirmed payments cover the total. Reported (buyer) payments do not count until confirmed. |
| Stock | `stockDeducted` | Stock is deducted at most once per order. |
| Delivery | `pending`, `shipped`, `delivered` | Shipping or delivering requires a covered payment and deducted stock. |
| Status | `active`, `cancelled`, `completed` | `completed` when delivered and paid; otherwise `active` unless cancelled. |

- An order is created `active`, unpaid, undelivered, without deducted stock and without reserving stock. Reason: creating an order is a record of intent; stock moves only when it is paid.
- Registering a payment deducts stock when payments cover the total, or when the seller asks for it on a partial payment (`deductStockIfPartial`). Deduction is conditional on available units and all variants are processed in a stable order inside the payment transaction; a shortage returns `INSUFFICIENT_STOCK` and rolls everything back.
- Voiding a confirmed payment can return the order from `completed` to `active`.
- Delivery details (home, agency or store pickup) can change only while delivery is `pending`; afterwards they return `DELIVERY_LOCKED`.
- A dispatch date can be scheduled only while delivery is `pending`.
- Cancelling is allowed only while delivery is `pending`. Cancelling publishes `order_cancelled`, whose handler restores deducted stock.
- Payment is recorded in Yoyos; no external charge is processed. Because orders never reserve stock, a sale can be rejected for stock after the seller already received money outside the app; the database transaction cannot undo that.

## Creating an order

`POST /api/orders` is the single creation endpoint. The client sends only its own data: the order UUID, `variantId` and positive integer `quantity` per item (at least one, no repeated variants), and optionally:

- `payments`: each with a client-generated `paymentId`, amount, method (`digital_wallet` or `bank_transfer`) and `deductStockIfPartial`.
- `delivery`: a rated delivery selection plus the `expectedPrice` the seller reviewed.
- `deliverImmediately`: confirms a hand-over delivery at creation.
- `scheduledDispatchDate`.

Company, seller, prices, totals, statuses and dates come from core; extra fields are rejected. Creation, delivery, payments, stock deduction and delivery confirmation run in one transaction: all succeed or none persist. Reason: a half-created sale (for example, paid but without stock deducted) would leave inventory and cash out of sync. The use case is `createCompleteOrder` (`application/create-complete-order.ts`); it reuses the public order operations inside the same transaction instead of a separate implementation.

The endpoint also accepts the fixed body `payment: { method: "digital_wallet" }` with `delivery: { method: "handover" }`, which registers an immediate sale paid in full and delivered by hand (`registerImmediateSale`). `POST /api/orders/pending` and `POST /api/orders/immediate-sale` remain for clients that still call them.

Every successful creation returns `201` with `orderAggregateSchema`.

### Errors

Errors use the envelope `{ code, error, issues? }`; `issues` points to the affected item by `index` or `variantId` when core knows it. Clients pick visible messages by `code`, never by the `error` text.

| Situation | HTTP and code |
| --- | --- |
| Malformed body, query or ID | `400 INVALID_INPUT` |
| Body is not JSON / larger than 100 kB | `415 UNSUPPORTED_MEDIA_TYPE` / `413 PAYLOAD_TOO_LARGE` |
| Business rule broken / mixed currencies | `422 INVALID_ORDER` / `422 CURRENCY_MISMATCH` |
| Variant not available in the company | `404 VARIANT_NOT_FOUND` |
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
| Set delivery / update shipping and dispatch date | `PUT /:id/delivery`, `PATCH /:id/shipping` |
| Deduct stock, ship, deliver, cancel | `POST /:id/deduct-stock`, `/ship`, `/deliver`, `/cancel` |
| Enable the buyer checkout link | `POST /:orderId/checkout-link` |

`GET /` and `GET /:id` serve the older completed-sales contract (`orderSchema`, `listOrdersResponseSchema`).

Day filters select whole inclusive days in `America/Lima`, converted to UTC instants with an inclusive start and exclusive end (`shared/orders-date.ts`); dates are displayed in Lima too. Reason: sellers operate in Peru and the filter must match the time shown, regardless of the phone's zone.

## Layers

- **Core** owns pricing, stock, authorization, company isolation (RLS) and historical copies. Routes and React Router actions validate input with Zod once and call the orders use cases; they never receive company or seller from the client.
- **Mobile** owns interaction, the temporary cart, the shown total and recovery of uncertain confirmations. It imports shared contracts, `Money` and `Result`, never core entities.
- Orders call the products feature to search catalog and deduct stock; they do not write products tables directly.

## Mobile sales flow

- "Nueva venta" holds two stages, products and review, in one route so the selection survives moving between them. The cart is in memory only: leaving with items asks to discard them; there is no persistent draft.
- Products are searched by name; a variant is chosen and a quantity set. The shown price and stock guide the seller but do not reserve units.
- The review stage sets payments, delivery, delivered/pending and scheduled dispatch date. Marking the order delivered requires the balance to be covered and quantities within the shown stock.
- Confirming requires a connection. While offline the cart stays editable.
- Before sending, mobile stores the request in a per-company queue in secure storage (`infrastructure/pending-order-confirmation.ts`); if it cannot store it, it does not send. A double tap and the background sync share one request per sale.
- When the result is uncertain, the sale stays queued and the seller can keep selling. The queue is sent automatically on sign-in, on returning to the app, on reconnecting and with exponential backoff with full jitter (up to 5 minutes). Each attempt first reads the ID in core and resends only on `ORDER_NOT_FOUND`.
- A definitive rejection during sync stops retries; the sale appears in "Nueva venta" for review and is saved again with the same order and payment IDs. The queue survives restart and sign-out and is shown only in its company. An unreadable stored sale is shown as an error that can be discarded without blocking new sales.
- If the total registered by core differs from the shown total, mobile shows both right after completing or recovering that attempt, so the seller adjusts the charge outside the app. Opening the order later shows only the registered total.
