# Payment methods and order payments: product definition

**Status:** definition ready to implement. The three questions and the routine decisions were decided by the review gate (UX/UI and product reviewers, rounds 1 and 2) and await the founder's confirmation in the pull request. Today the web app has «Medios de cobro» (Settings → Medios de cobro) with a digital wallet (provider, holder, optional image) and a bank transfer; the order detail «Pagos» card lists payments with a confirmation form under each buyer report plus a second identical «Registrar pago manual» form; «Ver captura» opens the receipt in a new tab. Mobile shows the same payments in the order detail and confirms reports from a sheet. This draft complements [orders](../orders.md) and [checkout](../checkout.md). Todoist task 6hqMXcQmXQ4fMWc3, 23/10/2026. Mockups b1–b4 of 23/10/2026 are a reorganization reference; where they differ from this document, this document wins. This draft is the pipeline's working document, not a new permanent document (the founder's task: «son arreglos»): on merge only [orders](../orders.md) and [checkout](../checkout.md) receive the behavior changes, and the draft is deleted.

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

1. «Medios de cobro» reorganized as b1/b2, without the «Así lo verá tu comprador» preview and without b1's «Número de celular» and provider dropdown: Proveedor stays free text. Bank transfer keeps all its fields; its image stays optional.
2. Mandatory payment QR for the digital wallet, validated by Yoyos when the image is chosen and again on saving, on the web page and on any client that saves payment methods.
3. No legacy path: a wallet that never passed the QR check is not offered to buyers and shows the QR error in the panel until the seller saves a valid one.
4. New «Rechazado» outcome for a buyer report, with an optional reason that the buyer sees.
5. Checkout: after a rejection, the upload block returns headed by the rejection and its reason; «Comprobantes enviados» shows the rejected receipt.
6. Web «Pagos» card as b3: three summary cells, one row per payment (reports with **Rechazar** and **Aprobar**; confirmed with **Anular pago**; rejected and voided with their state), and «¿Te pagaron por fuera? Registrar pago» as a separate secondary action that opens its own form. The duplicated form disappears.
7. Receipt modal as b4, opened from «Ver captura» and from the thumbnail, where the seller approves or rejects with the receipt in view.
8. The «Descontar stock aunque sea abono parcial» box appears only when the amount does not cover the balance (rule below), when approving and in the manual payment.
9. Mobile: rejected payments are shown as «Pago rechazado» with «Ver captura»; its existing review sheet adds **Rechazar** with an optional reason; the stock box follows the same rule.
10. Texts in Spanish and Portuguese.

Meeting point with task 6hqMXP6qmJV5Fc73 (compact checkout payment): that task reorganizes the checkout payment block. This one adds the rejection notice as the first part of the upload block and the «Rechazado» state in «Comprobantes enviados». Whatever the compact layout does, the notice travels with the upload block and is shown expanded whenever that block is shown; it is never behind a closed control or only at the end of the page.

## Out of this version

- «Así lo verá tu comprador» preview in Medios de cobro: not built.
- Visual redesign of the panel: only the reorganization of b1–b4 with the current style.
- Phone number and closed provider list for the wallet (b1): the wallet keeps provider (free text), holder and QR.
- New payment methods, gateways, automatic verification of transfers, or QR generation by Yoyos.
- Mandatory image for bank transfer.
- Checking that the QR belongs to the chosen provider or holder: any readable QR is accepted. Trigger: sellers uploading QRs from another account. Flagged as minor risk (a buyer could pay the wrong account), not deferred into a task unless the founder asks.
- Undoing a rejection: a rejected report stays rejected; the buyer sends another receipt. Trigger: sellers rejecting by mistake often.
- b3/b4 reorganization of the mobile payment section (reports stay in the current list and sheet; no receipt modal on mobile).
- Changing the stock deduction rule or the voiding of confirmed payments.
- Notifying the buyer of a rejection outside the checkout (WhatsApp, email): the seller tells them in chat.
- Warning the seller outside «Medios de cobro» that their wallet is hidden from buyers: they learn it only in that field. Acceptable because no business is in production and the one-time check covers existing wallets. Trigger: sellers learning from buyers that the wallet is missing.
- Aligning voiding in cancelled orders: today the web shows **Anular pago** in a cancelled order and mobile hides it. This known platform difference predates the task and stays as is.

## Flow

**Setting up the wallet (web)**

1. Settings → Medios de cobro. The seller ticks «Ofrecer billetera digital», types Proveedor and Titular.
2. In «QR de cobro *» chooses the screenshot of the QR from their wallet app. The field shows «Revisando QR…», then the thumbnail, file name and size, and «✓ QR válido».
3. **Guardar cambios**. Yoyos reads the QR again; on success «Medios de cobro guardados.» The buyer sees the QR from that moment.
- The image has no readable QR: the field turns red with «Esta imagen no es un código QR. Sube la captura del QR de tu billetera.», **Guardar cambios** is disabled with «Corrige el QR de cobro para guardar.», and the rest of the form stays as typed.
- The QR cannot be checked when choosing the image: «No pudimos revisar el QR. Inténtalo de nuevo.» with **Reintentar**; **Guardar cambios** stays enabled, because the save check is the one that counts. If the check also fails on saving, the same message shows and nothing is saved.

**Reviewing a report from the row (web)**

1. The buyer taps «Ya pagué» with a receipt. In the order detail, «Pendiente» shows «Pago por revisar» and «Historial de pagos» shows the row «Pago reportado, pendiente de revisión · Reportado por el comprador · 23/10/2026 10:12 p. m.» with thumbnail, «Ver captura», **Rechazar** and **Aprobar**.
2. **Aprobar** opens «Aprobar pago» with «Importe recibido» prefilled with the balance (S/ 70.00) and «Medio de pago». If the amount covers the balance, **Aprobar pago S/ 70.00** confirms it; the dialog closes, «Pago actualizado.» shows at the top of the card, Recibido becomes S/ 70.00, Pendiente S/ 0.00, the row shows «Pago confirmado» with **Anular pago**, focus goes to that row, and stock is deducted under the current rule.
- Partial: the seller changes the amount to S/ 30.00; the box «Descontar stock aunque sea abono parcial» appears unticked. Pendiente becomes S/ 40.00.
- Reject: **Rechazar** opens «¿Rechazar este comprobante?» with «Motivo (opcional, lo verá el comprador)» and **Rechazar comprobante** / **Volver**. The row becomes «Pago rechazado» with the reason; Recibido and Pendiente do not change; stock is not touched.

**Reviewing a report in the receipt modal (web)**

1. The seller taps the thumbnail or «Ver captura»: «Comprobante de pago» opens with the large image and, in its decision area, «Saldo pendiente del pedido S/ 70.00», **Rechazar** and **Aprobar**.
2. **Aprobar** does not open a second dialog: the decision area of the same modal turns into «Importe recibido (S/)» (prefilled with the balance), «Medio de pago», the stock box under the rule, **Aprobar pago S/ 70.00** and **Cancelar**, with the receipt still visible: beside the fields on wide screens; at 390 px a reduced copy of the receipt stays fixed at the top of the modal above the fields, so it stays readable while the phone keyboard is open and the seller types the amount. Focus goes to «Importe recibido».
3. On success the modal closes, «Pago actualizado.» shows at the top of the «Pagos» card, and focus goes to the decided row.
- **Rechazar** turns the decision area into «¿Rechazar este comprobante?», the same text and «Motivo (opcional, lo verá el comprador)», **Rechazar comprobante** and **Volver**, with the receipt still visible (fixed at the top at 390 px, as when approving); focus goes to «Motivo». On success the modal closes and focus goes to the row, now «Pago rechazado».
- **Cancelar** / **Volver** return the decision area to **Rechazar** and **Aprobar**, keeping the modal open.
- Any failure (no stock, already reviewed, no response, invalid amount) shows inside the modal, next to the buttons, never at the top of the card behind it; the modal stays open with what was typed.
- The seller closes the modal with ×, Escape or a click outside without deciding: nothing is recorded, the report stays pending and focus returns to the thumbnail or «Ver captura» that opened it.

**Recording a manual payment (web)**

1. «¿Te pagaron por fuera? Registrar pago» («Para pagos en efectivo o acordados directamente con el comprador.») opens «Registrar pago» with the same amount, method and conditional stock box. **Confirmar pago** records it.

**Reviewing a report (mobile)**

1. In the order detail, the report row has **Revisar comprobante**, which opens the existing sheet with «Ver captura» (opens the receipt outside the app, as today), amount, method, the stock box under the rule, and its existing **Confirmar pago** button (mobile keeps «Confirmar pago»; it does not change to «Aprobar»).
2. The sheet adds **Rechazar** (secondary). It shows «¿Rechazar este comprobante?», the same text, «Motivo (opcional, lo verá el comprador)», **Rechazar comprobante** and **Volver** inside the same sheet. On success the sheet closes and the row reads «Pago rechazado» with its reason. Failures are the same as on the web and show inside the sheet.

**Buyer after a rejection**

1. The buyer opens the order link again. While the balance is above zero and no report is pending, the upload block returns, and its first part is the notice «Tu comprobante fue rechazado», «Motivo: El monto no coincide.» (only when a reason was given) and «Envía otro comprobante para que la tienda lo revise.»
2. The buyer uploads another receipt and taps «Ya pagué». The notice is replaced by the pending-review notice (as today); the seller sees a new report row.
3. «Comprobantes enviados» lists the rejected receipt as «Ver captura · Rechazado» with the reason below it, and the new one as «Ver captura · Pendiente».

## Screens

**Medios de cobro (web, Settings → Medios de cobro):**
- Title «Medios de cobro», «Muestra al comprador los datos actuales para pagar su pedido.» Two cards and **Guardar cambios** at the end. No preview block.
- «Billetera digital», «Configura un proveedor, titular y el QR con el que te pagan.», «Ofrecer billetera digital». When ticked: Proveedor (free text, as today), Titular and «QR de cobro *». No phone number field.
- «QR de cobro *» states:
  - Empty: drop zone **Subir QR**; help «Obligatorio. Sube la captura del QR desde la app de tu billetera (JPG, PNG o WEBP, hasta 10 MB).»
  - Uploading/checking: «Revisando QR…».
  - Valid, just chosen: thumbnail, file name · size, «✓ QR válido», **Cambiar imagen**, **Quitar imagen**.
  - Valid, saved (on opening the page): thumbnail and «✓ QR válido», without file name or size, **Cambiar imagen**, **Quitar imagen**.
  - Not a QR: red border, the chosen image's thumbnail, «Esta imagen no es un código QR. Sube la captura del QR de tu billetera.», **Cambiar imagen**, **Quitar imagen** (returns the field to empty).
  - Wrong file: «Usa una imagen JPG, PNG o WEBP de hasta 10 MB.»
  - Upload failed: on the field, the existing text «No se pudo subir la imagen. Inténtalo de nuevo.» with **Reintentar**; the previous image, if any, stays.
  - Saved wallet that never passed the check (on opening the page): red field with «Tus compradores no ven esta billetera hasta que subas un QR válido.», the saved image's thumbnail if there is one, **Cambiar imagen** (or **Subir QR** without image) and **Quitar imagen**. While the wallet stays ticked, **Guardar cambios** is disabled with «Corrige el QR de cobro para guardar.», also for a seller who only came to change the bank transfer: the way out is to upload a valid QR or untick «Ofrecer billetera digital». This follows from the no-legacy decision and is intended.
  - Could not check: «No pudimos revisar el QR. Inténtalo de nuevo.» with **Reintentar**.
- **Guardar cambios** is disabled while the wallet is offered and its QR is missing («Sube el QR de cobro para guardar.») or was read and is not a QR («Corrige el QR de cobro para guardar.»), and while the field shows «Subiendo imagen…» or «Revisando QR…» (the field's status line explains the wait), so a save always carries the image the seller sees. It stays enabled when the check could not run. Unticking «Ofrecer billetera digital» removes the requirement.
- No text of the wallet says «Imagen opcional». «Transferencia bancaria» keeps Banco, Titular, Número de cuenta, CCI and its «Imagen opcional».
- Saving failures keep everything typed: «Revisa los datos de cobro e inténtalo de nuevo.»

**Pagos card (web, Pedidos → order detail):**
- Three cells: «Total S/ 70.00» («Incluye entrega S/ 10.00» when there is a delivery charge), «Recibido S/ 0.00», «Pendiente S/ 70.00» with «Pago por revisar» while at least one report is pending and the order is not cancelled. The overpayment notice stays as today.
- «Historial de pagos», newest first, one row per payment:
  - Reported: receipt thumbnail with magnifier, «Pago reportado, pendiente de revisión», «Reportado por el comprador · <date time>», «Ver captura», **Rechazar** (secondary), **Aprobar** (main). No amount or method: the buyer does not declare them.
  - Confirmed: «S/ 70.00 · Billetera digital», «Pago confirmado · <date time>», «Ver captura» if it came from a report, **Anular pago**.
  - Rejected: «Pago rechazado · <date time>», the reason if given, «Ver captura». No actions.
  - Voided: «Pago anulado» with amount and method, as today. No actions.
  - Empty: «Aún no hay pagos registrados.»
- Separated at the end, only when the order is not cancelled and Pendiente is above S/ 0.00: «¿Te pagaron por fuera? Registrar pago» and «Para pagos en efectivo o acordados directamente con el comprador.»
- «Pago actualizado.» and card-level errors show at the top of the card, as today, only for actions taken outside the modal or after it closes.
- In a cancelled order: rows are read-only (no **Aprobar**, **Rechazar**, **Registrar pago**) and «Pago por revisar» is not shown; a report pending at cancellation stays «Pago reportado, pendiente de revisión» with «Ver captura» and no actions. **Anular pago** stays as today on the web.
- Accessibility: the thumbnail is a button named «Ver comprobante del 23/10/2026 10:12 p. m.»; «Ver captura», **Aprobar**, **Rechazar** and **Anular pago** have accessible names that include the row's date and time («Aprobar pago reportado el 23/10/2026 10:12 p. m.»), so several rows never share a name. The thumbnail and every row action have the touch size of the current links (at least 44 px on phones). **Rechazar** meets AA contrast in light and dark modes.

**Comprobante de pago (web modal):**
- «Comprobante de pago», «Pedido #1042 · Reportado por el comprador · 23/10/2026 10:12 p. m.», × to close. The image fits the viewport (also at 390 px wide) without opening a new tab.
- Decision area for a pending report in an order that is not cancelled: «Saldo pendiente del pedido S/ 70.00», **Rechazar** and **Aprobar**. Each one turns the same area into its form (described in the Flow) while the image stays visible; there is no stacked dialog. For a confirmed, rejected or voided payment, or a cancelled order, the area shows the payment's state and no decision buttons.
- Errors of a decision show in the decision area; «Pago actualizado.» shows in the card after the modal closes.
- Image fails to load: «No se pudo cargar la captura.» with **Reintentar**; the decision buttons stay available.
- Closes with ×, Escape or a click outside. On opening, focus goes into the modal; on closing without deciding, it returns to the element that opened it; after deciding, to the decided row.

**Aprobar pago / Registrar pago (web dialog from the row):**
- «Importe recibido (S/)» prefilled with the balance when it is above zero, empty otherwise; «Medio de pago» Billetera digital / Transferencia bancaria; the stock box under the rule; main button «Aprobar pago S/ 70.00» (updates with the amount; reads «Aprobar pago» without an amount while the field is empty or invalid) or «Confirmar pago» for the manual one; **Cancelar**. The same fields form the modal's decision area.
- Invalid amount: «Escribe un importe mayor a 0 con hasta 2 decimales.» next to the field.
- Focus goes to «Importe recibido» on opening and returns to the row on closing.

**Rechazar comprobante (web dialog from the row, modal decision area, mobile sheet):**
- «¿Rechazar este comprobante?», «El saldo seguirá pendiente y el comprador podrá enviar otro comprobante.», «Motivo (opcional, lo verá el comprador)» (up to 200 characters), **Rechazar comprobante**, **Volver**. Same texts in all three places.

**Order detail payments (mobile):**
- Keeps its current layout: «Registrar pago», list «Ver pagos», report rows with **Revisar comprobante** and the receipt opened outside the app.
- While at least one report is pending and the order is not cancelled, the summary shows «Pago por revisar» under Saldo pendiente, so the seller knows there is a report without opening «Ver pagos».
- Adds «Pago rechazado» rows with date, reason and «Ver captura»; today any non-reported, non-voided payment is labeled as confirmed, so this label is required, not cosmetic.
- The review sheet adds **Rechazar** (Flow above) and shows «Descontar stock aunque sea abono parcial» only under the same rule as the web; the register sheet follows the same stock rule.
- Mobile has no payment settings screen; nothing changes there.

**Checkout (buyer):**
- Wallet section shows provider, holder and the QR on its white plate. A wallet that never passed the QR check is not listed; if no method remains, the current «noSettings» text is shown.
- Upload block: while a report is pending, the pending notice replaces it (as today). When no report is pending, the balance is above zero and the most recent report was rejected, the block returns with the rejection notice as its first part (Flow above); without a rejection it is as today.
- «Comprobantes enviados»: each receipt with its state in the current pattern «Ver captura · <estado>»: Pendiente, Confirmado, Anulado and now Rechazado, with the reason below a rejected one when given.

**Checkout preview (Apariencia de la tienda):** the preview of the checkout shows the company's payment methods under the same rule: a wallet that never passed the QR check is not listed, so the seller never sees a wallet their buyers do not see.

## Rules

| Aspect | Behavior |
| --- | --- |
| QR required | A wallet that is offered must have an image with a readable QR. A wallet that is not offered needs nothing. |
| What counts as a valid QR | Yoyos decodes at least one QR in the image. Its content is not compared with the provider or holder. A Yape or Plin screenshot passes; a landscape photo or meme does not. |
| When it is checked | When a new image is chosen (to show «QR válido» at once) and again on saving it, which is the check that counts. A save whose wallet image is unchanged and already passed does not read it again, so a checker outage never blocks unrelated edits (bank account, holder, unticking the wallet). Any client saving payment methods gets the same rejection. |
| Validity is kept | A wallet saved with a QR that passed the save check stays offered to buyers and shown as valid in the panel until the seller changes its image. A later outage of the checker never hides it nor shows it as invalid. |
| Never passed | A wallet never passed when it has no image or its image was read and holds no QR. Wallets saved before this version are checked once when it is installed; one whose image is read and holds no QR counts as never passed. If the checker is unavailable during that check, it is retried and not recorded as a failure, so an outage at install never hides a wallet. How that one-time check runs is resolved in implementation. |
| Checker unavailable on save | When the save carries a new wallet image, nothing is saved; the seller retries. Never saved "unchecked". |
| Previously saved wallets | Same requirement, no transition period: one that never passed is not offered to buyers and the panel shows the QR error. No business is operating in production. |
| Bank transfer | Unchanged; its image stays optional and is not checked as QR. |
| Who sets the amount | The buyer's report carries only a receipt. The amount that reduces the balance is the one the seller types when approving. |
| Approve | Turns the report into a confirmed payment with the same receipt, amount and method typed by the seller. Applies the current stock rule. `INSUFFICIENT_STOCK` records nothing. |
| Stock box | Shown only when the stock was not yet deducted and the typed amount is below the pending balance. Example: total S/ 70.00, nothing received, amount S/ 70.00 → hidden, stock is deducted; amount S/ 30.00 → shown, unticked. With S/ 40.00 already received, S/ 30.00 covers the balance → hidden. Same for manual payment, web and mobile. |
| Reject | Only a pending report can be rejected. It does not add to Recibido, does not change Pendiente and does not touch stock. Reason optional, up to 200 characters, seen by the buyer. |
| After rejecting | Final. The buyer can send a new receipt, which is a new report. |
| Repeating a decision | Repeating the same decision on the same report gives the same result and records nothing new: approving again with the same amount and method returns that confirmed payment, even if the stock box differs on the retry (the first result stands: no further stock deduction, no refusal); rejecting again returns that rejection with its original reason. A different decision, or approving with a different amount or method, on a report that is already decided is refused with «Este pago ya fue revisado.» and changes nothing. |
| Several reports | Each row is decided independently. The buyer has one pending report at a time because the checkout hides the upload block while one is pending (a display rule, as today); Yoyos does not refuse a second report sent by other means, and each one is decided on its own row. |
| Cancelled order | Reports cannot be approved or rejected and no manual payment is recorded; a pending report stays visible, read-only, and does not show «Pago por revisar». |
| Company isolation | Only the seller of the order's business can approve, reject or record; anyone else is refused and nothing changes. |
| Voiding | Unchanged: only confirmed payments; voiding does not return stock. |

## States

Buyer-reported payment and recorded payment:

| State | Meaning | What triggers it | What can be done | Seller sees | Buyer sees |
| --- | --- | --- | --- | --- | --- |
| Reportado | The buyer says they paid; does not count | «Ya pagué» with receipt | Approve, reject (not in a cancelled order) | «Pago reportado, pendiente de revisión», **Aprobar**, **Rechazar** | Pending-review notice; «Ver captura · Pendiente» |
| Confirmado | Verified by the seller; counts | **Aprobar** or manual **Confirmar pago** | Void | «Pago confirmado», amount, method | «Ver captura · Confirmado» |
| Rechazado | The seller did not accept the receipt; never counted | **Rechazar** | Nothing | «Pago rechazado», reason | Rejection notice with reason in the upload block; «Ver captura · Rechazado» |
| Anulado | A confirmed payment that was a mistake; stops counting | **Anular pago** | Nothing | «Pago anulado» | «Ver captura · Anulado» |

Transitions: Reportado → Confirmado; Reportado → Rechazado; Confirmado → Anulado. Rechazado and Anulado are final. Existing records keep their state; no existing report becomes rejected.

## When something fails

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| Wallet saved | «Medios de cobro guardados.» | — |
| Offered wallet without QR, or image without QR | Field error (b2), **Guardar cambios** disabled; everything typed is kept | Upload another image or untick the wallet |
| QR image upload fails | «No pudimos subir la imagen. Inténtalo de nuevo.» on the field; previous image kept | **Reintentar** |
| QR checker unavailable on choosing | «No pudimos revisar el QR. Inténtalo de nuevo.»; **Guardar cambios** stays enabled | **Reintentar**, or save (the save check decides) |
| QR checker unavailable on saving a new image | «No pudimos revisar el QR. Inténtalo de nuevo.»; nothing saved; the previous configuration stays | **Reintentar** |
| QR checker unavailable on a save that keeps the already-passed image | Nothing: the save proceeds | — |
| QR checker unavailable while buyers or the panel load | Nothing: a wallet that passed stays offered and shown as valid | — |
| Save not sent / no response | «Revisa los datos de cobro e inténtalo de nuevo.» with the form intact; on reload the page shows what is actually saved | Save again (saving is a full replacement, repeating does not duplicate) |
| Approve succeeded | Dialog or modal closes; row «Pago confirmado», cells updated, «Pago actualizado.» at the top of the card; focus on the row | — |
| Approve without stock | Dialog or modal stays open with amount and method: «No hay stock suficiente para confirmar este pago.»; nothing recorded, report still pending | Change stock in Productos and retry, or reject |
| A different decision on a report already decided elsewhere (other tab, mobile) | «Este pago ya fue revisado.» where the decision was taken (dialog, modal or sheet); the card reloads with the real state and the modal shows it without decision buttons | — |
| Approve or reject without response | «No sabemos si se guardó. Revisa el pedido antes de repetir.» where the decision was taken; the card reloads; that row's decision buttons stay blocked until it does | Repeat: the same decision returns the same result, never a second payment |
| Manual payment without response | Same notice; repeating from the same open form does not create a second payment | Reload and verify |
| Seller of another business tries to approve, reject or record | Refused, nothing changes | — |
| Receipt image does not load | «No se pudo cargar la captura.» in the modal or row | **Reintentar**; deciding is still allowed |
| Buyer uploads after rejection and the upload fails | Current checkout messages; the rejection notice stays | Current retry |
| Seller closes a dialog, the modal or the sheet midway | Nothing recorded; the report stays pending | Open it again |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller (signed in, own business) | All payments of their orders, receipts, rejection reasons, wallet QR | Configure methods, approve, reject (web and mobile), record, void | Act on another business's orders |
| Buyer (order link) | Current payment methods with QR, their own receipts with their state and, for a rejected one, the reason | Send a receipt, send another after a rejection | See internal payment records, amounts typed by the seller as decisions, other orders |

The receipt is evidence seen by both. The rejection reason is also seen by the buyer, and its field says so.

## Information that is kept

- The wallet QR is an instruction to act now: the buyer always sees the current one; changing it does not touch existing orders or payments.
- Whether the current wallet image passed the QR check is kept with it, so a later outage of the checker does not change what buyers see.
- A rejected report keeps its receipt, the date of the report, who rejected it, when and the optional reason. A new receipt is a new report; the rejected one stays in the history.
- Previously saved wallets keep their data; only being offered depends on a QR that passed the check.

## Vocabulary

- Rechazado («Pago rechazado»; buyer: «Tu comprobante fue rechazado», «Ver captura · Rechazado»; pt «Pagamento rejeitado», «Seu comprovante foi rejeitado», «Rejeitado»): a report whose receipt the seller did not accept; it never counted. A new state because «Anulado» applies only to confirmed payments with an amount, and leaving the report pending blocks the buyer from sending another.
- Anulado («Pago anulado»): a confirmed payment recorded by mistake, which stops counting.
- Aprobar: the seller's action on a report, which records it as «Pago confirmado» with the amount they received.
- QR de cobro: the image of the wallet QR the buyer scans. Required and validated; distinct from the buyer's receipt («captura»/«comprobante»).
- Existing texts that do not change, on web and mobile: «Pago actualizado.» (success), «Pago reportado, pendiente de revisión» (reported row), «Historial de pagos» (list heading), «Revisar comprobante» (mobile action), «Confirmar pago» (mobile review sheet button; the web says **Aprobar**), «No se pudo subir la imagen. Inténtalo de nuevo.» (image upload failure), «Ver captura · <estado>» (checkout list).

## Closed decisions

| Decision | Why |
| --- | --- |
| The digital wallet requires a QR validated by Yoyos, for every wallet including saved ones, without a legacy mode | A wallet without a QR leaves buyers asking where to pay; there are no businesses in production |
| A pending report can be rejected with an optional reason; the balance stays pending; the buyer sees it and can send another | A wrong receipt must not stay pending forever nor block the buyer |
| «Pagos» card as b3 and receipt in a modal as b4 | One decision per row and no context loss |
| The partial-payment stock box appears only when the amount is below the total (founder's wording; this draft refines it to the pending balance, see "Decided unless objected") | When it covers, stock is deducted anyway; the box only adds noise |
| No «Así lo verá tu comprador» preview | Out of this task |
| Bank transfer image stays optional | Bank data is enough to pay |

## Questions decided by the review gate

Decided by the UX/UI and product reviewers of the review gate (proposed in round 1, both with the same answer, and confirmed without objections in round 2, 23/10/2026), not by the founder; the founder confirms them in the pull request.

| Question | Answer | Reason | Discarded alternative |
| --- | --- | --- | --- |
| 1. b1 shows «Número de celular» and a provider dropdown; the wallet stores provider (free text), holder and QR | Keep provider as free text and no phone number | The founder's own "Dependencias" says the wallet model does not change until they decide; the phone field was rejected before; the QR already carries the destination; mockups give way to the text | Add the phone number (with copy in the checkout) and a closed list Yape / Plin / Otro: reopens a closed decision and touches the checkout that 6hqMXP6qmJV5Fc73 reorganizes |
| 2. Does the buyer see the rejection reason? | Yes, in the rejection notice and under the rejected receipt; the field reads «Motivo (opcional, lo verá el comprador)» | The receipt is already shared evidence; the buyer knows what to fix without another chat message; the label warns the seller before writing | No, the reason is internal and the seller explains in chat |
| 3. Does mobile get **Rechazar**? | Yes, with optional reason, in its existing review sheet; no b3/b4 reorganization on mobile | Daily seller operations exist on both platforms; without it a phone-only seller can only approve a bad receipt or leave the buyer blocked; it is one action in an existing sheet, not a new mobile payment screen | Mobile only shows «Pago rechazado»; rejecting is web only |

## Acceptance criteria

1. The seller opens Medios de cobro: the page matches b1 except that there is no «Número de celular» field and Proveedor is free text, and there is no «Así lo verá tu comprador» block.
2. With «Ofrecer billetera digital» ticked and no QR, **Guardar cambios** is disabled with «Sube el QR de cobro para guardar.» and the QR field is marked; no wallet text says «Imagen opcional».
3. The seller uploads a landscape photo: «Esta imagen no es un código QR. Sube la captura del QR de tu billetera.», save disabled, Proveedor and Titular intact; nothing is saved.
4. The seller uploads a real Plin QR screenshot and saves: «QR válido», «Medios de cobro guardados.», and the buyer of Order #1042 sees that QR in the checkout. Reopening the page shows the thumbnail with «✓ QR válido».
5. A client saves payment methods with an offered wallet without image, or with an image without QR: rejected, nothing saved.
6. The QR checker is unavailable when saving: «No pudimos revisar el QR. Inténtalo de nuevo.» and the previous configuration stays. When it was unavailable only on choosing the image, **Guardar cambios** stays enabled and saving with a real QR succeeds.
7. A business whose saved wallet never passed the check: the buyer does not see the wallet (only bank transfer, or the no-methods text), the checkout preview in Apariencia de la tienda does not list it, and the seller sees «Tus compradores no ven esta billetera hasta que subas un QR válido.»
8. With the QR checker unavailable, a wallet saved with a valid QR is still offered in the checkout and shown as «✓ QR válido» in the panel.
9. Order #1042, total S/ 70.00, one pending report: the card shows Total S/ 70.00 «Incluye entrega S/ 10.00», Recibido S/ 0.00, Pendiente S/ 70.00 «Pago por revisar», one report row with thumbnail, date, «Ver captura», **Rechazar**, **Aprobar**, and «¿Te pagaron por fuera? Registrar pago» at the end. There is only one payment form on the page, and only when opened.
10. Tapping the thumbnail or «Ver captura» opens «Comprobante de pago» with the image and the actions, without a new tab; ×, Escape and a click outside close it and focus returns to what opened it; at 390 px the image fits the screen.
11. In the modal, **Aprobar** shows amount, method and **Aprobar pago S/ 70.00** with the receipt still visible and no second dialog; approving closes the modal, shows «Pago actualizado.» in the card and puts focus on the confirmed row. **Rechazar** in the modal works the same way with the reason field.
12. Approving S/ 70.00 with Billetera digital: no stock box shown; the row becomes «Pago confirmado» with the same receipt; Recibido S/ 70.00, Pendiente S/ 0.00; stock deducted once; «Registrar pago» is no longer shown.
13. In another order of S/ 70.00, approving S/ 30.00 shows the unticked stock box; confirming without ticking leaves stock undeducted and Pendiente S/ 40.00; with it ticked, stock is deducted.
14. Approving when a product lacks stock: «No hay stock suficiente para confirmar este pago.», the dialog or modal keeps S/ 70.00 and the method, the report stays pending and nothing is recorded.
15. Rejecting a report with «El monto no coincide»: the row shows «Pago rechazado» and the reason; Recibido and Pendiente unchanged; stock unchanged.
16. Approving a rejected or voided payment, rejecting a confirmed one, or approving a confirmed one with a different amount is refused with «Este pago ya fue revisado.» and changes nothing.
17. Approving or rejecting with no response, then repeating the same decision: a single payment or a single rejection results, with its original data.
18. After the rejection, the buyer opens the checkout and sees, at the start of the upload block, «Tu comprobante fue rechazado» and «Motivo: El monto no coincide.»; «Comprobantes enviados» shows «Ver captura · Rechazado» with the reason. The buyer uploads a new receipt and taps «Ya pagué»; the seller sees a new report row and the rejected row stays.
19. The seller records S/ 20.00 in cash from «Registrar pago»: it appears as «Pago confirmado» without receipt; the stock box was shown because S/ 20.00 does not cover S/ 70.00.
20. In a cancelled order with a pending report: no **Aprobar**, **Rechazar** or «Registrar pago», no «Pago por revisar»; the rows are read-only.
21. A seller of another business who tries to approve, reject or record a payment of Order #1042 is refused and nothing changes.
22. On mobile, a rejected payment appears as «Pago rechazado» with its reason and «Ver captura», never as confirmed; the review sheet shows the stock box only when the amount does not cover the balance; **Rechazar** in the sheet with «El monto no coincide» leaves the row «Pago rechazado» and the balance unchanged.
23. With Portuguese selected, the new texts appear in Portuguese on the web, mobile and checkout («Pagamento rejeitado», «Seu comprovante foi rejeitado», «Ver captura · Rejeitado»).
24. The thumbnail and row actions have distinct accessible names that include the row's date and time.
25. The seller records S/ 20.00 from «Registrar pago», gets no response and taps **Confirmar pago** again in the same open form: a single payment of S/ 20.00 results.
26. While the field shows «Revisando QR…», **Guardar cambios** is disabled; when the QR image upload fails, the field shows «No se pudo subir la imagen. Inténtalo de nuevo.» with **Reintentar** and the previous image stays.
27. With the QR checker unavailable, a seller whose wallet already passed changes the bank account number and saves: «Medios de cobro guardados.» and the wallet is still offered.
28. On mobile, an order with a pending report shows «Pago por revisar» in the summary without opening «Ver pagos».

## Decisions taken by the review gate

Decided by the UX/UI and product reviewers of the review gate (proposed in round 1, approved without objections in round 2, 23/10/2026), not by the founder; the founder confirms them in the pull request.

- The report row and the modal show no amount or method (b3/b4 show «S/ 70.00 · Billetera digital (Plin)»): the buyer does not declare them. The modal shows «Saldo pendiente del pedido S/ 70.00» and the approve button shows the amount typed.
- The stock box compares the amount with the pending balance, not the order total (the founder wrote "menor al total"), and is hidden once stock was deducted; with no prior payments both are the same.
- **Aprobar** from the row opens a short dialog with amount (prefilled with the balance) and method, starting on Billetera digital as today; from the modal, the same fields replace the modal's buttons with the receipt still visible.
- After a decision in the modal, the modal closes and the success text shows in the card; errors stay inside the modal.
- Any readable QR is accepted; its content is not matched with the provider or holder.
- The QR is checked on choosing a new image and again on saving it; only the save check counts, so a failed check on choosing does not disable saving; an unchanged image that already passed is not read again.
- A wallet that passed the save check stays offered regardless of later checker availability; wallets saved before this version are checked once on installing it, and a checker outage during that check is retried, not recorded as never passed.
- Unticking «Ofrecer billetera digital» removes the QR requirement.
- «Rechazado» is final; a mistaken rejection is solved by the buyer sending the receipt again.
- Repeating the same decision returns the same result (a different stock box on the retry does not change it); a different decision on a decided report is refused with «Este pago ya fue revisado.»
- Rejection reason up to 200 characters (initial value, adjustable).
- In cancelled orders reports cannot be approved or rejected, no manual payment is recorded, and a pending report is shown read-only without «Pago por revisar»; voiding stays as today on each platform (web shows **Anular pago**, mobile does not).
- «Registrar pago» is shown only when Pendiente is above S/ 0.00; a report can still be approved when the balance is zero (overpayment notice as today).
- Rejected and voided payments stay in «Historial de pagos», newest first, without actions.
- The buyer can upload again only when no report is pending and the balance is above zero; one pending report at a time stays a checkout display rule, not a refusal by Yoyos.
- Existing texts «Pago actualizado.», «Pago reportado, pendiente de revisión», «Historial de pagos» and «Revisar comprobante» are kept on web and mobile.
- Mobile keeps opening the receipt outside the app; no modal there.
- At 390 px a reduced copy of the receipt stays fixed at the top of the modal while the seller types (round 2).
- **Guardar cambios** is disabled while the QR is uploading or being checked, and «Quitar imagen» is offered in the not-a-QR and never-passed states (round 2).
- Mobile shows «Pago por revisar» in the order summary while a report is pending and keeps «Confirmar pago» as its approve button (round 2).

## Open items and questions

Questions: none.
