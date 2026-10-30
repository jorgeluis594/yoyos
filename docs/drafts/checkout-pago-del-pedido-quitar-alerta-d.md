# Checkout payment step: no confirmed alert, clear amounts and a closing screen after the receipt: product definition

**Status:** definition ready to implement. Approved by the review gate in round 2 (product and UX/UI reviewers), which answered on the founder's behalf; the founder confirms its decisions in the final pull request. Adjusts the payment step of the buyer checkout described in [Checkout](../checkout.md) (sections «Checkout states» and «Payment») and [Orders · Payments](../orders.md#payments); all three changes are on the same screen. Todoist task `6hrqR5fHPm5f9883`, requested by the founder on 30/10/2026 with default proposals, checked against `main` at `c4307126`.

## Problem and situation

A buyer opens the order link from WhatsApp, confirms Pedido #1001 and lands on the payment step to pay S/ 30.00 (S/ 20.00 of products plus S/ 10.00 of delivery). Three things get in the way. First, a green «Pedido confirmado» block sits at the top of the screen, so the first thing they read is a success message about confirmation, not what to pay. Second, the wallet box shows «Total del pedido S/ 30.00», «Incluye entrega S/ 10.00» and «Saldo pendiente S/ 30.00». That reads like a sum or a subtraction that does not add up, and the buyer wonders whether they owe S/ 30.00 or S/ 40.00. Third, after they attach the screenshot and press **Ya pagué**, they stay on the same screen with the QR, the amount, «Pago pendiente de revisión» and «Comprobantes enviados». It is not clear that they are done, so some pay again or write to the seller asking whether it worked.

## Goal

When they open the payment step, the buyer sees one clear amount to pay. After sending the receipt they reach a screen that clearly says the receipt was received and that they only have to wait for the seller. Hypothesis: fewer chat messages like «¿te llegó mi pago?» right after a receipt, and no duplicate receipts for the same payment. It would show as fewer orders with two reports sent minutes apart.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Buyer who confirmed the order from a WhatsApp link and has to pay, usually on a phone | Know exactly how much to pay and where | Checkout payment step (core web, store brand host) |
| Buyer who just sent the payment screenshot | Know it arrived and that nothing else is needed from them | The same order link, now showing the closing screen |
| Buyer who reopens the link later, after a receipt, an approval or a rejection | See what to do next, or that it is paid | The same order link |

The buyer checkout exists only on the web. The mobile app does not render the buyer checkout or call the buyer payment API; it only shares the link and has the store appearance editor with static theme samples, which show none of these elements. Mobile is therefore unchanged.

## First-version scope

