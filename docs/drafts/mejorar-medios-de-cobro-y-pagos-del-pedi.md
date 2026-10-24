# Payment methods and order payments: product definition

**Status:** draft with open questions. Today the web app has «Medios de cobro» (Settings → Medios de cobro) with a digital wallet (provider, holder, optional image) and a bank transfer; the order detail «Pagos» card lists payments with a confirmation form under each buyer report plus a second identical «Registrar pago manual» form; «Ver captura» opens the receipt in a new tab. Mobile shows the same payments in the order detail and confirms reports from a sheet. This draft complements [orders](../orders.md) and [checkout](../checkout.md). Todoist task 6hqMXcQmXQ4fMWc3, 23/10/2026. Mockups b1–b4 of 23/10/2026 are a reorganization reference; where they differ from this document, this document wins.

## Problem and situation

At 10:12 pm a buyer of Order #1042 taps «Ya pagué» and attaches a Plin screenshot. The seller opens the order on the web and finds two identical forms with «Confirmar pago», one under the report and one for a manual payment, and cannot tell which one to use. To read the screenshot they open a new tab and lose the order. If the screenshot is from another business or is a meme, the only options are to leave the report pending forever or to confirm it: nothing says "this is not valid", and the buyer, who sees «pendiente de revisión», cannot send another one. Earlier, while setting up, the seller uploaded a landscape photo as the "wallet image" because the field said «Imagen opcional»; buyers saw a holder name and no QR, and asked through chat where to pay.

## Goal

The seller configures a digital wallet that always carries a real, readable payment QR; in the order detail they review each buyer receipt in a modal and approve or reject it in one step, with a manual payment clearly separate. Hypothesis: fewer "where do I pay?" messages and no reports left pending; it would show as reports reaching «Aprobado» or «Rechazado» within the day and as rejected buyers sending a second receipt from the checkout.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller setting up how they get paid, once or when they change wallet | Leave a wallet that buyers can actually pay to | Web, Settings → Medios de cobro |
| Seller at night checking the "I already paid" of the day | See the receipt, decide, record the amount received | Web order detail; mobile order detail |
| Seller who received cash or a payment agreed in chat | Record it without confusing it with a report | Web order detail «Registrar pago»; mobile «Registrar pago» |
| Buyer who opened the order link from WhatsApp and paid | Pay with the QR, send the receipt, and know if it was not accepted | Checkout (mobile browser) |

## First-version scope

1. «Medios de cobro» reorganized as b1/b2, without the «Así lo verá tu comprador» preview. Bank transfer keeps all its fields; its image stays optional.
2. Mandatory payment QR for the digital wallet, validated by Yoyos when the image is chosen and again on saving, on the web page and on any client that saves payment methods.
3. No legacy path: a saved wallet without a readable QR is not offered to buyers and shows the QR error in the panel until the seller saves a valid one.
4. New «Rechazado» outcome for a buyer report, with an optional reason.
5. Checkout: a rejected report shows «Tu comprobante fue rechazado» in «Comprobantes enviados» and the buyer can send another receipt with the current flow.
6. Web «Pagos» card as b3: three summary cells, one row per payment (reports with **Rechazar** and **Aprobar**; confirmed with **Anular pago**; rejected and voided with their state), and «¿Te pagaron por fuera? Registrar pago» as a separate secondary action that opens its own form. The duplicated form disappears.
7. Receipt modal as b4, opened from «Ver captura» and from the thumbnail.
8. The «Descontar stock aunque sea abono parcial» box appears only when the amount does not cover the balance (rule below), when approving and in the manual payment.
9. Mobile: rejected payments are shown as «Pago rechazado» and the stock box follows the same rule. Whether mobile also gets **Rechazar** is question 3.
10. Texts in Spanish and Portuguese.

Meeting point with task 6hqMXP6qmJV5Fc73 (compact checkout payment): that task reorganizes the checkout payment block. This one only adds the rejected state to «Comprobantes enviados» and the re-upload after a rejection; the compact layout keeps both.

## Out of this version

