# Message to order

Every incoming photo or text of an individual chat updates that chat's open order the way the seller would: it adds the product named or shown, with the variant and quantity the buyer stated, removes or changes the item the buyer refers to, and finishes what an earlier message left unfinished. When a message asks for something Yoyos cannot apply, nothing changes for that request and the seller gets a notice on the phone that received the message ([notifications](notifications.md)). A doubt is never silent. The seller still closes the sale: they review the order and send the checkout link themselves.

Sources of truth:

- Use case: `apps/core/src/features/orders/application/apply-chat-message.ts`; handler and dead-letter handler: `chat-message-handler.ts`; queue policy: `chat-message-policy.ts`; reader limits from env: `infrastructure/chat-message-limits-env.ts`.
- The reader (one model call per message): port `ReadChatMessage` in `apply-chat-message.ts`; adapter, schema and every model-facing text in `orders/infrastructure/` (`openai-chat-reader.ts`, `chat-reader-schema.ts`, `chat-reader-text.ts`, `chat-reader-context-text.ts`, `chat-reader-env.ts`). `chat-reader.model-text.json` pins every text and request setting the model gets, so a change to it is deliberate.
- Reading context, the reader's answer and the checks that turn it into actions: `orders/domain/chat-reading.ts`. Pendings and their life: `chat-pendings.ts`, `pending-transitions.ts`. Order transitions and outcomes (pure): `chat-order.ts`, `chat-message-outcome.ts`, `mentioned-price.ts`. Open-order rule: `message-order.ts`.
- Notice choice: `orders/domain/seller-notice.ts`; texts (es, pt-BR): `orders/presentation/seller-notice-texts.ts`.
- Products given to the reader: `findProductsForReading` and `findMessageCandidates` in `products` ([image-product-search](image-product-search.md)).
- Contracts: `shared/contracts/whatsapp-messages.ts`, `shared/contracts/orders.ts` (`mentionedPrice`), `shared/contracts/seller-notices.ts`. Tables: `ChatMessageOutcome`, `ChatPendings` in `apps/core/prisma/schema.prisma`.

```text
Customer 1 ── * Contact 1 ── 1 Chat 1 ── * ChatMessage 1 ── 0..1 ChatMessageOutcome (every message read)
    │                           │  └── 0..1 ChatPendings (the chat's unfinished requests)
    └──────────── * Order ──────┘ (chatId)       └── OrderMessage (messages that changed or created an order)
```

## Vocabulary

- **Chat order:** the chat's open order, which messages update. Interface: «Pedido #1023» with the WhatsApp mark. There is no other per-conversation state besides pendings.
- **Identification:** deciding which catalog product a photo shows, with a certainty ([image-product-search](image-product-search.md)). Texts have no identification step: the reader names the product.
- **Reader:** the single model reading of a message. It returns the actions the buyer asks for, «no intent» or a doubt; it never changes anything by itself.
- **Check:** what Yoyos verifies of each action against the catalog and the order before applying it.
- **Pending:** what a message identified and could not add (a product without its full variant, or a product doubtful between several), kept for the chat until a later message completes it or it ends. It is not an item: it changes no total, checkout or stock, and no screen shows it.
- **Doubt:** the reader says it is not sure what a message asks of the order. Always a notice.
- **Outcome:** what a message did or why it could not be applied, kept per message in `ChatMessageOutcome`.
- **Notice:** what the seller's phone shows when a message needs them. Interface: «aviso».
- **Mentioned price:** the amount a buyer wrote for an item and how many units it covers. It never changes the unit price.

## Flow

1. Mobile registers each message with `POST /api/messages` ([whatsapp](whatsapp.md)). After the commit, core publishes `message_created` (`{ companyId, chatId, messageId }`, event ID = message ID).
2. The `apply-chat-message` job reads the message, the chat's open order (items, variants, quantities, unit prices), the chat's pendings and which orders the chat opened since an orderless pending last changed. Earlier messages are never read.
3. A photo identifies its product first (QR, then visual search at 0.8 certainty).
4. The reader reads the message with the order, the pendings and the catalog products involved. A product photo without a readable caption, or any product photo when the reader is disabled, gets a fixed answer built in code («add the shown product with the QR attributes») that goes through the same checks.
5. Yoyos checks each action. What passes is applied in one transaction to the order and to the chat's pendings, and the outcomes are recorded. What does not pass becomes a pending or a notice; nothing is applied partly inside one action.
6. After the commit, if the outcomes call for a notice, core publishes `chat_message_processed` and the notifications feature sends it.

```text
message_created ─▶ apply-chat-message (ordered per chat)
                    ├─ photo cascade (QR, visual 0.8)                                   (outside the transaction)
                    ├─ context: order, pendings, products for reading, text candidates   (outside the transaction)
                    ├─ reader: one structured call → actions / no intent / doubt         (outside the transaction)
                    ├─ checks: reader answer → resolved actions                          (pure)
                    └─ transaction: lock Contact → lock Order → lock ChatPendings → apply → save order, pendings, ChatMessageOutcome
                 ─▶ chat_message_processed (only when a notice is due) ─▶ send-chat-message-notice
apply-chat-message-dead-letter: record failed → publish notice → release the chat
```

