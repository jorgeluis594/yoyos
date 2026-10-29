# Payments always accepted and automatic stock deduction on restock: product definition

**Status:** definition ready to implement. 29/10/2026; approved by the review gate in round 2. Complements [Orders](../orders.md) (lifecycle, payments, mobile sales flow) and [Products](../products.md) (stock). Since PR #226, «Guardar como pendiente» in the mobile «Nueva venta» keeps payments and leaves the order with stock not deducted. Todoist task `6hrgMcPP6mp8CPF3`. Founder rules of 29/10/2026: payments are never deleted nor rejected for any reason; if the order is fully paid and stock exists, it is deducted then; if not, the payment is accepted and the stock is deducted automatically when restocked.

## Problem and situation

A seller has order #1012 for 4 «Camisa · M», and only 3 are in stock. At 9 pm the buyer transfers the remaining S/ 80.00 and sends the screenshot in WhatsApp. The seller opens the order and taps **Aprobar** on the report. Yoyos answers «No hay stock suficiente para confirmar este pago.»: the payment is not recorded, the report stays pending, and the balance still says S/ 80.00, even though the money is already in the bank.

The same happens in four more cases:

- the seller records a manual payment that completes the total;
- the seller saves a sale with payments in web «Nueva venta»;
- the seller changes the delivery so that the payments cover the new total;
- the buyer picks a cheaper delivery in the checkout.

The seller ends up writing the payment in a notebook and remembering to record it later. When stock comes back, nothing tells them which paid orders were waiting for it.

## Goal

The seller records every payment that arrived, whatever the stock. When a paid order cannot be dispatched for lack of stock, the order says so, and says what is missing. When stock comes back, Yoyos deducts it for the waiting orders it covers, without the seller doing anything.

Hypothesis: if it works, waiting orders leave «Esperando stock» with no seller action as soon as stock exists for them. It would show in two measures: the share of waiting orders deducted automatically, and the time from «Esperando stock» to deducted, which should equal the time until the next stock increase of their variants. That payments are no longer rejected for stock is true by construction, so it is not a signal.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller recording a payment that arrived through the chat, with stock short | The payment is recorded and the balance is right | Order detail on web and mobile (manual payment, approving a report) |
| Seller building a sale with the customer waiting and less stock than requested | Save and charge the sale in one tap, knowing it will wait for stock | Mobile «Nueva venta», web «Nueva venta» |
| Seller who opens a paid order and cannot dispatch or deliver it | Understand why, and what is missing | Order detail on web and mobile |
| Buyer who paid through the checkout link | Their payment report is approved and their balance is right | Checkout (no new visible element) |

## First-version scope

- No payment operation is rejected for stock. This covers:
  - recording a manual payment;
  - approving a buyer report;
  - creating an order with payments (web and mobile);
  - changing the delivery so that payments cover the total, whether the seller does it on web or mobile or the buyer does it in the checkout.
- When one of those operations makes the order due for deduction, two things can happen. If stock is enough, the result the seller sees is already deducted, as today. If stock is short, the operation completes and the order shows «Esperando stock».
- When a variant's stock increases, Yoyos deducts the stock of the waiting orders that the increase covers.
- The order detail on web and mobile shows the «Esperando stock» notice with what is missing.
- The «Marcar enviado» / «Marcar como despachado» and «Marcar entregado» / «Marcar como entregado» buttons agree with the notice.
- Mobile «Nueva venta»:
  - the «No hay stock suficiente» dialog and «Guardar como pendiente» are removed; **Guardar** with the inline alert is enough;
  - the per-line warning and the stock labels stop saying the order cannot be fully charged.
- Web «Nueva venta» saves an order with payments and short stock instead of rejecting it.
- The only ways to deduct stock are:
  - the automatic deduction described here;
  - dispatch (unchanged);
  - creation with immediate delivery or dispatch (unchanged; it requires stock).

  The standalone «deduct stock of an order» operation is removed: no seller action and no client deducts stock directly.
- Portuguese texts change with the Spanish ones and keep the same meaning.

### Meeting point with stock editing (`6hj7HpVmhfCCHrC3`)