- «Así lo verá tu comprador» preview in Medios de cobro: not built.
- Visual redesign of the panel: only the reorganization of b1–b4 with the current style.
- New payment methods, gateways, automatic verification of transfers, or QR generation by Yoyos.
- Mandatory image for bank transfer.
- Checking that the QR belongs to the chosen provider or holder: any readable QR is accepted. Trigger: sellers uploading QRs from another account. Flagged as minor risk (a buyer could pay the wrong account), not deferred into a task unless the founder asks.
- Undoing a rejection: a rejected report stays rejected; the buyer sends another receipt. Trigger: sellers rejecting by mistake often.
- b3/b4 reorganization of the mobile payment section (reports stay in the current list and sheet).
- Changing the stock deduction rule or the voiding of confirmed payments.
- Notifying the buyer of a rejection outside the checkout (WhatsApp, email): the seller tells them in chat.

## Flow

**Setting up the wallet (web)**

1. Settings → Medios de cobro. The seller ticks «Ofrecer billetera digital», types Proveedor and Titular.
2. In «QR de cobro *» chooses the screenshot of the QR from their wallet app. The field shows «Revisando QR…», then the thumbnail, file name and size, and «✓ QR válido».
3. **Guardar cambios**. Yoyos reads the QR again; on success «Medios de cobro guardados.» The buyer sees the QR from that moment.
- The image has no readable QR: the field turns red with «Esta imagen no es un código QR. Sube la captura del QR de tu billetera.», **Guardar cambios** is disabled with «Corrige el QR de cobro para guardar.», and the rest of the form stays as typed.
- The QR cannot be checked right now: «No pudimos revisar el QR. Inténtalo de nuevo.» with **Reintentar**; nothing is saved.

**Reviewing a report (web)**

1. The buyer taps «Ya pagué» with a receipt. In the order detail, «Pendiente» shows «Pago por revisar» and «Pagos del pedido» shows the row «Pago reportado · Reportado por el comprador · 23/10/2026 10:12 p. m.» with thumbnail, «Ver captura», **Rechazar** and **Aprobar**.
2. The seller taps the thumbnail or «Ver captura»: the «Comprobante de pago» modal opens with the large image.
3. **Aprobar** opens «Aprobar pago» with «Importe recibido» prefilled with the balance (S/ 70.00) and «Medio de pago». If the amount covers the balance, **Aprobar pago S/ 70.00** confirms it; Recibido becomes S/ 70.00, Pendiente S/ 0.00, the row shows «Pago confirmado» with **Anular pago**, and stock is deducted under the current rule.
- Partial: the seller changes the amount to S/ 30.00; the box «Descontar stock aunque sea abono parcial» appears unticked. Pendiente becomes S/ 40.00.
- Reject: **Rechazar** opens «Rechazar comprobante» with «Motivo (opcional)» and **Rechazar comprobante** / **Volver**. The row becomes «Pago rechazado» with the reason; Recibido and Pendiente do not change; stock is not touched.
- The seller closes the modal with ×, Escape or a click outside without deciding: the report stays pending.

**Recording a manual payment (web)**

1. «¿Te pagaron por fuera? Registrar pago» («Para pagos en efectivo o acordados directamente con el comprador.») opens «Registrar pago» with the same amount, method and conditional stock box. **Confirmar pago** records it.

**Buyer after a rejection**

1. In the checkout, «Comprobantes enviados» shows the receipt with «Tu comprobante fue rechazado» (and the reason, depending on question 2).
2. The «Adjunta tu comprobante» block is available again; the buyer uploads another receipt and taps «Ya pagué». It appears to the seller as a new report row.

## Screens

**Medios de cobro (web, Settings → Medios de cobro):**
- Title «Medios de cobro», «Muestra al comprador los datos actuales para pagar su pedido.» Two cards and **Guardar cambios** at the end. No preview block.
- «Billetera digital», «Configura un proveedor, titular y el QR con el que te pagan.», «Ofrecer billetera digital». When ticked: Proveedor, Titular and «QR de cobro *». The phone number field and the provider list depend on question 1.
- «QR de cobro *» states:
  - Empty: drop zone **Subir QR**; help «Obligatorio. Sube la captura del QR desde la app de tu billetera (JPG, PNG o WEBP, hasta 10 MB).»
  - Uploading/checking: «Revisando QR…».
  - Valid: thumbnail, file name · size, «✓ QR válido», **Cambiar imagen**, **Quitar imagen**.
  - Not a QR: red border, the chosen image's thumbnail, «Esta imagen no es un código QR. Sube la captura del QR de tu billetera.», **Cambiar imagen**.
  - Wrong file: «Usa una imagen JPG, PNG o WEBP de hasta 10 MB.»
  - Saved wallet with no valid QR (on opening the page): red field with «Tus compradores no ven esta billetera hasta que subas un QR válido.»
  - Could not check: «No pudimos revisar el QR. Inténtalo de nuevo.» with **Reintentar**.
