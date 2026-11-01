# Order review

How the seller resolves what the message reader left in a WhatsApp order: the «Con duda» marks, the «Por resolver» points, the order review shown when taking the checkout link, undoing what one message did, editing items on mobile, and the notice when an order changes after the link was taken. The reader's rules and decisions are in [message-to-order](message-to-order.md); the design is in [message-reader](message-reader.md).

Goal: every message a buyer sends either changes the order correctly without bothering the seller, or leaves a visible mark the seller resolves in one place, the review, without leaving the order and without cancelling it.

Sources of truth: use cases `load-order-review.ts`, `confirm-order-review.ts`, `undo-message-changes.ts`, `record-link-action.ts`, `find-open-questions.ts` in `apps/core/src/features/orders/application/`; pure rules `domain/order-review.ts` and `domain/message-changes.ts`; contracts `shared/contracts/order-review.ts`, `order-message-undo.ts`, `order-link-actions.ts`, `order-items-edit.ts`; web `orders/presentation/order-review-dialog.tsx` and `message-changes-block.tsx`; mobile `apps/mobile/src/features/orders/presentation/order-review-modal.tsx`, `message-changes-block.tsx`, `order-items-editor.tsx`. Texts: `apps/core/app/locales.ts` and `order-review-translations.ts` in mobile.

## Decisions

| Decision | Reason |
| --- | --- |
| The seller confirms or corrects in a review with the order's products when taking the link, doubtful points highlighted | One place, at the moment that matters; the seller lives in the chat |
| No approving change by change, and no moving between apps | Yoyos builds and corrects the order alone while it is pending |
| Pendings show as «Por resolver»; a review acknowledges them; only new points reopen it | Otherwise a link can go out missing a requested product; acknowledging avoids a review loop |
| Urgent questions are copied by the seller; Yoyos never writes to the buyer | Yoyos cannot send WhatsApp (receive-only library) and a WhatsApp message cannot point to the buyer's chat; the push opens the exact chat |
| One «Pedido #N cambió» per review cycle after the link was taken | The link never expires and the buyer pays the current total, so the seller is the only one who can miss the change |
| Mobile removes items and changes quantities; adding and changing variants stay on web | Keeps the phone flow small; a product asked for and not added is added from the web |
| Marks use the amber of the short-stock notice, contrast ≥ 4.5:1 in light and dark | Reuses an existing signal; never color alone |

## When something is "to review"

On an order **open for messages**, an order has something to review when it has: a change by a message after the last review, a «Con duda» mark, or a «Por resolver» point that appeared after the last review (points acknowledged in a review do not reopen it). Sure changes after the last review count; the card's count names only «Con duda» changes and unacknowledged points (a point carrying «Con duda» counts once, as a point, until it becomes an item).

On an order **no longer open for messages** (confirmed or reported payment, buyer-confirmed checkout, shipment, stock deducted, completion or cancellation), only «Con duda» marks keep it «Por revisar»: sure changes never reviewed do not, and pendings end with the order. Reason: the seller handled the order without the link.

Orders created on web, mobile or the public catalog never show marks, the review or **Cambios por mensajes**. Orders and messages from before this feature have no changes recorded and never open the review.

| Order | Link card | Review | Lists |
| --- | --- | --- | --- |
| Open for messages, WhatsApp, with something to review | URL hidden; «Revisa el pedido antes de enviar el enlace.» and the count; each link action opens the review first | On the link action | «Por revisar» |
| Paid, reported, buyer-confirmed or stock deducted, delivery pending | Today's card: URL visible, actions run directly | From **Revisar pedido** in the detail; **Confirmar revisión** records the review and saves corrections under the edit's rules, and takes no link | «Por revisar» while it has marks |
| Shipped or delivered | Today's card | From **Revisar pedido**, read-only (no quantity, **Quitar** or **Deshacer mensaje**; the edit's lock text); confirming clears the marks | «Por revisar» while it has marks |
| Completed | Today's card | Not offered; marks hidden; unreviewed changes become «not reviewed» | Never |
| Cancelled | «Pedido cancelado» | Not offered; marks hidden | Never |

## The review

