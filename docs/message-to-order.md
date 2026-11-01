# Message to order

Every incoming photo or text of an individual chat updates that chat's open order the way the seller would: it adds the product named or shown, with the variant and quantity the buyer stated, removes or changes the item the buyer refers to, and finishes what an earlier message left unfinished. Each change ends in exactly one decision: applied, applied marked «Con duda», kept «Por resolver», escalated to the seller with a notice, or silent. A doubt with a single best reading becomes a mark the seller resolves in the order review ([order-review](order-review.md)); a doubt without one becomes a notice on the phone that received the message ([notifications](notifications.md)). The seller still closes the sale: they review the order and send the checkout link themselves.

The goal is zero silent wrong changes: a wrong change applied without a mark or a notice. Urgent notices stay at or under 10 % of the messages read in production (target 5–10 %, checked in real use); the evals gate false urgent notices instead (see «Cap»).

Sources of truth:

- Use case: `apps/core/src/features/orders/application/apply-chat-message.ts`; handler and dead-letter handler: `chat-message-handler.ts`; queue policy: `chat-message-policy.ts`. The reading pipeline (stages, runtime, budgets, traces) is described in [message-reader](message-reader.md).
- Reading types, checks, certainty, risk, agreement and decision (pure): `orders/domain/reader/`. Pendings and their life: `orders/domain/chat-pendings.ts`, `pending-transitions.ts`. Order transitions and outcomes (pure): `chat-order.ts`, `chat-message-outcome.ts`, `mentioned-price.ts`. Photo just sent: `photo-just-sent.ts`. Open-order rule: `message-order.ts`.
- Notice choice: `orders/domain/seller-notice.ts`; texts (es, pt-BR): `orders/presentation/seller-notice-texts.ts`; suggested questions: `orders/domain/suggested-question.ts` and `presentation/suggested-question-texts.ts`.
- Products given to the reading: `findMentionCandidates`, `findProductsForReading` and the photo cascade in `products` ([image-product-search](image-product-search.md)).
- Contracts: `shared/contracts/whatsapp-messages.ts`, `shared/contracts/orders.ts` (`mentionedPrice`), `shared/contracts/seller-notices.ts`, `shared/contracts/message-questions.ts`. Tables: `ChatMessageOutcome`, `ChatPendings`, `OrderMessage`, `OrderItemChange` in `apps/core/prisma/schema.prisma`.

```text
Customer 1 ── * Contact 1 ── 1 Chat 1 ── * ChatMessage 1 ── 0..1 ChatMessageOutcome (every message read)
    │                           │  └── 0..1 ChatPendings (the chat's unfinished requests)
    └──────────── * Order ──────┘ (chatId)       └── OrderMessage (messages that changed or created an order, or touched a pending)
                                                        └── * OrderItemChange (one per item a message changed)
```

## Vocabulary

- **Chat order:** the chat's open order, which messages update. Interface: «Pedido #1023» with the WhatsApp mark.
- **Identification:** deciding which catalog product a photo shows, with a certainty ([image-product-search](image-product-search.md)). Texts have no identification step: the reading names the product and the catalog search finds it.
- **Reader:** the staged reading of a message (context, intent, extraction, resolution, checks, certainty, decision). It never changes anything by itself; the decision applies. Not visible to the seller.
- **Check:** what Yoyos verifies of each request against the catalog and the order before applying it.
- **Con duda / Com dúvida:** a change Yoyos applied with doubt; it already counts in the total. A state, not an action, and never «Por confirmar», because checkout already uses «Pendiente de confirmación» for the buyer.
- **Por resolver / A resolver:** something the buyer asked that could not be added without their answer (a pending). Each point is titled with its notice («Falta la variante», «Producto no claro», «Variante no disponible»).
- **Pending:** what a message identified and could not add (a product without its full variant, or a product doubtful between several), kept for the chat until a later message completes it or it ends. It is not an item: it changes no total, checkout or stock. It shows as a «Por resolver» point.
- **Urgent notice:** a push notice for a message where the buyer waits for something only the seller can give.
- **Suggested question:** text for the seller to copy and send to the buyer. Yoyos never writes to the buyer.
- **Outcome:** what a message did or why it could not be applied, kept per message in `ChatMessageOutcome`.
- **Mentioned price:** the amount a buyer wrote for an item and how many units it covers. It never changes the unit price.
- **Silent wrong change:** a wrong change applied without mark or notice. The measure the policy keeps at 0.

## Flow