### What the reader receives and returns

| Aspect | Rule | Reason |
| --- | --- | --- |
| Context | The message (photo caption or text); the open order's items; the chat's pendings; and the catalog products involved, each with its sellable variants and every value of each attribute. Answers use short references (`P1`, `I1`, `Q1`) valid for one reading, so an unknown reference fails only its action. | One reading decides everything, and a pending can be completed by «en talla M» without naming the product. |
| Products given | Priority, deduplicated: the products a photo shows, variant pendings' products, the candidates of doubtful pendings (round robin), the order items' products, and for a text the catalog candidates. At most 24 (`READER_MAX_PRODUCTS`). Items stay listed with their own snapshot even when their product is cut. | Bounds the context while every pending keeps at least one product. |
| Candidates for a text | The 8 active, sellable products whose names cover most of the message's words (`TEXT_MATCH_CANDIDATES`), ranked by the sum of per-word trigram similarity at 0.3 or more, ties to the shorter name. The searched words are the text's distinct words of 3 or more characters, capped from the company's catalog size so the work stays near 150 ms (budget 25,000 word × product pairs). A statement over 1 s gives no candidates instead of failing the message. | One path for any catalog size; coverage keeps the named product first where a best-single-word ranking ties on common words. Rejected: the whole catalog up to a size (15–30k tokens per message). |
| Limits | A text over 2,000 characters is not read (`text_too_long`, generic «Revisa el chat»). At most 40 items are listed; a reference to an unlisted item ends as `unclear_item`. At most 10 actions per answer: the first 10 apply and `too_many_actions` is reported. | Bounds cost and answer size. A long list is never lost whole. |
| Model | OpenAI Responses API, strict structured output, `store: false`, `AI_READER_MODEL` (default `gpt-6-luna`), reasoning effort `none`, `AI_TIMEOUT_MS` (default 20 s), no retries inside the call. | `none` is the lowest effort the model accepts: it rejected `minimal`. The queue retries, not the call. |
| Catalog words | The reader relates the buyer's words to catalog values: «rojas», «rojita» reach Color «Rojo»; «talla eme» reaches «M». Domain and application code compare the value the reader chose with the catalog value ignoring case and accents only. They hold no word lists, plurals, feminines, diminutives, verbs or phrase matching, and no text for the models. | Founder rule: buyers write in many ways, in Spanish and Portuguese, for any catalog. Understanding is the model's, validation is code's. |
| Examples in prompts | Examples never copy eval inputs (`apps/core/evals/cases`): they use other products, colors and wording. A unit test enforces it (`evals/lib/prompt-overlap.test.ts`): every «…» quote and parenthesised example in the string literals of the prompt files is compared with every eval input by words, shared three-word runs and character similarity. | The eval measures the rule, not the memorized text. |
| Gates | No certainty gate on the reader. The visual-search certainty (`PRODUCT_MATCH_MIN_CONFIDENCE`, 0.8) stays on photos. | The reader's own doubt and Yoyos's checks replace the old text gates. |

## Messages that count

| Message | Behavior | Reason |
| --- | --- | --- |
| Outgoing message | Skipped without reading it, no outcome row. | The seller's own words have no rule yet. |
| Text that is empty or has no letter or digit (only emoji or punctuation) | Skipped without reading it, no outcome row. | Avoids a paid model call for «👍». |
| Photo, with or without a caption | One message: the photo decides the product, the caption gives variant, quantity, price or «no lo quiero». | WhatsApp delivers the caption inside the photo message; nothing waits for a second message. |
| Text | Can add products it names from the active, sellable catalog, remove or change items of the open order, and complete or end pendings. | — |
| Message received after the link, whatever its date | Processed and notified, including messages WhatsApp held while the phone was off. | They are live sales the seller has not seen. |

## Rules