- **Guardar cambios** is disabled while the wallet is offered without a valid QR, with «Corrige el QR de cobro para guardar.» (or «Sube el QR de cobro para guardar.» when empty). Unticking «Ofrecer billetera digital» removes the requirement.
- No text of the wallet says «Imagen opcional». «Transferencia bancaria» keeps Banco, Titular, Número de cuenta, CCI and its «Imagen opcional».
- Saving failures keep everything typed: «Revisa los datos de cobro e inténtalo de nuevo.»

**Pagos card (web, Pedidos → order detail):**
- Three cells: «Total S/ 70.00» («Incluye entrega S/ 10.00» when there is a delivery charge), «Recibido S/ 0.00», «Pendiente S/ 70.00» with «Pago por revisar» while at least one report is pending. The overpayment notice stays as today.
- «Pagos del pedido», newest first, one row per payment:
  - Reported: receipt thumbnail with magnifier, «Pago reportado», «Reportado por el comprador · <date time>», «Ver captura», **Rechazar** (secondary), **Aprobar** (main). No amount or method: the buyer does not declare them.
  - Confirmed: «S/ 70.00 · Billetera digital», «Pago confirmado · <date time>», «Ver captura» if it came from a report, **Anular pago**.
  - Rejected: «Pago rechazado · <date time>», the reason if given, «Ver captura». No actions.
  - Voided: «Pago anulado» with amount and method, as today. No actions.
  - Empty: «Aún no hay pagos registrados.»
- Separated at the end, only when the order is not cancelled and Pendiente is above S/ 0.00: «¿Te pagaron por fuera? Registrar pago» and «Para pagos en efectivo o acordados directamente con el comprador.»
- In a cancelled order: rows are read-only (no **Aprobar**, **Rechazar**, **Registrar pago**); **Anular pago** stays as today.

**Comprobante de pago (web modal):**
- «Comprobante de pago», «Pedido #1042 · Reportado por el comprador · 23/10/2026 10:12 p. m.», × to close. The image fits the viewport (also at 390 px wide) without opening a new tab.
- Footer for a pending report: «Pendiente S/ 70.00», **Rechazar** and **Aprobar**, which lead to the same dialogs as the row. For a confirmed, rejected or voided payment the footer shows its state and no decision buttons.
- Image fails to load: «No se pudo cargar la captura.» with **Reintentar**; the decision buttons stay available.
- Closes with ×, Escape or a click outside.

**Aprobar pago / Registrar pago (web dialog):**
- «Importe recibido (S/)» prefilled with the balance when it is above zero, empty otherwise; «Medio de pago» Billetera digital / Transferencia bancaria; the stock box under the rule; main button «Aprobar pago S/ 70.00» (updates with the amount) or «Confirmar pago» for the manual one; **Cancelar**.
- Invalid amount: «Escribe un importe mayor a 0 con hasta 2 decimales.» next to the field.

**Rechazar comprobante (web dialog):**
- «¿Rechazar este comprobante?», «El saldo seguirá pendiente y el comprador podrá enviar otro comprobante.», «Motivo (opcional)» (up to 200 characters), **Rechazar comprobante**, **Volver**.

**Order detail payments (mobile):**
- Keeps its current layout: «Registrar pago», list «Ver pagos», report rows with **Revisar pago** and the receipt opened outside the app.
- Adds «Pago rechazado» rows with date and reason; today any non-reported, non-voided payment is labeled as confirmed, so this label is required, not cosmetic.
- The review/register sheet shows «Descontar stock aunque sea abono parcial» only under the same rule as the web.
- **Rechazar** in the review sheet: question 3.
- Mobile has no payment settings screen; nothing changes there.