A restock is any increase of a variant's stock. Today the only increase is cancelling an order that had deducted stock, which restores it. Stock editing (`6hj7HpVmhfCCHrC3`, on hold, to be prioritized right after this task) will add a way for the seller to increase stock. Its increases trigger the same automatic deduction, oldest order first, without changes to this feature: that task only adds its screen and its rule for entering stock.

### What the seller does meanwhile

Until stock editing exists, a waiting order:

- leaves «Esperando stock» only when an order that had deducted the same variant is cancelled;
- cannot be dispatched or delivered.

The seller sees on the order what is missing and settles timing with the buyer in the chat. No copy tells the seller to restock, because that action does not exist yet. No way out is offered for an order whose goods are physically there but whose stock was entered wrong; that waits for stock editing (flagged in "Out of this version").

## Out of this version

- A list filter or badge for «Esperando stock» in the order list. Trigger: sellers with several waiting orders who need to find them without opening each one.
- Choosing by hand which waiting order is served first. Trigger: a seller reporting that the creation-date order served the wrong buyer.
- Deducting part of an order (some items yes, others not). Trigger: none foreseen; an order is deducted complete or not at all.
- Marking waiting orders in the label batch review. Trigger: the same as the list badge.
- Notifying the seller or the buyer when a waiting order is deducted. Trigger: when seller notifications for stock events are defined.
- **Real risk, flagged for the founder:** until stock editing (`6hj7HpVmhfCCHrC3`) exists, the seller cannot increase stock. A paid order can therefore stay «Esperando stock» indefinitely and cannot be dispatched or delivered, even when the goods are physically there. Trigger: stock editing, prioritized right after this task.

## Flow

1. The seller records a payment, approves a report, saves a sale with payments, or changes the delivery.
2. Yoyos records the payment (or the delivery), the balance, the paid status and completion, as always.
3. The order becomes due for deduction if payments now cover the total, or if a confirmed payment asked to deduct stock even though it is partial.
4. If every item has enough stock, the stock is deducted. The result the seller sees right after the response already shows «Stock descontado», as today.
5. If any item is short, nothing is deducted. The order shows «Esperando stock» with the short items.
6. When a variant's stock increases, Yoyos goes through the waiting orders that contain that variant, oldest creation date first. It deducts each order whose items are all covered by the stock available at that moment. Orders that still do not fit stay waiting.
7. A deducted order leaves «Esperando stock». It can then be dispatched or delivered under the current rules.

Alternative paths:

- **Mobile «Nueva venta», delivered at creation with short stock.** Still blocked, because delivering requires deducted stock (unchanged rule). The review stage warns and saving stays disabled. Dispatch at creation with short stock is also still blocked.
- **Web «Confirmar cobro y completar venta» (paid and delivered by hand) with short stock.** Still refused: nothing is recorded and the form stays intact. The seller can save it without delivering it, and then the payments are recorded.
- **The order is cancelled while waiting.** It leaves the waiting orders. Nothing is restored, because nothing was deducted.
- **The order stops being due.** This happens when a payment is voided, or when a delivery change raises the total, and the rest no longer covers it (and no remaining payment asked to deduct even if partial). The order leaves «Esperando stock» and shows «Stock pendiente», like any unpaid order.

## Screens

### Order detail, «Esperando stock» notice (web and mobile)

Placement:

- **Web:** a warning notice between the page header (with its badges) and the cards, above the cancel button.
- **Mobile:** a warning notice in the scroll content, right after the heading block (date, status, buyer) and the pending-reports notice when there is one, before the products card.

Accessibility:

- The notice is static. It is not announced as an alert on every load.
- Its title is a header.
- It uses the existing warning surface and warning text color, plus an icon, as the mobile pending-reports notice does. It never relies on color alone.

Content when at least one item is short:

- Title «Esperando stock».
- One line per short item, in the order of the products card. Each line shows the product name, then the combination in each platform's format (web «M · Azul», mobile «Talla: M · Color: Azul»; just the name for a product without options), then the quantity in the order and the current stock. Web: «Camisa (M · Azul): 4 en el pedido, hay 3.» Mobile: «Camisa (Talla: M · Color: Azul): 4 en el pedido, hay 3.» The wording is neutral because the order may have been made by the buyer (catalog, chat). Each variant appears once per order, so there are no repeated lines. The current stock is read when the order loads.
- «Se descontará solo cuando haya stock suficiente. Hasta entonces no se puede despachar ni entregar.»

Content when the order is due and not deducted, but no item is short (deduction in progress or being recovered, see "Rules › Guarantee"):

- Title «Descontando stock».
- «Ya hay stock para este pedido; se descontará en menos de un minuto.» The text names the recovery bound in "Rules › Guarantee". No refresh control is added (out of scope); the order shows the result when it reloads on focus (mobile) or on navigation (web), as today.

When the stock is deducted, the notice disappears. An order that is not due shows no notice.

The notice has no action. The order reloads on focus (mobile) and on navigation (web), as today; no live refresh is added.

The stock line inside «Detalles internos» shows one of three values:

| Order | Web | Mobile |
| --- | --- | --- |
| Deducted | «Descontado» | «Stock descontado» |
| Waiting | «Esperando stock» | «Esperando stock» |
| In progress («Descontando stock») | «Descontando stock» | «Descontando stock» |
| Not due | «Pendiente» | «Stock pendiente» |

### Order detail, fulfillment buttons

Web shows «Marcar enviado» and «Marcar entregado» in the «Entrega» card. Mobile shows the single next action, «Marcar como despachado» or, for store pickup, «Marcar como entregado». The rules do not change: ship needs at least one confirmed payment and deducts stock itself; deliver needs full payment and deducted stock.

What each button shows on a waiting or in-progress order:

| Order | Ship (web, mobile) | Deliver (web, mobile, store pickup included) |
| --- | --- | --- |
| «Esperando stock» | Disabled, with reason «Para despachar falta stock de Camisa (M · Azul).» | Disabled, with reason «Para entregar falta stock de Camisa (M · Azul).» |
| «Descontando stock» | Enabled, as today: shipping deducts the stock itself | Disabled, with reason «El stock se está descontando; podrás entregarlo en menos de un minuto.» |

- The reason names only the short items, in each platform's combination format; the quantities stay in the notice, so mobile does not repeat the notice's lines a few rows below. Several items are joined as a list: «Camisa (M) y Polo (L)», «Camisa (M), Polo (L) y Short (S)».

- The deliver reason «Se requiere descontar el stock antes de entregar.» is replaced by the two texts above. The only due-and-not-deducted orders are waiting or in progress; an unpaid order shows the payment reason first, as today.
- If the stock changed after the screen loaded and a tap still meets short stock, the existing «No hay stock suficiente para despachar este pedido.» is shown and the order reloads.

### Order detail, payment actions (web «Pagos» card, mobile register and review sheets)

- **Aprobar**, **Confirmar pago** and «Registrar pago» never show «No hay stock suficiente para confirmar este pago.» (web) or «… el pago.» (mobile). Those texts are removed.
- The success text is chosen from the result the response returns:
  - Web: «Pago registrado.» when the order ends deducted or not due, and «Pago registrado. El pedido queda esperando stock.» when it ends «Esperando stock». The text shows in the card, as today. «Pago actualizado.» stays for voiding and rejecting, so web and mobile say the same thing for a recorded payment.
  - Mobile: the sheet closes as today. A status line then appears in the products card, under the balance: «Pago registrado.» or «Pago registrado. El pedido queda esperando stock.». It is announced once, politely, and it stays until the seller leaves the screen or starts another payment, delivery or fulfillment action. The «Esperando stock» notice also appears at the top. To check in the UI review: on small screens the line must not push the payment buttons below the fold.
- The partial-deduction box keeps its offer rule. Its label:
  - web: «Descontar stock aunque sea un abono parcial» (unchanged);
  - mobile: «Descontar stock con abono parcial», in the register sheet, the review sheet and the «Nueva venta» payment card (replacing «Descontar stock ahora»).

  With short stock, the box leaves the order waiting instead of failing.