1. Mobile registers each message with `POST /api/messages` ([whatsapp](whatsapp.md)). After the commit, core publishes `message_created` (`{ companyId, chatId, messageId }`, event ID = message ID).
2. The `apply-chat-message` job gathers the **context**: the open order, the chat's pendings, the last photo with its identified product and the chat's recent messages, the buyer's and the seller's ([Context and reading](#context-and-reading)).
3. A photo identifies its product first (QR, then visual search at 0.8 certainty). A product photo without a readable caption, or any product photo when the reader is disabled, gets a fixed answer built in code («add the shown product with the QR attributes») that goes through the same checks.
4. **Intent.** Decides whether the message asks something of the order (add, remove, change, complete, «listo», wants to pay) or not, and if not, why.
5. **Extraction.** For each request: target, values, quantity, price and change verb, each with the exact words of the buyer that justify it.
6. **Resolution.** Each product named is found by searching the company's catalog and choosing among the results.
7. **Checks.** The rules of this document decide whether each change can be applied: the variant exists and is sold, the item is in the order, limits, closed orders, mentioned prices.
8. **Certainty and decision.** Each change gets a certainty from reviewable signals and a risk; the decision policy ends it in exactly one decision ([Decision](#decision)). The changes of one message that apply, apply together in one transaction to the order and to the chat's pendings, with the outcomes and the per-item change records.
9. After the commit, if the outcomes call for a notice, core publishes `chat_message_processed` and the notifications feature sends it. The trace of the reading is saved best effort.

```text
message_created ─▶ apply-chat-message (ordered per chat)
                    ├─ context (code, bounded)                       (outside the transaction)
                    ├─ photo cascade (QR, visual 0.8)                (outside the transaction)
                    ├─ intent → extraction → resolution              (model stages, outside the transaction)
                    ├─ checks and certainty                          (pure)
                    └─ transaction: lock Contact → Order → ChatPendings → decide (pure) → apply → save order, pendings, changes, ChatMessageOutcome
                 ─▶ trace (after commit, best effort)
                 ─▶ chat_message_processed (only when a notice is due) ─▶ send-chat-message-notice
apply-chat-message-dead-letter: record failed → publish notice → release the chat
```

## Context and reading

| Aspect | Behavior | Reason |
| --- | --- | --- |
| Context | The last 12 messages of the chat sent within the 48 hours before the message, both directions, each cut to 500 characters, plus the outcome of the latest incoming photo in that window, the open order, the pendings and the photo memory. A message of another chat or company is never context. Messages without a send time never count as context. | A request is understood against the conversation («¿En qué talla?» from the seller, then «M»). |
| Context is not a request | Only the message being read can change the order. Seller messages and earlier buyer messages help understand it but are never applied again: a request an earlier message already applied, or the seller undid, never applies a second time through a later reading. | Re-applying history would double orders. |
| Understanding vs checking | Understanding the buyer's words is the model's; checking against catalog and order is code's. Code keeps no word lists, plurals, feminines, diminutives, verbs or phrases, and no gender rules for texts. Domain code compares the value the model chose with the catalog value ignoring case and accents only. | Buyers write in many ways, in Spanish and Portuguese, for any catalog. |
| Justifying words | Every product, variant value, quantity and price carries the buyer's exact words. Code checks that they appear in the current message (ignoring case and whitespace); a datum whose words are missing or not found is dropped and its request continues without it. Only a target may come from context. | Nothing the buyer did not say is applied. |
| Catalog | Products reach the reading only through the catalog search on the extracted words, the photo identification, the order items and the pendings. The catalog is never pasted, so there is no limit by number of products. | Cost and recall do not depend on catalog size. |
| Catalog words | The model relates the buyer's words to catalog values on every path, not only when the message names the product: «rojas», «rojita» reach Color «Rojo»; «talla eme» reaches «M»; an answer to a pending, a variant change, a photo caption and an «otro igual» are mapped against the product they point to. Words that fit no value of the product are reported as a variant that is not available, not as a missing one. | |
| Two values of one attribute | «Una gorra negra y una roja» is read as two requests, one per value, and each is applied on its own; when one request carries both values, the variant is never guessed and the seller is told to check the chat. | A second value must never overwrite the first. |
| Embedded instructions | Text that tries to give instructions is data: the change it asks for is a request the chat never does. | |
| Photo | The photo still decides the product (QR, then visual search at 0.8). The caption gives variant, quantity, price or declines it. | |
| Examples in prompts | Prompt examples never copy eval inputs (`apps/core/evals/cases`). A unit test enforces it (`evals/lib/prompt-overlap.test.ts`). | The eval measures the rule, not the memorized text. |
| Limits | A text over 2,000 characters is not read (`text_too_long`, generic «Revisa el chat»). At most 40 items are listed; a reference to an unlisted item ends as `unclear_item`. At most 10 requests per message: the first 10 apply and `too_many_actions` is reported. | Bounds cost and answer size. |
| Cost and time | Average cost ≤ US$0.0015 per message over the seed bank, with no fixed maximum per message. p95 ≤ 6 s from the moment the message starts being read to its decision, excluding the time queued behind earlier messages of the chat, which is reported apart. | Targets measured by the evaluation. |

## Messages that count

| Message | Behavior | Reason |
| --- | --- | --- |
| Outgoing message | Skipped without reading it, no outcome row. Read only as context for later messages. | The seller's own words request nothing. |
| Text that is empty or has no letter or digit (only emoji or punctuation) | Skipped without reading it, no outcome row. | Avoids a paid model call for «👍». |
| Photo, with or without a caption | One message: the photo decides the product, the caption gives variant, quantity, price or «no lo quiero». | WhatsApp delivers the caption inside the photo message. |
| Text | Can add products it names from the active, sellable catalog, remove or change items of the open order, and complete or end pendings. | |
| Message received after the link, whatever its date | Processed and notified, including messages WhatsApp held while the phone was off. | They are live sales the seller has not seen. |

## Decision

Each change a message asks for gets exactly one decision. The decision is pure and reviewable: the same signals give the same decision, without a model. It is evaluated inside the transaction on the locked state.

| Decision | When | What the order shows | Notice |
| --- | --- | --- | --- |
| Applied | High certainty and low risk; or high certainty, high risk and two readings that agree | The change, nothing else | None |
| Applied «Con duda» | A single best reading exists, but certainty is not high, or the change is high risk and the readings do not agree | The change, with the «Con duda» mark and its reason | None |
| «Por resolver» | The buyer asked for a product that cannot be added without their answer (a pending) | Not an item; a point in the order detail and the review | Urgent, once, when the point is created |
| Not applied, urgent | The buyer waits for something only the seller can give, and there is no single best reading | Nothing changes | Urgent notice, with the suggested question when one applies |
| Silent | No purchase intent; pending changes the buyer clearly asked for | Nothing new | None |

Reason: the AI builds and corrects the order alone while it is pending; only a doubt without a single best reading interrupts the seller. Approving change by change was rejected because the seller lives in the chat.

**Certainty is high only when every signal holds:**

1. The justifying words are present for every piece of data.
2. The target is named in the buyer's own words (the product or item), or it is the product a photo in the same message shows. A target taken from context (the only item, the last photo, the product just mentioned) is never high certainty, with one exception: the **photo just sent**.
3. A variant change on an existing item has an explicit change verb («cámbialo», «mejor en»). A text that only names a variant («en talla M», «la quiero en M») is never high certainty for an item.
4. A single candidate in the catalog or the order.

So «la quiero en M», «otro igual», «uno más» and «quítalo» resolved from context are at best «Con duda», even when two readings agree. Two agreeing readings are required on top of the signals for high-risk changes, never a substitute for them. The confirming reading runs for the kinds that can reach high certainty with high risk: remove, change quantity and change variant, and also for any add when the order already has lines, because an add can raise an existing line. An add by reference without a name never reaches high certainty.

| Risk | Changes |
| --- | --- |
| Low | Add a named product that is not yet a line, complete a pending, change a pending's quantity or values, note a mentioned price, «listo» |
| High | Remove an item, lower or set the quantity of an existing item, change a variant, add by reference without a name («otro igual»), any change to an item the buyer did not name, and any increase of a line the order already has (an add of its variant, a quantity «add» on it) |

A mentioned price on an item the message did not name is low risk but its target comes from context, so it is applied «Con duda» with its own reason (the amount and units the buyer mentioned; the order's price did not change), not escalated.

**Photo-then-variant guard:** a text that only names a variant never changes an item that the last photo is not about. If the last incoming photo in the context showed a product that was not identified, was identified but not added (declined, or left nothing), or is a product other than the item the variant would fit, the text completes that photo's pending if there is one; otherwise it is urgent (`variant_only`) with «¿Para qué producto es la talla L?». It may become «Con duda» on an item only when no photo is in the context or the last photo is of that same item. Reason: after a photo that was not added, «en talla L» must not silently change another item.

### Photo just sent

The only context target that counts as named.

| Aspect | Behavior |
| --- | --- |
| What it is | A matched product photo that is the chat's last incoming message read before this one, not itself right after another incoming photo (an album). Outgoing and skipped messages in between (seller replies, «👍») do not break it; any read buyer text in between does. |
| What it covers | Only **set** wording without a product name: «quiero 3 de esos», «pásame 3 de esas», «que sean 3», «mejor 3», also with values. It sets the quantity, up to 99, of what that photo left: its pending, or the item it created or grew. |
| What it does not cover | **Add** wording («2 más de esos», «otros 2», «otro igual», «uno más», «lo mismo x2») stays an unnamed add: at best «Con duda», otherwise urgent. It never applies to another item, even the only one. «Lo mismo x2» adds 2 (a line of 1 becomes ×3). Set wording with no photo just sent («dame 2 de ese», «pásame 2 de esos») on the one line of that product sets it to 2, always «Con duda». |
| Unchanged since | It counts only while what the photo left is as the photo left it: the pending alive and unchanged, or the item at the quantity and variant the photo left, in the same open order. Otherwise the target is plain context: at best «Con duda». |
| No photo just sent | The previous incoming message is a text, a photo that matched nothing, a non-product photo, a product photo that left nothing, a photo right after another photo, or the photo's pending ended or its order stopped being open. |

### Doubt on pendings

Changes to a pending carry no money, so they are low risk; a pending cannot hold an item mark. A change to a pending that is not high certainty, or whose quantity the confirming reading reads differently (another mode or number), is applied to the pending and its «Por resolver» point carries the reason «Con duda: un mensaje cambió la cantidad a 3», which opens the review like a new point; no notice. Example: photo of the «Gorra trucker» without color (pending ×1), then «2 más de esas»: the pending becomes ×3 «Con duda», one notice only («Falta la variante» for the photo). An add that points at a pending changes that pending's quantity as the request words it: set wording sets it («pásame 2 de esos» → ×2, «Con duda»), add wording adds to it, and an add with values completes the pending with them (plus the units it adds), «Con duda» unless the pending is named. An add that states no units and no values never adds a unit: it only completes the pending with what the message says.
**The doubt follows the units to the item:**

| Aspect | Behavior |
| --- | --- |
| Completion | Each item created from a pending that still carries «Con duda» gets the «Con duda» mark with the pending's reason, even when the completing message itself is high certainty. The doubt that another request of the same message leaves on the pending also marks the item created. |
| Split | When a message assigns the pending's units to several items, every item created from it carries the mark; units left as a pending keep the doubt on their point. |
| Never nested | An inherited reason carries the original reason, never another inherited one. |
| The buyer restates the doubted data | When the completing message states the doubted value itself with the same number («en rojo, las 3» after the doubted ×3), that value has its own justifying words and the decision is that message's: no inherited mark. A partial completion states the units it covers, which is not the doubted quantity, so it restates nothing. |
| Acknowledged before | A confirmed review that showed the doubtful point acknowledges its doubt: the item created later carries no mark. It is still a change after the last review, so it opens the next review on a link action. |
| Undo | Undoing the completing message brings the pending back with its doubt. |

### «Con duda» mark

| Aspect | Behavior |
| --- | --- |
| Reason text | Says what the message did in catalog terms, with no articles or gendered words before catalog names: «Un mensaje cambió talla: de L a M» / «Uma mensagem mudou tamanho: de L para M», «Un mensaje cambió la cantidad a 3», «Un mensaje agregó 2», «Un mensaje quitó Gorra trucker». Reason: code holds no gender rules. |
| Quote | The buyer's justifying words, up to 80 characters, phones and addresses masked, read from the message trace while it exists (90 days); afterwards only the reason. |
| Clears when | The seller confirms a review that showed it, edits that item (web or mobile), or undoes the message. A later message changing the same item replaces the mark with its own decision. |
| Removed items | An item removed with a mark shows in the review as «Quitado por un mensaje»; it is restored only by **Deshacer mensaje**. |
| Cancelled order | Marks are not shown and stop counting. |

## Rules

| Topic | Rule | Reason |
| --- | --- | --- |
| Several requests | A message can carry several requests in any mix: «quita la gorra y listo» removes the gorra and marks the order ready. Each is checked and decided on its own; a failed request changes nothing for itself and the rest still applies. A message never applies half of one change. | Buyers write several requests in one message. |
| Add more vs set quantity | The model states which one the buyer means: «uno más del polo» adds 1 (2 → 3); «mejor que sean 3» sets 3. The same message never yields both. | They differ for the same quantity. |
| Numbers inside a product name | A number that is part of a catalog name is not a quantity: «las medias pack x3» adds «Medias deportivas pack x3 · ×1». | The catalog name is the authority. |
| Generic names | «el polo rojo M» with several polos adds the only one that has Rojo in M, because the candidates' variants count. If two or more fit, it is a doubtful-product pending. | Narrows by what exists. |
| Photo with caption | The photo decides the product. The caption gives its variant, quantity and price, or declines it. A caption without letters or digits counts as no caption. A caption naming another product that has an open pending completes that pending; naming another product without a pending adds nothing and reports `not_the_shown_product` (generic «Revisa el chat»). | That product was already identified by an earlier message. |
| Caption the reading cannot use | A caption that reads as no intent is a photo without caption: the shown product is added or left pending, with no mark. A request in the caption that does not speak about the product (a payment request, closing the order, or a remove, decline or quantity aimed at another order line or pending) leaves the shown product added as well, and a caption that declines it still declines. A quantity or variant the caption gives without naming a product, aimed at an order line of another product, is about the shown product: it is added, or, when the order already has a single line of it, applied to that line. For a caption the reading cannot understand, the shown product is still added or left pending. When it is added, the item gets «Con duda: no pudimos leer lo que escribió con la foto» and no notice; when it stays pending, «Falta la variante» notifies. A caption over 2,000 characters is treated the same. | The photo is the request; the doubt lives in the order. |
| Photo that matched nothing | Ends as `not_identified` («Producto no reconocido»), with or without a caption; the caption is not read. | Only the photo's product could be added, and there is none. |
| Photo that is not a product | A payment or transfer screenshot, selfie, map, document or payment QR is no purchase intent: nothing changes, no notice. A caption that only reports a payment keeps it so. A caption that asks for something changes nothing and reports `image_with_request`. | A receipt asks for nothing; a request next to it needs the seller. |
| Product QR codes | A photo shows one item per product: several QR labels of one product count once, with the first label. A caption quantity applies to the shown product. A caption naming another variant adds that variant of the same product keeping the other attributes of the QR variant, if sellable; otherwise «Variante no disponible». The first QR product also feeds the candidates of the resolution. | The QR identifies the product; the caption is what the buyer asks for. |
| Variant | Added only when a single sellable variant fits the known values. Unnamed attributes keep the base values (the QR variant, the item being changed, the pending's known values). A value outside the sellable values, or an attribute name the product does not have, is «Variante no disponible» and the product stays a pending with the other known values. Attributes that still vary leave a pending that misses them. | Product images and names identify a product, not a variant. |
| Several products in one text | «2 polos negros M y una gorra» adds one item per identified variant. What cannot be added is reported; the rest is still added and one notice covers the message. | |
| Quantity | Positive whole number, 1 when not stated («un par» = 2). 0 on an add or completion, a fraction or a negative is `quantity_not_whole` (generic «Revisa el chat»); «mejor que sean 0» is a removal. An item that would end above 99 units does not change and reports `quantity_above_limit`. | Bounds misreadings. |
| Variant already in the order | Quantity grows by the stated quantity. Because the buyer may mean «set» or «only the price», such an add is high risk: it is applied unmarked only when the confirming reading agrees, otherwise «Con duda». | An order holds each variant once. |
| Remove | Applies to an item the message names. «quita uno» lowers the quantity by one; at quantity 1 it removes the item. | |
| Change quantity | «mejor que sean 3» sets the quantity of the item it points to. Removing, lowering or changing the quantity of an item never requires its product to still be sellable. | Items of a product deactivated later keep working. |
| Change variant | Needs an explicit change verb. Replaces the variant at the same quantity, overriding only the attributes the words name, merging with the new variant if already in the order (`Variante no disponible` if not sellable). | |
| References without a name | «ese», «quítalo», «mejor que sean 3», «otro igual», «uno más» are context targets, even when the order has one item: at best «Con duda» when a single product is the best reading, otherwise urgent (`unclear_item`, `unnamed_add`). The only exceptions are set wording on the item the photo just sent left and the line a photo just added. A quote the model gives as the name of a line or pending counts as naming it only when the resolution stage chooses that line's or pending's product for it (it is sent as a mention whose only candidates are that product); «esas», «lo mismo» resolve to nothing and stay context targets. A resolution between several products counts only when exactly one line or pending fits. Code compares no words. A removal, quantity or price on an unnamed line is urgent (`unclear_item`) when two or more lines of the order fit the values the request states, unless a photo added or shows that line; with one fitting line it stays «Con duda». «Ese» or «uno más» pointing at the only item holds only when the order has exactly one line (or the stated values fit exactly one line): with two or more lines it follows this unnamed-line rule (urgent `unclear_item`, `unnamed_add` for an add). An add pointing at the only item raises it «Con duda». Any increase of a line already in the order (an add of its variant, «de la chompa ponme 2», a quantity «add») is high risk: applied only when the confirming reading agrees, otherwise «Con duda». | A sole item does not prove the buyer meant it; marking moves these cases into «Con duda», which the evaluation reads apart. |
| Named targets | A target named in words acts on the order line of the product it resolves to, also when the words fit a few products and exactly one of them is a line of the order. If the product is in no line but in exactly one pending, remove, quantity and decline act on that pending. A quantity for a named product the order does not have is an add of that quantity, «Con duda» when the order already has lines. A price or quantity request of the message about a product the same message adds is part of that add only when exactly one add of the message has that product, the order has no line or pending of that product and the request's values add nothing the add lacks or contradicts; otherwise it acts on its own target or asks. A product the message already adds is never added a second time by a quantity request (it asks). A refusal repeated in one message is one problem. | Words like «el polo» fit several products; the order and the pendings are what the buyer can mean. |
| Variant-only text | With a pending the variant fits, «en talla L» completes it and never changes an item; when it fits several alive pendings and the message does not say which (nor addresses each), it is urgent `variant_for_several_pendings`. Without one, and with the photo guard passed, one item it fits and the variant sold → «Con duda»; several items or the guard not passed → urgent `variant_only`; not sold → urgent as `variant_not_available`. | Pendings are where «en talla M» belongs. |
| Removing the only item | The item stays; the outcome is `only_item_kept` and the seller decides whether to cancel. | The chat never cancels or closes an order. |
| Product not sellable | An add, a pending completion or a variant change to a product deactivated, archived or deleted reports `product_not_available`. | The product left the catalog. |
| No purchase intent | Greetings, thanks, questions about stock, price, sizes, delivery or payment methods, addresses, payment reports and receipts, and declining a product that is not in the order change nothing and send no notice. | |
| Payment request | «¿cómo te pago?», «pásame el link» are urgent, not silent. So is a question of whether the buyer can pay in some way, or where to send the payment. Only a general question about which methods or cards the shop accepts is silent. A product named with a price and nothing else is an add; when the order already has that variant, the price is the line's mentioned price, not another unit. | A buyer ready to pay is a sale. |
| «Confirmo» | A confirmation after the seller listed the order («confirmo así nomás») is «listo». | A confirmation read as small talk leaves the buyer waiting. |
| Intent that cannot be told | When the intent stage cannot say whether the message asks something of the order, nothing changes and the outcome is `reader_doubt` («Revisa el chat»). The same holds for a single request of the message the reader could not read (its quote is not in the message, or no extracted request answers it): that request reports `reader_doubt` and the rest still applies. | No message is lost silently. |
| Requests the chat never does | «cancela mi pedido», «pon el precio en 0», «ya está pagado, márcalo» change nothing and report `request_not_allowed`. | A real buyer asking to cancel needs the seller. |
| Price | New items use the current catalog price; existing items keep theirs. A price the buyer mentions never changes the unit price or the total; it is kept as the item's mentioned price. | The catalog is the only price authority. |
| Mentioned price | Kept as said, in the order's currency: an amount and the units it covers. A price in another currency is dropped; the model is told the currency of the shop's prices (from the company's country) with its name in Spanish and Portuguese from the platform's locale data (PEN: «sol peruano, soles peruanos»), so a price in it («20 soles» in Peru) counts as the order's. A later message about the same item that mentions a price replaces it; one that mentions none leaves it. A variant change keeps it only if that message mentions a price. Removing the item removes it. Display: [orders](orders.md#mentioned-price). | It records what the buyer said, which the seller may have to settle in the chat. |
| Price per unit or for the lot | The model says `unit`, `lot` or `not_explicit`. «a 35 c/u» is per unit and «los 2 por 70» for the lot, and no rule overrides an explicit reading. When not explicit and the quantity is above 1, the reading whose per-unit amount is closer to the variant's catalog price wins. A tie is for the lot. Quantity 1 is per unit. A lot price is never divided and goes whole on the first item of its request. | The catalog is the price authority; closeness is the common sense of «2 en 70». |
| Price helps choose | The resolution sees the price the request states and each candidate's price range. When not explicit, a price helps choose a product only as a per-unit amount. If the per-unit and lot readings point to different candidates and nothing else separates them, it is a doubtful product («Producto no claro») and a pending. | Guessing the wrong product is worse than asking. |
| Stock | Items are added even with zero stock. Creating or growing an order never reserves or deducts stock. | |
| Seller | The user who registered the message; changing items does not change the seller. | |
| Customer and buyer | A customer is created and linked to the contact only when a message creates an order. The chat order always has a buyer with the `contactId` and no name or phone; checkout asks for the phone. | Contacts from mobile WhatsApp arrive without name or phone. |
| What the chat never does | Close, cancel, register payments, deduct stock, generate or send the checkout link, change delivery or prices. | The seller closes the sale. |
| Privacy | Logs and notices never contain the buyer's text, captions, phone numbers, WhatsApp IDs, prompts or model answers. | |

Example: the open order #1023 has «Polo básico · M · ×2 · S/ 35.00». The buyer writes «y una gorra negra y mejor que el polo sea talla L». Result: «Polo básico · L · ×2» and «Gorra · Negro · ×1 · S/ 25.00», total S/ 95.00, no notice.

### Pendings

| Topic | Rule | Reason |
| --- | --- | --- |
| What becomes one | (a) A product identified without its full variant: a photo with no size, «quiero el polo básico», or a variant that does not exist. (b) A product doubtful between several candidates (at most 4). Each carries the attribute names and values already given (catalog values, never the buyer's words), the quantity, the mentioned price and its basis, and its doubt when it has one. | Pendings are structured data, never the raw history. |
| What does not | A photo that matched nothing, a text naming nothing in the catalog, a doubt, a failed removal or change, an unnamed add, a quantity above 99. | They end in their notice. |
| Owner | The chat, within the chat's company. Candidates and products come only from that company's catalog, and only messages of the same chat read or change its pendings. There is no seller action on pendings other than through the chat and the order review. | Company isolation. |
| Storage | One `ChatPendings` row per chat with a validated JSON list (at most 10), `readyRemembered`, the photo memory and the time of the last message read with order intent. | The list is always read and written whole under the chat lock. |
| Notice on creation | Once, urgent: «Falta la variante» for (a), «Producto no claro» for (b), «Variante no disponible» when the named variant does not exist. | The seller learns once that the request is unfinished. |
| Seller view | Each alive pending of the order shows as a «Por resolver» point with what to do and the suggested question ([order-review](order-review.md)). A review acknowledges the points present then; only new points reopen it. | A link must not go out missing a requested product. |
| Completing | A later message that gives what is missing adds the item with the pending's quantity and mentioned price unless the message states others. No notice: silence after the buyer's answer means Yoyos understood it. | The seller already knows the request was unfinished. |
| Units | A message assigns units of a pending: «uno negro M y otro blanco L» on «Polo básico ×2» adds two items and ends it. Units not assigned stay as a pending with the earlier values and no second notice. A message that assigns more units than the pending had uses the message's quantity. A part split off by a partial completion counts toward the limit and keeps the remembered «listo». No unit is ever dropped. | No unit is dropped silently. |
| Partly completing | «en M» on a pending missing Talla and Color keeps it with only Color missing, no notice. A doubtful product resolved to one that still lacks its variant becomes a variant pending, no notice. | |
| Naming it in full | «polo básico negro M» while that polo is pending adds one item, not two, and ends the pending. | |
| Replacing | A new message naming the same product without its variant, or a second photo of it, replaces that pending, keeping what the new message says and the rest of the old one, and never notifies. A message adding a product with several pendings replaces the one whose known values do not conflict, the most recently changed when none fits; when several fit and the values do not say which, it reports `variant_for_several_pendings`. A message identifying one of a doubtful pending's candidates resolves that pending: by the candidate the resolution chose, or by values exactly one candidate sells. A choice made by the resolution is the buyer naming the product; values alone infer it, so that completion is «Con duda». | Replacing refines a known request. |
| Declining | The buyer declines it → it ends, no notice. | |
| Life with an order | A pending joins the first chat order that is open for messages at or after its last change, and ends when that order stops being open for messages. Ended pendings never come back, even if the order reopens. A late «en M» for a pending that ended reports `variant_only` and never adds the item to a new order; the reader sees the pendings that ended in this message as ended refs, so the detail is read as an answer to the gone pending. | A pending lives until its order stops being open. |
| Life without an order | Lasts 7 days from its last change (`CHAT_PENDING_TTL_DAYS`), then ends silently. As soon as the chat has an open order, the pending belongs to that order and the 7 days stop. Completing it with no open order creates the chat order. | Bounds stale completions while keeping next-day answers. |
| Derived, not swept | Whether a pending is alive is derived under the message's lock from stored times (`messageOpenIntervals`, `pendingLife`); order use cases never call into pendings. | The flags that revert cannot say when an order was open. |
| Limit | At most 10 pendings per chat (`maxChatPendings`); an 11th ends the least recently changed other one, silently. | Bounds the context. |
| Product or variant no longer sellable | Checked when a message completes it. Product deactivated, archived or deleted → the pending ends and the message gets «Producto no disponible». Only the chosen variant → «Variante no disponible» and the pending stays. | |

### «Listo»

| Situation | Effect | Notice |
| --- | --- | --- |
| «listo» with items and no pending | The order does not change. | «Pedido #N listo» |
| «quita la gorra y listo» | Removes the gorra. | «Pedido #N listo» |
| «listo» with a pending left after the message | The pending stays; Yoyos remembers the buyer said «listo» (`readyRemembered`). | «Revisa el chat» naming up to three products (`ready_with_pendings`). Any problem of the message wins. |
| A later message completes the last pending, or the buyer declines it with items left | The item is added or the pending ends. | «Pedido #N listo» |
| The buyer declines the last pending and no items remain | The pending ends. | None |
| A message after the remembered «listo» adds a new item or creates a new pending | Applied as usual; the remembered «listo» is dropped. | As usual |
| «listo» with no items and no pending | Nothing changes. | None |
| The last pending ends because its product stopped being sellable | The pending ends. | «Producto no disponible»; no «Pedido #N listo». |

### Open order

Items go to the most recent order of the chat that is still open (`isOpenForMessageItems`). An order is open when all of these hold:

| Condition | Reason |
| --- | --- |
| Its `chatId` is the message's chat. | Manual orders never receive automatic items. |
| Not cancelled and not completed. | |
| No confirmed or reported payment (only voided ones). | Changing items would change a total already covered or reported. |
| Checkout not confirmed. | The buyer already confirmed another total. |
| Delivery `pending` and stock not deducted. | The order was not prepared or dispatched. |

An order with checkout enabled but not confirmed stays open. If its total changes, checkout confirmation detects it under lock and returns `TOTAL_CHANGED`.

When there is no open order, the reason decides what a message does:

| Latest chat order | Add | Remove or change |
| --- | --- | --- |
| None | Creates a chat order. | `no_open_order` |
| Cancelled | Creates a chat order without notice. | `no_open_order` |
| Closed (paid, checkout confirmed or dispatched) | Creates a chat order and reports `new_order_after_closed` («Pedido nuevo #1024»). | `order_closed` |

Item requests resolve against the target as it was before the message: «agrega una gorra y quita el polo» after a closed order creates the new order with the gorra and reports `order_closed` for the removal. Reason: the removal refers to the order the buyer was looking at.

### Outcomes

Each message that was read gets exactly one `ChatMessageOutcome` row (PK company and message) holding a non-empty list of outcomes, validated with a Zod schema on write and read, the suggested questions of its points as structured data, and `noticeSentAt`. The kinds are in `orders/domain/chat-message-outcome.ts`.

| Current outcome | Decision | Suggested question (es) |
| --- | --- | --- |
| Added, removed, quantity changed, variant changed, mentioned price set, pending created/updated/completed/split/ended | Applied, or «Con duda», by the signals and risk | — |
| `no_intent` | Silent | — |
| `ready` | Applied; push «Pedido #N listo» | — |
| `only_item_kept` | Applied; push «Revisa el pedido #N» | — |
| `new_order_after_closed` | Applied; push «Pedido nuevo #N» | — |
| `variant_missing` | «Por resolver», urgent | «Polo básico: ¿en qué talla, S, M o L?» |
| `not_clear` (product between candidates) | «Por resolver», urgent | «¿Cuál de estos quieres: Polo oversize o Polo básico?» |
| `variant_not_available` | «Por resolver», urgent | «Polo básico no viene en XL. ¿En qué talla, S, M o L?» |
| `variant_for_several_pendings` | «Por resolver», urgent | «Talla M: ¿para cuál de estos? Polo básico o Polera.» |
| `ready_with_pendings` | Urgent | The first pending's question |
| `variant_only` | See [Rules](#rules): completes a pending; else «Con duda» on one item it fits; else urgent | «¿Cuál quieres en M: Polera gris o Polo básico?» / «¿Para qué producto es la talla M?» |
| `unnamed_add` | «Con duda» when a single product is the best reading; otherwise urgent | «¿De cuál producto quieres otro?» |
| `unclear_item` | «Con duda» with a single best reading from context; otherwise urgent | «¿Cuál quieres quitar: Gorra trucker o Polo básico?» |
| `not_identified` (photo matched nothing) | Urgent; silent misses while the catalog is not ready stay silent | «¿Me dices el nombre del producto de la foto?» |
| `product_not_available` | Urgent | «Ya no tenemos Casaca jean. ¿Te muestro otra opción?» |
| `payment_requested` | Urgent | None |
| `request_not_allowed`, `order_closed`, `no_open_order`, `image_with_request`, `quantity_above_limit` | Urgent | — |
| `reader_doubt` | Urgent when the intent stage cannot say whether the message asks something of the order | — |
| `invalid_action`: quantity not whole or below zero, text too long, too many requests, not the shown product, `unknown_reference` (a completion names a pending, or a photo answer a product, the reading cannot place) | Urgent, generic «Revisa el chat» | — |
| `failed` | Urgent «No pudimos revisar un mensaje» | — |

An answer of a stage that is still invalid after one in-stage retry is `failed`; products outside the candidates are retried by the stage and then become `not_identified`. There are no `malformed` or `context_too_large` outcomes; a reference the reading cannot place is `invalid_action` with reason `unknown_reference`.

| Decision | Reason |
| --- | --- |
| Outcome and identification certainty are kept per message, not only logged | They make each message apply once and are the data for tuning thresholds. |
| `ChatMessageOutcome` is separate from `OrderMessage`; `OrderMessage` records the messages that changed or created an order, or touched a pending (with the pendings as they were before and after) | `OrderMessage`'s composite FK to `Order` cannot become optional while `companyId` is required; a message that only changed a point must still be undoable and listed. |
| No FK from outcomes or pendings to `Order` | Order IDs inside them are historical references; the notice route checks the order still exists. |
| A `failed` outcome is final and never reprocessed | By then the chat's later messages have applied and the notice was sent. |
| The buyer's text is not copied anywhere new | Outcomes and pendings hold IDs, kinds, catalog names and values only. |

## Suggested questions

One question in the store's voice, in the buyer's language (Portuguese when the buyer writes in Portuguese, else Spanish), naming catalog products and values only. It never claims stock («Polo básico: ¿en qué talla, S, M o L?», not «Tenemos S, M y L»). With more than 3 values for an attribute it names none. Templates use no articles or gendered pronouns: the catalog name goes first. Reason: code holds no gender rules. Questions are stored in the outcome as structured data and rendered by core.

The mobile chat view shows a message's question under it in a box «Pregúntale al cliente:» with **Copiar pregunta**, one box per point (up to 3), every time the chat shows that message, while its point is open. A point with a pending is open while the pending is alive. A point without a pending is open until a later message of the chat is read with order intent, the seller edits, undoes or reviews the order, or the order stops being open for messages. A notice without a question («No pudimos revisar un mensaje», a cancel request) shows no box. The order detail and the review show the same questions to every seller of the company. The question is text for the buyer, so it follows the buyer's language, not the interface's.

## Notices

The notice choice is pure (`chooseSellerNotice`). One message gets at most one notice, and a notice never contains the buyer's text, phone or WhatsApp ID.

1. **Problems** (all urgent): non-silent `not_identified` and `not_clear`, `variant_missing`, `variant_not_available`, `quantity_above_limit`, `unclear_item`, `unnamed_add`, `variant_only`, `image_with_request`, `order_closed`, `no_open_order`, `reader_doubt`, `request_not_allowed`, `invalid_action`, `product_not_available`, `variant_for_several_pendings`, `payment_requested`, `failed`, and `ready_with_pendings`. Exactly one → its own notice. Two or more → «Revisa el chat» naming up to three identified products and counting the rest («Gorra y otra»), carrying the suggested question of the first problem in the message's order.
2. **No problem:** «Pedido #N cambió» (after the link was taken, [order-review](order-review.md#after-the-link-was-taken)), then `only_item_kept` («Revisa el pedido #N»), then `ready` («Pedido #N listo»), then `new_order_after_closed` («Pedido nuevo #N»).
3. When the chosen notice is a problem and the message also created a new order, its body ends with «Se creó el pedido nuevo #N.». When it is a problem and the order changed after the link was taken, its body ends with «El pedido cambió después de enviar el enlace.».
4. Otherwise no notice: successful changes, marks, `no_intent` and every pending change are silent. With notices off, the mark, the point and the question still show the doubt.

Reason for the order: a problem needs the chat before the seller charges, and the chat shows the whole message. The suggested question is appended to the body; the full question lives in the chat view, the order detail and the review, because the system truncates long bodies.

| Case | Title | Opens |
| --- | --- | --- |
| Product not identified (photo or text) | «Producto no reconocido» | Chat, on the message |
| Text matching several products, none certain | «Producto no claro» (names up to three, then «y N más») | Chat, on the message |
| Variant missing | «Falta la variante» («qué talla o color», attribute names in the product's stored attribute order) | Chat, on the message |
| Variant not available | «Variante no disponible» | Chat, on the message |
| Product no longer sellable | «Producto no disponible» («un producto» when it was deleted) | Chat, on the message |
| Quantity above 99, unclear or missing item, unnamed add, variant only, non-product image with a request, change after the order closed, several problems | «Revisa el chat» (the body names the case) | Chat, on the message |
| Intent doubt, a request the chat never does, a quantity that is not whole, a text too long, more than 10 requests, a reference to a pending or item the reading cannot place, a caption naming a product with no pending | «Revisa el chat»: «Un cliente escribió algo sobre el pedido #N que no pudimos aplicar.» (without «sobre el pedido #N» when there is no order) | Chat, on the message |
| Payment request | «Revisa el chat» / «Veja o chat»: open order «Un cliente quiere pagar el pedido #1023.»; no order «Un cliente quiere pagar.»; latest order not open for messages and not cancelled «Un cliente quiere pagar, pero el pedido #1023 ya tiene un pago o está cerrado. Revisa el chat.»; with pendings left, with or without «listo», «Un cliente quiere pagar el pedido #1023, pero falta completar Polo básico.» (up to three names, then «y N más»). It wins over «Pedido #N listo»; a «listo» in that message is still remembered. | Chat, on the message |
| «Listo» with pendings | «Revisa el chat»: «Un cliente dice que terminó el pedido #N, pero falta completar X.» | Chat, on the message |
| A variant that fits two or more pendings | «Revisa el chat»: «…mencionó una variante sin decir de cuál producto: X y Y.» | Chat, on the message |
| Retries exhausted or permanent error | «No pudimos revisar un mensaje» | Chat, on the message |
| Order changed after the link was taken | «Pedido #1023 cambió»: «Un cliente cambió el pedido #1023 después de recibir el enlace. Revísalo antes de cobrar.» (non-urgent) | The order |
| Removing the only item | «Revisa el pedido #N» | The order |
| That's all | «Pedido #N listo» | The order |
| New order after the previous one closed | «Pedido nuevo #N» | The new order |

- Bodies are in `seller-notice-texts.ts`, in Spanish and Brazilian Portuguese (the phone's language). «Un cliente» stands for the buyer until chats have a name.
- Lists in the texts name up to three distinct products joined with «y» / «e», then the rest counted as «y N más» / «e mais N». A doubtful-product pending and a pending whose product was deleted have no name: they are counted.
- Order numbers are resolved from the order the message was applied to; a deleted order or product falls back to a text without its number or name.
- **Silent misses:** a photo miss in a company whose catalog search readiness is not `ready`, and a text miss in a company with no active products, send no notice. The mobile WhatsApp screen shows the catalog hint instead. Reason: in that state visual search never answers, so every photo would notify.
- **Cap:** in production urgent notices stay at or under 10 % of the messages read (target 5–10 %), checked in real use. The eval case sets are built from hard cases and expect about 30 % urgent messages, so their gate is the false urgent share: urgent notices that were not expected stay at or under 10 % of the decided messages, with recall (of the expected urgent cases, how many notified) at 100 %. Precision (of the urgent notices, how many were expected) and the total urgent share are reported, not gated (founder, 2026-11-01). «Pedido #N cambió», «listo», «Pedido nuevo» and «Revisa el pedido» are counted apart.

## Order of processing and failures

| Topic | Rule | Reason |
| --- | --- | --- |
| Order per chat | Messages of one chat apply one at a time, in the order they reached core (queue `apply-chat-message`, ordering key = core chat ID). A message waiting for a retry holds back the later messages of its chat; other chats do not wait. | Each message is read against the order and pendings the previous ones left. |
| Fairness | At most 8 messages of one company run at once per worker process, out of 16 slots (`APPLY_CHAT_MESSAGE_CONCURRENCY`). | One company's live sale never takes more than half of a worker ([event-bus](event-bus.md)). |
| Each message once | The outcome row's primary key makes a repeated event, a resend or a reprocess end as `already_processed`, with no change and no second notice. | Resends and reprocessing are normal. |
| Temporary failures | Persistence, image storage, QR reader, embedder, product matcher and AI provider unavailability, a stage running out of its time budget, and the attempt deadline, are retried: 8 retries from 5 s, exponential, capped at 100 s. | A temporary failure never loses a message. |
| Time bound | Each attempt ends by an 85 s deadline; pg-boss expires it at 90 s and detects expiry or a lost heartbeat (30 s) within 10 s. A job spends at most about 25 minutes from its first attempt to its last (excluding queue time). | The seller learns of a stuck message in bounded time. |
| Candidate search timeout | A catalog search over its 1 s budget is not an error: every mention of the message becomes `not_identified` (urgent) instead of retrying. | Retrying would hold the chat's queue for an input that is slow every time. |
| Permanent errors | Invalid stored data, a missing message, contact or seller, a currency mismatch, an invalid order, and stage answers still invalid after the in-stage retry record a `failed` outcome, publish the notice and complete the job. | They would repeat on every paid attempt. |
| Releasing a chat | A job that ends `failed` goes to `apply-chat-message-dead-letter`, which records `failed` (`RETRIES_EXHAUSTED`) unless an outcome exists, publishes the notice if due and unsent, and then deletes the source job, which releases the chat. | A `failed` job blocks its chat's key until deleted. |
| Notice publication | If publishing `chat_message_processed` fails after the commit, the job completes and the notice is lost (logged). A crash between commit and publication is recovered by the re-run, which finds the outcome with an unsent notice due. | The order change stands and the chat never waits for a notice. |
| Trace | A trace that cannot be saved is counted and never blocks the order. | The order is the product; the trace is evidence. |
| Without an AI key | Without `OPENAI_API_KEY` and without a configured fake, the reader is disabled: a photo follows the fixed answer, a caption is ignored, and texts are skipped (`reader_disabled`, no row). | Development and tests run without paid providers. |
| Cost | Every text with letters or digits and every photo with a readable caption costs the stages' calls; a retry repeats every paid stage. A photo without caption costs none. | |

## Consistency

- Image reading, the catalog search and every model call run outside the transaction. Inside it, the contact is locked first (without creating a customer), the outcome is re-checked, then the open order and the chat's pendings are locked and re-checked, `pendingLife` is evaluated, and the decision is taken on that locked state. No model call and no reading or candidate query runs under the lock.
- Item references are re-checked against the locked order: a variant that left the order meanwhile reports `unclear_item`. A pending a request referenced that ended under the lock is checked as if there were none.
- A message applies to the order as it is when it is applied. If the order closed meanwhile, the closed-order rules apply and its pendings have already ended.
- The order, the pendings, the outcome, the `OrderMessage` row and the item change rows change together or not at all.
- No unique index enforces "one open order per chat": the locks guarantee it. If an older order's payment is voided, the chat can have two open orders; the most recent one is used.
- Publication of `message_created` is retried only by mobile resending `POST /api/messages` with the same identity. Rejected: a periodic republisher (needs cross-company access) and enqueueing the job inside the message transaction (the event bus port exposes no transactions).

## Known limitations

- Two items of the same product with close labels («Polo · M» and «Polo · L») can still be chosen wrongly with high confidence.
- A message that reaches core out of chat order (a photo whose upload was retried after a later text) is applied in the order received.
- After a pending ended, a late «en M» gets the variant-only text although the buyer is answering about the ended pending.
- The catalog search scans the company's products (the trigram index cannot serve the app role under forced RLS, because the pg_trgm operators are not leakproof). Its cost is bounded per statement ([message-reader](message-reader.md#catalog-search)); above about 33,000 active products the three-word floor exceeds the budget and only the 1 s timeout bounds it.
- Mobile cannot add products or change variants; those stay on the web order view.
- Not handled: audio, video, documents, stickers, view-once images, reactions, edited or deleted messages, group chats, several products in one photo found by visual search, and replying to the buyer.

## Operation

- Log events: see [message-reader](message-reader.md#observability); the queue events `orders_chat_message_applied`, `orders_chat_message_skipped`, `orders_chat_message_retry_scheduled`, `orders_chat_message_failed`, `orders_chat_message_notice_publish_failed` and `orders_chat_queue_blocked` carry company, message, event, chat and order IDs, outcome kinds and codes. The core chat ID is logged because it is the queue key and not personal data.
- Settings (`apps/core/.env.example`): the reader's stage, budget and context variables ([message-reader](message-reader.md#configuration)), `CHAT_PENDING_TTL_DAYS` and `APPLY_CHAT_MESSAGE_CONCURRENCY`. The item quantity limit (99) and the pending limit (10) are domain constants.
- A chat held by a `failed` job raises `orders_chat_queue_blocked`; the runbook is in [event-bus](event-bus.md#blocked-keys).
- To reprocess a job, retry it in pg-boss; resending the message does not work because the event is already marked as dispatched. A message with a `failed` outcome is not applied again.

```sql
SELECT id, singleton_key, data->'metadata'->>'eventId' AS message_id, output->>'message', completed_on
FROM pgboss.job
WHERE name = 'apply-chat-message' AND state = 'failed';
```

- The queue `add-message-products-to-order` has no handler. Its pg-boss queue and any jobs in it are dropped by hand on environments that still have it. `message_created` jobs whose payload lacks `chatId` fail permanently as invalid stored data and go to the dead-letter queue.

## Evaluation

`apps/core/evals` measures the reading with the real models; how to run it, the cases and the report are in its README, and the conventions in [testing-conventions](testing-conventions.md#ai-evals).

| Aspect | Behavior |
| --- | --- |
| Sources | A committed seed bank (the failure families: confirmations and payment questions read as no intent, quantities after a photo, mentioned prices not noted, «la quiero en M» changing the variant silently), people playing buyers with loose scripts, and seller verdicts as labels (without text). There are no real buyer chats as a source. |
| Runs | Every evaluation runs 3 times (`EVAL_REPEATS`) and reports mean and range per metric. A change counts as better only if its range does not overlap the previous one. |
| Metrics per stage | Intent correct; each extracted field correct; right product among the candidates; decision correct; silent wrong changes; ignored requests; urgent share with precision and recall, and the false urgent share that gates the evals; «Pedido #N cambió» count; cost per message (mean); time (p95, without queue wait). |
| Silent wrong change | A change applied without a «Con duda» mark or notice that differs from the expected order. |
| Ignored request | A request with no change, no mark, no «Por resolver» point and no notice. |
| Frozen holdout | Built outside the repository by an agent that never touches prompts and loaded from `EVAL_PRIVATE_DIR`. Run only to close a phase. Its texts are never published, in the repository, pull requests, Todoist or reports: only ids and failure types. |
| Regression | Dev, frozen test and earlier holdouts stay as regression, not as the goal. |
| Prompt examples | Never copy evaluation inputs. |
| Paid runs | A run that calls models needs `EVAL_PAID=1` and prints an estimate first; each paid step is approved by the founder separately. |
| Cancel-and-recreate | Measured after switch-on as cancelled WhatsApp orders followed by a new order in the same chat within 24 hours. |

The suites run the production staged `applyChatMessage` and score each stage from the `MessageTrace` it builds: the trace is kept in memory for the running case and stored nowhere. The intent, extracted fields and chosen product come from the primary readings of the trace; the decision is the most severe decision kind of the trace (the notice, when one was sent); stage cost sums every call, confirming readings and the photo cascade included; reading time runs from the start of the reading to the decision, with no queue wait. A message with no reading (too long, photo without caption) is scored from its outcomes. Cases without stage labels are relabelled from their notice and outcomes, and the fake mode builds the same stage answers from scripted stages, so the stage metrics and the final outcome of a run come from one run.

## Display

Orders from chats have `source: "whatsapp"`. Core web and mobile show a WhatsApp icon labelled "WhatsApp" and no link to the chat. The buyer is shown as name, else phone; "Público general" is reserved for orders without a buyer. Items changed by messages show like any item, with the «Con duda» mark and the «Cambios por mensajes» block described in [order-review](order-review.md); pendings show as «Por resolver» points; the mentioned price note is described in [orders](orders.md#mentioned-price).