**Checkout (buyer):**
- Wallet section shows provider, holder and the QR on its white plate. A wallet without a valid QR is not listed; if no method remains, the current «noSettings» text is shown.
- «Comprobantes enviados»: each receipt with its state; rejected ones read «Tu comprobante fue rechazado».
- While a report is pending, the pending notice replaces the upload block (as today). When the last report was rejected and the balance is above zero, the upload block returns.

## Rules

| Aspect | Behavior |
| --- | --- |
| QR required | A wallet that is offered must have an image with a readable QR. A wallet that is not offered needs nothing. |
| What counts as a valid QR | Yoyos decodes at least one QR in the image. Its content is not compared with the provider or holder. A Yape or Plin screenshot passes; a landscape photo or meme does not. |
| When it is checked | When the image is chosen (to show «QR válido» at once) and again on saving, which is the check that counts. Any client saving payment methods gets the same rejection. |
| Checker unavailable | Nothing is saved; the seller retries. Never saved "unchecked". |
| Previously saved wallets | Same requirement, no transition: a wallet without a readable QR is not offered to buyers and the panel shows the QR error. No business is operating in production. |
| Bank transfer | Unchanged; its image stays optional and is not checked as QR. |
| Who sets the amount | The buyer's report carries only a receipt. The amount that reduces the balance is the one the seller types when approving. |
| Approve | Turns the report into a confirmed payment with the same receipt, amount and method typed by the seller. Applies the current stock rule. `INSUFFICIENT_STOCK` records nothing. |
| Stock box | Shown only when the stock was not yet deducted and the typed amount is below the pending balance. Example: total S/ 70.00, nothing received, amount S/ 70.00 → hidden, stock is deducted; amount S/ 30.00 → shown, unticked. With S/ 40.00 already received, S/ 30.00 covers the balance → hidden. Same for manual payment, web and mobile. |
| Reject | Only a pending report can be rejected. It does not add to Recibido, does not change Pendiente and does not touch stock. Reason optional, up to 200 characters. |
| After rejecting | Final. The buyer can send a new receipt, which is a new report. |
| Several reports | Each row is decided independently. The buyer can have only one pending report at a time (as today). |
| Cancelled order | Reports cannot be approved or rejected and no manual payment is recorded. |
| Voiding | Unchanged: only confirmed payments; voiding does not return stock. |

## States

Buyer-reported payment and recorded payment:

| State | Meaning | What triggers it | What can be done | Seller sees | Buyer sees |
| --- | --- | --- | --- | --- | --- |
| Reportado | The buyer says they paid; does not count | «Ya pagué» with receipt | Approve, reject | «Pago reportado», **Aprobar**, **Rechazar** | Pending-review notice |
| Confirmado | Verified by the seller; counts | **Aprobar** or manual **Confirmar pago** | Void | «Pago confirmado», amount, method | Receipt with confirmed state |
| Rechazado | The seller did not accept the receipt; never counted | **Rechazar** | Nothing | «Pago rechazado», reason | «Tu comprobante fue rechazado», upload again |
| Anulado | A confirmed payment that was a mistake; stops counting | **Anular pago** | Nothing | «Pago anulado» | Receipt with voided state |

Transitions: Reportado → Confirmado; Reportado → Rechazado; Confirmado → Anulado. Rechazado and Anulado are final. Existing records keep their state; no existing report becomes rejected.

## When something fails

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| Wallet saved | «Medios de cobro guardados.» | — |
| Offered wallet without QR, or image without QR | Field error (b2), **Guardar cambios** disabled; everything typed is kept | Upload another image or untick the wallet |
| QR checker unavailable (on choose or save) | «No pudimos revisar el QR. Inténtalo de nuevo.»; nothing saved | **Reintentar** |
| Save not sent / no response | «Revisa los datos de cobro e inténtalo de nuevo.» with the form intact; on reload the page shows what is actually saved | Save again (saving is a full replacement, repeating does not duplicate) |
| Approve succeeded | Row «Pago confirmado», cells updated, «Pago guardado.» | — |
| Approve without stock | Dialog stays open with amount and method: «No hay stock suficiente para confirmar este pago.»; nothing recorded, report still pending | Change stock in Productos and retry, or reject |
| Approve/reject on a report already decided elsewhere (other tab, mobile) | «Este pago ya fue revisado.» and the card reloads with its real state | — |
| Approve or reject without response | «No sabemos si se guardó. Revisa el pedido antes de repetir.»; the card reloads; actions on that row stay blocked until it does | Repeat: approving or rejecting the same report again returns the same result, never a second payment |
| Manual payment without response | Same notice; repeating from the same open form does not create a second payment | Reload and verify |
| Receipt image does not load | «No se pudo cargar la captura.» in the modal or row | **Reintentar**; deciding is still allowed |
| Buyer uploads after rejection and the upload fails | Current checkout messages | Current retry |
| Seller closes a dialog midway | Nothing recorded; the report stays pending | Open it again |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller (signed in, own business) | All payments of their orders, receipts, rejection reasons, wallet QR | Configure methods, approve, reject, record, void | Act on another business's orders |
| Buyer (order link) | Current payment methods with QR, their own receipts and their state | Send a receipt, send another after a rejection | See internal payment records, amounts typed by the seller as decisions, other orders |