| Topic | Rule | Reason |
| --- | --- | --- |
| Context | The message itself plus the items and pendings of the chat. Earlier messages are never read. | Founder decision: the history is not agent memory; pendings carry what matters. |
| Several actions | A message can carry several actions in any mix: «quita la gorra y listo» removes the gorra and marks the order ready; «el polo en M y quita la correa» completes a pending and removes an item. Each action is checked and applied on its own; a failed action changes nothing for itself and the rest still applies. | Buyers write several requests in one message. |
| Add more vs set quantity | The reader states which one the buyer means: «uno más del polo» adds 1 (2 → 3); «mejor que sean 3» sets 3. The same message never yields both. | They differ for the same quantity. |
| Numbers inside a product name | A number that is part of a catalog name is not a quantity: «las medias pack x3» adds «Medias deportivas pack x3 · ×1». | The catalog name is the authority. |
| Generic names | «el polo rojo M» with several polos adds the only one that has Rojo in M, because the candidates' variants count. If two or more fit, it is a doubtful-product pending. | Narrows by what exists. |
| Photo with caption | The photo decides the product. The caption gives its variant, quantity and price, or declines it («no lo quiero»). A caption without letters or digits counts as no caption. A caption naming another product that has an open pending completes that pending («y el polo en M» on a photo of a gorra); naming another product without a pending adds nothing and reports `not_the_shown_product` (generic «Revisa el chat»). | That product was already identified by an earlier message, so the caption adds nothing the photo did not ask for. |
| Caption the reader doubts | The shown product is still added or left pending, as for a photo without caption, and the seller is always told: «Falta la variante» when it stays pending, otherwise «Revisa el chat» saying the product was added (`caption_not_applied`). A caption over 2,000 characters is treated the same. | The photo is the request; the caption may have carried something lost. |
| Photo that matched nothing | Ends as `not_identified` («Producto no reconocido»), with or without a caption; the caption is not read. | Only the photo's product could be added, and there is none. |
| Photo that is not a product | A payment or transfer screenshot, selfie, map, document or payment QR is no purchase intent: nothing changes, no notice. A caption that only reports a payment keeps it so. A caption that asks for something changes nothing and reports `image_with_request`. | A receipt asks for nothing; a request next to it needs the seller. |
| Product QR codes | A photo shows one item per product: several QR labels of one product count once, with the first label. A caption quantity applies to the shown product. A caption naming another variant («en talla L» on the M label) adds that variant of the same product keeping the other attributes of the QR variant (the color), if sellable; otherwise «Variante no disponible». | The QR identifies the product; the caption is what the buyer asks for. |
| Variant | Added only when a single sellable variant fits the known values: the product has one, or the values name exactly one. Unnamed attributes keep the base values (the QR variant, the item being changed, the pending's known values). A value outside the sellable values, or an attribute name the product does not have, is «Variante no disponible» and the product stays a pending with the other known values. Attributes that still vary leave a pending that misses them («Falta la variante»). | Product images and names identify a product, not a variant. |
| Several products in one text | «2 polos negros M y una gorra» adds one item per identified variant. What cannot be added is reported; the rest is still added and one notice covers the message. | — |
| Quantity | Positive whole number, 1 when not stated («un par» = 2). 0 on an add or completion, a fraction or a negative is `quantity_not_whole` (generic «Revisa el chat»); «mejor que sean 0» is a removal. An item that would end above 99 units does not change and reports `quantity_above_limit`. | Bounds misreadings. |
| Variant already in the order | Quantity grows by the stated quantity. | An order holds each variant once. |
| Remove | Applies to an item the message names, or to the only item. «quita uno» lowers the quantity by one; at quantity 1 it removes the item. | — |
| Change quantity | «mejor que sean 3» sets the quantity of the item it points to. Removing, lowering or changing the quantity of an item never requires its product to still be sellable. | Items of a product deactivated later keep working. |
| Change variant | Needs an explicit change verb («cámbialo a talla L»). Replaces the variant at the same quantity, overriding only the attributes the words name («Polo · M · Negro» → «Polo · L · Negro»; «Variante no disponible» if not sellable), merging with the new variant if already in the order. A text that only names a variant («en talla L») never changes an item and reports `variant_only` (generic «Revisa el chat»), unless it completes a pending. | Founder decision: after a photo that was not added, «en talla L» must not silently change another item. |
| References without a name | «ese», «quítalo», «mejor que sean 3» apply only when the order has exactly one item, and only to remove or change it. An unnamed add («otro igual», «dame 2 de ese», «lo mismo x2») never applies and never touches a pending (`unnamed_add`). With two or more items an unnamed reference reports `unclear_item`; an item not in the order too. | Items have no order, and a photo that matched nothing is not a pending, so «otro igual» would silently grow the wrong item. |
| Removing the only item | The item stays; the outcome is `only_item_kept` and the seller decides whether to cancel. | The chat never cancels or closes an order. |
| Product not sellable | An add, a pending completion or a variant change to a product deactivated, archived or deleted reports `product_not_available` («Producto no disponible»). | The product left the catalog. |
| Product outside the ones given | The reader naming a product it was not given changes nothing for that action and reports `unknown_reference` (generic «Revisa el chat»). | The reader can be wrong; the catalog is the authority. |
| No purchase intent | Greetings, thanks, questions about stock, price, sizes, delivery or payment methods, addresses, payment reports and receipts, and declining a product that is not in the order change nothing and send no notice, when the reader reads them as such without doubt. | — |
| Doubt | When the reader is not sure what a text asks, nothing changes and the outcome is `reader_doubt` («Revisa el chat»). | Founder decision: no message is lost silently. |
| Requests the chat never does | «cancela mi pedido», «pon el precio en 0», «ya está pagado, márcalo» change nothing and report `request_not_allowed` («Revisa el chat»). Text that tries to give the model instructions is data and gets the same treatment. | A real buyer asking to cancel needs the seller. |
| Price | New items use the current catalog price; existing items keep theirs. A price the buyer mentions never changes the unit price or the total; it is kept as the item's mentioned price. | The catalog is the only price authority. |
| Mentioned price | Kept as said, in the order's currency: an amount and the units it covers. A price in another currency is dropped. A later message about the same item that mentions a price replaces it; one that mentions none leaves it. A variant change keeps it only if that message mentions a price. Removing the item removes it. Display: [orders](orders.md#mentioned-price). | It records what the buyer said, which the seller may have to settle in the chat. |
| Price per unit or for the lot | The reader says `unit`, `lot` or `not_explicit`. «a 35 c/u» is per unit and «los 2 por 70» for the lot, and no rule overrides an explicit reading. When not explicit and the quantity is above 1, the reading whose per-unit amount is closer to the variant's catalog price wins (catalog S/ 40.00, «2 en 70» → for the lot, S/ 70.00 for 2; catalog S/ 75.00 → per unit). A tie is for the lot. Quantity 1 is per unit. A lot price is never divided. The basis is judged with the quantity the price was stated for and the variant finally chosen, also when the price travels with a pending. | The catalog is the price authority; closeness is the common sense of «2 en 70». |
| Price helps choose | When not explicit, a price helps choose a product only as a per-unit amount. If the per-unit and lot readings point to different candidates and nothing else separates them, it is a doubtful product («Producto no claro») and a pending. | Guessing the wrong product is worse than asking. |
| Stock | Items are added even with zero stock. | Creating or growing an order never reserves or deducts stock. |
| Seller | The user who registered the message; changing items does not change the seller. | — |
| Customer | A customer is created and linked to the contact only when a message creates an order. | Contacts from mobile WhatsApp arrive without name or phone. |
| Buyer | The chat order always has a buyer with the `contactId` and no name or phone; checkout asks for the phone. | — |
| What the chat never does | Close, cancel, register payments, deduct stock, generate or send the checkout link, change delivery or prices. | Founder decision: the seller closes the sale. Model output can only reach the actions above, on its own chat's open order. |
| Privacy | Logs and notices never contain the buyer's text, captions, phone numbers, WhatsApp IDs, prompts or the reader's answer. | — |

Example: the open order #1023 has «Polo básico · M · ×2 · S/ 35.00». The buyer writes «y una gorra negra y mejor que el polo sea talla L». Result: «Polo básico · L · ×2» and «Gorra · Negro · ×1 · S/ 25.00», total S/ 95.00, no notice.

### Pendings

| Topic | Rule | Reason |
| --- | --- | --- |
| What becomes one | (a) A product identified without its full variant: a photo with no size, «quiero el polo básico», or a variant that does not exist («Polo básico rojo», no Rojo). (b) A product doubtful between several candidates (at most 4): «el polo de 40» with two polos at S/ 40.00. Each carries the attribute names and values already given (catalog values, never the buyer's words), the quantity, the mentioned price and its basis. | Pendings are structured data, never the raw history. |
| What does not | A photo that matched nothing, a text naming nothing in the catalog, a doubt, a failed removal or change, an unnamed add, a quantity above 99. | They end in their notice. |
| Owner | The chat, within the chat's company. Candidates and products come only from that company's catalog, and only messages of the same chat read or change its pendings. There is no seller action or route on pendings. | Company isolation; the seller acts through the chat. |
| Storage | One `ChatPendings` row per chat with a validated JSON list (at most 10) and `readyRemembered`. | The list is always read and written whole under the chat lock. Rejected: one row per pending. |
| Notice on creation | Once, with the existing notice: «Falta la variante» for (a), «Producto no claro» for (b), «Variante no disponible» when the named variant does not exist. | The seller learns once that the request is unfinished. |
| Completing | A later message that gives what is missing («en talla M», «el negro», «el oversize» for a doubtful polo) adds the item with the pending's quantity and mentioned price unless the message states others. No notice: silence after the buyer's answer means Yoyos understood it; the item is added once nothing is missing. | The seller already knows the request was unfinished. |
| Units | A message assigns units of a pending: «uno negro M y otro blanco L» on «Polo básico ×2» adds two items and ends it. Units not assigned stay as a pending with the earlier values and no second notice. A message that assigns more units than the pending had uses the message's quantity. A part split off by a partial completion counts toward the limit and keeps the remembered «listo». No unit is ever dropped. | Founder decision: no unit is dropped silently. |
| Partly completing | «en M» on a pending missing Talla and Color keeps it with only Color missing, no notice. A doubtful product resolved to one that still lacks its variant becomes a variant pending, no notice. | The seller already knows. |
| Naming it in full | «polo básico negro M» while that polo is pending adds one item, not two, and ends the pending. | — |
| Replacing | A new message naming the same product without its variant («y el polo básico x2»; a second photo of the same polo) replaces that pending, keeping what the new message says and the rest of the old one, and never notifies. A message adding a product with several pendings replaces the one whose known values do not conflict, the most recently changed when none fits, and never opens a parallel request; when several fit and the values do not say which, it reports `variant_for_several_pendings`. A replacement naming a value that does not exist is a failed check: «Variante no disponible», and the pending keeps the rest. A message identifying one of a doubtful pending's candidates resolves that pending, so both kinds never coexist for a product. | Replacing is a refinement of a known request; a missing value needs the seller. |
| Declining | The buyer declines it («ya no el polo») → it ends, no notice. | — |
| Several pendings | The reader decides which pending a message completes («el polo en M y la polera en L» completes both). A value that fits two and does not say which: nothing changes and `variant_for_several_pendings`. | — |
| Lot price across parts | A lot price goes whole on the first item of its request and is cleared from the rest of that request. | A lot price is never divided. |
| Life with an order | A pending joins the first chat order that is open for messages at or after its last change, and ends when that order stops being open for messages (a payment reported or confirmed, checkout confirmed, shipment, stock deduction, completion or cancellation). Ended pendings never come back, even if the order reopens (a voided payment). A late «en M» for a pending that ended reports `variant_only` and never adds the item to a new order. | Founder decision: a pending lives until its order stops being open. |
| Life without an order | Lasts 7 days from its last change (`CHAT_PENDING_TTL_DAYS`), then ends silently. As soon as the chat has an open order, whatever opened it, the pending belongs to that order, follows its life and the 7 days stop. Completing it with no open order creates the chat order, with the rules of a new order (including «Pedido nuevo #N» after a closed one). | Bounds stale completions while keeping next-day answers. |
| Derived, not swept | Whether a pending is alive is derived under the message's lock from stored times (`messageOpenIntervals`, `pendingLife`); order use cases never call into pendings. The order's cancellation and first stock deduction times are stored for it (`Order.cancelledAt`, `Order.stockDeductedAt`). | The flags that revert (stock restored, completion cleared by a void) cannot say when an order was open. |
| Limit | At most 10 pendings per chat (`maxChatPendings`, a domain constant); an 11th ends the least recently changed other one, silently, since its notice was sent. | Bounds the context. |
| Product or variant no longer sellable | Checked when a message completes it. Product deactivated, archived or deleted → the pending ends and the message gets «Producto no disponible». Only the chosen variant → «Variante no disponible» and the pending stays. | — |
| Variant-only text | With a pending the variant fits, «en talla L» completes it and never changes an item. Without one, `variant_only`. | Pendings are where «en talla M» belongs. |

### «Listo»

| Situation | Effect | Notice |
| --- | --- | --- |
| «listo» with items and no pending | The order does not change. | «Pedido #N listo» |
| «quita la gorra y listo» | Removes the gorra. | «Pedido #N listo» |
| «listo» with a pending left after the message | The pending stays; Yoyos remembers the buyer said «listo» (`readyRemembered`). | «Revisa el chat» naming up to three products (`ready_with_pendings`), with or without order number. It is never counted as an unapplied request: any problem of the message wins. |
| A later message completes the last pending, or the buyer declines it with items left | The item is added or the pending ends. | «Pedido #N listo» |
| The buyer declines the last pending and no items remain | The pending ends. | None |
| A message after the remembered «listo» adds a new item or creates a new pending | Applied as usual; the remembered «listo» is dropped, since the buyer is still ordering. | As usual; a later «listo» notifies again |
| «listo» with no items and no pending | Nothing changes. | None (no purchase intent) |
| The last pending ends because its product stopped being sellable | The pending ends. | «Producto no disponible»; no «Pedido #N listo» follows. A problem wins over «listo». |

The remembered «listo» ends with the chat's pendings, or when dropped as above.

### Open order

Items go to the most recent order of the chat that is still open (`isOpenForMessageItems`). An order is open when all of these hold:

| Condition | Reason |
| --- | --- |
| Its `chatId` is the message's chat. | Manual orders never receive automatic items. |
| Not cancelled and not completed. | — |
| No confirmed or reported payment (only voided ones). | Changing items would change a total already covered or reported. |
| Checkout not confirmed. | The buyer already confirmed another total. |
| Delivery `pending` and stock not deducted. | The order was not prepared or dispatched. |

An order with checkout enabled but not confirmed stays open. If its total changes, checkout confirmation detects it under lock and returns `TOTAL_CHANGED`.

When there is no open order, the reason decides what a message does:

| Latest chat order | Add | Remove or change |
| --- | --- | --- |
| None | Creates a chat order. | `no_open_order` («… no tiene un pedido abierto»). |
| Cancelled | Creates a chat order without notice (the seller cancelled it). | `no_open_order`. |
| Closed (paid, checkout confirmed or dispatched) | Creates a chat order and reports `new_order_after_closed` («Pedido nuevo #1024»). | `order_closed` («… que ya no se puede modificar»). |

Item actions resolve against the target as it was before the message: «agrega una gorra y quita el polo» after a closed order creates the new order with the gorra and reports `order_closed` for the removal, whatever the action order. Reason: the removal refers to the order the buyer was looking at.

### Outcomes

Each message that was read gets exactly one `ChatMessageOutcome` row (PK company and message) holding a non-empty list of outcomes, validated with a Zod schema on write and read, and `noticeSentAt`. The kinds and their fields are in `orders/domain/chat-message-outcome.ts`: the order changes (added, removed, quantity lowered or changed, variant changed, mentioned price set, ready, only item kept, order closed, new order after closed), the problems (no intent, variant only, unnamed add, image with a request, no open order, not identified, not clear, variant missing, variant not available, quantity above limit, unclear item, reader doubt, request not allowed, invalid action, product not available, variant for several pendings, ready with pendings, caption not applied, failed) and the pending changes (created, updated, completed, split, ended with its reason), which are silent. They keep, when known, the identified product, the identification method (QR, visual) and its certainty, and whether a removal or change named its item.

| Decision | Reason |
| --- | --- |
| Outcome and identification certainty are kept per message, not only logged | They make each message apply once and are the data for showing how each item was identified and for tuning thresholds. |
| `ChatMessageOutcome` is separate from `OrderMessage`; `OrderMessage` still records only messages that changed or created an order | `OrderMessage`'s composite FK to `Order` cannot become optional while `companyId` is required. |
| No FK from outcomes or pendings to `Order` | Order IDs inside them are historical references; the notice route checks the order still exists. |
| A `failed` outcome is final and never reprocessed | By then the chat's later messages have applied and the notice was sent. |
| The buyer's text is not copied anywhere new | Outcomes and pendings hold IDs, kinds, catalog names and values only. |

## Notices

The notice choice is pure (`chooseSellerNotice`). One message gets at most one notice:

1. **Problems** are the outcomes that need the chat: non-silent `not_identified` and `not_clear`, `variant_missing`, `variant_not_available`, `quantity_above_limit`, `unclear_item`, `unnamed_add`, `variant_only`, `image_with_request`, `order_closed`, `no_open_order`, `reader_doubt`, `request_not_allowed`, `invalid_action`, `product_not_available`, `variant_for_several_pendings`, `caption_not_applied`, `failed`. Exactly one → its own notice. Two or more → «Revisa el chat» naming up to three identified products and counting the rest («Gorra y otra»). What could be applied is applied.
2. **No problem:** `ready_with_pendings`, then `only_item_kept` («Revisa el pedido #N»), then `ready` («Pedido #N listo»), then `new_order_after_closed` («Pedido nuevo #N»).
3. When the chosen notice is a problem and the message also created a new order, its body ends with «Se creó el pedido nuevo #N.», so the seller does not act on the closed order.
4. Otherwise no notice: successful changes, `no_intent` and every pending change are silent.

Reason for the order: a problem needs the chat before the seller charges, and the chat shows the whole message.

| Case | Title | Opens |
| --- | --- | --- |
| Product not identified (photo or text) | «Producto no reconocido» | Chat, on the message |
| Text matching several products, none certain | «Producto no claro» (names up to three, then «y N más») | Chat, on the message |
| Variant missing | «Falta la variante» («qué talla o color», attribute names in the product's stored attribute order; «qué variante» when variants have no attributes) | Chat, on the message |
| Variant not available | «Variante no disponible» | Chat, on the message |
| Product no longer sellable | «Producto no disponible» («un producto» when it was deleted) | Chat, on the message |
| Quantity above 99, unclear or missing item, unnamed add, variant only, non-product image with a request, change after the order closed, several problems | «Revisa el chat» (the body names the case) | Chat, on the message |
| Doubt, a request the chat never does, a product outside the ones given, a quantity that is not whole, a text too long, more than 10 actions, a caption naming a product with no pending | «Revisa el chat»: «Un cliente escribió algo sobre el pedido #N que no pudimos aplicar.» (without «sobre el pedido #N» when there is no order) | Chat, on the message |
| A doubted caption on a photo whose product was added | «Revisa el chat»: «…enviamos una foto de X y la agregamos al pedido #N, pero no pudimos aplicar lo que escribió.» | Chat, on the message |
| «Listo» with pendings | «Revisa el chat»: «Un cliente dice que terminó el pedido #N, pero falta completar X.» | Chat, on the message |
| A variant that fits two or more pendings | «Revisa el chat»: «…mencionó una variante sin decir de cuál producto: X y Y.» | Chat, on the message |
| Retries exhausted or permanent error | «No pudimos revisar un mensaje» | Chat, on the message |
| Removing the only item | «Revisa el pedido #N» | The order |
| That's all | «Pedido #N listo» | The order |
| New order after the previous one closed | «Pedido nuevo #N» | The new order |

- Bodies are in `seller-notice-texts.ts`, in Spanish and Brazilian Portuguese (the phone's language, as the app interface). «Un cliente» stands for the buyer until chats have a name.
- Lists in the pending texts name up to three distinct products joined with «y» / «e», then the rest counted as «y N más» / «e mais N». A doubtful-product pending and a pending whose product was deleted have no name: they are counted, never written as «un producto y un producto». Accepted trade-off: naming candidates inside another list would make the body unreadable.
- A notice never contains the buyer's text, phone or WhatsApp ID; it may name a catalog product and an order number. Order numbers are resolved from the order the message was applied to, not from the chat's current order; a deleted order or product falls back to a text without its number or name.
- Amounts use the same money format as the order's unit prices.
- Distinct titles for each «Revisa el chat» case were rejected: the title carries the action and the body names the case.
- **Silent misses:** a photo miss in a company whose catalog search readiness is not `ready` (no active products, visual search off, or no active product image indexed yet), and a text miss in a company with no active products, send no notice. The mobile WhatsApp screen shows the catalog hint instead. Reason: in that state visual search never answers, so every photo would notify.
- **Expected double notice:** «quiero 2 de esos» right after a matched photo without variant gives «Falta la variante» for the photo and the unnamed-add notice for the message: two notices for one product. Kept because growing a pending silently on an unnamed reference would be worse.

## Order of processing and failures

| Topic | Rule | Reason |
| --- | --- | --- |
| Order per chat | Messages of one chat apply one at a time, in the order they reached core (queue `apply-chat-message`, ordering key = core chat ID). A message waiting for a retry holds back the later messages of its chat; other chats do not wait. | Each message is read against the order and pendings the previous ones left. |
| Fairness | At most 8 messages of one company run at once per worker process, out of 16 slots (`APPLY_CHAT_MESSAGE_CONCURRENCY`). | One company's live sale never takes more than half of a worker. Group concurrency is exact per worker process, not shared across replicas ([event-bus](event-bus.md)). |
| Each message once | The outcome row's primary key makes a repeated event, a resend or a reprocess end as `already_processed`, with no change and no second notice; a completed pending is not completed again. | Resends and reprocessing are normal. |
| Temporary failures | Persistence, image storage, QR reader, embedder, product matcher and AI provider unavailability, and the attempt deadline, are retried: 8 retries from 5 s, exponential, capped at 100 s. | Founder decision: a temporary failure never loses a message. |
| Time bound | Each attempt ends by an 85 s deadline; pg-boss expires it at 90 s and detects expiry or a lost heartbeat (30 s) within 10 s. A job spends at most about 25 minutes from its first attempt to its last (excluding time queued behind earlier messages of its chat or waiting for a free slot). | The seller learns of a stuck message in bounded time. The reader honors the deadline; the image cascade is bounded by the chooser timeout (`PRODUCT_MATCH_TIMEOUT_MS`) and by job expiry. |
| Candidate search timeout | A candidate search over its 1 s statement timeout is not an error: the message continues without candidates (items and pendings are still listed) and `message_candidates_timeout` is logged. | Retrying would hold the chat's queue for about 25 minutes for an input that is slow every time. A product named only in the text may end as `not_identified`. |
| Permanent errors | Invalid stored data, a missing message, contact or seller, a currency mismatch, an invalid order, and invalid reader responses record a `failed` outcome, publish the notice and complete the job. | They would repeat on every paid attempt. |
| Releasing a chat | A job that ends `failed` (retries exhausted, last attempt expired, worker crashed) goes to `apply-chat-message-dead-letter`, which records `failed` (`RETRIES_EXHAUSTED`) unless an outcome exists, publishes the notice if it is due and unsent, and then deletes the source job, which releases the chat. | A `failed` job blocks its chat's key until deleted. |
| Notice publication | If publishing `chat_message_processed` fails after the commit, the job completes and the notice is lost (logged). A crash between commit and publication is recovered by the re-run, which finds the outcome with an unsent notice due and publishes it. | The notice is a secondary effect; the order change stands and the chat never waits for a notice. |
| Without an AI key | Without `OPENAI_API_KEY`, the reader is disabled: a photo follows the fixed answer (the shown product is added), a caption is ignored, and texts are skipped (`reader_disabled`, no row). | Development and tests run without paid providers. |
| Cost | Every text with letters or digits and every photo with a readable caption costs one reader call; a retry repeats every paid stage. A photo without caption costs none. Counted with the o200k_base tokenizer (the closest published to gpt-6-luna), a usual context (12 products of few combinations and one price, 3 items, 1 pending) is about 2.6k input tokens, about US$0.0008 per message; the synthetic worst case (24 products of 72 combinations with a price each, 40 items, 10 pendings, 2,000 characters) is about 29.9k, about US$0.0035, over the US$0.003 bound (Todoist task `6hrqHJghCXGwX26V`). The counts are pinned in `chat-reader.model-text.json`. | The reader replaced up to four calls per text. |

## Consistency

- Image reading, the candidate search, the reader and every model call run outside the transaction. Inside it, the contact is locked first (without creating a customer), the outcome is re-checked, then the open order and the chat's pendings are locked and re-checked, and `pendingLife` is evaluated before the actions. Reason: locking the contact serializes the messages of one chat even if two jobs of one key overlap, so two concurrent messages create one customer and one order; locking the order serializes against payments, delivery, stock, cancellation and checkout. No model call and no reading or candidate query runs under the lock.
- Item references are re-checked against the locked order: a variant that left the order meanwhile reports `unclear_item`. A pending the reader referenced that ended under the lock is checked as if there were none: an action with only values reports `variant_only`, one that named the product follows the add rules.
- A message applies to the order as it is when it is applied. If the order closed meanwhile, the closed-order rules apply and its pendings have already ended.
- The order, the pendings and the outcome change together or not at all. A pending is written only when it changed.
- No unique index enforces "one open order per chat": openness depends on payments and checkout in other tables, so the locks guarantee it. If an older order's payment is voided, the chat can have two open orders; the most recent one is used.
- Publication of `message_created` is retried only by mobile resending `POST /api/messages` with the same identity. Rejected alternatives: a periodic republisher (needs cross-company access to RLS-protected messages and a scheduler) and enqueueing the job inside the message transaction (the event bus port exposes no transactions).

## Known limitations

- No operation edits the items of an existing order from web or mobile. A wrong item added by a message, a pending completed wrongly, or an item a message failed to add can only be fixed by cancelling the order.
- A confident misread removal or change («no me gusta ese color, ¿tienes otro?» read as a removal) applies silently, and without a certainty gate the reader alone carries that risk; the order keeps no per-item trace of what each message changed.
- Two items of the same product with close labels («Polo · M» and «Polo · L») can still be chosen wrongly with high confidence.
- A message that reaches core out of chat order (a photo whose upload was retried after a later text) is applied in the order received: «quita la gorra» before the photo of the gorra reports «Revisa el chat», then the photo adds it; «en M» processed before the polo photo gets the variant-only notice, then the photo creates a pending with «Falta la variante».
- After a pending ended (its order closed, 7 days passed or the limit pushed it out), a late «en M» gets the variant-only text although the buyer is answering about the ended pending.
- After «Producto no claro» resolved to a product that still lacks its variant («el oversize»), the silence does not mean the item was added; the «listo»-with-pending notice and the order detail show it.
- The candidate search scans the company's products (the trigram index cannot serve the app role under forced RLS on `Product`, because the pg_trgm operators are not leakproof). Its cost is the company's products × the searched words (about 4.5 µs per pair), so the searched words are capped from the catalog size: p95 stays near 150 ms up to about 5,000 products and about 155–185 ms at 10,000, and recall falls above about 8,300 products where only the 3 longest words are searched. A per-word lookup that lets the index serve the matches is a follow-up.
- Not handled: audio, video, documents, stickers, view-once images, reactions, edited or deleted messages, group chats, several products in one photo found by visual search, and replying to the buyer.

## Operation

- Log events: `orders_chat_message_applied` (with `readerCalls`, `answer`, `actionKinds`, `contextTruncated`, pendings before and after, candidate timing), `orders_chat_message_skipped`, `orders_chat_message_retry_scheduled`, `orders_chat_message_failed` (`source`: permanent or dead letter), `orders_chat_message_notice_publish_failed` and `orders_chat_queue_blocked`, with company, message, event, chat and order IDs, outcome kinds and codes; reader events `chat_reader_completed` (tokens, duration), `chat_reader_request_failed`, `chat_reader_invalid_response`, `chat_reader_disabled`; `message_candidates_found`, `message_candidates_timeout`, `chat_orders_opened_since_capped`. The core chat ID is logged because it is the queue key and not personal data.
- Settings (`apps/core/.env.example`): `AI_READER_MODEL`, `AI_TIMEOUT_MS`, `CHAT_PENDING_TTL_DAYS`, `READER_MAX_PRODUCTS`, `READER_MAX_ITEMS`, `READER_MAX_TEXT_CHARS`, `TEXT_MATCH_CANDIDATES`, `TEXT_MATCH_MIN_SIMILARITY`, `TEXT_MATCH_PAIR_BUDGET`, `TEXT_MATCH_MIN_WORDS`, `TEXT_MATCH_MAX_WORDS`, `APPLY_CHAT_MESSAGE_CONCURRENCY`. The item quantity limit (99) and the pending limit (10) are domain constants, not settings.
- A chat held by a `failed` job raises `orders_chat_queue_blocked`; the runbook is in [event-bus](event-bus.md#blocked-keys).
- To reprocess a job, retry it in pg-boss; resending the message does not work because the event is already marked as dispatched. Reprocessing is safe because of `ChatMessageOutcome`, but a late reprocess may land in a different open order. A message with a `failed` outcome is not applied again.

```sql
SELECT id, singleton_key, data->'metadata'->>'eventId' AS message_id, output->>'message', completed_on
FROM pgboss.job
WHERE name = 'apply-chat-message' AND state = 'failed';
```

- The queue `add-message-products-to-order` has no handler. Its pg-boss queue and any jobs in it are dropped by hand on environments that still have it. `message_created` jobs whose payload lacks `chatId` fail permanently as invalid stored data and go to the dead-letter queue.

## Evaluation

`apps/core/evals` measures the whole path with the real models: single messages and conversations of 2 to 4 messages whose steps include events (days passing, a cancelled order, a reported, confirmed or voided payment, a deactivated product). A case can seed the chat's starting state: the open order, its pendings, a closed order, inactive lines. Scoring is by order and by the notice that `chooseSellerNotice` picks; a conversation also fails when two notices name the same product, unless the step marks `expectsRepeatNotice`. A private catalog and private cases load at run time from `EVAL_PRIVATE_DIR`, outside the repository. Details and settings: `apps/core/evals/README.md`.

## Display

Orders from chats have `source: "whatsapp"`. Core web and mobile show a WhatsApp icon labelled "WhatsApp" and no link to the chat. The buyer is shown as name, else phone; "Público general" is reserved for orders without a buyer. Items changed by messages show like any item; pendings are not shown on any screen; the mentioned price note is described in [orders](orders.md#mentioned-price).