- **Opens** on **Copiar enlace**, **Compartir enlace** or **Abrir enlace** of the checkout link of a WhatsApp order that is open for messages and has something to review; otherwise the link action runs directly. The first link action of a WhatsApp order always opens it (every item came from messages); with nothing marked it shows only **Productos** and the total and is confirmed with one tap. It opens only when the link is loaded; a link error, a missing subdomain or a cancelled order follow the card of [checkout](checkout.md#order-link-seller).
- **Layout:** mobile, a full-screen modal with a fixed bottom bar (total and main action); web, the app's dialog over the order view, actions fixed at the bottom. Title «Revisa el pedido #1023», with «Antes de enviar el enlace» when opened by a link action.
- **Content, in reading order (each section only if it has rows):**
  1. **Cambios con duda:** each marked item with its line, its reason and the buyer's quote («“la quiero en M”»). Items removed with a mark show as «Quitado por un mensaje: …».
  2. **Por resolver:** each pending point (new or acknowledged, while the pending lives) with its notice title, what to do per platform («Pregúntale al cliente o agrégalo desde la web.» on mobile; «… agrégalo en Productos, después de cerrar esta revisión.» on web), the suggested question and **Copiar pregunta**. Informative: it does not block confirming.
  3. **Productos:** the other items, read-only. After a previous review, items changed by messages carry «Cambió desde tu última revisión» and removals by messages, even sure ones, show «Quitado desde tu última revisión: …».
  4. Total.
- **Controls only on «Cambios con duda» items:** the quantity stepper (1 to 9999), **Quitar** (not on the last item: «El pedido necesita al menos un producto. Si ya no va, cancélalo.») and **Deshacer mensaje**. Unmarked items are corrected from the order detail. Reason: controls on every item would turn the check into a second editor.
- **Main action:** **Confirmar revisión** saves the corrections, records the review, then runs the link action that opened it (or only closes when opened from the detail). **Cerrar** closes without saving or taking the link; leaving with corrections asks «¿Descartar los cambios?».
- **Deshacer mensaje with corrections on screen** is disabled («Confirma o descarta tus correcciones antes de deshacer un mensaje.») and the bar offers **Descartar correcciones**. Reason: undo changes the saved order the corrections were made against. Without corrections, **Deshacer mensaje** asks its confirmation, applies at once and the review reloads.
- **Copy and open on web:** browsers refuse a clipboard write or a new tab after a wait. A review opened by the copy or open icon therefore closes after confirming, shows the URL and focuses the icon, which copies or opens on the next click. «Enlace copiado» shows only after a copy that succeeded. The link is recorded as taken on that click.
- **Web with unsaved product edits:** the link icons and **Revisar pedido** are `aria-disabled` with «Guarda o descarta los cambios del pedido antes de revisarlo.»
- **What confirming records:** that the seller reviewed exactly what the review showed (the changes up to the moment it loaded, its marks and its points). A later change, mark or point opens the review again on the next link action. Any seller of the company, on web or mobile, can review.
- **Corrections** (quantity and **Quitar** on marked items) are saved with the confirmation as one edit with the web edit's rules and locks ([orders](orders.md#editing-a-saved-order)): items can be corrected until the order is shipped, delivered or cancelled.
- **A message arrives while the review is open:** on **Confirmar revisión**, if the message touched an item the seller corrected, or added a mark or a point, nothing is saved and the review reloads in place keeping corrections on untouched items, marking the affected ones «Cambió mientras revisabas» and showing «Llegó un mensaje mientras revisabas. Revisa lo marcado y confirma de nuevo.». If the message only applied sure changes to other items, the confirmation succeeds, the link action runs, and the seller is told what changed and the confirmed total («Mientras revisabas, un mensaje agregó Gorra trucker · Rojo · ×1. Total: S/ 120.00.»); those changes open the review again on the next link action. On mobile the summary stays in the link card until the seller leaves the detail.
- **Another seller edited the order meanwhile:** «Este pedido cambió mientras lo revisabas. Revísalo de nuevo.», reloaded, corrections kept on untouched items.
- **Failures:** not sent → «No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo.», corrections intact, link not taken; in doubt → «No sabemos si se guardó. Verificando…», the link is not taken until verified, and repeating saves the same final state; shipped, delivered or cancelled meanwhile → the edit's lock text, and **Confirmar revisión** without corrections stays available on shipped or delivered orders.

## Screens

- **Link card (mobile and web):** on a WhatsApp order open for messages with something to review the URL text is not shown; the card shows «Revisa el pedido antes de enviar el enlace.» and, when there are marks or points, their count («1 cambio con duda», «2 por resolver»). The link actions stay and each opens the review first. This card is the only entry on such orders; the detail shows no second **Revisar pedido**. Otherwise the card is today's.
- **Order detail (mobile and web):** items with a mark show the badge «Con duda» (icon and text) and the reason; «Por resolver» points show above the items with **Copiar pregunta**; **Revisar pedido** shows above the items only where the link card does not already lead to the review (orders no longer open for messages, not cancelled or completed, with something to review). Below the items, **Cambios por mensajes** lists one row per message that changed the order, newest first, with the time (and the date when not today), a summary in catalog terms («15:42 · Agregó Polo básico · M · ×2 · Quitó Gorra trucker»), **Deshacer** when it can be undone, the reason instead of the button when it cannot, and «Deshecho» for undone rows; up to 5 rows with **Ver más**. The block loads with the order and does not show without changes by messages.
- **Mobile editing:** **Editar productos** enters edit mode with a quantity control and **Quitar** per item and a bar «Cambios sin guardar» with **Descartar cambios** and **Guardar cambios**. Same rules, revisions, locks, conflicts and texts as the web edit ([order-view](order-view.md)): quantity 1 to 9999, the last item cannot be removed, shipped, delivered, completed and cancelled orders do not offer it, editing never deducts or restores stock by itself, a seller edit wins over earlier messages, and a message that changes the items meanwhile makes the save answer «Este pedido cambió mientras lo editabas…» with the edits kept. In edit mode the link actions, **Revisar pedido** and **Deshacer** are disabled («Guarda o descarta los cambios primero.»). On web, unsaved changes disable **Deshacer** and **Revisar pedido** the same way.
- **Order lists:** an active WhatsApp order (not cancelled, not completed) with something to review shows «Por revisar» next to the checkout label. No filter.
- **Mobile chat view:** the suggested question of a message appears under it ([message-to-order](message-to-order.md#suggested-questions)).

## Undo what one message did

There is one undo: per message, all or nothing, from the **Cambios por mensajes** row or from **Deshacer mensaje** in the review.

| Aspect | Behavior |
| --- | --- |
| Effect | Returns the order and the chat's pendings to what they were right before that message for everything it touched: removes what it added, puts back what it removed with the same line (copied name, variant, unit price and mentioned price), restores quantities and variants, and restores the pendings it created, replaced or completed to their earlier state. The order is not cancelled. |
| Price | A restored line keeps its copied unit price, even if the catalog price changed: it reverts a change the seller did not make. Manual edits keep the web rule. |
| Restored pendings | A pending comes back with its earlier values and its earlier last-change time, so its life is unchanged: one without an order whose 7 days have passed does not come back. It counts toward the limit of 10; if the chat is full, the least recently changed other pending ends silently. A created pending ends. |
| When | While the order is open for messages. |
| Refused | When an item the message touched was changed later (by another message or the seller); when it would leave the order without items; when it would put back a product or variant that is no longer sold; when the order moved on. A message whose own undo already happened does not block an earlier message's undo: once the later message is undone, the earlier one can be undone again, and its mark returns. The row shows the reason instead of **Deshacer** («Un cambio posterior tocó este producto.», «Dejaría el pedido sin productos.», «La Gorra trucker · Negro ya no se vende.», «El pedido ya avanzó.»). If the state changed between showing and confirming, the same reason shows after confirming and nothing changes. |
| Unsaved edits | Disabled while the web order view has unsaved changes, the mobile edit mode is open, or the review has corrections on screen. |
| Confirmation | «¿Deshacer lo que hizo este mensaje?» listing the changes («Quitar Gorra trucker · Negro · ×2», «Volver Polera gris a talla L»), the pendings that come back («Volverá: …») and the one that ends to make room («Terminará: …»), with **Deshacer cambios** / **Conservar**. |
| Messages afterwards | A later message reads the order as it is after the undo. The undone message is never applied again. |
| Failures | Success → «Cambios deshechos.»; not sent → «No se pudo deshacer. Revisa tu conexión e inténtalo de nuevo.»; in doubt → «No sabemos si se deshizo. Verificando…» (repeating never undoes twice). |

Accepted risks: a product asked for and not added («Por resolver») can be added by hand only from the web, and an item a message removed by mistake whose undo is refused can be added back only from the web, at the current catalog price.

## After the link was taken

| Aspect | Behavior |
| --- | --- |
| Link taken | A recorded **Copiar enlace**, **Compartir enlace** or **Abrir enlace** of the checkout link on web or mobile, by any seller of the company, directly or after confirming a review. Copy and open are recorded on the tap that performs them; share is not recorded when the system reports the share sheet was dismissed. A review confirmed from the detail does not take the link. Copying the visible URL by hand is not recorded; on orders with something to review the URL is hidden, so the first link always goes through a recorded action. Accepted: a seller who only wanted to review takes the link to confirm, and that arms the notice even if the buyer never got the link. |
| Notice | The first message that changes the order (any applied change, a mark or a new point) after the link was taken and before the next review sends one non-urgent push: «Pedido #1023 cambió» / «Pedido #1023 mudou», body «Un cliente cambió el pedido #1023 después de recibir el enlace. Revísalo antes de cobrar.», opening the order. Later messages of the same cycle send nothing new for this reason. |
| Precedence | An urgent problem in the same message wins and its body ends with «El pedido cambió después de enviar el enlace.». «Pedido #N cambió» wins over «Pedido #N listo», «Revisa el pedido #N» and «Pedido nuevo #N». |
| Only while open | Messages change only orders open for messages, so the notice exists only then; a buyer already confirming is protected by the checkout's `TOTAL_CHANGED`. |
| Next link action | Opens the review with the changes since the last review. |

## Verdicts

Every change gets one final verdict: kept, quantity changed or removed (in a review, also a read-only one, or by an edit in the order detail on web or mobile), undone (by **Deshacer**), or not reviewed, fixed only when the order completes or is cancelled with the change never reviewed nor edited. «Kept» on an item that had a mark is a strong label; «kept» on an unmarked item is a weak label, reported apart, because a one-tap confirmation does not prove the seller read it. Verdicts feed evaluation labels and keep no buyer text.

State of a change: Applied → Revisado, Deshecho or Sin revisar; Con duda → Revisado (also by a read-only review), Deshecho, Sin revisar, or replaced by a later message's decision; Revisado → Deshecho (while open). Deshecho and Sin revisar are final.

## Accessibility

- Opening the review moves focus to the title and closing returns it to the control that opened it; on web the dialog traps focus and closes with Escape (with the discard confirmation when there are corrections). Section titles are headings in reading order: title, **Cambios con duda**, **Por resolver**, **Productos**, total, actions.
- Marks, «Cambió desde tu última revisión», «Cambió mientras revisabas», «Quitado…» and «Deshecho» are text with an icon, never color alone. The mark is read as part of its item («Polera gris M, con duda: un mensaje cambió talla: de L a M»). The quote is read as «El cliente escribió: …».
- Each **Deshacer** names its row, each **Quitar** and quantity control names the product and variant, each **Copiar pregunta** names the product it asks about.
- Controls blocked by a rule stay focusable as disabled with the reason as their description.
- «Pregunta copiada», «Cambios deshechos.», «Actualizando pedido…», «Verificando…» and the summary of changes during review are announced politely; known rejections as alerts. Touch targets are at least 44 pt on mobile.

## Texts

Spanish is the source; every text has a Brazilian Portuguese version in the same files. Names that matter: sections «Cambios con duda» / «Mudanças com dúvida», «Por resolver» / «A resolver», «Productos» / «Produtos»; mark «Con duda» / «Com dúvida»; list label «Por revisar» / «Para revisar»; action **Confirmar revisión** / **Confirmar revisão**; reasons «Un mensaje cambió talla: de L a M» / «Uma mensagem mudou tamanho: de L para M» (the attribute name follows the catalog, with no article), «Un mensaje cambió la cantidad a 3», «Un mensaje agregó 2», «Un mensaje quitó Gorra trucker», «No pudimos leer lo que escribió con la foto», and for a mentioned price on an item the message did not name, a text stating the amount and units and that the order's price did not change. Reasons are structured data and never include articles or gendered words before catalog names. Catalog names and values are never translated.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller of the company | Their orders, marks, quotes, «Cambios por mensajes», points, suggested questions | Review, correct, undo, edit items on web and mobile | See traces; see other companies' data |
| Buyer | The checkout as today | Confirm and pay as today | See marks, quotes, points or the review; be written to by Yoyos |
| Named Yoyos team members | Traces with masked texts, evaluation reports | Debug, evaluate; each trace read is recorded | Reach traces through seller roles |

## Information kept with the order

For the life of the order: what each message changed (items, quantities, variants, mentioned prices, the line as it was before) in catalog terms, the decision of each change, the «Con duda» reason, the suggested questions, each change's verdict, what each review showed and when, and each recorded link action. No buyer text. The review's unsaved corrections are not kept. The quote shown in the review is read from the trace and disappears with it after 90 days.
