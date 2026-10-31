# Orders

An order records what a buyer takes from a company: items, payments, delivery and fulfillment. The technical concept is `Order` in core, shared and mobile; "Ventas" is only the interface label.

Sources of truth:

- Domain and lifecycle: `apps/core/src/features/orders/domain/order.ts` and `order-state-machine.ts`; stock deduction rule: `domain/stock-deduction.ts`.
- JSON contracts: `shared/contracts/orders.ts`; fulfillment blocks shared by web and mobile: `shared/orders-fulfillment.ts`.
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
- Items of a variant deactivated later keep working: the order is shown, paid, deducted (including the automatic deduction of a waiting order on restock) and cancelled with stock restoration, which do not filter by variant status. New orders cannot include it ([Products](products.md)).
- Core resolves all the variants of an order in one batched lookup and inserts the items in variant order. Reason: a product save that changes combinations locks variants in the same order, so the two cannot deadlock. A variant deleted between that lookup and the insert fails the order item's foreign key and answers `VARIANT_NOT_FOUND` with its `variantId`; message-to-order treats it as a retryable failure instead, because its next scan no longer finds the variant.
- Each variant appears once per order, with its total quantity.
- An order always has at least one item. Chat messages can add items, remove an item, set its quantity or replace its variant (merging into the same variant if present), each recalculating subtotals and totals; removing the only item is refused. The seller of the company edits the items of a saved order from web ([Editing a saved order](#editing-a-saved-order)); mobile has no such operation. A chat message never edits an order with a confirmed or reported payment, so it never makes an order due for stock deduction.
- `total = itemsTotal + deliveryCharge`.

## Mentioned price

An item may keep the price the buyer mentioned in a chat (`mentionedPrice: { amount, units } | null` in `shared/contracts/orders.ts`; columns `mentionedPriceAmount` and `mentionedPriceUnits` on `OrderItem`, both or none, amount positive, units 1 to 99). The currency is the order's. It never changes the unit price, subtotal or total; its rules, including how a price for several units is read as per unit or for the lot, are in [message-to-order](message-to-order.md#rules).

- Order detail on web and mobile shows «El cliente mencionó S/ 30.00 por unidad», or «… S/ 50.00 por 3» when the buyer priced several units together, under the unit price and in the same money format, only when the mentioned amount differs from the unit price times its units. Web shows it in the item's row under the variant and price line (`orderDetail.mentionedPrice`); mobile in the item card under the price and in the item's accessibility label. The order list and the buyer's checkout never show it.
- Reason it differs from the price comparison declined for manual sales: that compared the price shown to the seller with the stored one; this note records what the buyer said, which the seller may have to settle in the chat.

## Lifecycle

An order has three independent dimensions plus a derived status:

| Dimension | Values | Rule |
| --- | --- | --- |
| Payment | `pending`, `paid` | `paid` when confirmed payments cover the total. Reported (buyer) payments do not count until confirmed. |
| Stock | `stockDeducted` | Stock is deducted at most once per order, all items or none; see [Stock deduction](#stock-deduction). |
| Delivery | `pending`, `shipped`, `delivered` | Shipping and delivering require at least one confirmed payment, partial or full, and deduct pending stock themselves. A delivered order can keep a balance due. |
| Status | `active`, `cancelled`, `completed` | `completed` when delivered and its confirmed payments cover the total (`deliveredAt` is the physical delivery, `completedAt` the moment delivery and coverage both hold); otherwise `active` unless cancelled. |

- An order is created `active`, unpaid, undelivered, without deducted stock and without reserving stock. Reason: creating an order is a record of intent; stock moves only when it is paid.
- No payment is ever rejected, deleted or left unrecorded because of stock. The payment, the balance, the paid status and completion are recorded whether or not stock can be deducted. Reason: founder rule; money that arrived must be recorded.
- Voiding a confirmed payment can return the order from `completed` to `active`. It never restores stock.
- Delivery details (home, agency or store pickup) can change only while delivery is `pending`; afterwards they return `DELIVERY_LOCKED`.
- A dispatch date can be scheduled only while delivery is `pending`.
- Cancelling is allowed only while delivery is `pending`. Cancelling publishes `order_cancelled`, whose handler restores deducted stock.
- Payment is recorded in Yoyos; no external charge is processed.

## Stock deduction

### Rules

| Aspect | Rule |
| --- | --- |
| Due for deduction | An order is due when it is not cancelled, its delivery is `pending`, and either (a) its stock is not deducted and its confirmed payments cover the total or a confirmed payment asked to deduct stock even though it is partial (`deductStockIfPartial`, stored on the payment), or (b) its stock is deducted but an edit left units pending (a line with `stockDeductedQuantity` below `quantity`), whatever the payments. It is derived from the order (`isStockDeductionDue`); nothing else marks it. |
| When it is attempted | Whenever an order may become due (a payment is confirmed: manual payment, report approval, creation with payments, immediate sale; a delivery changes, by the seller or by the buyer in the checkout; the seller saves an edit that changed the items or the delivery of a saved order) and whenever a variant's stock increases. Nothing else deducts: editing never deducts or restores stock by itself; on an order that is already deducted, the edit's `order_edited` listener settles only the difference. Reason: every path that makes an order due needs a trigger. |
| Enough stock | The result the seller sees right after the response is already deducted. Reason: anything else would show a false «Esperando stock». |
| Short stock | Nothing is deducted and the operation still succeeds; the order is **waiting** («Esperando stock»). |
| All or nothing | Either every item of the order is deducted or none. Example: 4 «Camisa · M» and 2 «Polo · L» with stock 3 and 5: nothing is deducted until «Camisa · M» reaches 4. Reason: a half-deducted order cannot be dispatched and hides what is missing. |
| Restock | Any increase of a variant's stock. Today the only one is the cancellation of an order that had deducted it. Any future use case that increases stock publishes `product_stock_increased` once per transaction with the variants that actually increased, and gets the same serving. |
| Serving waiting orders | On a restock, the waiting orders that contain an increased variant are served oldest creation date first; each order whose items all fit the stock left at that moment is deducted, and an order that does not fit is skipped so the next ones are tried. Example: stock left at 3, #1010 needs 5 and #1012 needs 2: #1012 is deducted and #1010 keeps waiting with «hay 1». Reason: simple and predictable, and stock does not sit idle behind a large order (rejected: choosing the order by hand). |
| Restock in one step | The increase and the deduction of the waiting orders it covers commit in the same transaction, so no newer payment, creation or dispatch can take the increased units in between. A sale paid while units are free is deducted right away. |
| Guarantee | A due order whose items all fit is never left undeducted, store pickup included: if the deduction did not complete, the recovery job deducts it within a minute, without seller action and without another restock. Meanwhile the order shows «Descontando stock». |
| Stock source | Stock is never negative and never deducted twice for one order. It is deducted only by this automatic deduction (also after an edit), by shipping, by delivering, and by creation with immediate delivery or shipment; it is returned only by cancellation and by an edit of a deducted order that lowers or removes a line (which publishes `product_stock_increased`). There is no standalone deduction operation. Reason: a second path would bypass oldest first. |
| Ship and deliver | Ship deducts inside its own transaction and answers `INSUFFICIENT_STOCK` when short (also on a partially paid order that is not due). Deliver, by `deliverOrder` (the deliver endpoint and `PATCH /shipping` with `delivered`), requires deducted stock and takes out the part an edit left pending in its own transaction, or answers `INSUFFICIENT_STOCK` with nothing persisted. Reason: a delivered order is no longer due, so nothing else would take those units. |
| Leaving waiting | A cancelled waiting order leaves the waiting orders and nothing is restored, because nothing was deducted. An order that stops being due (a voided payment, or a delivery or items change that raises the total, and no remaining payment asked to deduct) shows «Stock pendiente» like any unpaid order. |

The order response carries `stockDue` (`null`, `{ kind: "waiting", shortItems: [{ variantId, available }] }`, `{ kind: "partial_waiting", shortItems }` (deducted order whose edit added units that did not fit; mobile shows it like waiting) or `{ kind: "deducting" }`; `orderStockDueSchema`). It is the only representation of «Esperando stock» and «Descontando stock»; `null` covers deducted and not due orders, which `stockDeducted` already tells apart. `available` is the current stock, read when the order is read, listed in the order's item order. Use cases that publish a stock event compute it inside their own transaction from the deduction outcome, so a response never mixes two moments; other reads compute it in a read snapshot and read stock only for due orders. List pages never compute it, and dispatch labels compute it once per batch. Nothing new is copied into the order and no history of deduction attempts is kept.

### Mechanism

- Payments, deliveries, checkout and products only publish in-transaction events ([Event bus · In-transaction events](event-bus.md#in-transaction-events)): `payment_confirmed`, `order_delivery_changed`, `order_edited`, `order_stock_deduction_overdue` (recovery) and `product_stock_increased`. One orders listener (`application/deduct-due-stock.ts`) handles them inside the producer's transaction. Reason: it is the only way to answer already deducted and to serve a restock in one step without an outbox (rejected: pg-boss after commit with a transactional outbox, which shows a false «Descontando stock» on every covering payment and lets newer sales take restored units).
- Orders owns the deduction: the due rule, the `stockDeducted` flag and the waiting-order queries are orders data. Products exposes stock capabilities (lock stock rows, one guarded bulk decrement that changes every row or none, read stock) and knows nothing about orders; it receives the restock publisher by injection.
- The lock order is the same everywhere: order row, then stock rows in `variantId` order. Payment and delivery paths wait on stock rows within their lock timeout; restocks and recovery never wait once they hold their first lock and skip rows held elsewhere (`SKIP LOCKED`), leaving those orders to recovery. Restock and recovery take orders `FOR NO KEY UPDATE`, so inserting a payment or a message on the same order is not blocked.
- Errors are contained per order. Only a failure that ends the whole transaction (Prisma's transaction timeout, a lost connection) rolls back the producer, so its retry is safe. Statement-level failures (lock or statement timeout, deadlock) and data faults roll back to the listener's savepoint and are left to recovery: the payment, delivery or restoration still commits.
- Producers that publish run with a 2000 ms lock timeout and a 3000 ms statement timeout under the 5000 ms transaction timeout, so a lock wait ends as a contained timeout instead of rolling back the payment.
- Serving waiting orders is bounded: at most 100 candidates and a 500 ms budget enforced on every statement, a fixed number of statements whatever the number of candidates. Running out of budget is contained, so a restoration always commits once its own increments succeed, adding at most about half a second. The restoration transaction runs with a 5000 ms timeout and 2000 ms lock and statement timeouts; only a failed increment or a transaction-ending error makes pg-boss retry it.
- Creation with immediate delivery and `registerImmediateSale` deduct through `payment_confirmed`. If the order is still undeducted, the creation rolls back and answers `INSUFFICIENT_STOCK` with the first short `variantId` only when stock is short; a data fault answers `500 INTERNAL_ERROR` and a contended deduction `503 SERVICE_UNAVAILABLE`. Reason: the seller never reads «No hay stock suficiente» when stock is enough.

### Recovery

- Scheduled job `recover-due-stock-deductions`, worker only, cron every minute. pg-boss sends at most one cron job per minute, so each run makes up to three passes, 20 s apart, with none starting after 45 s. Each pass lists the companies with due orders that fit the current stock (a `SECURITY DEFINER` function that returns only company ids) and publishes `order_stock_deduction_overdue` for each order, oldest first, in its own tenant transaction.
- A pass is capped at 200 orders and 10 s, shared fairly across companies with a rotating first company, so one company's backlog does not starve the others.
- The queue is `standard`, with no retry (the next minute is the retry) and 58 s expiry. Reason: a `stately` queue was measured to start a run up to 55 s late after a long run. Overlapping runs are harmless because each order is taken with `SKIP LOCKED` and the listener re-checks the due rule under the lock. The pg-boss schedule row keeps the job alive across deploys and restarts.
- Bound: about 42 s from an order becoming overdue to its deduction while passes are not cut by their budget; measured maximum about 17 s. A backlog above a company's share defers the rest to later passes.
- An order whose deduction fails with a data fault is quarantined in the worker for 10 minutes and logged once per quarantine; it keeps showing «Descontando stock» and needs diagnosis. The quarantine is per worker process and forgotten on restart. Statement-level failures are retried on the next pass.
- With the worker down, recovery stops; payments and deliveries still deduct in their own transaction.

### Accepted gaps

- If, at a restock, a waiting order or one of its stock rows is locked elsewhere, or the serving budget runs out before it, the increased units stay free until recovery and a newer paid sale can take them first. The same happens to an order left «Descontando stock» by a contained failure. Reason: an oldest-first check in every payment is not worth its cost.
- Sellers cannot increase stock by hand, so a waiting order leaves «Esperando stock» only when another order that had deducted the same variant is cancelled; it can stay waiting indefinitely even if the goods are physically there. Copy never tells the seller to restock. Reason: there is no restock action to point to.
- A lost `order_cancelled` publication restores nothing and serves no waiting order; recovery does not restore stock.

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
- **Approve** and a manual payment always record the payment and then apply [Stock deduction](#stock-deduction); with short stock the order is left waiting. A confirmation stores the seller's `deductStockIfPartial` (a voided payment no longer makes the order due). `POST /:id/payments` answers `{ order }`, with `stockDue` from the same transaction.
- **Reject** applies only to a pending report. It keeps the receipt, report date, who rejected it, when, and an optional reason (trimmed, empty means none, at most 200 characters) that the buyer sees. It changes neither the received amount, the balance, stock nor completion. Reason: a wrong receipt must not stay pending forever nor block the buyer. Rejected is final: a mistaken rejection is solved by the buyer sending the receipt again, which creates a new report; the rejected one stays in the history.
- **Repeated decisions:** repeating the same decision on the same payment returns the first result and writes nothing (a repeated approval publishes no stock event and deducts at most once). Approving again with the same amount and method returns that confirmation, even with a different `deductStockIfPartial`; rejecting again returns the original rejection and reason, whatever reason the retry carries; a buyer report resent with the id and receipt of a rejected payment returns the rejection. A different decision is refused: approving a rejected payment, rejecting a confirmed or voided one, or approving with another amount or method answers `409 PAYMENT_CONFLICT`; voiding a rejected or reported payment answers `409 INVALID_TRANSITION`. Clients show both codes as «Este pago ya fue revisado.» and reload. Reason: a retry after an uncertain response must never create a second payment or overwrite a decision.
- **Concurrency:** approve, reject and void lock the order row and update the payment only if its stored status is still the expected one, so decisions from two tabs or web and mobile are serialized.
- **Cancelled order:** reports cannot be approved or rejected (`409 ORDER_CANCELLED`) and no manual payment is recorded; a pending report stays visible, read-only.
- **Several reports:** each report is decided on its own. The checkout lets the buyer have one pending report at a time, as a display rule; core does not refuse a second report.
- **Partial stock choice:** clients offer the partial deduction box only when stock is not yet deducted and the typed amount is below the pending balance (`offersPartialStockDeduction` in `shared/orders-payment.ts`, used by web and mobile); a hidden box sends `deductStockIfPartial: false`. Reason: when the amount covers the balance stock is deducted anyway, so the box only adds noise. It compares with the balance, not the total, so earlier payments count. Web labels it «Descontar stock aunque sea un abono parcial»; mobile «Descontar stock con abono parcial» in the register sheet, the review sheet and the «Nueva venta» payment card. With short stock it leaves the order waiting instead of failing.
- Only the seller of the order's company can approve, reject, record or void; an order of another company answers as missing.

### Web «Pagos» card

- A summary line, hidden on a cancelled order: «Sin pagos · necesario para enviar», «Pago parcial · falta S/ 148.00», «Pagado» or «Pagado · Exceso recibido: S/ 12.00», plus «Pago por revisar» while a report is pending. The card is part of the [order view](order-view.md#pagos).
- Rows, newest first, one per payment. Reported: receipt thumbnail, «Pago reportado, pendiente de revisión», report date, «Ver captura», **Rechazar** and **Aprobar**, with no amount or method because the buyer does not declare them. Confirmed: amount and method, «Pago confirmado», «Ver captura» when it came from a report, **Anular pago**. Rejected: «Pago rechazado», date, reason and «Ver captura», no actions. Voided: «Pago anulado», no actions. A saved payment has no remove icon.
- The manual payment is a separate action: one **Agregar <wallet>** button per wallet of the country's catalog (`shared/wallet-providers`; in Peru **Agregar Yape** and **Agregar Plin**) and **Transferencia bancaria**. Each opens the payment form with the method preset and «Importe recibido» prefilled with the balance. They show only while the order is not cancelled, has a product and the balance is above zero. A report can still be approved with a zero balance. Reason: one form per decision, so the seller never confuses a report with a manual payment.
- **Aprobar** from the row opens a short dialog with «Importe recibido» prefilled with the balance, «Medio de pago» and the partial stock box under the rule above. **Rechazar** asks «¿Rechazar este comprobante?» with «Motivo (opcional, lo verá el comprador)».
- The thumbnail and «Ver captura» open «Comprobante de pago», a dialog with the receipt fitted to the screen instead of a new tab. For a pending report it shows the pending balance, **Rechazar** and **Aprobar**; each turns the dialog's decision area into its form while the receipt stays visible (on a phone, a reduced copy stays fixed above the fields). Errors show inside the dialog; after a decision it closes, the result text shows in the card and focus goes to the decided row. If the receipt cannot load, the dialog says «No se pudo cargar la captura.» with **Reintentar**. Closing without deciding records nothing. Reason: the seller decides with the evidence in view and without losing the order.
- After recording or approving a payment the card says «Pago registrado.», or «Pago registrado. El pedido queda esperando stock.» when the returned order is waiting; voiding and rejecting say «Pago actualizado.». No payment action ever shows a stock rejection.
- In a cancelled order the rows are read-only and «Pago por revisar» is not shown; **Anular pago** stays available on the web.
- Thumbnails, «Ver captura» and the row actions have accessible names that include the row's date and time, so several rows never share a name.

### Mobile

- The order detail keeps its layout: «Registrar pago», «Ver pagos», and **Revisar comprobante** on each report, which opens the review sheet; the receipt opens outside the app.
- The review sheet approves with «Confirmar pago» and adds **Rechazar** with the same optional reason, inside the same sheet. The partial stock box follows the same rule in the review and register sheets; when the amount covers the balance its reason reads «No hace falta: al cubrir el saldo, el stock se descuenta solo.».
- After a recorded payment the sheet closes and a status line appears in the «Pagos» card, under the balance: «Pago registrado.» or «Pago registrado. El pedido queda esperando stock.». It is announced once, politely, and stays until the seller leaves the screen or starts another payment, delivery or fulfillment action. Reason: the sheets close on success and had no other surface.
- Rejected payments show «Pago rechazado» with date, reason and «Ver captura», never as confirmed. The summary shows «Pago por revisar» under «Saldo pendiente» while a report is pending and the order is not cancelled.
- Voiding is not offered in a cancelled order on mobile, unlike the web.

## Order detail: waiting for stock

### Notice

- **Web:** a warning notice between the page header (with its badges) and the cards, above the cancel button. **Mobile:** a warning notice in the scroll content, right after the heading block (date, status, buyer) and the pending-reports notice when there is one, before the products card.
- Waiting: title «Esperando stock», one line per short item in the order of the products card, and «Se descontará solo cuando haya stock suficiente. Hasta entonces no se puede enviar ni entregar.». Each line shows the product name, the combination in each platform's format ([Products · Combination text](products.md#combination-text); just the name without options), the quantity and the current stock: web «Camisa (M · Azul): 4 en el pedido, hay 3.», mobile «Camisa (Talla: M · Color: Azul): 4 en el pedido, hay 3.». The wording is neutral because the buyer may have made the order (catalog, chat).
- Deducting: title «Descontando stock» and «Ya hay stock para este pedido; se descontará en menos de un minuto.». No refresh control: the order shows the result when it reloads on focus (mobile) or navigation (web).
- Deducted and not due orders show no notice. The notice has no action, is static (not announced as an alert on every load), has its title as a header, and uses the warning surface and text color plus an icon, never color alone.
- The notice appears only on the order detail; there is no list filter or badge, label batches list and print waiting orders unmarked, and no notification is sent when a waiting order is deducted.

The stock state of the order, in the header of the web products card and in the stock line of the mobile detail:

| Order | Web | Mobile |
| --- | --- | --- |
| Deducted | «Stock descontado» | «Stock descontado» |
| Waiting | Told by the notice, not repeated in the card | «Esperando stock» |
| Deducting | Told by the notice, not repeated in the card | «Descontando stock» |
| Not due | «Stock pendiente» | «Stock pendiente» |

A cancelled order shows no stock state on web, because its stock was restored or never deducted. The web detail has no «Detalles internos» card: the seller's user id and the delivery author's id are not shown (an id means nothing to the seller); the buyer's choice shows as «Elegida por el comprador» in «Entrega», and the internal delivery cost stays there.

### Fulfillment buttons

Web shows «Marcar enviado», «Entregar directamente» and «Marcar entregado» in the «Estado del pedido» card ([Order view](order-view.md#estado-del-pedido)); mobile shows the single next action, «Marcar como enviado» or, for store pickup, «Marcar como entregado». Both platforms decide with `orderFulfillmentBlock` (`shared/orders-fulfillment.ts`): payment and transition reasons first, then the stock block.

| Order | Ship | Deliver (store pickup included) |
| --- | --- | --- |
| Waiting | Disabled: «Para enviar falta stock de Camisa (M · Azul).» | Disabled: «Para entregar falta stock de Camisa (M · Azul).» |
| Deducting | Enabled: shipping deducts the stock itself | Enabled: delivering deducts the stock itself |

- The reasons name only the short items, as a list («Camisa (M) y Polo (L)», «Camisa (M), Polo (L) y Short (S)»); the quantities stay in the notice. Reason: the notice and the buttons must agree, and mobile would otherwise repeat the notice a few rows below.
- An unpaid order shows the payment reason first; «Se requiere descontar el stock antes de entregar.» is only a domain guard that the clients no longer reach.
- If stock changed after the screen loaded and a tap still meets short stock, «No hay stock suficiente para enviar este pedido.» (or «…para entregar este pedido.» when delivering) is shown and the order reloads. A partially paid order with short stock and no deduction request is not waiting: it shows no notice, ship stays enabled and the tap fails with that text.
- The [AI assistants' dispatch readiness](assistants.md#dispatch-readiness) uses these rules and sentences, and also marks a partially paid order with short stock as not ready.

### Delivery

- Saving a delivery that makes payments cover the total never fails for stock. Web saves it with the other edits and says «Cambios guardados.», or «Cambios guardados. El pedido queda esperando stock.» when the order ends waiting. Mobile «Entrega» returns to the detail with no success text; the notice is the feedback, because the detail reloads on focus.
- The buyer's checkout confirms a delivery change without any stock message, and the buyer never sees whether the order is waiting ([Checkout](checkout.md#confirmation)).

## Editing a saved order

`editOrder` (`application/edit-order.ts`) is the seller's single operation to change the items, the customer and the delivery of a saved order. Only a seller of the order's company can use it; an order of another company answers as missing. Only the web route action uses it; mobile does not edit items. Reason: a public route and contract with no client is not added.

### What the request carries

- The final state of each part it edits, never increments: the lines (variant and quantity), the customer (name and phone, or `null`) and the delivery change. A part that is absent is not touched. Reason: repeating a request after an uncertain response cannot add twice.
- For each part, the revision of that part as the client loaded it (see [Conflicts](#conflicts)).
- Everything is applied in one transaction under the order lock, all or nothing. Contracts: `apps/core/src/features/orders/presentation/order-edit-schemas.ts`; limits: `shared/orders-edit.ts`.

### Rules per part

| Part | Rule |
| --- | --- |
| Items | A line per variant, quantity 1 to 9999, at most 100 lines, at least one. A variant already in the order keeps its row: copied name, combination, SKU, unit price and mentioned price, also when its quantity changes or when it is removed and added back in the same save. A new variant takes the current catalog price. Totals are recalculated; the delivery charge does not change. Repricing a kept line is not possible. |
| Deactivated variant | A kept line of a deactivated variant can stay or be lowered. Raising it, or adding a deactivated variant, answers `VARIANT_NOT_FOUND` with its `variantId`. A variant deleted between the lookup and the insert answers the same. |
| Customer | Name and phone, both or none. Changing them keeps the order's link to its contact. Emptying them is refused with `CUSTOMER_REQUIRED` on an order the buyer confirmed (it can be changed to another customer, not left empty); otherwise an order with a contact keeps the contact with empty name and phone (a WhatsApp order returns to «chat contact without name or phone»); any other order loses its buyer row and reads as «Público general». The customer is a copy; no contact is updated. |
| Delivery | Either a replacement or an amendment. A replacement (method, district, rate or agency) is quoted again with the `expectedPrice` the seller saw and can answer `TOTAL_CHANGED` with the current price, `RATE_UNAVAILABLE`, `DELIVERY_UNAVAILABLE` or `DELIVERY_METHOD_DISABLED`. An amendment changes only the recipient, the home address text, the reference or the agency identity document, keeps the stored rate, cost and charge and is never quoted. Both record the seller as the author, so «Elegida por el comprador» disappears. An empty reference is stored as `null`. A delivery that was not sent is never re-quoted or rewritten. |
| Payments | Never changed, voided or removed by an edit. Payment status is derived again, and an overpayment is an amount shown as «Exceso recibido», with no refund recorded. |

### Locks enforced by core

| Order | Items | Customer | Delivery |
| --- | --- | --- | --- |
| Cancelled | `ORDER_CANCELLED` | `ORDER_CANCELLED` | `ORDER_CANCELLED` |
| Delivery shipped or delivered | `DELIVERY_LOCKED` | Editable | `DELIVERY_LOCKED` |
| Stock deducted, delivery pending | Editable: the stock listener settles the difference ([Stock after an edit](#stock-after-an-edit)) | Editable | Editable |

«Descontando stock» is not enforced by core: it is derived and can appear or vanish while the seller edits. A save accepted in that state is harmless, because the items are replaced under the lock and the listener then deducts the new ones. Reason: a lock that depends on a moment would refuse saves for a state the seller cannot see change.

### Conflicts

- Each part has a revision: a digest of its stored content (items: id, variant, quantity, unit price, mentioned price; customer: contact, name, phone; delivery: the full snapshot with its author). Catalog copies, payments, totals, stock and fulfillment are not part of any revision. Reason: no version column is needed and no other writer changes; a payment, a restock or a catalog edit never conflicts with an edit.
- Under the order lock, core drops every sent part whose stored state already equals the request (applied), checks the state locks on the rest, then compares the revision of each remaining part. A difference answers `ORDER_CHANGED` listing the parts. Reason: a repeat after an uncertain answer succeeds without writes even if the first attempt deducted the stock or the order was shipped since.
- A chat message, another tab or seller, a buyer confirmation that changed their details, or the buyer's delivery change conflicts only with the part it changed. Parts do not overlap: a customer-only save succeeds when the items changed.

### Stock and result

- When the items or the delivery changed, the edit publishes the in-transaction event `order_edited` once, and the stock listener deducts the order if it became due and every item fits ([Stock deduction](#stock-deduction)). A customer-only edit publishes nothing. The edit is never refused for stock: with short stock it commits and the order is waiting.
- The result carries the order with `stockDue`, the new revisions and the parts applied.
- Saved lines carry their current stock and sellable state, read in one query of the order's variants (active variants of active products, no cap). If the read fails the stock is unknown: the order stays readable and editable without stock warnings, and core still refuses an unsellable variant on save. When the stored order already locks its items the read is skipped.
- An edit holds the order lock for a fixed number of statements whatever the number of lines. Everything inside the lock is database-only.
- Items of an order whose stock is already deducted can be edited ([Stock after an edit](#stock-after-an-edit)); a deduction never locks them. Payments are never removed or rejected: a higher total with uncovered payments keeps the stock already reserved.

#### Stock after an edit

- `editOrder` never moves stock. It reads, under the order lock and before replacing the lines, the units already deducted by the lines it removes, and publishes `order_edited` with `{ companyId, orderId, returns }` (`returns`: variant → previously deducted units of removed lines). Kept lines keep their row and their `stockDeductedQuantity`; new lines start at 0. Reason: the listener runs in the same transaction and settles by difference, so the stock never swings through zero.
- For a deducted order the listener locks the order row, then the variants in `variantId` order, and per variant compares the lines' `quantity` with their `stockDeductedQuantity`. A lower or removed line returns the difference and publishes `product_stock_increased` like a cancellation. A higher or new line takes what fits; the rest stays pending and the order keeps `stockDeducted = true`. Reason: an edit is never refused for stock.
- An order with pending units answers `stockDue: { kind: "partial_waiting", shortItems }`. The restock listener and the recovery job retry it (all pending units fit or nothing, like a waiting order). Ship and deliver deduct the pending part first, through the helper in `fulfill-order.ts`, and answer the usual short-stock error if it does not fit; `stockFulfillmentBlock` blocks both buttons meanwhile.
- Cancelling returns the sum of `stockDeductedQuantity` per variant, never `quantity`. Reason: a short increase followed by a cancellation returns exactly what was taken.
- After commit the listener logs `order_stock_adjusted` with `trigger`, `returnedUnits`, `deductedUnits`, `pendingLines` and `durationMs`; pending units reuse `order_stock_waiting`.
- A buyer-confirmed order keeps its confirmation after a change; the buyer sees the current products and total on the same link, and the checkout's `expectedTotal` check refuses a confirmation with an outdated total ([Checkout](checkout.md#confirmation)).
- Only the latest items and customer are kept; there is no history of earlier versions.

## Creating an order

`POST /api/orders` is the single creation endpoint. The client sends only its own data: the order UUID, `variantId` and positive integer `quantity` per item (at least one, no repeated variants), and optionally:

- `payments`: each with a client-generated `paymentId`, amount, method (`digital_wallet` or `bank_transfer`) and `deductStockIfPartial`.
- `delivery`: a rated delivery selection plus the `expectedPrice` the seller reviewed.
- `deliverImmediately`: confirms a hand-over delivery at creation.
- `scheduledDispatchDate`.

`deferStockDeduction` is still accepted and ignored, so a sale queued on a device before it was removed is saved as a plain save, never rejected.

Company, seller, prices, totals, statuses and dates come from core; extra fields are rejected. Creation, delivery, payments, stock deduction and delivery confirmation run in one transaction: all succeed or none persist. Reason: a half-created sale would leave inventory and cash out of sync. Payments never fail for stock: with short stock the order is saved with every payment and left waiting. Only immediate delivery or shipment requires stock and rolls the whole creation back without it. The use case is `createCompleteOrder` (`application/create-complete-order.ts`); it reuses the public order operations inside the same transaction instead of a separate implementation.

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
| Not enough stock for immediate delivery, immediate shipment or an immediate sale | `409 INSUFFICIENT_STOCK` with the short `variantId` (nothing persists) |
| Repeated order ID | `409 ORDER_ALREADY_EXISTS` |
| Delivery already progressed / payment not covered | `409 DELIVERY_LOCKED` / `409 PAYMENT_REQUIRED` |
| Known persistence failure, or a contended stock deduction for immediate delivery | `503 SERVICE_UNAVAILABLE` |

An order of another company responds exactly as a missing one. Outside creation, `INSUFFICIENT_STOCK` remains only for shipping and delivering (`/ship`, `/deliver` and `PATCH /:id/shipping`).

### Uncertain responses

A lost response, a technical error or `ORDER_ALREADY_EXISTS` does not prove the order failed. The client reads `GET /api/orders/:id/aggregate` and checks company, ID and expected result. If it is `ORDER_NOT_FOUND`, the client may resend with the same ID; it never generates a new ID to resolve an uncertain attempt.

## Other operations

All under `/api/orders`, authenticated, scoped to the session company and sent with `Cache-Control: no-store`:

| Operation | Route |
| --- | --- |
| List with filters (view `all`/`unpaid`/`undelivered`, search, created dates, delivery status, courier, scheduled dispatch, shipped dates), 20 per page | `GET /mixed` |
| Read one order (with `stockDue`) | `GET /:id/aggregate` |
| Search sellable products (`search`, `variantIds` up to 100, `inStock=true` to keep only products with an active variant in stock, shown with all their active variants) | `GET /catalog` |
| Register / void a payment | `POST /:id/payments`, `POST /:id/payments/:paymentId/void` |
| Reject a buyer report (body `{ reason: string \| null }`) | `POST /:id/payments/:paymentId/reject` |
| Set delivery / update shipping and dispatch date | `PUT /:id/delivery`, `PATCH /:id/shipping` |
| Edit items, customer and delivery of a saved order (web only) | Action `save_changes` of the web order route, on `editOrder`; there is no `/api/orders` route for it |
| Ship, deliver, cancel | `POST /:id/ship`, `/deliver`, `/cancel` |
| Read the buyer checkout link (idempotent, used by mobile; `409 SUBDOMAIN_REQUIRED` or `409 ORDER_CANCELLED`) | `POST /:orderId/checkout-link` |

There is no route that deducts the stock of an order.

`GET /` and `GET /:id` serve the older completed-sales contract (`orderSchema`, `listOrdersResponseSchema`).

AI assistants read orders through the orders feature's composed operations, not these routes; their search never matches the buyer phone ([AI assistants · Tools](assistants.md#tools)).

Day filters select whole inclusive days in `America/Lima`, converted to UTC instants with an inclusive start and exclusive end (`shared/orders-date.ts`); dates are displayed in Lima too. Reason: sellers operate in Peru and the filter must match the time shown, regardless of the phone's zone.

## Layers

- **Core** owns pricing, stock, authorization, company isolation (RLS) and historical copies. Routes and React Router actions validate input with Zod once and call the orders use cases; they never receive company or seller from the client.
- **Mobile** owns interaction, the temporary cart, the shown total and recovery of uncertain confirmations. It imports shared contracts, `Money` and `Result`, never core entities.
- Orders call the products feature to search the catalog and to lock, deduct and read stock; they do not write products tables directly. Products publishes stock increases through a publisher it receives by injection and never imports orders.

## Web sales flow

Creating and reviewing an order share one screen, described in [Order view](order-view.md). **Guardar venta** uses the creation endpoint above.

- A line whose quantity exceeds the stock shows «Disponible: 3. Si lo cobras, el pedido quedará esperando stock.».
- Saving with payments and short stock succeeds and opens the order, which shows «Esperando stock».
- With «Marcar como entregado al guardar», short stock is still refused with «No hay stock suficiente para uno de los productos.»: nothing is recorded and the form stays intact; the seller can save it without delivering it. Reason: delivering deducts the stock itself and refuses when it is short.

## Mobile sales flow

- "Nueva venta" holds two stages, products and review, in one route so the selection survives moving between them. The cart is in memory only: leaving with items asks to discard them; there is no persistent draft.
- Products are searched by name; a variant is chosen and a quantity set. The shown price and stock guide the seller but do not reserve units. Only active variants, and products with at least one, are offered, in saved option and value order. A search returns up to 20 products with all their active variants, which is accepted at current catalog sizes.
- Variants and items show their combination as «Talla: M · Color: Azul» on mobile and «M · Azul» on web ([Products · Combination text](products.md#combination-text)).
- A line above the shown stock warns «Solo hay 3 disponibles. Puedes guardarlo y cobrarlo; si lo cobras, quedará esperando stock y no podrás enviarlo hasta que se descuente.» («Solo hay 1 disponible. …» for one unit).
- A sale rejected with `VARIANT_NOT_FOUND`, sent directly or from the queue, returns to the review stage with the item marked «L / Azul ya no está disponible.»; the seller removes or changes it and confirms again.
- The review stage sets payments, delivery, delivered/pending and scheduled dispatch date. When payments would deduct stock (they cover the total, or one deducts stock if partial) and a quantity exceeds the shown stock, an inline warning stays above **Guardar**: «Falta stock: se guardará con los pagos y quedará esperando stock.». **Guardar** saves directly with every payment; there is no stock dialog. Reason: it produces the same order, and a dialog only adds a tap. The warning uses the shown stock, so a sale whose server stock dropped after the screen loaded saves as waiting with no warning, and the detail it opens shows the notice; one whose server stock rose saves already deducted.
- Marking the order delivered requires the balance to be covered and quantities within the shown stock; with short stock saving stays disabled with «Reduce la cantidad para guardarlo como entregado.». Dispatch at creation with short stock stays blocked with «Para enviar falta stock de …». A pending order without payments that deduct saves regardless of stock.
- Confirming requires a connection. While offline the cart stays editable.
- The order detail reloads when the screen gains focus, after **Obtener enlace** (so items and total next to the link are current), and when a seller notice for that chat arrives while it is open, at most once every 2 s.
- Before sending, mobile stores the request in a per-company queue in secure storage (`infrastructure/pending-order-confirmation.ts`); if it cannot store it, it does not send. A double tap and the background sync share one request per sale.
- When the result is uncertain, the sale stays queued and the seller can keep selling. The queue is sent automatically on sign-in, on returning to the app, on reconnecting and with exponential backoff with full jitter (up to 5 minutes). Each attempt first reads the ID in core and resends only on `ORDER_NOT_FOUND`.
- A definitive rejection during sync stops retries; the sale appears in "Nueva venta" for review and is saved again with the same order and payment IDs. The queue survives restart and sign-out and is shown only in its company. An unreadable stored sale is shown as an error that can be discarded without blocking new sales.
- If the total registered by core differs from the shown total, mobile shows both right after completing or recovering that attempt, so the seller adjusts the charge outside the app. Opening the order later shows only the registered total.