- The mobile reason «No disponible: un pago que cubre el saldo descuenta el stock automáticamente.» becomes «No hace falta: al cubrir el saldo, el stock se descuenta solo.».

### Order detail, delivery (web «Entrega» card, mobile «Entrega» screen)

- Saving a delivery that makes payments cover the total no longer shows «No hay stock suficiente. Conservamos la entrega anterior.». The delivery is saved.
- Web shows «Entrega guardada.» when the order ends deducted or not due, and «Entrega guardada. El pedido queda esperando stock.» when it ends waiting.
- Mobile «Entrega» returns to the detail, as today, with no success text for any outcome. The «Esperando stock» notice at the top is the feedback, because the detail reloads on focus.

### Label batch printing (mobile «Ventas» › «Imprimir rótulos»)

Unchanged: waiting orders are listed and printed like any order pending dispatch, with no mark in the batch review. The seller finds out on the order detail that it cannot be dispatched. Trigger to mark them in the batch review: the list badge or filter for «Esperando stock» (see "Out of this version").

### Checkout (buyer)

Confirming a delivery no longer fails with «No hay stock suficiente. Contacta al vendedor.». The buyer never sees whether the order is waiting for stock.

### Mobile «Nueva venta», products stage, per-line warning (`creationStockWarning`)

- One unit: «Solo hay 1 disponible. Puedes guardarlo y cobrarlo; si lo cobras, quedará esperando stock y no podrás despacharlo hasta que se descuente.»
- Several or zero: «Solo hay 3 disponibles. Puedes guardarlo y cobrarlo; si lo cobras, quedará esperando stock y no podrás despacharlo hasta que se descuente.»

### Mobile «Nueva venta», review stage

- When payments would deduct stock and some quantity exceeds the shown stock, an inline warning stays above **Guardar**: «Falta stock: se guardará con los pagos y quedará esperando stock.».
- **Guardar** saves directly, with all payments. The warning is computed from the shown stock, so a sale whose stock dropped on the server after the screen loaded saves as waiting with no warning first; the order detail it opens shows the notice. The «No hay stock suficiente» dialog, its **Guardar como pendiente** and **Volver**, and the per-item lines in that dialog are removed.
- Delivered with short stock stays blocked with «Reduce la cantidad o repón el stock para guardarlo como entregado.». That text becomes «Reduce la cantidad para guardarlo como entregado.», because restocking is not available. Dispatch at creation with short stock stays blocked with its current «Para despachar falta stock de …».

### Web «Nueva venta»

- The per-item note becomes «Disponible: 3. Si lo cobras, el pedido quedará esperando stock.».
- Saving with payments and short stock succeeds and opens the order, which shows «Esperando stock».
- «No hay stock suficiente para uno de los productos.» stays only for «Confirmar cobro y completar venta».

## Rules