- Remove the «Pedido confirmado» block shown at the top of the checkout once the order is confirmed, in both interface languages. Its two other lines go with it on purpose and are not moved anywhere: «Recibimos tu confirmación. Esto no registra un pago.» and «Para solicitar cambios, contacta al vendedor por el canal que ya utilizan.». Before confirming, «Confirmas tu intención de compra. El pago se coordina por separado.» already covers that confirming is not paying. Change requests happen in the chat the buyer already uses. The «Pedido cancelado» block stays as it is.
- Change the amount rows of the payment step and of the separate amounts card to follow the [amount rows rule](#rules). The «Incluye entrega» row is removed from the payment step.
- Show the order summary card («Subtotal de productos», «Entrega» and the total row) on phones too in the confirmed states, below the main column. Its total row reads «Total del pedido» in those states.
- Add the closing screen, shown on the same order link while the buyer has a receipt pending review and payment is available.
- All of this works in the five checkout themes and in the «Apariencia de la tienda» preview, which loses the confirmed block like the real checkout does.

## Out of this version

- Notifying the buyer outside the page (WhatsApp, email) when the seller approves or rejects. The seller tells them in chat, as today. Trigger: when buyer notifications exist.
- Seller review screens (web «Pagos» card, mobile review sheet): unchanged.
- Mobile app: unchanged, since the buyer checkout is web only.
- Letting the buyer replace or withdraw a pending receipt from the closing screen. A wrong screenshot is resolved in chat: the seller rejects it and the buyer sends another. Trigger: if sellers report that rejecting wrong screenshots is a frequent chore.
- A closing-screen state in the «Apariencia de la tienda» preview. It keeps its two states (review and payment). Trigger: if the founder wants to preview every buyer state.
- An overpayment notice for the buyer. Overpaying comes from a seller mistake, and the seller sorts it out in chat. Trigger: if overpayments show up in real use.
- A notice to the buyer when the seller approves less than the balance. Trigger: if buyers ask in chat why they still owe.
- The sibling task «Catálogo y checkout: un solo anillo de foco…» (`6hrqR5H6Ch7V8GrV`) also touches checkout styles. It only changes focus rings, so it adds on top of this without conflict.

## Flow

1. The buyer confirms the order. The page shows the payment step with no green confirmed block. Order: the title «Pedido #1001», the products, then «Datos del comprador» and «Cómo pagar», then the summary card ending in «Total del pedido S/ 30.00». On a computer the products and summary stay in the right column.
2. In «Cómo pagar», the selected method shows its QR or bank data and one row, «Monto a pagar S/ 30.00».
3. The buyer pays in their bank or wallet app, attaches the screenshot and presses **Ya pagué**.
4. The page switches to the closing screen on the same link, with focus on its title «Recibimos tu comprobante». The closing card sits right under the order title, followed by the products, «Datos del comprador» and the summary.
5. The buyer closes the tab. Opening the link again, on any device, shows the closing screen with the closing card first, while the seller has not decided.
6. The seller approves the receipt for S/ 30.00. The link now shows the paid state, «Pedido pagado».

Alternative paths:

- **Rejected:** the seller rejects with «La captura no muestra el monto». The link shows the payment step again with «Tu comprobante fue rechazado», «Motivo: La captura no muestra el monto» and the upload block. This is the current rejection behavior and does not change.
- **Approved for less than the balance:** the seller approves S/ 20.00 of S/ 30.00. The link shows the payment step with «Total del pedido S/ 30.00», «Pagado S/ 20.00» and «Saldo pendiente S/ 10.00», plus the upload block for another receipt. The seller explains the difference in chat.
- **Seller records a payment by hand (no receipt):** the link moves from the payment step to the partial payment step or to paid, depending on whether the payment covers the balance. A pending receipt does not block this.
- **Seller voids a confirmed payment:** the balance reopens. A paid order goes back to the payment step, with three rows if confirmed payments remain or «Monto a pagar» if none remain. A void while a receipt is pending leaves the closing screen in place.
- **Payment not available while a receipt is pending:** the not-available card wins and the closing screen is not shown until payment is available again. This state is dormant today: the buyer view always reports payment as available, and no seller flow sends a confirmed order back to awaiting a quote. The rule only keeps the existing branch of the payment content in its place.
- **Order cancelled while a receipt is pending:** «Pedido cancelado» takes precedence. The closing screen and the payment step are not shown.
- **Sending fails, or the report goes out but the page cannot refresh:** see [When something fails](#when-something-fails).

## Screens

**Checkout header (every state):**
- Shows the order title «Pedido #1001» and «Revisa los productos y el total de tu pedido.» as today.
- No state shows the confirmed block. The slot under the title holds the «Pedido cancelado» block in the cancelled state and the closing card in the closing state. It is empty in every other state.

**Order summary card (every state):**
- While pending (before confirming): unchanged, ending in «Total a pagar», and on phones in its current position.
- In the confirmed states (payment, closing, paid, payment not available): the last row reads «Total del pedido» (pt «Total do pedido») with the order total. On phones it is shown below the main column instead of being hidden. On a computer it stays in the right column. The page never shows two different amounts labelled as «to pay»: the only amount due is «Monto a pagar» or «Saldo pendiente» in the payment box.

**Payment step (confirmed, payment available, no receipt pending, not paid):**
- Same layout as today: «Datos del comprador», «Cómo pagar» with the method radios, the selected method block (QR or bank data), the upload block with **Ya pagué**, and «Comprobantes enviados» when the buyer sent receipts before.
- The amount rows inside the selected method block follow the [amount rows rule](#rules). With no confirmed payments there is a single row, «Monto a pagar S/ 30.00». With confirmed payments there are three: «Total del pedido S/ 30.00», «Pagado S/ 20.00», «Saldo pendiente S/ 10.00», with the last row emphasized as today.
- When the business has no payment methods configured, «El negocio aún no ha configurado sus datos de cobro. Contacta al vendedor.» stays, followed by the same amount rows.
- After a rejection, the rejection notice stays as today at the start of the upload block.

**Closing screen (confirmed, payment available, a receipt pending review, not paid, not cancelled):**
- The closing card sits in the header slot, right under the order title, on every width. A buyer reopening the link on a phone reads it first, before the products. It uses the theme's information semantics (not success), with a clock icon and no check mark, and no wording that implies the payment was approved or confirmed. It contains:
  - Title «Recibimos tu comprobante».
  - «La tienda revisará tu pago y te confirmará cuando lo reciba. No necesitas hacer nada más por ahora.»
  - «Si enviaste una captura equivocada, escríbele a la tienda por donde hiciste tu pedido.»
  - **Ver captura**: a link that opens the pending receipt in a new tab, the same way receipts open today. It has an external-link icon, a touch target of at least 44 × 44 px and an accessible name that includes «(se abre en una pestaña nueva)». With more than one pending receipt, there is one link per pending receipt, newest first, each with its send date and time: «Ver captura · 30 oct. 2026, 6:42 p. m.». The time is in the store's zone (Peru, America/Lima), the same one the seller sees, whatever the buyer's device zone. The format is the medium date and short time already used for order dates in the seller's order list. None is hidden. A pending receipt whose image cannot be opened (its link does not resolve) is listed without a link. The closing screen still shows, because it depends on the receipt being pending, not on its image.
- The main column keeps only «Datos del comprador». «Cómo pagar», the upload block, the pending notice and «Comprobantes enviados» are not shown, so the buyer cannot pay twice by mistake from this screen.
- Order summary: the products and the summary card ending in «Total del pedido». The closing screen shows no «Monto a pagar», «Pagado» or «Saldo pendiente», even when the seller had already confirmed earlier payments. The receipt does not change what is owed, and the text already says the store will confirm.

**Paid state (confirmed, payments cover the total):**
- Unchanged texts: amounts card plus «Pedido pagado» / «El pago de este pedido ya está confirmado.», and «Comprobantes enviados» with their states.
- The amounts card follows the rule: «Total del pedido S/ 30.00», «Pagado S/ 30.00», «Saldo pendiente S/ 0.00».
- Overpayment (the seller confirmed S/ 35.00 on a S/ 30.00 order) is shown as is: «Total del pedido S/ 30.00», «Pagado S/ 35.00», «Saldo pendiente S/ 0.00», with no notice for the buyer.
- A receipt still pending when the order became paid keeps its «Ver captura · Pendiente» label in «Comprobantes enviados». It refers to that receipt, which the seller has yet to decide, and «Pedido pagado» above it states what counts.

**Separate amounts card when payment is not available** (order confirmed with the delivery still unquoted, or other states where payment is closed): uses «Total del pedido» instead of «Monto a pagar» when there are no confirmed payments, because nothing can be paid yet. With confirmed payments it uses the three rows.

## Rules

| Aspect | Behavior |
| --- | --- |
| Confirmed alert | Removed, with its «Esto no registra un pago» and change-request lines, which are not moved elsewhere. Confirming shows no success block; arriving at the payment step is the feedback. Its texts disappear from both interface languages. |
| Cancelled notice | Unchanged and still takes precedence over every other state. |
| Amount rows, no confirmed payments | One row. In the payment step it reads «Monto a pagar», with the balance, which equals the order total. Example: an order of S/ 30.00 with S/ 10.00 of delivery shows «Monto a pagar S/ 30.00». |
| Amount rows, with confirmed payments | Three rows that read as a subtraction: «Total del pedido», «Pagado» (the sum of confirmed payments) and «Saldo pendiente». Example: S/ 30.00, S/ 20.00, S/ 10.00. With an overpayment, «Saldo pendiente» shows S/ 0.00 and «Pagado» the real sum. This is accepted as is. |
| Summary total label | «Total a pagar» before confirming; «Total del pedido» in every confirmed state. At most one amount due is visible on the page, in the payment box, and the closing and paid screens show none. |
| Delivery charge | Not shown in the payment amount rows. The breakdown (products, delivery, total) lives in the summary card, which is visible on every screen width in the confirmed states. |
| What counts as «Pagado» | Only payments the seller confirmed: an approved receipt or a payment the seller recorded. Pending, rejected and voided payments do not count. |
| Receipts and the balance | A receipt never changes the balance or «Pagado». Only the seller records money received. |
| Which screen the link shows | In this order: cancelled → «Pedido cancelado»; payment not available (delivery awaiting a quote) → not-available card; paid → paid state; a receipt pending review → closing screen; otherwise → payment step (with the rejection notice when the latest report was rejected). |
| Closing screen duration | Shown while at least one receipt is pending review and the screens above it do not apply. It ends when the seller approves or rejects the last pending receipt, or when the order becomes paid, not available or cancelled. |
| Which receipt «Ver captura» opens | Every pending receipt, newest first by send date. With one there is a single «Ver captura»; with more, each link carries its send date and time in the store's zone (America/Lima). A receipt without a resolvable image gets no link, and the closing screen stays. |
| One receipt at a time | Kept as a display rule: while a receipt is pending the buyer cannot send another. The closing screen offers no upload. |
| Same link | The closing screen has no URL of its own. Reloading, reopening the WhatsApp link or opening it on another phone shows the same screen while the receipt is pending. |
| Source of the screen | The screen shown after **Ya pagué** always comes from the refreshed order state, never from the send response alone. Resending an already rejected report therefore shows the rejection, not the closing screen. |
| Focus after **Ya pagué** | Only on that transition, focus moves to one heading of the refreshed page: «Recibimos tu comprobante» in the closing card under the order title; «Tu comprobante fue rechazado» in the rejection notice of the upload block; «Pedido pagado» in the paid card of the payment content; «Pedido cancelado» in the cancelled block under the order title (the header block, never a second cancelled card). That heading is announced once, through focus: the card holding it is not also a live region (`status`), so it is never announced twice. Opening or reloading the link moves no focus. |
| Themes | The closing card, the summary label and the new amount rows are themed like the rest of the checkout in Clásico, Boutique, Antojo, Suave and Noche. The information colors of the closing card meet each theme's contrast floor. |
| Payment not available | Dormant today: the buyer view always reports payment as available. Its place in the precedence keeps the existing branch and is checked at view level only. |

## States

The buyer-facing states of the payment step. They are presentations derived from the order and its payments; no new stored state is created.

| State | What triggers it | What the buyer sees | What the buyer can do |
| --- | --- | --- | --- |
| Payment, no payments | Confirmed, payment available, no confirmed payments, no pending receipt | «Monto a pagar» and the payment methods; summary ending in «Total del pedido» | Pay and send a receipt |
| Payment, partial | Confirmed payments below the total, no pending receipt | «Total del pedido / Pagado / Saldo pendiente» and the payment methods | Pay the balance and send a receipt |
| Payment, rejected | Latest report rejected, no pending receipt, balance above zero | Rejection notice with its reason, the amount rows and the payment methods | Send another receipt |
| Closing | A receipt pending review, payment available, not paid, not cancelled | «Recibimos tu comprobante», «Ver captura», «Datos del comprador», summary with no amount due | Open the receipt; wait |
| Paid | Confirmed payments cover the total, overpayment included | «Pedido pagado» and the amounts card | View the sent receipts |
| Payment not available | Confirmed with the delivery awaiting a quote | The not-available card with «Total del pedido» or the three rows | Wait for the store |
| Cancelled | Order cancelled | «Pedido cancelado» | Nothing |

Transitions:
- Payment (any) → Closing when the buyer sends a receipt.
- Closing → Payment, rejected when the seller rejects the last pending receipt.
- Closing → Payment, partial when the seller approves less than the balance.
- Closing → Paid when an approval or a manual payment covers the total.
- Payment, no payments or partial → Payment, partial or Paid when the seller records a manual payment without a receipt.
- Paid → Payment, partial or Payment, no payments when the seller voids a confirmed payment and the balance reopens. A void in Payment, partial can return to Payment, no payments. A void during Closing keeps Closing.
- Any confirmed state → Payment not available when the delivery goes back to awaiting a quote, and back when it is quoted.
- Any → Cancelled when the seller cancels.

Orders that already have a pending receipt show the closing screen from the first visit after release, with no data conversion. Orders that already have more than one pending receipt list all of them.

## When something fails

| Situation | What the buyer sees | What they can do |
| --- | --- | --- |
| **Ya pagué** succeeds | The closing screen on the same link, with focus on «Recibimos tu comprobante» | Close the tab |
| Send rejected because the order was cancelled meanwhile | The refreshed page with «Pedido cancelado» and focus on it | Contact the store |
| Send not sent (no connection, server error) | Stays on the payment step with the screenshot kept: «No se pudo enviar el aviso. Tu captura sigue lista; vuelve a intentarlo.» | **Ya pagué** again; the retry reuses the same report and never creates two |
| Send in doubt (the request left, no answer) | The same message; the screenshot stays ready | Retrying is safe because it is the same report. Reloading shows the closing screen if the report arrived |
| Report recorded but the page could not refresh | The upload block is replaced by «Enviamos tu comprobante, pero no pudimos actualizar la página. Recárgala para ver el estado de tu pago.» with **Recargar página**. Focus moves to that message, which is announced once (through focus, not also as a live region). **Ya pagué** and the screenshot are not offered again | **Recargar página**, which shows the closing screen (or whatever the refreshed state is) |
| **Ver captura** fails to open the image | The browser's own error in the new tab; the closing screen stays | Contact the store; the receipt is already with the seller |
| Buyer abandons after attaching but before **Ya pagué** | Nothing is sent; on return the payment step shows with no file | Attach again |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Buyer with the order link | Their order, its amounts, the confirmed «Pagado», their own receipts and rejection reasons | Pay, send one receipt at a time, open their receipts | See the seller's internal notes, approve, or change amounts |
| Seller | Unchanged: every payment and receipt of their order | Approve, reject, record or void as today | — |

The closing screen exposes nothing new: its receipt links are the same ones already listed under «Comprobantes enviados».

## Vocabulary

- «Monto a pagar»: what the buyer has to pay when nothing has been paid yet. It equals the order total. It appears only in the payment box.
- «Total del pedido»: the order total, products plus delivery. In the confirmed states it labels the summary card's last row and the first of the three amount rows. «Total a pagar» is used only before confirming.
- «Pagado»: the sum of payments the seller confirmed. A receipt pending review is not «Pagado».
- «Saldo pendiente»: «Total del pedido» minus «Pagado», never below S/ 0.00.
- Closing screen: what the order link shows while a receipt is pending review. Its visible title is «Recibimos tu comprobante».

### Texts in both interface languages

| Key text | Spanish | Portuguese |
| --- | --- | --- |
| Single amount row | «Monto a pagar» | «Valor a pagar» |
| Confirmed payments row | «Pagado» | «Valor pago» |
| Summary total, confirmed states | «Total del pedido» | «Total do pedido» |
| Closing title | «Recibimos tu comprobante» | «Recebemos seu comprovante» |
| Closing body | «La tienda revisará tu pago y te confirmará cuando lo reciba. No necesitas hacer nada más por ahora.» | «A loja vai revisar seu pagamento e confirmar quando recebê-lo. Você não precisa fazer mais nada por enquanto.» |
| Closing hint | «Si enviaste una captura equivocada, escríbele a la tienda por donde hiciste tu pedido.» | «Se você enviou a captura errada, escreva para a loja pelo mesmo canal em que fez seu pedido.» |
| Receipt link | «Ver captura» | «Ver captura» |
| Receipt link with date | «Ver captura · 30 oct. 2026, 6:42 p. m.» | «Ver captura · 30 de out. de 2026, 18:42» |
| New-tab hint (accessible name) | «(se abre en una pestaña nueva)» | «(abre em uma nova aba)» |
| Recorded but not refreshed | «Enviamos tu comprobante, pero no pudimos actualizar la página. Recárgala para ver el estado de tu pago.» | «Enviamos seu comprovante, mas não conseguimos atualizar a página. Recarregue para ver o status do seu pagamento.» |
| Reload button | «Recargar página» | «Recarregar página» |

## Closed decisions

| Decision | Why |
| --- | --- |
| No «Pedido confirmado» block after confirming, and its change-request guidance is not moved elsewhere | It pulls attention away from paying, on the very screen where the buyer has to pay; changes are asked for in the chat |
| One «Monto a pagar» row when nothing is paid; three rows once something is | Two equal amounts plus a delivery line read like a wrong sum; three rows read as a subtraction |
| The summary total reads «Total del pedido» once confirmed | The page shows only one amount «to pay», and it is in the payment box |
| The summary card is visible on phones in the confirmed states | It is the only place left that shows the delivery charge |
| The closing screen lives on the same order link, with its card first | The buyer only ever has the WhatsApp link, and on reopening they must read the reassurance first |
| The closing screen shows no balance, no «Pagado» and no amount due | The receipt does not change what is owed, and an unchanged balance reads as «your payment did not count» |
| No upload on the closing screen | It keeps one receipt under review at a time; a wrong screenshot is resolved in chat |
| A receipt never changes the balance | Only the seller knows what arrived |

## Acceptance criteria

1. The buyer confirms Pedido #1001 (S/ 20.00 of products, S/ 10.00 of delivery). The payment step shows no «Pedido confirmado» block and none of its lines. The wallet block shows a single row, «Monto a pagar S/ 30.00», with no «Incluye entrega» row. The summary ends in «Total del pedido S/ 30.00», not «Total a pagar».
2. On a phone-width screen (390 px), in the payment step, the closing screen and the paid state of that order, the summary card is visible below the main column, with «Entrega S/ 10.00» and «Total del pedido S/ 30.00». It does not stick or overlap any other content while scrolling.
3. The seller recorded a S/ 20.00 payment on a S/ 30.00 order. The buyer's payment step shows «Total del pedido S/ 30.00», «Pagado S/ 20.00» and «Saldo pendiente S/ 10.00», and the only amount due on the page is «Saldo pendiente S/ 10.00».
4. The buyer attaches a PNG and presses **Ya pagué**. The page shows «Recibimos tu comprobante» right under the order title, the products, «Datos del comprador» and the summary ending in «Total del pedido». **Ver captura** opens that PNG in a new tab and its accessible name says it opens in a new tab. No QR, bank data, upload control, «Monto a pagar», «Pagado» or «Saldo pendiente» is visible. Focus is on the title, which is announced once.
5. With a receipt pending, the buyer reloads the link and then opens it on another phone. Both show the closing screen with the closing card above the products, and focus does not move.
6. An order has two pending receipts sent at 18:42 and 18:50 Lima time on 30/10/2026, viewed from a device set to another time zone. The closing screen shows two links, «Ver captura · 30 oct. 2026, 6:50 p. m.» first and «Ver captura · 30 oct. 2026, 6:42 p. m.» second. When the only pending receipt has no resolvable image, the closing screen shows without a «Ver captura» link.
7. The seller rejects the pending receipt with «La captura no muestra el monto». Opening the link shows the payment step with «Tu comprobante fue rechazado», «Motivo: La captura no muestra el monto» and the upload block.
8. The buyer resends, with **Ya pagué**, a report the seller already rejected. The refreshed page shows the rejection notice with focus on «Tu comprobante fue rechazado», not the closing screen.
9. The seller approves the pending receipt for S/ 30.00. Opening the link shows «Pedido pagado» with «Total del pedido S/ 30.00», «Pagado S/ 30.00», «Saldo pendiente S/ 0.00».
10. The seller approves the pending receipt for S/ 20.00 of S/ 30.00. Opening the link shows the payment step with «Pagado S/ 20.00» and «Saldo pendiente S/ 10.00», and the buyer can send another receipt.
11. On a paid order, the seller voids the S/ 30.00 payment. Opening the link shows the payment step with «Monto a pagar S/ 30.00».
12. The seller confirmed S/ 35.00 on a S/ 30.00 order. The link shows «Pedido pagado» with «Pagado S/ 35.00» and «Saldo pendiente S/ 0.00», with no notice.
13. **Ya pagué** fails for lack of connection. The buyer stays on the payment step with the screenshot ready and «No se pudo enviar el aviso…». Retrying records a single report and shows the closing screen.
14. The report is recorded but the page refresh fails. The buyer sees «Enviamos tu comprobante, pero no pudimos actualizar la página…» with **Recargar página**, and **Ya pagué** is not available. Reloading shows the closing screen, and the seller sees a single report.
15. The seller cancels the order while a receipt is pending. The link shows «Pedido cancelado» and neither the closing screen nor the payment step.
16. Checked at view level, since no real flow produces it today: a buyer view marked not available with a pending receipt shows the not-available card, not the closing screen.
17. Screenshots in Clásico (light) and Noche (dark), at phone width and computer width, of the payment step without payments, the payment step with a partial payment, the payment step with a rejection, the closing screen and the paid state. The closing card's information text meets the contrast floor of all five themes, and it shows no check mark or approval wording.
18. With the interface in Portuguese, the closing screen shows «Recebemos seu comprovante», the payment step shows «Valor a pagar», and a partial payment shows «Valor pago».
19. A receipt is pending and the seller records a manual S/ 30.00 payment that covers the order. The link shows «Pedido pagado», and that receipt stays as «Ver captura · Pendiente» in «Comprobantes enviados».
20. A receipt is pending on an order with a confirmed S/ 20.00 payment, and the seller voids that payment. The link still shows the closing screen.
21. After **Ya pagué**, when the refreshed page is paid, focus is on the «Pedido pagado» heading; when it is cancelled, focus is on the «Pedido cancelado» heading under the order title. Each heading is announced once.
22. In «Apariencia de la tienda», the payment preview shows no «Pedido confirmado» block and shows «Monto a pagar» and «Total del pedido».

Validation requested by the founder for the next phase: view tests for each state (no payments, partial payment, pending receipt, rejected, paid), an end-to-end test of the full flow (confirm → send receipt → closing screen → reject → resend → approve → paid), and screenshots in at least two themes.

## Questions decided by the review gate

1. **Where does a phone buyer see the delivery charge after confirming, without «Incluye entrega»?** Decided: show the summary card on phones too, below the main column, in the confirmed states (payment step, closing screen and paid). Decided by both reviewers of the round 1 gate (product and UX/UI) and consolidated by the coordinator. Reason: the delivery charge is the one amount the payment box no longer shows, and the summary is the only remaining place for it. The buyer is usually on a phone, so the reason for removing the row only holds if the summary is visible there. Its total is relabelled «Total del pedido» so the page shows a single amount due. Discarded: keeping the summary hidden on phones, which hides the delivery charge from the usual buyer, and keeping «Incluye entrega» on phones only, which brings back the confusing double amount on the main device.

The coordinator also took the following decisions in round 2, on the reviewers' suggestions:

2. **The «payment not available» state.** It is dormant: the buyer view always reports payment as available, and no seller flow produces it. It keeps its place in the precedence only so the existing branch is preserved, and its criterion is checked at view level. Reason: no real flow can reproduce it. Discarded: designing a seller quote flow for it, which is out of scope.
3. **Date and time on «Ver captura».** It uses the store's zone (Peru, America/Lima), the one the seller sees, in the medium date and short time format of the seller's order list. Reason: the buyer and the seller name the same time for the same receipt. Discarded: the buyer device's zone, which can differ from the seller's. It needs the report date in the buyer view; that is to be resolved in architecture.
4. **More money criteria.** A manual payment covering the total while a receipt is pending shows the paid state, and the receipt keeps «Pendiente». A void while a receipt is pending keeps the closing screen. Reason: these are the precedence cases most likely to regress.
5. **Summary on phones in the paid state.** The phone-width criterion also covers the paid state and checks that the summary does not stick or overlap. Reason: today the card is sticky on computers.
6. **Pending receipt without a resolvable image.** The closing screen still shows, without that link. Reason: the state comes from the receipt being pending, not from its image. Discarded: falling back to the payment step.
7. **Focus targets after «Ya pagué».** Cancelled focuses the «Pedido cancelado» heading in the block under the order title. Paid focuses the «Pedido pagado» heading in the paid card. A focused card is never also a live region, and the «Recargar página» message takes focus and is announced once. Reason: no unmounted or duplicated target, and no double announcement.
8. **Closing card style.** It uses information semantics with a clock icon, with no check mark or approval wording. Reason: success styling on an unreviewed receipt reads as «paid». Discarded: success styling.
9. **Portuguese «Pagado».** It is «Valor pago». Reason: «Pago» alone reads as the noun «payment».
10. **Status line.** It records the gate's approval, with the founder confirming in the final pull request.

## Decided unless objected

Routine decisions the founder confirms in the final pull request:

- The «Pedido confirmado» texts are removed in both interface languages (Spanish and Portuguese), and so is the confirmed block in the «Apariencia de la tienda» preview. Its «Esto no registra un pago» and change-request lines are dropped on purpose and not moved elsewhere.
- In the confirmed states, the summary total reads «Total del pedido» / «Total do pedido». «Total a pagar» stays only before confirming.
- On phones, the summary card shows below the main column in the confirmed states.
- Precedence: cancelled, then payment not available, then paid, then closing, then payment.
- The closing card sits under the order title on every width, so it is read first on a plain reopen. The main column keeps only «Datos del comprador».
- The closing texts are the ones in the bilingual table; the hint says «por donde hiciste tu pedido» instead of naming a channel.
- The closing card uses information semantics with a clock icon, no check mark and no approval wording.
- «Ver captura» dates follow the store's zone (America/Lima) in the order list format; a pending receipt without a resolvable image shows no link, and the closing screen stays.
- The «payment not available» state is dormant and is checked at view level only.
- The Portuguese label for «Pagado» is «Valor pago».
- The closing screen shows the order total, but no «Monto a pagar», «Pagado» or «Saldo pendiente», even with earlier confirmed payments.
- «Ver captura» links every pending receipt, newest first, adding the date and time when there is more than one. It has a 44 px touch target, an external-link icon and a new-tab hint in its accessible name.
- The closing screen offers no way to send another receipt or withdraw the pending one.
- «Pagado» counts only confirmed payments. With nothing paid, the payment step says «Monto a pagar» and the not-available amounts card says «Total del pedido».
- Overpayment is shown as is («Pagado S/ 35.00», «Saldo pendiente S/ 0.00»), with no buyer notice.
- The paid state keeps its current texts and uses the three rows. A receipt still pending in «Comprobantes enviados» keeps «Pendiente».
- When a manual payment covers the total while a receipt is pending, the paid state wins over the closing screen. A void during the closing screen keeps it.
- After an approval below the balance, the payment step shows no special notice; the seller explains in chat.
- After **Ya pagué**, and only then, focus goes to the heading of the refreshed state (closing card, rejection notice, paid card, or the cancelled block under the title), announced once and never also as a live region.
- «Report recorded but the page could not refresh» has its own message with **Recargar página** and does not offer **Ya pagué** again.
- The «Apariencia de la tienda» preview gets no closing-screen state. Success-color contrast is covered in all five themes by the theme contrast checks, and screenshots are taken in Clásico and Noche.
- The header hint «Revisa los productos y el total de tu pedido.» stays in every state.
- Mobile app unchanged: it has no buyer checkout.