The receipt is evidence seen by both. The rejection reason is seen by the buyer depending on question 2.

## Information that is kept

- The wallet QR is an instruction to act now: the buyer always sees the current one; changing it does not touch existing orders or payments.
- A rejected report keeps its receipt, the date of the report, who rejected it, when and the optional reason. A new receipt is a new report; the rejected one stays in the history.
- Previously saved wallets keep their data; only being offered depends on a valid QR.

## Vocabulary

- Rechazado («Pago rechazado», buyer: «Tu comprobante fue rechazado»): a report whose receipt the seller did not accept; it never counted. A new state because «Anulado» applies only to confirmed payments with an amount, and leaving the report pending blocks the buyer from sending another.
- Anulado («Pago anulado»): a confirmed payment recorded by mistake, which stops counting.
- Aprobar: the seller's action on a report, which records it as «Pago confirmado» with the amount they received.
- QR de cobro: the image of the wallet QR the buyer scans. Required and validated; distinct from the buyer's receipt («captura»/«comprobante»).

## Closed decisions

| Decision | Why |
| --- | --- |
| The digital wallet requires a QR validated by Yoyos, for every wallet including saved ones, without a legacy mode | A wallet without a QR leaves buyers asking where to pay; there are no businesses in production |
| A pending report can be rejected with an optional reason; the balance stays pending; the buyer sees it and can send another | A wrong receipt must not stay pending forever nor block the buyer |
| «Pagos» card as b3 and receipt in a modal as b4 | One decision per row and no context loss |
| The partial-payment stock box appears only when the amount does not cover the balance | When it covers, stock is deducted anyway; the box only adds noise |
| No «Así lo verá tu comprador» preview | Out of this task |
| Bank transfer image stays optional | Bank data is enough to pay |

## Acceptance criteria

1. The seller opens Medios de cobro: the page matches b1 and there is no «Así lo verá tu comprador» block.
2. With «Ofrecer billetera digital» ticked and no QR, **Guardar cambios** is disabled with «Sube el QR de cobro para guardar.» and the QR field is marked; no wallet text says «Imagen opcional».
3. The seller uploads a landscape photo: «Esta imagen no es un código QR. Sube la captura del QR de tu billetera.», save disabled, Proveedor and Titular intact; nothing is saved.
4. The seller uploads a real Plin QR screenshot and saves: «QR válido», «Medios de cobro guardados.», and the buyer of Order #1042 sees that QR in the checkout.
5. A client saves payment methods with an offered wallet without image, or with an image without QR: rejected, nothing saved.
6. The QR checker is unavailable when saving: «No pudimos revisar el QR. Inténtalo de nuevo.» and the previous configuration stays.
7. A business whose saved wallet has no image or a non-QR image: the buyer does not see the wallet (only bank transfer, or the no-methods text) and the seller sees «Tus compradores no ven esta billetera hasta que subas un QR válido.»
8. Order #1042, total S/ 70.00, one pending report: the card shows Total S/ 70.00 «Incluye entrega S/ 10.00», Recibido S/ 0.00, Pendiente S/ 70.00 «Pago por revisar», one report row with thumbnail, date, «Ver captura», **Rechazar**, **Aprobar**, and «¿Te pagaron por fuera? Registrar pago» at the end. There is only one payment form on the page, and only when opened.
9. Tapping the thumbnail or «Ver captura» opens «Comprobante de pago» with the image and the actions, without a new tab; ×, Escape and a click outside close it; at 390 px the image fits the screen.
10. Approving S/ 70.00 with Billetera digital: no stock box shown; the row becomes «Pago confirmado» with the same receipt; Recibido S/ 70.00, Pendiente S/ 0.00; stock deducted once.
11. In another order of S/ 70.00, approving S/ 30.00 shows the unticked stock box; confirming without ticking leaves stock undeducted and Pendiente S/ 40.00; with it ticked, stock is deducted.
12. Approving when a product lacks stock: «No hay stock suficiente para confirmar este pago.», the dialog keeps S/ 70.00 and the method, the report stays pending and nothing is recorded.
13. Rejecting a report with «El monto no coincide»: the row shows «Pago rechazado» and the reason; Recibido and Pendiente unchanged; stock unchanged.
14. Rejecting or approving a payment that is already confirmed, rejected or voided is refused and changes nothing.
15. After the rejection, the buyer sees «Tu comprobante fue rechazado» in «Comprobantes enviados», uploads a new receipt and taps «Ya pagué»; the seller sees a new report row and the rejected row stays.
16. The seller records S/ 20.00 in cash from «Registrar pago»: it appears as «Pago confirmado» without receipt; the stock box was shown because S/ 20.00 does not cover S/ 70.00.
17. Approving or rejecting with no response, then repeating: a single payment or a single rejection results.
18. On mobile, a rejected payment appears as «Pago rechazado» with its reason, never as confirmed; the mobile review sheet shows the stock box only when the amount does not cover the balance.