| Aspect | Behavior |
| --- | --- |
| Payments and stock | No payment is rejected, deleted or left unrecorded because of stock. The payment, the balance, the paid status and completion are recorded whether or not stock can be deducted. |
| Due for deduction | An order is due when it is not cancelled, its stock is not deducted, and either confirmed payments cover the total or a confirmed payment asked to deduct even though it is partial. This is derived from the order; nothing else marks it. |
| «Esperando stock» | A due order with at least one item whose current stock is below its quantity. |
| «Descontando stock» | A due order whose items all have enough stock and that is not deducted yet. It is transitional; see "Guarantee". |
| Enough stock at payment | When a payment, a delivery change or a creation makes an order due and every item has enough stock, the result the seller sees right after the response is already deducted, as today. |
| Guarantee | A due order whose items all have enough stock never stays undeducted, store pickup included. It is deducted without seller action, without another stock increase and without being deducted twice, even if one attempt fails, within 1 minute (initial value, adjustable; the «Descontando stock» texts name it). How the platform achieves this is architecture; today events have no outbox, so the mechanism must close that gap. |
| All or nothing | If every item of the order has enough stock, all of it is deducted; otherwise nothing. Example: order #1012 with 4 Camisa M and 2 Polo L, and stock of 3 and 5. Nothing is deducted until Camisa M reaches 4. |
| Order between waiting orders | Oldest creation date first; an order that does not fit is skipped and the next ones are tried. Example: a restock leaves Camisa M at 3; #1010 needs 5 and #1012 needs 2. #1012 is deducted, and #1010 keeps waiting with «5 en el pedido, hay 1». |
| New sale versus waiting orders | A stock increase and the deduction of the waiting orders it covers are one step: no payment, creation or dispatch can take the increased units in between. A sale paid while stock is available (not taken by waiting orders) is deducted right away, as today. |
| Stock source | Stock is never negative and is never deducted twice for the same order. It is deducted only by the automatic deduction, by dispatch and by creation with immediate delivery or dispatch, and restored only by cancellation (unchanged). No seller action deducts stock of an order. |
| Restock | Any increase of a variant's stock. Today: cancelling an order that had deducted it. Later: stock editing (`6hj7HpVmhfCCHrC3`). |
| Timing after a restock | Waiting orders covered by a stock increase are deducted together with the increase. «Descontando stock» appears only when an attempt did not complete and the guarantee is recovering it. |
| Inactive variants | A waiting order with a deactivated variant is still deducted on restock, just as orders with inactive variants are paid today. |
| Dispatch and delivery | The rules do not change; only the button presentation does (see "Fulfillment buttons"). |
| Voiding | Voiding a payment never restores stock (unchanged). If the order stops being due, it leaves «Esperando stock». |
| Mobile «Guardar como pendiente» | Removed, along with its dialog and the creation option that deferred deduction. With the new rules, **Guardar** produces the same order. A sale left in doubt on a device before the update that is re-sent still carrying that option is treated as a plain save, never rejected. |
| Existing orders | Orders already saved with payments that cover the total and stock not deducted (for example, from «Guardar como pendiente») become due. They show «Esperando stock» or «Descontando stock» and fall under the guarantee. There are no businesses in production, so no transition is designed. |

## When something fails

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| Payment recorded, stock deducted | «Pago registrado.» on web and mobile; «Stock descontado» | Continue |
| Payment recorded, stock short | Web «Pago registrado. El pedido queda esperando stock.»; the same on mobile in the products card; the «Esperando stock» notice | Nothing in the app; tell the buyer in the chat |
| Known payment rejection (invalid amount, cancelled order, already reviewed) | Unchanged messages, e.g. «Este pago ya fue revisado.»; form intact | Correct or reload |
| Payment not sent (no connection) | Unchanged «No se pudo guardar el pago. Inténtalo de nuevo.»; form intact | Retry; the same payment is never recorded twice |
| Payment in doubt | Unchanged: the order is read before offering to repeat | Repeat only if it was not recorded |
| Automatic deduction not completed although stock is enough | «Descontando stock» notice; deliver disabled with its reason; ship enabled | Nothing; Yoyos completes it within 1 minute under the guarantee |
| Partially paid order (not due, no deduction box) with short stock | Unchanged: no notice, ship enabled, and the tap fails with «No hay stock suficiente para despachar este pedido.». The ship rule is out of scope and this order is not waiting | Record the rest of the payment or wait for stock |
| Mobile «Nueva venta» whose server stock dropped after the screen loaded | No warning before saving; the sale saves with all payments and the opened detail shows «Esperando stock» | Nothing; tell the buyer in the chat |
| Two waiting orders compete for the same units | The oldest that fits is deducted; the other keeps waiting with the updated «hay N» | Nothing |
| Ship tapped after stock changed on screen | «No hay stock suficiente para despachar este pedido.»; the order reloads | Nothing until stock exists |
| Mobile delivered at creation with short stock | Unchanged block; saving disabled with «Reduce la cantidad para guardarlo como entregado.» | Change the quantity or save without delivered |
| Web paid-and-delivered sale with short stock | «No hay stock suficiente para uno de los productos.»; form intact | Save it without delivering it |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller of the company | «Esperando stock», «Descontando stock» and the short items of their orders | Record and approve payments regardless of stock | Deduct stock of an order directly; choose which waiting order is served first |
| Buyer | Their payments and balance | Report payments; choose delivery in the checkout | See stock or whether the order is waiting |

