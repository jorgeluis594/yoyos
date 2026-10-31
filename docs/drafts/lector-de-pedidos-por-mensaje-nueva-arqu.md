# Staged message reader: product definition

**Status:** definition ready to implement (closed 31/10/2026 after the review gate: UX/UI approved in round 3, product in round 5; the founder confirms the gate's answers in the final pull request). Replaces the single-call reader described in [message-to-order](../message-to-order.md) (one gpt-6-luna call decides and applies every change); reuses its rules, pendings, notices and checks, and the reader rules planned in PR #313 (closed unmerged, branch `jorgeluis594/pedidos-por-mensaje-que-la-ia-no-pierda`), whose texts this document restates where it uses them. Covers the five phases of Todoist task `6hv99FVqgMmmJJR3`. Founder decisions of 31/10/2026 prevail over the background proposal. Date: 31/10/2026.

## Problem and situation

A seller is answering five WhatsApp chats at once on a Saturday evening. Carla sends a photo of the «Polera gris» and writes «la quiero en M»; she already had the polera in L. Yoyos changes the item to M without telling anyone. Ten minutes later Rosa writes «confirmo así nomás, ta bien» and Yoyos reads it as small talk: no «Pedido listo», so the seller does not send her the link and Rosa waits. When the seller finally opens Carla's order to send the link, nothing on the screen says which items a message changed, the phone offers no way to remove the wrong item or lower a quantity, and the only fix is to cancel the order and build it again. In the founder's real WhatsApp test of PR #313 the same thing happened in numbers: 10 requests ignored and 5 silent wrong changes, and two identical runs of the same test differed by 2.7 points (90.2 % and 87.5 %), so nobody could tell whether a prompt change helped.

## Goal

Every message a buyer sends either changes the order correctly without bothering the seller, or leaves a visible mark the seller resolves in one place, the order review shown when they take the checkout link, without leaving the order. Zero silent wrong changes. Hypothesis: if it works, the seller sends the link without reading the whole chat again and without cancelling orders to fix them. It would show as: fewer than 1 in 20 cancelled WhatsApp orders followed by a new order in the same chat within 24 hours; at most 10 % of messages escalated to the seller; and seller corrections concentrated on the changes Yoyos marked, not on unmarked ones.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller selling in several WhatsApp chats at once, phone in hand | That orders build themselves and that only a real doubt interrupts them, with the question ready to copy | Mobile push notices; mobile chat view |
| Seller about to send the checkout link to a buyer | To see what will be charged, with what Yoyos was unsure about highlighted, and fix it right there | Order review on mobile and web, shown when taking the link |
| Seller who sees a wrong item in an order | To undo what one message did, remove an item or change a quantity from the phone, without cancelling | Mobile order detail; web order view |
| Buyer writing in WhatsApp | Nothing new: they keep talking to the seller; Yoyos never writes to them | WhatsApp (the seller's) and the checkout |
| Yoyos team improving the reader | To know which stage failed in a message and whether a change improved things beyond noise | Traces and evaluation reports (internal, no seller screen) |

## First-version scope

All five phases of the task are in scope, built in this order; each phase only adds to the previous one. The whole task follows the implement-task flow: one integration branch, one pull request per plan task against it, one final pull request to `main` (founder, 31/10, replacing the task's «un PR por fase»). Sellers therefore get phase 1 (undo, mobile editing) together with the rest, at the final merge.

1. **Measure and undo.** A trace per message and stage; **Deshacer** on what one message did; removing items and changing quantities on mobile; the seed bank; every evaluation run 3 times with mean and range.
2. **Context and intent.** The reader sees the recent conversation (buyer and seller) and decides first whether the message asks something of the order. Criterion: 0 «confirmo» or payment requests read as no intent, in 3 of 3 runs.
3. **Extraction and catalog resolution.** Each piece of data comes with the buyer's exact words that justify it; products are found by searching the catalog, not by pasting it. Criteria: resolution measured on its own; average cost ≤ US$0.0015 per message and p95 ≤ 6 s (proposed targets).
4. **Certainty and decision.** Each change gets a certainty and a risk; an explicit policy applies it, applies it marked «Con duda», keeps it «Por resolver», or escalates it. Criterion: 0 silent wrong changes in the frozen holdout, 3 of 3 runs.
5. **Switch-on.** The new reader applies from day one; the old reader runs in shadow (compared, never applied); the seller confirms in the order review when taking the link.

Channels, message types and languages do not change: individual WhatsApp chats, text and photo with caption, buyers writing in Spanish or Portuguese, the app in Spanish and Brazilian Portuguese. Everything in [message-to-order](../message-to-order.md) (pendings, «listo», mentioned prices, open order, order per chat, retries, notice texts) keeps its rules unless [Changes to current rules](#changes-to-current-rules) lists it.

Meeting points left for other tasks: showing how a photo was identified (`6hp3GMrxGGqWCfG3`) adds to the «Con duda» reason; several products per photo (`6hrVWR46qpGFcwq3`) feeds more changes into the same policy; hiding a product (`6hrqR5xxq2q9hr3V`) no longer waits for the reader. This task replaces `6hrq6p7vJHRmJcwV` and makes `6hrqHJghCXGwX26V` (`READER_MAX_PRODUCTS`) obsolete.

## Out of this version

- Yoyos writing to the buyer on WhatsApp, and sending WhatsApp messages to the seller. Suggested questions are copied by the seller from Yoyos. Trigger: a sending channel is decided.
- Approving changes one by one before they apply, and making the seller move between apps to approve. Founder decision.
- A strong model as a second opinion. Each stage's model is chosen by configuration so one can be added without touching the others or the policy. Trigger: the frozen holdout shows a family of errors the cheap model cannot resolve within the cost target.
- New screens other than the order review and **Deshacer**: no inbox of doubts, no history screen, no seller screen for traces.
- Adding products and changing variants from mobile: mobile removes items and changes quantities; adding or changing a variant stays on the web order view. Trigger: sellers ask for it on mobile. **Real risks, accepted:**
  - A product the buyer asked for and Yoyos could not add («Por resolver») can be added by hand only from the web; on mobile the seller copies the question and the buyer's answer completes it.
  - An item a message removed by mistake, when **Deshacer** is refused (a later change touched another product of that message, or the order moved on), can be added back only from the web, and at the current catalog price, not the copied one.
- Keeping buyer texts beyond 90 days for evaluation (review gate, Q3).
- Reading audio, video, documents, stickers, edited or deleted messages and group chats (unchanged).
- Real buyer chats as evaluation source: there are none yet; the seed bank, people playing buyers and seller verdicts stand in for them.

## Flow

1. A buyer message arrives in an individual chat and is registered as today; messages of one chat are read one at a time, in arrival order.
2. **Context.** Yoyos gathers the open order, the chat's pendings, the last photo with its identified product and the chat's recent messages, the buyer's and the seller's: the last 12 messages from the last 48 hours (initial values, adjustable). Seller messages and earlier buyer messages are context only (see [Context and reading](#context-and-reading)).
3. **Intent.** Yoyos decides whether the message asks something of the order (add, remove, change, complete, «listo», wants to pay) or not, and if not, why (greeting, question about stock, payment report…). «confirmo así nomás» after the seller listed the order is «listo»; «¿cómo te pago?» is a payment request.
4. **Extraction.** For each request: product, size, color, quantity, price and reference («esas», «la de la foto»), each with the exact words of the buyer that justify it.
5. **Resolution.** Each product is found by searching the company's catalog (the search that exists today, by name, and the photo identification) and choosing among the results.
6. **Checks.** The current rules decide whether each change can be applied: the variant exists and is sold, the item is in the order, limits, closed orders, mentioned prices.
7. **Certainty.** Each change gets a certainty from reviewable signals ([Decision](#decision)).
8. **Decision.** Each change ends in exactly one decision. The changes of one message that apply, apply together.
9. **Notice.** When the message needs the seller now, one push notice with the suggested question for the buyer ([Notices](#notices)); when it changed an order whose link was already taken, one «Pedido #N cambió» per review cycle.
10. **Review.** When the seller takes the checkout link of an order with something to review, Yoyos shows the order review; the seller confirms or corrects, then the link is copied, shared or opened. The seller can also open the review from the order detail.

Alternative paths:

- The seller sees a wrong item before sending the link: in the order detail, **Deshacer** on that message, or remove the item or change its quantity.
- A message changes the order after the seller took the link: the seller gets «Pedido #N cambió» once, and the next link action opens the review ([After the link was taken](#after-the-link-was-taken)).
- The buyer pays or confirms and the order stops being open for messages: marks stay; the seller reviews from the detail, and corrections follow the web edit's locks ([Orders that are no longer open for messages](#orders-that-are-no-longer-open-for-messages)).
- A message fails to be read after its retries: the urgent notice «No pudimos revisar un mensaje», as today.

## Screens

### Order review (mobile and web)

- **When it opens on a link action:** on **Copiar enlace**, **Compartir enlace** or **Abrir enlace** of the checkout link of a WhatsApp order that is open for messages and has something to review: a change by a message after the last review, a «Con duda» mark, or a «Por resolver» point that appeared after the last review. Otherwise the link action runs directly. Orders from web, mobile and the public catalog never show it. «Por resolver» points already acknowledged in a review do not open it again (no loop).
- **When it opens from the detail:** **Revisar pedido** in the order detail, offered on orders no longer open for messages ([below](#orders-that-are-no-longer-open-for-messages)); confirming there records the review and takes no link.
- **First review with only sure changes:** the first link action of a WhatsApp order always opens the review (every item came from messages), as the founder decided; with nothing marked and nothing to resolve it shows only **Productos** and the total, no empty sections, and is confirmed with one tap.
- **Only with a link ready:** the review opens on a link action only when the link is loaded. While it loads, the existing «Cargando enlace…» shows and the link buttons stay disabled; a link error, a missing subdomain or a cancelled order follow today's card ([checkout](../checkout.md#order-link-seller)) and the review does not open.
- **Layout:** mobile, a full-screen modal (header with title and **Cerrar**, scrollable content, a fixed bottom bar with the total and the main action above the keyboard and the system bar). Web, the app's existing dialog over the order view, scrollable content, actions fixed at the bottom.
- **Title:** «Revisa el pedido #1023». Under it «Antes de enviar el enlace» when opened by a link action; nothing from the detail.
- **Content, in reading order (each section only if it has rows):**
  1. **Cambios con duda**: each item with a «Con duda» mark, with its line, its reason and the buyer's quote. Example: «Polera gris · M · ×1 · S/ 59.00», reason «Un mensaje cambió la talla de L a M», quote «“la quiero en M”». Items removed with a mark show here as «Quitado por un mensaje: Gorra trucker · Negro · ×2».
  2. **Por resolver**: each pending point (new or already acknowledged, while the pending lives) with its notice title and what to do, per platform. Mobile: «Falta la variante: Polo básico ×2 — falta la talla. Pregúntale al cliente o agrégalo desde la web.». Web: «… Pregúntale al cliente o agrégalo en Productos, después de cerrar esta revisión.». With the suggested question and **Copiar pregunta**. Informative: it does not block confirming.
  3. **Productos**: the rest of the items, read-only, with variant, quantity, unit price and subtotal. When a previous review exists, items changed by messages after it carry «Cambió desde tu última revisión», and items removed by messages after it, even sure removals, show read-only as «Quitado desde tu última revisión: Gorra trucker · Negro · ×2».
  4. Total.
- **Controls, only on «Cambios con duda» items:** the existing quantity stepper (− and +, here from 1 to 9999; 0 or empty shows «Ingresa una cantidad de 1 a 9999.»), **Quitar** (not on the last item: «El pedido necesita al menos un producto. Si ya no va, cancélalo.»), and **Deshacer mensaje**, with the [undo](#undo-what-one-message-did) semantics. Unmarked items are corrected from the order detail. Accepted cost: an unmarked wrong item the seller spots in the review takes **Cerrar**, **Editar productos** in the detail and the link action again; controls on every item would turn the check into a second editor.
- **Deshacer mensaje with corrections on screen:** while the review has corrections not yet confirmed, **Deshacer mensaje** is disabled with «Confirma o descarta tus correcciones antes de deshacer un mensaje.», and the bottom bar offers **Descartar correcciones**, which returns every item to the loaded state without closing. Reason: undo changes the saved order the corrections were made against. Without corrections, **Deshacer mensaje** asks its confirmation, applies at once and the review reloads.
- **Main action:** **Confirmar revisión**, one label for every case. It saves the corrections, records the review and then runs the link action that opened it, or only closes when opened from the detail. Secondary: **Cerrar**, which closes without saving or taking the link.
- **Copy and open on web:** browsers refuse a clipboard write or a new tab that happens after a wait instead of right on the click. So a review opened by the copy or open icon does not copy or open after saving: it closes, the URL shows in the card and focus goes to the icon that opened it, which copies or opens on the seller's next click. «Enlace copiado» shows only after a copy that succeeded. The link is recorded as taken on that click.
- **States:**
  - Loading: the products as last loaded with «Actualizando pedido…» announced politely; **Confirmar revisión** disabled; focus stays on the title.
  - Load error: «No pudimos cargar el pedido. Revisa tu conexión.» with **Reintentar**; the link is not taken.
  - All marks corrected: **Cambios con duda** shows «Ya revisaste todos los cambios con duda.»
  - The order is not open for messages: see [Orders that are no longer open for messages](#orders-that-are-no-longer-open-for-messages).
  - Shipped, delivered or cancelled while open: on confirm, the edit's lock text («El pedido ya se envió; los productos ya no se pueden cambiar.» and its variants) next to the corrections; **Confirmar revisión** stays available to record the review without corrections.
- **Messages arriving while the review is open:** see [Seller review](#seller-review); the review does not refresh by itself.
- **Leaving with corrections:** **Cerrar**, Escape or the back gesture asks «¿Descartar los cambios?» (**Descartar cambios** / **Seguir revisando**).
- **Web with unsaved product edits in the order view:** the link icons and **Revisar pedido** stay `aria-disabled` with «Guarda o descarta los cambios del pedido antes de revisarlo.»

### Link card (mobile and web, changed)

- **WhatsApp order open for messages with something to review:** the URL text (mobile selectable text, web read-only input) is not shown. In its place «Revisa el pedido antes de enviar el enlace.» and, only when there are marks or points, their count: «1 cambio con duda», «2 cambios con duda», «1 punto por resolver», «1 cambio con duda · 2 por resolver» (the count is of «Con duda» changes and unacknowledged «Por resolver» points; a «Por resolver» point carrying «Con duda» counts once, as a point, until it becomes an item, which then counts as a «Con duda» change; sure changes are not counted). The existing link actions stay, each opening the review first and then doing its own action after **Confirmar revisión**: mobile **Copiar enlace**, **Compartir enlace** and **Abrir enlace**; web the copy and open icons (see copy and open on web above). This card is the only entry to the review on such orders; the detail shows no second one.
- **Message during review, on mobile:** the «mientras revisabas» summary stays as a status line in the card until the seller leaves the detail, so it is still visible after returning from the share sheet or the browser.
- **Otherwise** (nothing to review, or an order not open for messages), the card is today's: the URL shows and the actions run directly.

### Order detail on mobile (changed)

- Items with a mark show the badge «Con duda» (icon and text, amber, contrast ≥ 4.5:1 in light and dark, reusing the amber of the short-stock notice) and the reason.
- «Por resolver» points show above the items, with the same content as in the review and **Copiar pregunta**.
- **Revisar pedido** with the same count («1 cambio con duda») shows above the items only when the link card does not already lead to the review: an order no longer open for messages, not cancelled or completed, with something to review ([Orders that are no longer open for messages](#orders-that-are-no-longer-open-for-messages)). On orders open for messages the link card is the only entry, and the review there always ends in a link action or **Cerrar**.
- **Editar productos** above the items enters edit mode: quantity control and **Quitar** per item, and a fixed bottom bar «Cambios sin guardar» with **Descartar cambios** and **Guardar cambios**, reusing the unsaved-changes pattern and the two-button confirmation already in the app. The last item cannot be removed: «El pedido necesita al menos un producto. Si ya no va, cancélalo.» Shipped, delivered, completed and cancelled orders do not offer **Editar productos**, with the web order view's lock texts ([order view](../order-view.md)). In edit mode the link actions, **Revisar pedido** and **Deshacer** are disabled with «Guarda o descarta los cambios primero.»
- **Cambios por mensajes** block below the items: one row per message that changed the order, newest first, with the time (and the date when not today: «30/10 15:42») and a summary in catalog terms («15:42 · Agregó Polo básico · M · ×2 · Quitó Gorra trucker»). Each row offers **Deshacer** when it can be undone; when it cannot, the row shows the reason instead of the button («Un cambio posterior tocó este producto.», «El pedido ya avanzó.», «Dejaría el pedido sin productos.», «La Gorra trucker · Negro ya no se vende.»). Undone rows show «Deshecho». Up to 5 rows with **Ver más**. The block is part of the order: it loads and fails with the order detail, with no state of its own. Without changes by messages it does not show.
- Leaving edit mode with changes asks «¿Descartar los cambios?» (**Descartar cambios** / **Seguir editando**).

### Web order view (changed)

- The same «Con duda» badge, «Por resolver» points, **Revisar pedido** and **Cambios por mensajes** block, below **Productos**. Editing products already exists.
- With unsaved changes, **Deshacer** and **Revisar pedido** are `aria-disabled` and covered by the existing note «Tienes cambios sin guardar. Guarda o descarta los cambios primero.» Reason: undo changes the saved order the edit was made against.

### Order lists (mobile and web, changed)

- An active WhatsApp order (not cancelled, not completed) with something to review shows «Por revisar» (text, next to the existing checkout label). Cancelled and completed orders never show it. No new filter.

### Mobile chat view (changed)

- A message whose decision carries a suggested question shows it under the message in a box: «Pregúntale al cliente:» and the question, selectable, wrapping to as many lines as needed, with **Copiar pregunta**. Copying announces «Pregunta copiada»; a copy the system refuses fails silently, like the link, and the text stays selectable.
- A message with several points shows one box per point, up to 3, in the order of the message.
- The box shows every time the chat shows that message, also without opening the notice and after dismissing it, while its point is still open. It disappears once a later message resolves the point (the pending is completed or declined), the seller resolves it (edits, undoes), or the order stops being open for messages.
- A notice without a question («No pudimos revisar un mensaje», a cancel request) shows no box.
- The question is in the buyer's language (Portuguese when the buyer writes in Portuguese, else Spanish), not the interface's: it is text for the buyer.
- The chat lives on the phone that has WhatsApp. Other sellers of the company see the same question in the order detail and the review.

## Rules

### Context and reading

| Aspect | Behavior |
| --- | --- |
| Messages read as context | The last 12 messages of the chat from the last 48 hours, incoming and outgoing, plus the last photo with its identified product, the open order and the pendings. Initial values, adjustable. A message of another chat or company is never context. |
| Context is not a request | Only the message being read can change the order. Seller messages and earlier buyer messages help understand it («¿En qué talla?» from the seller, then «M», completes the pending in M) but are never applied again: a request an earlier message already applied, or the seller undid, never applies a second time through a later reading. |
| Understanding vs checking | Understanding the buyer's words is the model's; checking against catalog and order is code's. Code keeps no word lists, plurals or phrases (founder rule, unchanged). |
| Justifying words | Every product, variant value, quantity and price comes with the buyer's exact words that justify it. Data with no justifying words is not used. |
| Catalog | Products reach the reading only through the catalog search and the photo identification. There is no limit by number of products pasted. |
| Embedded instructions | Text that tries to give instructions is data, as today: the change it asks for is a request the chat never does. |
| Photo | The photo still decides the product (QR, then visual search at 0.8). |
| Cost and time | Average cost ≤ US$0.0015 per message over the seed bank; no fixed maximum per message. p95 ≤ 6 s from the moment the message starts being read to its decision, excluding time queued behind earlier messages of the same chat, which is reported separately (proposed target, measured in phase 1). The shadow reader's cost is reported apart and does not count toward the average. |

### Decision

Each change a message asks for gets exactly one decision:

| Decision | When | What the order shows | Notice |
| --- | --- | --- | --- |
| Applied | High certainty and low risk; or high certainty, high risk and two readings that agree | The change, nothing else | None |
| Applied «Con duda» | A single best reading exists, but certainty is not high, or the change is high risk and the readings do not agree | The change, with the «Con duda» mark and its reason | None |
| «Por resolver» | The buyer asked for a product that cannot be added without their answer (today's pendings) | Not an item; a point in the order detail and the review | Urgent, once, when the point is created (as today's pending notice) |
| Not applied, urgent | The buyer waits for something only the seller can give, and there is no single best reading | Nothing changes | Urgent notice, with the suggested question when one applies |
| Silent | No purchase intent, pending changes the buyer clearly asked for | Nothing new | None |

**Certainty is high only when every signal holds:**

1. The justifying words are present for every piece of data.
2. The target is named in the buyer's own words: the product or item («el polo», «la gorra trucker»), or it is the product a photo in the same message shows. A target taken from context (the only item, the last photo, the product just mentioned) is never high certainty, with one exception, the **photo just sent** (below).
3. A variant change on an existing item has an explicit change verb («cámbialo», «mejor en»). A text that only names a variant («en talla M», «la quiero en M») is never high certainty for an item.
4. A single candidate in the catalog or the order.

So «la quiero en M», «otro igual», «uno más», and «quítalo» resolved from context are at best «Con duda», even when two readings agree. Two agreeing readings are required on top of the signals for high-risk changes, never a substitute for them.

**Photo just sent (the only context target that counts as named, rule planned in #313 and restated here):**

| Aspect | Behavior |
| --- | --- |
| What it is | A matched product photo that is the chat's last incoming message read before this one, not itself right after another incoming photo (an album, photo and photo). Outgoing and skipped messages in between (seller replies, «👍») do not break it; any read buyer text in between does. |
| What it covers | Only **set** wording without a product name: «quiero 3 de esos», «pásame 3 de esas», «que sean 3», «mejor 3», also with values («3 de esos en M negro»). It sets the quantity, up to 99, of what that photo left: its pending, or the item it created or grew. |
| What it does not cover | **Add** wording («2 más de esos», «otros 2», «otro igual», «uno más», «lo mismo x2») stays an unnamed add: at best «Con duda», otherwise urgent. It never applies to another item, even the only one. |
| Unchanged since | It counts only while what the photo left is as the photo left it: the pending alive and unchanged, or the item at the quantity and variant the photo left, in the same open order. Otherwise the target is plain context: at best «Con duda». |
| No photo just sent | The previous incoming message is a text, a photo that matched nothing, a non-product photo, a product photo that left nothing (the caption declined it), a photo right after another photo, or the photo's pending ended or its order stopped being open. |

**Changes to a pending** carry no money, so they are low risk; a pending cannot hold an item mark. A change to a pending that is not high certainty is applied to the pending and its «Por resolver» point carries the reason «Con duda: un mensaje cambió la cantidad a 3», which opens the review like a new point; no notice. Example: photo of the «Gorra trucker» without color (pending ×1, «Falta la variante»), then «2 más de esas»: the pending becomes ×3 «Con duda», one notice only.

**The doubt follows the units to the item.** A pending's doubt is not lost when a later message completes it:

| Aspect | Behavior |
| --- | --- |
| Completion | Each item created from a pending that still carries «Con duda» gets the «Con duda» mark with the pending's reason («Un mensaje cambió la cantidad a 3»), even when the completing message itself is high certainty («en rojo» only gives the color). The item counts as a «Con duda» change, opens the review and needs a review or an edit to clear, like any other mark. |
| Split | When a message assigns the pending's units to several items («uno negro M y otro blanco L»), every item created from it carries the mark; units left as a pending keep the doubt on their point. |
| The buyer restates the doubted data | When the completing message states the doubted value itself («en rojo, las 3» after the doubted ×3), that value has its own justifying words and the decision is that message's: no inherited mark. |
| Acknowledged before | A confirmed review that showed the doubtful point acknowledges its doubt: the item created later carries no mark. It is still a change after the last review, so it opens the next review on a link action and shows «Cambió desde tu última revisión». |
| Undo | Undoing the completing message brings the pending back with its doubt, as before that message. |

| Risk | Changes |
| --- | --- |
| Low | Add a named product, complete a pending, change a pending's quantity or values, note a mentioned price, «listo» |
| High | Remove an item, lower or set the quantity of an existing item, change a variant, add by reference without a name («otro igual»), any change to an item the buyer did not name |

**Photo-then-variant guard (founder, 22/10, kept):** a text that only names a variant never changes an item that the last photo is not about. If the last incoming photo in the context showed a product that was not identified, was identified but not added (declined, or left nothing), or is a product other than the item the variant would fit, the text completes that photo's pending if there is one; otherwise it is urgent (`variant_only`) with «¿Para qué producto es la talla L?». It may become «Con duda» on an item only when no photo is in the context or the last photo is of that same item.

- A message never applies half of one change. The changes of one message are decided one by one; those that apply, apply together.
- Every decision is pure and reviewable: the same signals give the same decision, without a model.

### Every current outcome under the new decisions

| Current outcome ([message-to-order](../message-to-order.md#outcomes)) | New decision | Suggested question (es) |
| --- | --- | --- |
| Added, removed, quantity changed, variant changed, mentioned price set, pending created/updated/completed/split/ended | Applied, or «Con duda», by the signals and risk above | — |
| `no_intent` | Silent | — |
| `ready` | Applied; push «Pedido #N listo» (unchanged) | — |
| `only_item_kept` | Applied; push «Revisa el pedido #N» (unchanged) | — |
| `new_order_after_closed` | Applied; push «Pedido nuevo #N» (unchanged) | — |
| `variant_missing` | «Por resolver», urgent | «¿En qué talla quieres el Polo básico: S, M o L?» |
| `not_clear` (product between candidates) | «Por resolver», urgent | «¿Cuál de estos quieres: Polo oversize o Polo básico?» |
| `variant_not_available` | «Por resolver», urgent | «El Polo básico no viene en XL. ¿Lo quieres en S, M o L?» |
| `variant_for_several_pendings` | «Por resolver», urgent | «¿Para cuál es la talla M: el Polo básico o la Polera?» |
| `ready_with_pendings` | Urgent (unchanged body) | The first pending's question |
| `variant_only` («la quiero en M») | **Changed:** completes a pending it fits (unchanged); else, with the photo guard passed, one item it fits and the variant is sold → «Con duda» (never applied without mark), no notice; several items or the guard not passed → urgent; not sold → urgent as `variant_not_available` | «¿Cuál quieres en M: la Polera gris o el Polo básico?» / «¿Para qué producto es la talla M?» |
| `unnamed_add` («otro igual», «uno más») | **Changed:** a single product the context points to → «Con duda» (never applied without mark); otherwise urgent | «¿De cuál producto quieres otro?» |
| Quantity for the photo just sent («pásame 3 de esas» right after the photo) | Set wording, unchanged since: high certainty. On the photo's pending: applied, silent. On the item the photo left (high risk): applied with two agreeing readings, else «Con duda». Add wording or changed since: at best «Con duda» (on the item, or on the pending's point) | — |
| `unclear_item` («quítalo» with two items) | **Changed:** a single best reading from context → «Con duda» (never applied without mark); otherwise urgent | «¿Cuál quieres quitar: la Gorra trucker o el Polo básico?» |
| `not_identified` (photo matched nothing) | Urgent (unchanged); silent misses while the catalog is not ready stay silent | «¿Me dices el nombre del producto de la foto?» |
| `product_not_available` | Urgent (unchanged) | «Ya no tenemos la Casaca jean. ¿Te muestro otra opción?» |
| Payment request («¿cómo te pago?», «pásame el link») | **Changed:** today no intent and silent; now urgent with the bodies in [Notices](#notices) | No question |
| `request_not_allowed` (cancel, change price, embedded instruction) | Urgent (unchanged) | — |
| `order_closed`, `no_open_order` | Urgent (unchanged) | — |
| `image_with_request` | Urgent (unchanged) | — |
| `quantity_above_limit` | Urgent (unchanged) | — |
| `caption_not_applied` (product added, caption lost) | **Changed:** the added item gets «Con duda: no pudimos leer lo que escribió con la foto», no notice | — |
| `reader_doubt` | Urgent when the intent stage cannot say whether the message asks something of the order (unchanged body) | — |
| `invalid_action`: quantity not whole, quantity below zero, text too long, too many actions (the rest after the first 10), not the shown product | Urgent, generic «Revisa el chat» (unchanged) | — |
| `invalid_action`: unknown reference, malformed, context too large | Removed as outcomes: products come only from the catalog search, so a product outside the results is a resolution failure retried by the stage, and a malformed answer that persists is `failed` | — |
| `failed` | Urgent «No pudimos revisar un mensaje» (unchanged) | — |

### Changes to current rules

| Current rule | New rule | Reason |
| --- | --- | --- |
| «Earlier messages are never read»; the pendings carry what matters | The last 12 messages of 48 hours, both sides, are context | Task stage 1, founder 31/10 |
| `variant_only` never changes an item and always notifies (founder 22/10) | With the photo guard kept, one item it fits → «Con duda», never without mark; urgent otherwise | Founder 31/10: the AI applies, doubts are marked, the seller confirms in the review. The 22/10 risk (a variant changing an item the photo was not about) stays closed by the guard |
| `unnamed_add` never applies and always notifies | «Con duda» when the context points to one product; urgent otherwise | Same |
| `unclear_item` always notifies | «Con duda» with a single best reading from context; urgent otherwise | Same |
| Payment request is no intent, silent | Urgent, with the bodies planned in #313 (founder 30/10) | «confirmo» and payment questions read as no intent are a seed-bank family; a buyer ready to pay is a sale |
| `caption_not_applied` notifies | «Con duda» mark on the item, no notice | The product was added; the doubt is in the order |
| «No screen shows pendings» (28/10) | Pendings show as «Por resolver» in the order detail and the review | Review gate Q2; founder 31/10 «modal con lo dudoso resaltado» |
| «Doubt is always a notice» | A doubt with a single best reading is a «Con duda» mark; only doubts without one notify | 5–10 % cap on escalations, founder 31/10 |
| No operation edits items from mobile | Mobile removes items and changes quantities | Task phase 1; release gate recorded 22/10 |
| No notice after the link is taken | «Pedido #N cambió» once per review cycle | Review gate Q4 |
| «References without a name»: «ese», «quítalo», «mejor que sean 3» apply silently when the order has exactly one item | The only item is a context target: at best «Con duda» (signal 2), except set wording on the item the photo just sent left | A sole item does not prove the buyer meant it; marking moves these cases into «Con duda», which the evaluation reads apart |
| «Expected double notice»: «quiero 2 de esos» right after a matched photo without variant gives «Falta la variante» plus the unnamed-add notice | Set wording right after the photo just sent sets the pending's quantity silently: one notice («Falta la variante»). Add wording («2 más de esos») grows the pending «Con duda» on its «Por resolver» point: still one notice | The growth is no longer silent: the point shows it with its reason and reopens the review, so the second notice only repeated the first |

### «Con duda» mark

| Aspect | Behavior |
| --- | --- |
| Name | «Con duda» / «Com dúvida»: a state, not an action, and never «Por confirmar», because the checkout already uses «Pendiente de confirmación» for the buyer and the change already counts in the total. |
| Reason text | Says what the message did in catalog terms: «Un mensaje cambió la talla de L a M», «Un mensaje agregó 2 por “dame dos”», «Un mensaje quitó la Gorra trucker». |
| Quote | The buyer's justifying words, up to 80 characters, with phones and addresses masked, shown as a quote of the buyer, read from the message trace while it exists (90 days); afterwards only the reason. |
| Clears when | The seller confirms a review that showed it, edits that item (web or mobile), or undoes the message. A later message changing the same item replaces the mark with its own decision. |
| Removed items | An item removed with a mark shows in the review as «Quitado por un mensaje»; it is restored only by **Deshacer mensaje**. |
| Cancelled order | Marks are not shown and stop counting: a cancelled order has nothing to charge. |

### Seller review

| Aspect | Behavior |
| --- | --- |
| What confirming records | That the seller reviewed exactly what the review showed: the changes by messages up to the moment it loaded, its marks and its «Por resolver» points. A later change by a message, a new mark or a new «Por resolver» point opens the review again on the next link action. |
| Corrections | Quantity and **Quitar** on marked items are saved together with the confirmation, as one edit with the web edit's rules and locks ([orders](../orders.md#editing-a-saved-order)): items can be corrected until the order is shipped, delivered or cancelled. **Deshacer mensaje** applies at once, with its own confirmation, only when there are no corrections on screen. |
| A message arrives while the review is open (the common case) | On **Confirmar revisión**: if the message touched an item the seller corrected, or added a mark or a «Por resolver» point, nothing is saved and the review reloads in place, keeping the corrections on untouched items, marking the affected ones «Cambió mientras revisabas» and showing «Llegó un mensaje mientras revisabas. Revisa lo marcado y confirma de nuevo.»; focus goes to that alert. If the message only applied sure changes to other items, the confirmation succeeds, the link action runs, and the seller is told what changed and the confirmed total: «Se agregó Gorra trucker · Rojo mientras revisabas. Total: S/ 120.00.» (announced politely, in the link card on mobile, in the status line on web). Those changes are not part of the review and open it again on the next link action. |
| Verdicts | Every change gets one final verdict: kept, quantity changed or removed (in a review, also a read-only one, or by an edit in the order detail, web or mobile), undone (by **Deshacer**), or not reviewed, fixed only when the order completes or is cancelled with the change never reviewed nor edited. A shipped or delivered order can still be reviewed, so its unreviewed changes get «not reviewed» only at completion. «Kept» on an item that had a «Con duda» mark is a strong label; «kept» on an unmarked item is a weak label, reported apart, because a one-tap confirmation does not prove the seller read it. Verdicts feed evaluation labels; they keep no buyer text. |
| Who | Any seller of the company, on web or mobile. |

### Orders that are no longer open for messages

An order stops being open for messages with a confirmed or reported payment, a buyer-confirmed checkout, a shipment, stock deducted, completion or cancellation. Its marks and unreviewed changes still need an exit:

| Order | Link card | Review | Lists |
| --- | --- | --- | --- |
| Paid, reported, buyer-confirmed or stock deducted, delivery pending | Today's card: URL visible, actions run directly (the seller may re-send the link to a buyer who paid) | From **Revisar pedido** in the detail. **Confirmar revisión** records the review and saves corrections under the edit's rules (allowed: these orders are editable on web) | «Por revisar» while it has «Con duda» marks |
| Shipped or delivered | Today's card | From **Revisar pedido**, read-only: no quantity, **Quitar** or **Deshacer mensaje**, the lock text «El pedido ya se envió; los productos ya no se pueden cambiar.» (or «ya se entregó»); **Confirmar revisión** records the review, which clears the marks | «Por revisar» while it has «Con duda» marks |
| Completed | Today's card | Not offered; marks hidden; unreviewed changes get «not reviewed» | Never «Por revisar» |
| Cancelled | «Pedido cancelado», as today | Not offered; marks hidden | Never «Por revisar» |

**What counts as «to review» once the order is not open for messages:** only «Con duda» marks. Sure changes never reviewed do not keep a paid or shipped order «Por revisar» (the seller handled it without the link), and pendings end with the order. On orders open for messages, «to review» also counts sure changes after the last review and new «Por resolver» points.

**Deshacer** stays limited to orders open for messages: it reverts the reader's changes, while the seller can still edit by hand within the edit's locks. A review on such an order never takes the link by itself.

### After the link was taken

| Aspect | Behavior |
| --- | --- |
| Link taken | A recorded **Copiar enlace**, **Compartir enlace** or **Abrir enlace** of the checkout link on web or mobile, by any seller of the company, directly or after confirming a review. Copy and open are recorded on the tap that performs them; share is not recorded when the system reports the share sheet was dismissed (where it does not report it, the tap counts). A review confirmed from the detail does not take the link. Copying the visible URL text by hand is not recorded; on WhatsApp orders open for messages with something to review the URL is hidden, so the first link always goes through a recorded action. Accepted: a seller who only wanted to review an open order takes the link to confirm, and that arms «Pedido #N cambió» even if the buyer never got the link. |
| Notice | The first message that changes the order (any applied change, a mark or a new «Por resolver» point) after the link was taken and before the next review sends one non-urgent push: title «Pedido #1023 cambió» / «Pedido #1023 mudou», body «Un cliente cambió el pedido #1023 después de recibir el enlace. Revísalo antes de cobrar.» / «Um cliente mudou o pedido #1023 depois de receber o link. Revise antes de cobrar.», opening the order. Later messages of the same cycle send nothing new for this reason. |
| Title | Distinct from «Revisa el pedido #N» (`only_item_kept`, which opens the order to decide whether to cancel): the title says what happened. |
| Only while open | Messages change only orders open for messages, so the notice exists only then; a buyer already confirming is protected by the checkout's `TOTAL_CHANGED`. |
| Precedence | An urgent problem in the same message wins: its notice is sent and its body ends with «El pedido cambió después de enviar el enlace.» / «O pedido mudou depois de enviar o link.» «Pedido #N cambió» wins over «Pedido #N listo», «Revisa el pedido #N» and «Pedido nuevo #N». |
| Next link action | Opens the review with the changes since the last review. |
| Measure | Counted in the evaluation report apart from the urgent share. |

### Undo what one message did

There is one undo: per message, all or nothing, from the **Cambios por mensajes** row or from **Deshacer mensaje** in the review.

| Aspect | Behavior |
| --- | --- |
| Effect | Returns the order and the chat's pendings to what they were right before that message for everything it touched: removes what it added, puts back what it removed with the same line (copied name, variant, unit price and mentioned price), restores quantities and variants, and restores the pendings it created, replaced or completed to their earlier state. The order is not cancelled. |
| Price | A restored line keeps its copied unit price, even if the catalog price changed. This is not an edit: it reverts a change the seller did not make. Manual edits keep the web rule (a variant added in a later save takes the current price). |
| Restored pendings | A pending comes back with its earlier values and its earlier last-change time, so its life is unchanged: one without an order whose 7 days have passed does not come back. It counts toward the limit of 10 per chat; if the chat is full, the least recently changed other pending ends silently, as today. A created pending ends. |
| When | While the order is open for messages. |
| Refused | When an item the message touched was changed later (by another message or the seller); when it would leave the order without items; when it would put back a product or variant that is no longer sold; when the order moved on. The row shows the reason instead of **Deshacer**, so the seller never confirms and then gets refused. If the state changed between showing and confirming, the same reason shows after confirming and nothing changes. |
| Unsaved edits | Disabled while the web order view has unsaved changes, the mobile edit mode is open, or the review has corrections on screen. |
| Confirmation | «¿Deshacer lo que hizo este mensaje?» listing the changes («Quitar Gorra trucker · Negro · ×2», «Volver Polera gris a talla L»), the pendings that come back («Volverá: Falta la variante · Polo básico») and the one that ends to make room («Terminará: Falta la variante · Polera»), with **Deshacer cambios** / **Conservar**. |
| Messages afterwards | A later message reads the order as it is after the undo. The undone message is never applied again. |
| Verdict | An undo records «undone» on each change of that message. |

### Editing items on mobile

| Aspect | Behavior |
| --- | --- |
| What | Remove items and change quantities (1 to 9999) of a saved order, any source. Same rules, revisions, locks, conflicts and texts as the web edit. |
| Stock | As on web: editing never deducts or restores stock by itself; a deducted order settles only the difference. |
| Chat orders | A seller edit wins over earlier messages; later messages read the order as edited. A message that changes the items while the seller edits makes the save answer «Este pedido cambió mientras lo editabas…», with the edits kept. |

### Notices

| Aspect | Behavior |
| --- | --- |
| Channel | Today's push notice to the phone that registered the message ([notifications](../notifications.md)), with the suggested question at the end of its body. The full question lives in the chat view, the order detail and the review, because the system truncates long bodies. |
| Urgent | The outcomes marked urgent in [Every current outcome](#every-current-outcome-under-the-new-decisions). |
| Several problems in one message | One notice, as today: «Revisa el chat» naming up to three identified products and counting the rest. It carries the suggested question of the first problem in the message's order; the chat box, the detail and the review show one question per point, up to 3. |
| Payment request | Title «Revisa el chat» / «Veja o chat». Bodies: open order «Un cliente quiere pagar el pedido #1023.» / «Um cliente quer pagar o pedido #1023.»; no order (none, or the latest cancelled) «Un cliente quiere pagar.» / «Um cliente quer pagar.»; latest order not open for messages and not cancelled «Un cliente quiere pagar, pero el pedido #1023 ya tiene un pago o está cerrado. Revisa el chat.» / «Um cliente quer pagar, mas o pedido #1023 já tem um pagamento ou está fechado. Veja o chat.»; with pendings left, with or without «listo», «Un cliente quiere pagar el pedido #1023, pero falta completar Polo básico.» / «Um cliente quer pagar o pedido #1023, mas falta completar Polo básico.» (up to three names, then «y N más» / «e mais N»). A payment request is a problem: it wins over «Pedido #N listo», and a «listo» in that message is still remembered. With another problem, the several-problems notice applies. A new order created by the same message is named, followed by «Se creó el pedido nuevo #N.» |
| Precedence | Problems, all urgent, including «listo» with pendings and the payment request → «Pedido #N cambió» → «Revisa el pedido #N» → «Pedido #N listo» → «Pedido nuevo #N». |
| Cap | Urgent notices stay at or under 10 % of the messages read in the seed bank and holdout (target 5–10 %), measured with precision and recall: of the urgent notices, how many were expected urgent; of the expected urgent cases, how many notified. Above 10 %, or with recall under 100 %, the phase is not done. «Pedido #N cambió», «listo», «Pedido nuevo» and «Revisa el pedido» are counted apart. |
| Suggested question | One question in the store's voice, in the buyer's language (Portuguese when they write in Portuguese, else Spanish), naming catalog products and values only. It never claims stock: «¿En qué talla lo quieres: S, M o L?», not «Tenemos S, M y L». With more than 3 values for an attribute it names none: «¿En qué talla lo quieres?». |
| One per message | At most one notice per message, as today. A notice never contains the buyer's text, phone or WhatsApp ID. |
| Notices off | The mark, the «Por resolver» point and the question in the chat, detail and review still show the doubt. |

### Traces

| Aspect | Behavior |
| --- | --- |
| What | For each message and stage: input, output, model, prompt version, tokens, duration, certainty and decision; during shadow, the old reader's result. 100 % of messages read have one. |
| Text | Message texts and context with phone numbers and addresses masked («+51 9•• ••• •12», «[dirección]»). |
| Retention | 90 days from the message, then deleted automatically. Nothing derived from a trace keeps buyer text after that: verdicts and evaluation labels keep only kinds, catalog names and values (review gate Q3). |
| Isolation | Per company; no business can see another's. |
| Who reads them | Only named Yoyos team members, to debug and evaluate. Access never goes through the company-scoped seller roles or any seller session, and every read is recorded (who, when, which company and messages). The access path itself is to be resolved in implementation. No seller screen shows traces; the review shows only the quote. Logs keep not carrying texts. |
| Scope | Traces bound only the copies made for reading. The message's own text is already stored with the chat message, as today, with no expiry; that is not changed here. |

### Evaluation

| Aspect | Behavior |
| --- | --- |
| Seed bank | From the PR #313 comment «Ejemplos que fallaron en las pruebas»: 11 failures of the frozen test, 17 of dev, 17 of holdout v4 (by id; their texts stay private) and the 4 families: confirmations and payment questions read as no intent, quantities after a photo, mentioned prices not noted, «la quiero en M» changing the variant silently. The founder's WhatsApp steps are added if provided. |
| Other sources | People playing buyers with loose scripts in their own style; seller verdicts as labels (without text after 90 days). |
| Runs | Every evaluation runs 3 times and reports mean and range per metric. A change counts as better only if its range does not overlap the previous one. |
| Metrics per stage | Intent correct; each extracted field correct; right product among the candidates; decision correct; silent wrong changes; ignored requests; urgent share with precision and recall; «Pedido #N cambió» count; cost per message (mean); time (p95, without queue wait). |
| Silent wrong change | A change applied without a «Con duda» mark or notice that differs from the expected order. |
| Ignored request | A request with no change, no mark, no «Por resolver» point and no notice. |
| Frozen holdout | Built by a Codex agent with the sol 6.1 model, the only exception to the models rule; that agent never touches prompts. Run only to close a phase. Its texts are never published, in the repository, pull requests, Todoist or reports: only ids and failure types. |
| Current synthetic cases | Dev, frozen test and holdouts v3 and v4 stay as regression, not as the goal. |
| Prompt examples | Never copy evaluation inputs (rule unchanged). |
| Cancel-and-recreate | Measured after switch-on as cancelled WhatsApp orders followed by a new order in the same chat within 24 hours. |

### Shadow and switch-on

| Aspect | Behavior |
| --- | --- |
| Shadow | During phase 5 the old reader reads the same messages, its result is kept in the trace for comparison, and it never changes an order or sends a notice. |
| Passing the founder's test | In the founder's real WhatsApp test: 0 silent wrong changes, 0 «confirmo» or payment requests ignored, urgent notices ≤ 10 % of the messages. |
| End | The old reader and its shadow are removed once that test passes. |

## States

| State of a change | Meaning | What triggers it | What the seller can do | What the seller sees |
| --- | --- | --- | --- | --- |
| Applied | Yoyos is sure | Decision | Undo the message, edit the item | The item; «Cambió desde tu última revisión» if after a review |
| Con duda | Applied with doubt | Decision | Confirm a review, edit, undo | «Con duda» with reason and quote |
| Revisado | Shown in a confirmed review, or edited by the seller | **Confirmar revisión**, an edit | Edit within the locks; undo while open | The item, no mark |
| Deshecho | The seller undid the message | **Deshacer cambios** | Nothing (never applied again) | The row marked «Deshecho» |
| Sin revisar | The order completed or was cancelled before the change was reviewed or edited | Completion or cancellation | Nothing | Nothing (marks hidden) |

Transitions: Applied → Revisado, Deshecho, Sin revisar; Con duda → Revisado (also by a read-only review of a shipped or delivered order), Deshecho, Sin revisar, or replaced by a later message's decision; Revisado → Deshecho (while open). Deshecho and Sin revisar are final.

«Por resolver» points follow the pending lifecycle of [message-to-order](../message-to-order.md#pendings); a review only acknowledges them (they stop opening the review) and they keep showing in the detail and the review until the pending ends.

Orders and messages from before this feature have no changes by messages recorded: they show no marks, no «Cambios por mensajes» block and never open the review (no customers yet, so nothing is converted).

## When something fails

| Situation | What the seller sees | What they can do |
| --- | --- | --- |
| Review confirmed and saved | Mobile: the link action runs («Enlace copiado», the share sheet, or the browser). Web: the URL shows and focus goes to the icon that opened the review, which copies or opens on the next click. From the detail: the review closes | — |
| Review: a message arrived meanwhile | See [Seller review](#seller-review) | Review the marked items and confirm again, or nothing |
| Review: another seller saved an edit meanwhile | «Este pedido cambió mientras lo revisabas. Revísalo de nuevo.», the review reloaded, corrections kept on untouched items | Confirm again |
| Review: shipped, delivered or cancelled meanwhile | The edit's lock text next to the corrections; nothing saved | **Confirmar revisión** without corrections (shipped or delivered) or **Cerrar** |
| Review: not sent | «No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo.»; corrections intact; link not taken | **Confirmar revisión** again |
| Review: in doubt | «No sabemos si se guardó. Verificando…»; the link is not taken until verified; then saved (link action runs) or not (corrections intact); repeating saves the same final state | Wait |
| **Deshacer** success | «Cambios deshechos.» announced politely, the order updated | — |
| **Deshacer** refused | The row's reason ([Undo](#undo-what-one-message-did)); nothing changed | Edit the products |
| **Deshacer** not sent | «No se pudo deshacer. Revisa tu conexión e inténtalo de nuevo.» | Retry |
| **Deshacer** in doubt | «No sabemos si se deshizo. Verificando…»; repeating never undoes twice | Wait |
| Mobile edit: success, conflict, locked, not sent, in doubt | The web edit's texts and behavior ([order view](../order-view.md)) | As on web |
| Copying the question fails | Nothing; the question stays selectable | Select and copy by hand |
| A stage fails temporarily (provider down) | Nothing; the message is retried as today and later messages of the chat wait | — |
| A message cannot be read after its retries | Urgent «No pudimos revisar un mensaje» | Read the chat |
| The notice cannot be delivered | Nothing; marks, points and questions still show | — |
| Trace cannot be saved | The message still applies; the missing trace is counted, never blocks the order | — |

## Accessibility

| Element | Behavior |
| --- | --- |
| Review opening and closing | Focus goes to the title on open and returns to the control that opened it on close. On web the dialog traps focus and closes with Escape (with the discard confirmation when there are corrections). |
| Reading order | Title, **Cambios con duda**, **Por resolver**, **Productos**, total, actions. Each section title is a heading. |
| Distinct names | The mark is a state («Con duda»), the sections name their content («Cambios con duda», «Por resolver»), the list label is «Por revisar» and the only action is **Revisar pedido**, so no two read alike next to each other. The mark is not focusable and is read as part of its item («Polera gris M, con duda: un mensaje cambió la talla de L a M»). |
| Marks | «Con duda», «Por resolver», «Cambió desde tu última revisión», «Cambió mientras revisabas», «Quitado…» and «Deshecho» are text with an icon, never color alone; amber with contrast ≥ 4.5:1 in light and dark. |
| Quote | Read as a quote of the buyer: «El cliente escribió: la quiero en M». |
| Accessible names | Each **Deshacer** includes its row («Deshacer mensaje de las 15:42: agregó Polo básico M ×2»); each **Quitar** and quantity control names the product and variant («Quitar Polera gris M», «Cantidad de Polera gris M»); each **Copiar pregunta** names the product it asks about. |
| Disabled with reason | Controls blocked by a rule stay focusable as disabled (`aria-disabled` on web, disabled state on mobile) with the reason as their description. |
| Announcements | «Pregunta copiada», «Cambios deshechos.», «Actualizando pedido…», «Verificando…», «Mientras revisabas, un mensaje …» and the review's conflict alert are announced politely; known rejections as alerts. |
| Touch targets | At least 44 pt for rows, quantity controls and buttons on mobile. |

## Texts (es / pt-BR)

| Use | es | pt-BR |
| --- | --- | --- |
| Review title / subtitle | «Revisa el pedido #1023» / «Antes de enviar el enlace» | «Revise o pedido #1023» / «Antes de enviar o link» |
| Sections | «Cambios con duda» / «Por resolver» / «Productos» | «Mudanças com dúvida» / «A resolver» / «Produtos» |
| Mark | «Con duda» | «Com dúvida» |
| Reason (variant) | «Un mensaje cambió la talla de L a M» | «Uma mensagem mudou o tamanho de L para M» |
| Reason (pending quantity) | «Con duda: un mensaje cambió la cantidad a 3» | «Com dúvida: uma mensagem mudou a quantidade para 3» |
| Reason (caption) | «No pudimos leer lo que escribió con la foto» | «Não conseguimos ler o que escreveu com a foto» |
| Removed item | «Quitado por un mensaje» / «Quitado desde tu última revisión» | «Removido por uma mensagem» / «Removido desde a sua última revisão» |
| Changed | «Cambió desde tu última revisión» / «Cambió mientras revisabas» | «Mudou desde a sua última revisão» / «Mudou enquanto você revisava» |
| Main action / close | **Confirmar revisión** / **Cerrar** | **Confirmar revisão** / **Fechar** |
| Discard corrections | **Descartar correcciones** / «Confirma o descarta tus correcciones antes de deshacer un mensaje.» | **Descartar correções** / «Confirme ou descarte suas correções antes de desfazer uma mensagem.» |
| Leaving | «¿Descartar los cambios?» / **Descartar cambios** / **Seguir revisando** / **Seguir editando** | «Descartar as alterações?» / **Descartar alterações** / **Continuar revisando** / **Continuar editando** |
| Message during review | «Llegó un mensaje mientras revisabas. Revisa lo marcado y confirma de nuevo.» | «Chegou uma mensagem enquanto você revisava. Revise o que está marcado e confirme de novo.» |
| Sure change during review | «Mientras revisabas, un mensaje agregó Gorra trucker · Rojo · ×1. Total: S/ 120.00.» (the summary follows the «Cambios por mensajes» row: «quitó…», «cambió … a ×3», «cambió … a talla L») | «Enquanto você revisava, uma mensagem adicionou Gorra trucker · Rojo · ×1. Total: S/ 120.00.» |
| Another seller edited | «Este pedido cambió mientras lo revisabas. Revísalo de nuevo.» | «Este pedido mudou enquanto você revisava. Revise de novo.» |
| All reviewed | «Ya revisaste todos los cambios con duda.» | «Você já revisou todas as mudanças com dúvida.» |
| Detail / card | «1 cambio con duda» / «2 cambios con duda» / «1 punto por resolver» / «2 puntos por resolver» / **Revisar pedido** / «Revisa el pedido antes de enviar el enlace.» | «1 mudança com dúvida» / «2 mudanças com dúvida» / «1 ponto a resolver» / «2 pontos a resolver» / **Revisar pedido** / «Revise o pedido antes de enviar o link.» |
| Link actions (existing) | **Copiar enlace** / **Compartir enlace** / **Abrir enlace** / «Enlace copiado» | **Copiar link** / **Compartilhar link** / **Abrir link** / «Link copiado» |
| Undo confirmation | «Volverá: …» / «Terminará: …» | «Voltará: …» / «Terminará: …» |
| Row time | «15:42» today, «30/10 15:42» another day | same |
| List label | «Por revisar» | «Para revisar» |
| Loading / error | «Actualizando pedido…» / «No pudimos cargar el pedido. Revisa tu conexión.» / **Reintentar** | «Atualizando pedido…» / «Não foi possível carregar o pedido. Verifique sua conexão.» / **Tentar de novo** |
| Quantity | «Ingresa una cantidad de 1 a 9999.» | «Informe uma quantidade de 1 a 9999.» |
| Save failures | «No se pudieron guardar los cambios. Revisa tu conexión e inténtalo de nuevo.» / «No sabemos si se guardó. Verificando…» | «Não foi possível salvar as alterações. Verifique sua conexão e tente de novo.» / «Não sabemos se foi salvo. Verificando…» |
| Unsaved edits | «Guarda o descarta los cambios del pedido antes de revisarlo.» / «Guarda o descarta los cambios primero.» | «Salve ou descarte as alterações do pedido antes de revisá-lo.» / «Salve ou descarte as alterações primeiro.» |
| Por resolver (mobile / web) | «Falta la variante: Polo básico ×2 — falta la talla. Pregúntale al cliente o agrégalo desde la web.» / «… Pregúntale al cliente o agrégalo en Productos, después de cerrar esta revisión.» | «Falta a variante: Polo básico ×2 — falta o tamanho. Pergunte ao cliente ou adicione pela web.» / «… Pergunte ao cliente ou adicione em Produtos, depois de fechar esta revisão.» |
| Question box | «Pregúntale al cliente:» / **Copiar pregunta** / «Pregunta copiada» | «Pergunte ao cliente:» / **Copiar pergunta** / «Pergunta copiada» |
| Cambios por mensajes | «Cambios por mensajes» / «15:42 · Agregó Polo básico · M · ×2 · Quitó Gorra trucker» / **Ver más** | «Mudanças por mensagens» / «15:42 · Adicionou Polo básico · M · ×2 · Removeu Gorra trucker» / **Ver mais** |
| Undo | **Deshacer** / **Deshacer mensaje** / «¿Deshacer lo que hizo este mensaje?» / **Deshacer cambios** / **Conservar** / «Cambios deshechos.» / «Deshecho» | **Desfazer** / **Desfazer mensagem** / «Desfazer o que esta mensagem fez?» / **Desfazer mudanças** / **Manter** / «Mudanças desfeitas.» / «Desfeito» |
| Undo failures | «No se pudo deshacer. Revisa tu conexión e inténtalo de nuevo.» / «No sabemos si se deshizo. Verificando…» | «Não foi possível desfazer. Verifique sua conexão e tente de novo.» / «Não sabemos se foi desfeito. Verificando…» |
| Undo refused | «Un cambio posterior tocó este producto.» / «Dejaría el pedido sin productos.» / «La Gorra trucker · Negro ya no se vende.» / «El pedido ya avanzó.» | «Uma mudança posterior alterou este produto.» / «Deixaria o pedido sem produtos.» / «A Gorra trucker · Negro não está mais à venda.» / «O pedido já avançou.» |
| Edit mode | **Editar productos** / «Cambios sin guardar» / «El pedido necesita al menos un producto. Si ya no va, cancélalo.» | **Editar produtos** / «Alterações não salvas» / «O pedido precisa de pelo menos um produto. Se não vai mais, cancele-o.» |
| Changed after link | «Pedido #1023 cambió» / «Un cliente cambió el pedido #1023 después de recibir el enlace. Revísalo antes de cobrar.» / «El pedido cambió después de enviar el enlace.» | «Pedido #1023 mudou» / «Um cliente mudou o pedido #1023 depois de receber o link. Revise antes de cobrar.» / «O pedido mudou depois de enviar o link.» |
| Payment request | See [Notices](#notices) | See [Notices](#notices) |

Lock texts of the web edit and the existing notices keep their current es and pt-BR versions. Catalog names and values are never translated. Suggested questions are generated in the buyer's language from the patterns of the Spanish examples («Em qual tamanho você quer o Polo básico: S, M ou L?»).

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller of the company | Their orders, marks, quotes, «Cambios por mensajes», «Por resolver» points, suggested questions | Review, correct, undo, edit items on web and mobile | See traces; see other companies' data |
| Buyer | The checkout as today | Confirm and pay as today | See marks, quotes, points or the review; be written to by Yoyos |
| Named Yoyos team members | Traces with masked texts, evaluation reports | Debug, evaluate; each trace read recorded | Publish holdout texts; keep trace texts beyond 90 days; reach traces through seller roles |

Masking phones and addresses closes the risk of a trace leaking a buyer's contact data; 90-day deletion bounds how long those reading copies exist; named, recorded access closes the risk of buyer texts of every company being read through a seller path.

## Information that is kept

- **With the order, for its life:** what each message changed (items, quantities, variants, mentioned prices, the line as it was before) in catalog terms, the decision of each change, the «Con duda» reason, the suggested questions, each change's verdict, what each review showed and when, and each recorded link action. No buyer text.
- **In traces, 90 days:** the message texts and context with phones and addresses masked, and each stage's data. The quote in the review is read from here and disappears with it.
- **Chat state:** pendings, «listo» and the photo memory, as today.
- **Evaluation:** the seed bank and synthetic cases in the repository; holdout texts and private cases outside it; seller verdicts without text.
- **Not kept:** the review's unsaved corrections (closing discards them), the shadow reader's result beyond its trace, a hand copy of the visible URL.

## Vocabulary

- **Reader:** the staged reading of a message (context, intent, extraction, resolution, checks, certainty, decision). Not visible to the seller.
- **Con duda:** a change Yoyos applied with doubt; it already counts in the total. Interface: «Con duda» / «Com dúvida».
- **Por resolver:** something the buyer asked that could not be added without their answer (a pending). Interface: «Por resolver», each point titled with its notice («Falta la variante», «Producto no claro», «Variante no disponible»).
- **Por revisar:** an order with something the seller has not reviewed. Interface: list label, and the card's count of «Con duda» changes and «Por resolver» points.
- **Review:** the order check shown when taking the checkout link or from the detail. Interface: «Revisa el pedido #N».
- **Link taken:** a recorded **Copiar enlace**, **Compartir enlace** or **Abrir enlace** of the checkout link.
- **Urgent notice:** a push notice for a message where the buyer waits for the seller; carries the suggested question when one applies.
- **Suggested question:** text for the seller to copy and send to the buyer. Interface: **Copiar pregunta**.
- **Deshacer:** returning the order and the pendings to what they were before one message. Interface: **Deshacer**.
- **Trace:** what each stage received and decided for one message. Internal.
- **Silent wrong change:** a wrong change applied without mark or notice. The measure the policy must keep at 0.

## Closed decisions

| Decision | Why |
| --- | --- |
| No approving change by change and no moving between apps; Yoyos builds and corrects the order alone while it is pending | Founder, 31/10: the seller lives in the chat |
| The seller confirms or corrects in a review with the order's products when taking the link, doubtful points highlighted | Founder, 31/10: one place, at the moment that matters |
| Urgent escalations stay at 5–10 % of messages | Founder, 31/10 |
| Questions to the buyer are copied by the seller; Yoyos never writes to the buyer | Founder, 31/10 |
| Traces keep message texts 90 days, phones and addresses masked, then deleted | Founder, 31/10 |
| Cost is an average per message (target ≤ US$0.0015) with a cap on escalations, no fixed maximum per message | Founder, 31/10 |
| No strong model now; each stage's model and prompt are chosen by configuration so one can be added later without touching other stages or the policy | Founder, 31/10 |
| The frozen holdout is built by a Codex agent with sol 6.1 that never touches prompts; its texts are never published | Founder, 31/10: the repository is public |
| Seed bank from the PR #313 comment and its 4 families | Founder, 31/10 |
| One integration branch, one pull request per plan task against it, one final pull request to `main` | Founder, 31/10, in the implementation session (replaces «un PR por fase») |
| A variant-only text never changes an item the last photo is not about | Founder, 22/10, kept as the photo guard |
| Urgent notices use today's push, with the question persisting in the chat view | Review gate Q1 |
| Pendings show as «Por resolver»; a review acknowledges them; only new points reopen it | Review gate Q2 (replaces «no screen shows pendings», 28/10) |
| No buyer text beyond 90 days, also for evaluation | Review gate Q3 |
| One «Pedido #N cambió» per review cycle after the link was taken | Review gate Q4 |
| Doubtful changes with a single best reading are applied and marked, not held | «The AI applies from day one and the seller confirms in the review» |
| Understanding is the model's, checking is code's; no word lists in code | Founder rule, unchanged |

## Acceptance criteria

1. Order #1023 has «Polera gris · L · ×1», no photo in the last 48 hours. The buyer writes «la quiero en M». The order shows «Polera gris · M · ×1» with «Con duda: Un mensaje cambió la talla de L a M», also when two readings agree; no notice. **Copiar enlace** opens the review with that item under **Cambios con duda** and the quote «“la quiero en M”».
2. Order with «Polera gris · L». The buyer sends a photo of the «Polo básico» that is not added (it lacks size, becomes a pending), then «en talla M»: the pending completes with M; the polera does not change. With a photo that matched nothing, «en talla M» changes nothing and sends an urgent notice with «¿Para qué producto es la talla M?».
3. Order with one polo; the seller wrote «¿te lo separo así?» and the buyer «confirmo así nomás ta bien». The order is «listo» and the seller gets «Pedido #N listo», in 3 of 3 runs.
4. The buyer writes «¿cómo te pago?» with the open order #1023. The order does not change; the seller gets «Revisa el chat» with «Un cliente quiere pagar el pedido #1023.» (pt-BR phone: «Veja o chat», «Um cliente quer pagar o pedido #1023.»), in 3 of 3 runs. With no order: «Un cliente quiere pagar.». With «Polo básico» pending: «Un cliente quiere pagar el pedido #1023, pero falta completar Polo básico.».
5. Photo of the «Gorra trucker» (color missing), then «pásame 3 de esas», then «en rojo». The order ends with «Gorra trucker · Rojo · ×3», no mark, one «Falta la variante» only (the photo just sent, set wording). With «2 más de esas» instead, the pending becomes ×3 with «Con duda» on its «Por resolver» point (the card counts «1 punto por resolver»), still one notice; then «en rojo» ends with «Gorra trucker · Rojo · ×3» marked «Con duda: un mensaje cambió la cantidad a 3» under **Cambios con duda** (the card now counts «1 cambio con duda»). If a review confirmed before «en rojo» showed the doubtful point, the item carries no mark and shows «Cambió desde tu última revisión». If the buyer writes «en rojo, las 3», no mark. With a buyer text between the photo and «pásame 3 de esas», the quantity is «Con duda».
5b. Pending «Polo básico ×2» with «Con duda» on its quantity; the buyer writes «uno negro M y otro blanco L»: both items carry «Con duda». With «uno negro M» only, that item carries the mark and the remaining unit's point keeps it.
5a. A photo added «Gorra trucker · Rojo · ×1»; the seller replies «👍»; the buyer writes «que sean 3»: the gorra is ×3, no mark, when both readings agree. If a message in between had changed the gorra to ×2, «que sean 3» gives ×3 «Con duda».
6. «quiero el polo de 55 en L blanco»: the polo premium is added with «mencionó S/ 55».
7. «quiero el polo básico» with sizes S, M, L: nothing is added; the urgent push ends with «¿En qué talla quieres el Polo básico: S, M o L?»; the chat view shows the box with **Copiar pregunta** also when the chat is opened later from the WhatsApp tab; the order detail and the review show «Falta la variante: Polo básico ×1 — falta la talla…».
8. A buyer writing in Portuguese «quero o polo básico»: the question is «Em qual tamanho você quer o Polo básico: S, M ou L?».
9. «quiero el polo básico y la casaca jean» (polo without size, casaca no longer sold): one «Revisa el chat» naming both, carrying the polo's question (the first problem); the chat view shows two boxes under the message, the polo's question and «Ya no tenemos la Casaca jean. ¿Te muestro otra opción?».
10. Order open for messages with a «Por resolver» point only. The card shows «Revisa el pedido antes de enviar el enlace.» and «1 punto por resolver»; the first **Copiar enlace** opens the review; **Confirmar revisión** copies the link. A second **Copiar enlace** with no new message copies directly; the point still shows in the detail.
11. The first **Copiar enlace** of a WhatsApp order with only sure changes opens the review with **Productos** and the total only; one tap on **Confirmar revisión** copies the link.
12. A message added «Gorra trucker · Negro · ×2» by mistake. In the mobile order detail, **Deshacer** on that row, then **Deshacer cambios**: the gorra is gone, the rest of the order and its number stay, the row shows «Deshecho».
13. A message removed «Polo básico · M · ×2 · S/ 35.00»; the catalog price is now S/ 39.00. **Deshacer** restores it at S/ 35.00.
14. A message removed «Gorra trucker · Negro», which was deactivated afterwards. The row shows «La Gorra trucker · Negro ya no se vende.» and no **Deshacer**.
15. A message added the gorra; a later message set it to ×3. The first row shows «Un cambio posterior tocó este producto.» and no **Deshacer**.
16. The only item came from one message: the row shows «Dejaría el pedido sin productos.».
17. A message completed the pending «Polo básico» in the wrong size; **Deshacer** removes the item and the «Falta la variante» point comes back. With 10 other pendings in the chat, the least recently changed one ends silently.
18. In the review, the seller lowers a marked item; **Deshacer mensaje** is disabled with «Confirma o descarta tus correcciones antes de deshacer un mensaje.»; **Descartar correcciones** enables it again.
19. Order #1023 has a confirmed payment and a «Con duda» item. The link card shows the URL and copies directly; the list shows «Por revisar»; **Revisar pedido** opens the review with quantity and **Quitar** available; **Confirmar revisión** saves and clears the mark.
20. The same order shipped: **Revisar pedido** opens a read-only review with «El pedido ya se envió; los productos ya no se pueden cambiar.»; **Confirmar revisión** clears the mark. Once completed, the list never shows «Por revisar».
21. A cancelled WhatsApp order with marks shows no marks, no review and no «Por revisar».
22. On mobile, the seller lowers «Polo básico» from ×3 to ×2 and removes the gorra, **Guardar cambios**: totals update; if a message changed the items meanwhile, «Este pedido cambió mientras lo editabas…» and the edits stay.
23. On mobile, a shipped order offers no **Editar productos**; on the last item **Quitar** is disabled with «El pedido necesita al menos un producto…».
24. With **Editar productos** open on mobile, or unsaved product edits on web, **Deshacer**, **Revisar pedido** and the link actions are disabled with their reason.
25. In the review, the seller removes a «Con duda» item and taps **Confirmar revisión**: the item is removed, the link is copied, the change's verdict is «removed». **Copiar enlace** again with no new message copies directly.
26. The seller lowers a marked item in the review; meanwhile a message changes that item. **Confirmar revisión** saves nothing and shows «Llegó un mensaje mientras revisabas…» with the item «Cambió mientras revisabas»; a correction on another item is kept.
27. While the review is open a message adds a gorra with certainty. **Confirmar revisión** succeeds, copies the link and the card keeps «Mientras revisabas, un mensaje agregó Gorra trucker · Rojo · ×1. Total: S/ 120.00.»; the next **Copiar enlace** opens the review with the gorra «Cambió desde tu última revisión». A sure quantity change shows «…un mensaje cambió Polo básico a ×3…».
28. A sure removal by a message after the last review appears in the next review as «Quitado desde tu última revisión: Gorra trucker · Negro · ×2».
29. While a WhatsApp order open for messages has something to review, the URL text does not show; the card shows «Revisa el pedido antes de enviar el enlace.» with «1 cambio con duda» (no count when only sure changes), and **Copiar enlace**, **Compartir enlace** and **Abrir enlace** each open the review first; the detail shows no second **Revisar pedido**.
29a. On web, a review opened by the copy icon closes after **Confirmar revisión**, shows the URL and focuses the copy icon; nothing is copied and no «Enlace copiado» shows until the next click copies.
29b. A paid order whose only unreviewed changes are sure ones shows no «Por revisar» and no count; one with a «Con duda» mark shows «Por revisar» until reviewed. A completed order shows no marks and no **Revisar pedido**.
29c. **Compartir enlace** after a review, with the share sheet dismissed (where the system reports it): the link is not recorded as taken, and a later change sends no «Pedido #N cambió».
30. On web, a review opened by the open icon closes after **Confirmar revisión**, shows the URL and moves focus to the open icon; no tab is opened by itself.
31. The seller copied the link of #1023. The buyer writes «y una gorra trucker roja»: the gorra is added and the seller gets «Pedido #1023 cambió» / «Un cliente cambió el pedido #1023 después de recibir el enlace. Revísalo antes de cobrar.». A second message before the next review sends nothing for this reason. A message with «quiero el polo básico» (no size) instead sends the urgent notice ending with «El pedido cambió después de enviar el enlace.». After a confirmed review that took the link, the cycle starts again.
32. Before any recorded **Copiar enlace**, **Compartir enlace** or **Abrir enlace**, a message that changes the order sends no «Pedido #N cambió».
33. The review is confirmed without connection: «No se pudieron guardar los cambios…», corrections intact, link not copied.
34. An order created on web never shows the review, marks or **Cambios por mensajes**.
35. With a screen reader, opening the review reads «Revisa el pedido #1023» first; each **Deshacer** is announced with its row; the mark is read as part of its item («…con duda: …»).
36. A trace of a message 91 days old no longer exists; the order still shows its «Cambios por mensajes» row and its «Con duda» reason without quote; no verdict holds buyer text.
37. A trace never contains a full buyer phone or address; a trace read by a Yoyos team member is recorded with who, when and which company.
38. An order shipped with a «Con duda» item: a read-only review records «kept» and clears the mark; without it, the verdict «not reviewed» is fixed when the order completes and never changes. A mark cleared by an edit in the mobile detail records the edit's verdict. «Kept» on unmarked items is reported as a weak label.
38a. A «listo» with a pending after the link was taken sends the urgent «listo» with pendings notice ending with «El pedido cambió después de enviar el enlace.», not «Pedido #N cambió».
39. Over the frozen holdout, 3 of 3 runs: 0 silent wrong changes; urgent notices ≤ 10 % of messages with 100 % recall on expected urgent cases; average cost ≤ US$0.0015 (shadow excluded); p95 ≤ 6 s without queue wait; each metric reported with mean and range, and «Pedido #N cambió» counted apart.
40. Replacing one stage's model with a fake one by configuration changes no other stage and no decision rule.
41. During shadow, the old reader's result appears in the trace and never changes an order or sends a notice.
42. No holdout text appears in the repository, a pull request, Todoist or a report.

## Questions decided by the review gate

| Question | Answer | Who decided | Reason | Discarded |
| --- | --- | --- | --- | --- |
| Q1. Channel of the urgent notice with the suggested question | Today's push notice with the question in its body; the question persists in the chat view, the order detail and the review | Both reviewers (UX/UI and product) | Yoyos cannot send WhatsApp (receive-only library) and a WhatsApp message cannot point to the buyer's chat; the push opens the exact chat, costs nothing per notice | A WhatsApp message from a Yoyos business number (Business account, templates, Meta cost per message, no way to reach the buyer's chat) |
| Q2. Show pendings in the review and the order detail | Yes, as «Por resolver», informative, each saying what to do; confirming a review acknowledges the points present then, and only new points reopen it | Both reviewers | Otherwise a link can go out missing a requested product; acknowledging avoids a review loop. Replaces the 28/10 rule «no screen shows pendings» | Keep pendings hidden (the urgent push as the only trace) |
| Q3. Keep a seller-corrected message beyond 90 days as an evaluation case | No: after 90 days only the verdict without text remains | Coordinator (reviewers disagreed: UX/UI option 2, product option 1 with conditions) | Consistent with founder decision 3 of 31/10 (texts 90 days, then deleted automatically) and the more conservative | Copying masked texts into the private bank by deliberate decision per case |
| Q4. A message changes the order after the link was taken | One non-urgent push «Pedido #N cambió» per review cycle; «link taken» is a recorded **Copiar enlace**, **Compartir enlace** or **Abrir enlace**; only while the order is open for messages; an urgent problem in the same message wins and its body says the order changed after the link; counted apart from the urgent share; a title distinct from «Revisa el pedido #N» | Both reviewers | The link never expires and the buyer pays the current total, so the seller is the only one who can miss the change; one notice per cycle costs little | No notice, the buyer's checkout confirmation as the verdict (a doubtful change could be paid unseen); stop applying changes after the link (contradicts «the AI builds and corrects the order alone while it is pending») |
| Delivery plan (product S9) | One integration branch, one pull request per plan task, one final pull request to `main` | Founder, 31/10, implementation session | The task follows the implement-task flow | One pull request per phase |

## Routine decisions approved by the review gate

Decided by the agent during definition and approved by both reviewers; the founder confirms them in the final pull request:

- Context: the last 12 messages of the chat from the last 48 hours, both sides, plus the last photo (initial values, adjustable); context is never applied again.
- Certainty is high only with justifying words, a target named by the buyer (or the photo of the same message, or the photo just sent for set wording while what it left is unchanged), an explicit change verb for variant changes and a single candidate; variant-only, unnamed-reference and context-resolved changes are at best «Con duda», even with two agreeing readings.
- A pending change that is not high certainty is applied with «Con duda» on its «Por resolver» point; the doubt carries to every item the pending becomes (splits included) unless a confirmed review already showed it or the completing message restates the value; the point counts as «por resolver» until it becomes an item; the «Expected double notice» goes away.
- The only-item rule is tightened: «quítalo», «ese», «mejor que sean 3» on a sole item are at best «Con duda».
- The 22/10 photo guard stays: a variant-only text never changes an item the last photo is not about.
- High-risk changes need two agreeing readings on top of high certainty; changing a pending's quantity is low risk.
- Every current outcome is mapped in [Every current outcome](#every-current-outcome-under-the-new-decisions); the changed rules are in [Changes to current rules](#changes-to-current-rules).
- The mark is «Con duda» (a state), the review sections «Cambios con duda» and «Por resolver», the list label «Por revisar», the only action **Revisar pedido**.
- The review opens on a link action only for WhatsApp orders open for messages with something new to review; the first link always opens it, one tap when nothing is marked.
- On those orders the URL is hidden and **Copiar enlace**, **Compartir enlace** and **Abrir enlace** each pass through the review; the card is the only entry there; its count names only «Con duda» changes and «Por resolver» points.
- «Link taken» is recorded on the tap (copy, open) or when the share is not reported dismissed; a seller who only wanted to review takes the link anyway (accepted).
- On web, copy and open after a review need one more click, and «Enlace copiado» shows only after a real copy.
- Once an order is not open for messages, only «Con duda» marks keep it «Por revisar»; completed and cancelled orders show no marks or review.
- «Not reviewed» is fixed at completion or cancellation; «kept» on unmarked items is a weak label.
- The undo confirmation lists the pendings that return and the one that ends; rows show the date when not today.
- The «mientras revisabas» summary covers any change kind and stays in the mobile card until leaving the detail.
- On orders no longer open for messages, the link card is today's, the review opens from **Revisar pedido**, corrections follow the web edit's locks, and a read-only review on shipped or delivered orders clears the marks; cancelled orders hide marks; completed and cancelled orders never show «Por revisar».
- The review has one main action, **Confirmar revisión**; controls only on marked items; mobile full-screen modal with a fixed bottom bar, web the existing dialog; on web, opening the link after a review takes one more click.
- **Deshacer mensaje** in the review is disabled while there are corrections on screen, with **Descartar correcciones**.
- A message during the review blocks the confirmation only if it touched a corrected item or added a mark or point; otherwise confirming succeeds and says what changed and the confirmed total.
- Sure removals since the last review show read-only in the review.
- One undo, per message, all or nothing; it restores the line with its copied price and the pendings with their earlier life and the 10-pending limit; it is refused (shown before confirming) after a later change, when it would empty the order, when it would restore something no longer sold, or when the order moved on.
- Verdicts cover reviews, edits in the detail, undo and changes never reviewed.
- Several problems in one message: one notice with the first problem's question; one question box per point, up to 3.
- Suggested questions never claim stock and name values only up to 3 per attribute; they are in the buyer's language; they persist in the chat view while their point is open.
- Mobile edits only remove items and change quantities; adding and changing variants stay on web, including re-adding an item whose undo was refused (at the current price).
- «Cambios por mensajes» shows up to 5 rows with **Ver más**, newest first, and loads with the order.
- Marks use the amber of the short-stock notice with contrast ≥ 4.5:1.
- Traces are read only by named Yoyos team members, never through seller roles, and each read is recorded.
- A phase is not done if urgent notices exceed 10 % of messages or miss an expected urgent case.
- A change counts as an improvement only if its 3-run range does not overlap the previous range.
- p95 excludes queue wait behind earlier messages of the chat (reported apart); the shadow reader's cost is reported apart.
- The old reader runs in shadow during phase 5 and is removed when the founder's real WhatsApp test meets the pass criteria.
- `unknown_reference`, `malformed` and `context_too_large` disappear as outcomes.
- Orders and messages from before the feature get no marks or review.