## Open items and questions

Questions (answer with the option number):

1. Mockup b1 shows «Número de celular» and Proveedor as a dropdown («Plin»), but the wallet stores only provider (free text), holder and the QR, and a phone field was rejected before.
   (1) Keep provider as free text and no phone number. Recommended: respects the earlier decision; the QR already carries the destination; no data or checkout change.
   (2) Add the phone number (with copy in the checkout, as a3) and a closed provider list (Yape, Plin, Otro). Adds wallet data, reopens a closed decision and touches the checkout that task 6hqMXP6qmJV5Fc73 reorganizes.

2. Does the buyer see the rejection reason?
   (1) Yes, under «Tu comprobante fue rechazado» when given; the field reads «Motivo (opcional, lo verá el comprador)». Recommended: the buyer knows what to fix without another chat message; the receipt is already shared evidence.
   (2) No, only «Tu comprobante fue rechazado»; the reason is internal. The seller explains in chat.

3. The task leaves mobile payment screens out, but sellers review payments from web and mobile and the guide asks for daily seller operations on both.
   (1) Mobile adds **Rechazar** (with optional reason) to its existing review sheet, besides showing «Pago rechazado» and the stock box rule; no b3/b4 reorganization. Recommended: a seller on the phone can otherwise only approve or leave the report pending.
   (2) Mobile only shows «Pago rechazado» correctly and applies the stock box rule; rejecting is web only. Smaller change; the seller opens the web to reject.

Decided unless objected:
- The report row and the modal footer show no amount or method (b3/b4 show «S/ 70.00 · Billetera digital (Plin)»): the buyer does not declare them. The modal footer shows «Pendiente S/ 70.00» and the approve button shows the amount typed.
- The stock box compares the amount with the pending balance, not the order total, and is hidden once stock was deducted; with no prior payments both are the same.
- **Aprobar** opens a short dialog with amount (prefilled with the balance) and method, starting on Billetera digital as today.
- Any readable QR is accepted; its content is not matched with the provider or holder.
- The QR is checked on choosing the image and again on saving; only the save check counts.
- Unticking «Ofrecer billetera digital» removes the QR requirement.
- «Rechazado» is final; a mistaken rejection is solved by the buyer sending the receipt again.
- Rejection reason up to 200 characters (initial value, adjustable).
- In cancelled orders reports cannot be approved or rejected and no manual payment is recorded; voiding stays as today.
- «Registrar pago» is shown only when Pendiente is above S/ 0.00; a report can still be approved when the balance is zero (overpayment notice as today).
- Rejected and voided payments stay in «Pagos del pedido», newest first, without actions.
- The buyer can upload again only when no report is pending and the balance is above zero.
- Mobile keeps opening the receipt outside the app; no modal there.