## Information that is kept

- Nothing new is copied into the order. Whether an order is waiting is derived from its payments, its stock deduction, its cancellation and the current stock.
- The «hay N» in the notice and the button reasons is the current stock, read when the order loads. It is an instruction to act now, not part of the agreement.
- No history of deduction attempts is kept for the seller.

## Vocabulary

- **«Esperando stock»:** a paid (or partial-with-deduction) order whose stock could not be deducted because an item is short. Yoyos deducts it when stock increases.
- **«Descontando stock»:** a due order whose stock is available and is being deducted.
- **«Stock pendiente»:** an order whose stock is not deducted because it is not due yet (unpaid, no partial request). Unchanged.
- **Restock:** any increase of a variant's stock.

## Replaced sections of current documents (for promotion on merge)

`docs/orders.md`:

- **Lifecycle:** the bullet "Registering a payment deducts stock … a shortage returns `INSUFFICIENT_STOCK` and rolls everything back", and the last bullet about a sale rejected for stock after money was received.
- **Payments:** "Approve applies the stock rule …; `INSUFFICIENT_STOCK` records nothing", and the «Partial stock choice» label.
- **Creating an order:** the all-or-nothing paragraph, which keeps atomicity but no longer fails for stock on payments, and the Errors table row `409 INSUFFICIENT_STOCK`, which now covers only immediate delivery or dispatch.
- **Other operations:** the «Deduct stock» route (removed).
- **Mobile sales flow:** the review-stage bullet about «No hay stock suficiente», «Guardar como pendiente», `paymentsWithoutStockDeduction` and the per-line warning. That bullet is already stale (it says the dialog drops payments).

`docs/products.md` › Stock row: "changes only when an order deducts it" now includes the automatic deduction.

## Closed decisions

| Decision | Why |
| --- | --- |
| No payment is rejected or deleted for stock | Founder rule of 29/10/2026: money that arrived must be recorded |
| Deduction is attempted whenever an order becomes due (payment accepted, creation with payments, a delivery change that makes payments cover the total, seller or buyer) and on stock increase, never through a seller action in the order | Founder design of 29/10/2026; every path that makes an order due needs a trigger |
| With enough stock, the payment's result is already deducted | The task requires "como hoy"; anything else would show a false «Esperando stock» |
| A due order with stock never stays undeducted | Otherwise a store-pickup order could be stranded with goods on the shelf |
| An order is deducted complete or not at all | A half-deducted order cannot be dispatched and hides what is missing |
| Waiting orders are served oldest first, skipping those that do not fit | Simple and predictable; stock does not sit idle behind a large order |
| Waiting orders are served in the same step as the stock increase | Otherwise a newer payment or a dispatch could take the units in between |
| «Guardar como pendiente» and its dialog are removed | **Guardar** produces the same order; the dialog only added a tap |
| The standalone stock-deduction operation is removed | A second path would bypass oldest-first |
| Dispatch and delivery rules do not change | Out of scope of the task |
| Copy never tells the seller to restock | Restocking does not exist until `6hj7HpVmhfCCHrC3` |

## Acceptance criteria

1. Order #1012 has 4 Camisa M, stock 3, and S/ 40.00 paid of S/ 120.00. The seller approves a report for S/ 80.00 on web. The payment is confirmed, the balance is S/ 0.00, the order is «Pagado», the card says «Pago registrado. El pedido queda esperando stock.», and the notice shows «Esperando stock» with «Camisa (M): 4 en el pedido, hay 3.». Stock stays at 3.
2. Same order with stock 4. Approving the S/ 80.00 report shows «Pago registrado.», the response already shows «Stock descontado» with no notice, and stock is 0.
3. A manual payment of S/ 120.00 on mobile, on an order with short stock, is recorded. The sheet closes and the products card shows «Pago registrado. El pedido queda esperando stock.». No «No hay stock suficiente» message appears.
4. A partial payment of S/ 50.00 with «Descontar stock con abono parcial» on an order with short stock is recorded, and the order shows «Esperando stock».
5. Cancelling order #1008, which had deducted 2 Camisa M, raises the stock from 2 to 4. Order #1012 (waiting, needs 4) is deducted together with that increase and stock ends at 0. Reopening #1012 shows «Stock descontado».
6. A restock leaves Camisa M at 3, with #1010 (5 units, created 20/10/2026) and #1012 (2 units, created 22/10/2026) waiting. #1012 is deducted, and #1010 keeps waiting with «5 en el pedido, hay 1.».
7. An order with 4 Camisa M and 2 Polo L is waiting. Polo L increases but Camisa M is still short: nothing is deducted, and the notice lists only Camisa M.
8. A waiting order is cancelled, then Camisa M is restocked: the cancelled order is not deducted.
9. The only covering payment of a waiting order is voided. The order shows «Stock pendiente» without the notice and is not deducted on the next restock.
10. A delivery change raises the total of a waiting order above its payments. The order leaves «Esperando stock» and shows «Stock pendiente».
11. On web, the seller changes the delivery so that payments cover the total, with short stock. The delivery is saved with «Entrega guardada. El pedido queda esperando stock.». On mobile «Entrega», the same change returns to the detail, which shows the notice.
12. The buyer picks a cheaper delivery in the checkout so that existing payments cover the total, with short stock. The checkout confirms without a stock message, and the seller sees «Esperando stock».
13. Mobile «Nueva venta» with 4 Camisa M and shown stock 3, paid in full. The line shows the new warning, the review stage shows «Falta stock: se guardará con los pagos y quedará esperando stock.», and **Guardar** saves without a dialog. The order has all its payments and shows «Esperando stock».
14. Same sale, but the server's stock is 4 because it was restored after the screen loaded. **Guardar** saves the order already deducted.
15. Web «Nueva venta» with payments covering the total and short stock saves the order. «Confirmar cobro y completar venta» with short stock is still refused, with the form intact.
16. A waiting store-pickup order on mobile shows «Marcar como entregado» disabled, with «Para entregar falta stock de Camisa (Talla: M).». A waiting home-delivery order on web with two short items shows «Marcar enviado» disabled, with «Para despachar falta stock de Camisa (M) y Polo (L).».
17. A due order whose deduction did not complete although stock is enough shows «Descontando stock» with «se descontará en menos de un minuto». Deliver is disabled with its reason, and within 1 minute the order ends deducted without seller action or another restock.
18. Approving the same report twice after an uncertain response records one payment and deducts at most once.
19. Two restocks in quick succession for the same waiting order deduct it only once.
20. The order detail of a catalog order never says «pediste».
21. Order #1012 waits for 4 Camisa M. Cancelling #1008 restores 4 units while the seller is saving a new sale of 2 Camisa M paid in full. #1012 gets the 4 units; the new sale is saved with its payment and shows «Esperando stock».
22. A mobile sale left in doubt before the update is re-sent from the queue carrying the old deferral option: it is saved like a plain **Guardar**, not rejected.
23. A partially paid order with short stock and no deduction box shows no notice; tapping «Marcar como despachado» shows «No hay stock suficiente para despachar este pedido.», as today.

## Questions decided by the review gate

| Question | Answer | Decided by | Reason | Discarded alternatives |
| --- | --- | --- | --- | --- |
| Restocking does not exist today; how does this task relate to stock editing? | Keep this task as defined and prioritize `6hj7HpVmhfCCHrC3` right after it. Copy must not tell the seller to restock, and the draft says what the seller does meanwhile and where the two tasks meet. | Both reviewers | Payments stop being lost now; the restock trigger already covers any increase, so stock editing only adds | Adding a minimal «Reponer stock» here (pre-decides `6hj7HpVmhfCCHrC3`'s open definition); doing stock editing first (payments keep being lost) |
| Name for a paid order waiting for stock | «Esperando stock», keeping «Stock pendiente» for orders not due | Both reviewers | It says what the order waits for and does not clash with «Stock pendiente» | «Stock por descontar» (a near-synonym of «Stock pendiente») |
| What the seller sees after a covering payment with enough stock | Already deducted in the response, as today; the success text is chosen from the real result | Both reviewers (round 1 blockers) | The task requires "como hoy"; a false «Esperando stock» breaks the guarantee | Leaving the timing to implementation |
| Guarantee for a due order with enough stock | It never stays undeducted (store pickup included), with no seller action, no second restock and no double deduction; shown as «Descontando stock» meanwhile | Both reviewers (product blocker F2, UX/UI blocker 1) | Without it, an order can be stranded with stock available | Retrying only on the next stock increase |
| Mobile «No hay stock suficiente» dialog and «Guardar como pendiente» | Removed; the inline alert plus **Guardar** is enough; deferring deduction at creation is removed; the delivered-at-creation block stays | Both reviewers (objections to the decided list) | **Guardar** produces the same order, and the dialog adds a tap | Keeping the dialog with a renamed button |
| Standalone stock-deduction operation | Removed | Both reviewers | A second path would bypass oldest-first and the task's "only the listener" criterion | Keeping it without a client |
| Ship and deliver on a waiting order | Rules unchanged; buttons disabled with reasons that name the short items, and deliver has its own «Descontando stock» reason | Both reviewers | The notice and the buttons must agree, store pickup included | Leaving ship enabled so it fails after the tap |
| Mobile feedback for "payment recorded, stock waiting" | A status line in the products card under the balance, plus the notice | UX/UI reviewer (blocker 2) | The sheets close on success and had no surface | A sheet success notice (does not exist) |

### Round 2 suggestions

All 13 round 2 suggestions were applied:

- UX/UI 1–2: button reasons name the items only, as a list.
- UX/UI 3: the partially paid short-stock case is stated as unchanged.
- UX/UI 4: label batches are unchanged, with a trigger.
- UX/UI 5 and product S2: there is a 1-minute recovery bound in the copy, and no refresh control (out of scope).
- UX/UI 6: stale shown stock is stated.
- UX/UI 7: a UI review check is noted.
- Product S1: the increase and the deduction are one step.
- Product S3: the «Descontando stock» stock line is added.
- Product S4: «Pago registrado.» is used on both platforms.
- Product S5: every due-making path is a trigger.
- Product S6: an old deferral option is treated as a plain save.

## Routine decisions approved by the review gate

No question remains open. The review gate approved these routine decisions in round 2 with no objections; the founder confirms them in the pull request:
- Waiting orders are served oldest first by creation date; an order that does not fit is skipped and the next ones are tried.
- An order is deducted complete or not at all.
- The partial-deduction box with short stock leaves the order waiting instead of failing. On mobile it is labeled «Descontar stock con abono parcial» everywhere.
- The notice shows only on the order detail: on web between the header and the cards, on mobile after the heading block. There is no list filter or badge in this version.
- The notice uses the neutral «4 en el pedido, hay 3»; the button reasons name only the short items, as a list; both use each platform's combination format.
- Waiting orders are deducted in the same step as the stock increase; «Descontando stock» appears only while the guarantee recovers a failed attempt, within 1 minute (initial value, adjustable).
- On a waiting order, ship is shown disabled with the short items even though its rule is unchanged. On an in-progress order, ship stays enabled because it deducts the stock itself.
- After a recorded payment, web and mobile say «Pago registrado.» or «Pago registrado. El pedido queda esperando stock.» (mobile in a status line in the products card); web keeps «Pago actualizado.» for voiding and rejecting.
- Waiting orders are printed in label batches as today, unmarked.
- A partially paid order with short stock keeps today's ship behavior (enabled, fails on tap).
- No refresh control is added for «Descontando stock».
- Web adds «… El pedido queda esperando stock.» to «Entrega guardada.»; mobile «Entrega» relies on the notice, because it has no success text today.
- The delivered-at-creation text drops «o repón el stock».
- Paid-and-delivered sales and dispatch at creation with short stock stay refused, with the form intact.
- Changing the delivery (seller or buyer) no longer fails for stock.
- No notification is sent when a waiting order is deducted; the seller sees it on the next load.
- Orders already saved as paid with stock not deducted become due, without a transition.
- Portuguese texts follow the Spanish meaning.
