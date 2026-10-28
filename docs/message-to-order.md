# Message to order

Every incoming photo or text of an individual chat updates that chat's open order the way the seller would: it adds the product named or shown, with the variant and quantity the buyer stated, or removes or changes the item the buyer refers to. When a message asks for something Yoyos cannot apply, nothing changes and the seller gets a notice on the phone that received the message ([notifications](notifications.md)). The seller still closes the sale: they review the order and send the checkout link themselves.

Sources of truth:

- Use case: `apps/core/src/features/orders/application/apply-chat-message.ts`; handler and dead-letter handler: `chat-message-handler.ts`; queue policy: `chat-message-policy.ts`.
- Tools offered to the models: `apps/core/src/features/orders/application/chat-message-tools.ts` (photos) and `chat-text-tools.ts` (texts).
- Order transitions and outcomes (pure): `apps/core/src/features/orders/domain/chat-order.ts`, `chat-message-outcome.ts`, `mentioned-price.ts`; open-order rule: `message-order.ts`.
- Notice choice: `apps/core/src/features/orders/domain/seller-notice.ts`; texts (es, pt-BR): `orders/presentation/seller-notice-texts.ts`.
- Contracts: `shared/contracts/whatsapp-messages.ts`, `shared/contracts/orders.ts` (`mentionedPrice`), `shared/contracts/seller-notices.ts`.

```text
Customer 1 ── * Contact 1 ── 1 Chat 1 ── * ChatMessage 1 ── 0..1 ChatMessageOutcome (every message read)
    │                           │                │
    └──────────── * Order ──────┘ (chatId)       └── OrderMessage (messages that changed or created an order)
```

## Vocabulary

- **Chat order:** the chat's open order, which messages update. Interface: «Pedido #1023» with the WhatsApp mark. There is no other per-conversation state.
- **Identification:** deciding which catalog product a photo or text refers to, with a certainty ([image-product-search](image-product-search.md)).
- **Interpretation:** deciding what the message asks to do with the chat order, and the variant, quantity and mentioned price ([ai-tools](ai-tools.md)).
- **Outcome:** what a message did or why it could not be applied, kept per message in `ChatMessageOutcome`.
- **Notice:** what the seller's phone shows when a message needs them. Interface: «aviso».
- **Mentioned price:** the amount a buyer wrote for an item and how many units it covers. It never changes the unit price.

## Flow

1. Mobile registers each message with `POST /api/messages` ([whatsapp](whatsapp.md)). After the commit, core publishes `message_created` (`{ companyId, chatId, messageId }`, event ID = message ID).
2. The `apply-chat-message` job reads the message and a summary of the chat's open order (items, variants, quantities, unit prices, currency). Earlier messages are never read.
3. **Identification**, for a photo: the image cascade says whether it shows a catalog product, a non-product, or a product it could not match. For a text, identification runs inside the tools that name products.
4. **Interpretation** decides what the message asks for: add, remove, change quantity or variant, set a mentioned price, «that's all», or nothing. A photo without a caption asks to add what it shows and calls no interpretation model.
5. The resolved actions are applied to the chat order in one transaction, and the message's outcomes are recorded.
6. After the commit, if the outcomes call for a notice, core publishes `chat_message_processed` and the notifications feature sends it.

```text
message_created ─▶ apply-chat-message (ordered per chat)
                    ├─ products: identify photo / text, resolve variant          (outside the transaction)
                    ├─ ai-tools: choose tools and arguments, resolve to actions   (outside the transaction)
                    └─ transaction: lock Contact → lock Order → apply actions → save → ChatMessageOutcome
                 ─▶ chat_message_processed (only when a notice is due) ─▶ send-chat-message-notice
apply-chat-message-dead-letter: record failed → publish notice → release the chat
```

### What the models are offered

How the tools are offered changes how sure the models are, never what a rule allows ([ai-tools](ai-tools.md)).

- Tools follow the message kind (photo of a product, photo of something else, text). The item tools (remove, quantity, variant, mentioned price) are offered only when the open order has items; otherwise one report takes their place and the order domain reports `no_open_order` or `order_closed`. An item tool fits «quiero 3 mochilas» almost as well as adding does, and every offered tool spreads the Decision's confidence.
- A variant text with items in the order is one tool, not two: offering both the change and the `variant_only` report split the Decision's confidence under the gate on texts like «only a size», which then ended silently as `ambiguous_intent`. The change tool's extra question (explicit change request or only a variant named) carries the founder rule instead.
- Each item tool asks its own item question. With a single item that item is offered, described as named or not, and `unnamed` is not asked: both fit a reference without a name («bórralo»), and the split certainty fell under 0.8. A second, ungated question (named or unnamed) only records whether the message named the item, so the outcome's `namedItem` stays faithful. With two or more items `unnamed` and `ambiguous` are offered and an unnamed reference stays `unclear_item`.
- The models name the currency they read (not named, a currency code, or another one); the tool keeps a price only when no currency is named or it is the item's. Quantity idioms are spelled out in the argument descriptions (a pair is 2, half a dozen 6, a dozen 12; a price «c/u» is for one unit).
- A stated price helps text identification as a per-unit amount: the chooser reads the words with «the one at N per unit» and sees which candidates have that price. A currency the buyer names travels with the hint, also without an open order, and only candidates in that currency are compared; a currency other than the open order's gives no hint. A lower price may be an offer and never rejects the only product named.
- Examples in the prompts never copy eval inputs (`apps/core/evals/cases`): they use other products, colors and wording, so the eval measures the rule and not the memorized text. A unit test enforces it (`evals/lib/prompt-overlap.test.ts`): every «…» quote and parenthesised example in the files whose text reaches a model is compared with every eval input by its words (numbers masked), shared three-word runs and character similarity.

## Messages that count

| Message | Behavior | Reason |
| --- | --- | --- |
| Outgoing message | Skipped without reading it, no outcome row. | The seller's own words have no rule yet. |
| Text that is empty or has no letter or digit (only emoji or punctuation) | Skipped without reading it, no outcome row. | Avoids a paid model call for «👍». |
| Photo, with or without a caption | One message: the photo decides the product, the caption gives variant, quantity, price or «no lo quiero». | WhatsApp delivers the caption inside the photo message; nothing waits for a second message. |
| Text | Can add products it names from the active, sellable catalog, and remove or change items of the open order. | — |
| Message received after the link, whatever its date | Processed and notified, including messages WhatsApp held while the phone was off. | They are live sales the seller has not seen. |

## Rules

| Topic | Rule | Reason |
| --- | --- | --- |
| Context | The message itself (photo and caption together) plus the items of the chat's open order. Earlier messages are never read, so a photo without size followed by «en talla M» in another message ends as «Falta la variante». | Founder decision: the history is not agent memory. |
| Photo with caption | The photo decides the product. A caption naming another product never adds it. A caption without letters or digits counts as no caption. A caption the models cannot place with enough confidence adds the shown product, as a photo without caption does; only an explicit decline («no lo quiero») keeps it out. | With a photo, only the photo's product can be added. |
| Photo that matched nothing | Ends as `not_identified` («Producto no reconocido»), with or without a caption; the caption is not interpreted. | Only the photo's product could be added, and there is none. |
| Photo that is not a product | A payment or transfer screenshot, selfie, map, document or payment QR is no purchase intent: nothing changes, no notice. A caption that only reports a payment keeps it so. A caption that asks for something («y agrégame una gorra negra») adds nothing and reports `image_with_request`. | A receipt asks for nothing; requirement 3 is about a product that was asked for and not found. |
| Several product QR codes in one photo | One item per variant, quantity 1 each. A caption quantity applies only when it says it is for each («2 de cada uno»). | — |
| Product QR with a caption naming another variant | «en talla L» on a photo of the M label adds the L variant of the same product, keeping the other attributes of the QR variant (the color), if sellable; otherwise «Variante no disponible». | The QR identifies the product; the caption is what the buyer asks for. |
| Enough certainty | A product is added only at an identification certainty of at least 0.8 (`PRODUCT_MATCH_MIN_CONFIDENCE`, shared by photos and texts). Below it, or with no candidate → «Producto no reconocido»; a text matching two or more likely products with none above the threshold → «Producto no claro». | Founder decision: low certainty adds nothing and notifies the seller. |
| Variant | Added only when a single sellable variant fits: the product has one, or the words name exactly one. Words name only some attributes: the rest come from the item being changed or the QR variant, and an attribute with a single sellable value is filled in. The variant chooser model decides which sellable variant the words name, given the product's sellable variants and that base variant as catalog data ([image-product-search](image-product-search.md#variant-resolution)); code holds no word lists and only accepts a sellable variant chosen at 0.8 or more. No attribute given → «Falta la variante». Words that match no sellable variant → «Variante no disponible». | Product images and names identify a product, not a variant. |
| Several products in one text | «2 polos negros M y una gorra» adds one item per identified variant. What cannot be added is reported; the rest is still added and one notice covers the message. | — |
| Quantity | Positive whole number, 1 when not stated («un par» = 2, «media docena» = 6). An item that would end above 99 units (including 98 already in the order + 2) does not change and reports `quantity_above_limit`. | Bounds misreadings; initial value, adjustable. |
| Variant already in the order | Quantity grows by the interpreted quantity. | An order holds each variant once. |
| Remove | Applies only to an item the message names without doubt, or to the only item. «quita uno» lowers the quantity by one; at quantity 1 it removes the item. | — |
| Change quantity | «mejor que sean 3» sets the quantity of the item it points to. 0 is a removal. | — |
| Change variant | Needs an explicit change verb («cámbialo a talla L», «mejor en talla L»). Replaces the variant at the same quantity, overriding only the attributes the words name and keeping the item's others («cámbialo a talla L» on «Polo · M · Negro» gives «Polo · L · Negro»; «Variante no disponible» if that combination is not sellable), merging with the new variant if already in the order. A text that only names a variant («en talla L», «negro») never changes an item, whatever the number of items, and reports `variant_only`. How it is decided: with items in the order, a text that gives a variant for an item goes to the change tool, whose Decision request also asks whether the buyer explicitly asks for the change or only names the variant; anything but «explicitly asks» at 0.8 or more runs the `variant_only` report instead (`chat-message-interpreter.ts`, `variantOnlyRule`), so no word list decides it. Without items the report is offered directly. | Founder decision: after a photo that was not added, «en talla L» must not silently change another item. |
| References without a name | «ese», «quítalo», «mejor que sean 3», «el último» apply only when the order has exactly one item, and only to remove or change it. An unnamed add («otro igual», «dame 2 de ese») never applies (`unnamed_add`). With two or more items any unnamed reference reports `unclear_item`. | Items have no order, so "the last one" has no meaning, and the message before may not have been applied. |
| Item chosen by the model | The item of a removal or change is accepted only at a certainty of at least 0.8; otherwise `unclear_item` and nothing changes. | No change applies to an item without that certainty. |
| Removing the only item | The item stays; the outcome is `only_item_kept` and the seller decides whether to cancel. | The chat never cancels or closes an order. |
| That's all | «listo», «eso es todo», «confirmo» record `ready` only when the open order has at least one item; otherwise no purchase intent. The order does not change. | It is the moment the seller needs to act; a notice is the only effect that keeps the chat from closing the order. |
| No purchase intent | Greetings, questions about availability or price, addresses, thanks, payment reports change nothing and send no notice. A message whose action the models cannot decide with enough confidence (`MESSAGE_ACTION_MIN_CONFIDENCE`) records `ambiguous_intent`, also without notice, unless a report that changes nothing (variant only, unnamed add, no open order, image with a request) is clearly the only fitting tool by its own predicate ([ai-tools](ai-tools.md#orchestration)): then that report and its notice apply. | — |
| Price | New items use the current catalog price; existing items keep theirs. A price the buyer mentions never changes the unit price or the total; it helps choose the product («el polo de 35») and is kept as the item's mentioned price. | The catalog is the only price authority, and the buyer is the interested party. |
| Mentioned price | Kept as said, in the order's currency: an amount and the units it covers («los 3 por 50» is S/ 50.00 for 3, never 16.67 per unit). A price in another currency is dropped. A later message about the same item that mentions a price replaces it; one that mentions none leaves it. A variant change keeps it only if that message mentions a price. Removing the item removes it. | It records what the buyer said, which the seller may have to settle in the chat. |
| Stock | Items are added even with zero stock. | Creating or growing an order never reserves or deducts stock. |
| Seller | The user who registered the message; changing items does not change the seller. | — |
| Customer | A customer is created and linked to the contact only when a message creates an order; a message that creates no order («hola») creates none. | Contacts from mobile WhatsApp arrive without name or phone. |
| Buyer | The chat order always has a buyer with the `contactId` and no name or phone; checkout asks for the phone. | — |
| What the chat never does | Close, cancel, register payments, deduct stock, generate or send the checkout link, change delivery or prices. | Founder decision: the seller closes the sale. Model output can only reach the actions above, on its own chat's open order. |
| Privacy | Logs and notices never contain the buyer's text, captions, phone numbers, WhatsApp IDs, prompts or model responses. | — |

Example: the open order #1023 has «Polo básico · M · ×2 · S/ 35.00». The buyer writes «y una gorra negra y mejor que el polo sea talla L». Result: «Polo básico · L · ×2» and «Gorra · Negro · ×1 · S/ 25.00», total S/ 95.00, no notice.

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

Each message that was read gets exactly one `ChatMessageOutcome` row (PK company and message) holding a non-empty list of outcomes, validated with a Zod schema on write and read, and `noticeSentAt`. The kinds and their fields are in `orders/domain/chat-message-outcome.ts`: added, removed, quantity lowered or changed, variant changed, mentioned price set, ready, only item kept, order closed, no intent, ambiguous intent, variant only, unnamed add, image with a request, no open order, not identified, not clear, variant missing, variant not available, quantity above limit, unclear item, new order after closed, failed. They keep, when known, the identified product, the identification method (QR, visual or text) and its certainty, and whether a removal or change named its item.

| Decision | Reason |
| --- | --- |
| Outcome and identification certainty are kept per message, not only logged | They make each message apply once and are the data for showing how each item was identified and for tuning thresholds. |
| `ChatMessageOutcome` is separate from `OrderMessage`; `OrderMessage` still records only messages that changed or created an order | `OrderMessage`'s composite FK to `Order` cannot become optional while `companyId` is required. |
| No FK from outcomes to `Order` | Order IDs inside outcomes are historical references; the notice route checks the order still exists. |
| A `failed` outcome is final and never reprocessed | By then the chat's later messages have applied and the notice was sent. |
| The buyer's text is not copied anywhere new | Outcomes hold IDs, kinds and certainties only. |

## Notices

The notice choice is pure (`chooseSellerNotice`). One message gets at most one notice:

1. **Problems** are the outcomes that need the chat: non-silent `not_identified` and `not_clear`, `variant_missing`, `variant_not_available`, `quantity_above_limit`, `unclear_item`, `unnamed_add`, `variant_only`, `image_with_request`, `order_closed`, `no_open_order`, `failed`. Exactly one → its own notice. Two or more → «Revisa el chat» naming up to three identified products and counting the rest («Gorra y otra»). What could be applied is applied.
2. **No problem:** `only_item_kept` («Revisa el pedido #N»), then `ready` («Pedido #N listo»), then `new_order_after_closed` («Pedido nuevo #N»).
3. When the chosen notice is a problem and the message also created a new order, its body ends with «Se creó el pedido nuevo #N.», so the seller does not act on the closed order.
4. Otherwise no notice: successful changes, `no_intent` and `ambiguous_intent` are silent.

Reason for the order: a problem needs the chat before the seller charges, and the chat shows the whole message.

| Case | Title | Opens |
| --- | --- | --- |
| Product not identified (photo or text) | «Producto no reconocido» | Chat, on the message |
| Text matching several products, none certain | «Producto no claro» (names up to three, then «y N más») | Chat, on the message |
| Variant missing | «Falta la variante» («qué talla o color», attribute names in the product's stored attribute order; «qué variante» when variants have no attributes) | Chat, on the message |
| Variant not available | «Variante no disponible» | Chat, on the message |
| Quantity above 99, unclear or missing item, unnamed add, variant only, non-product image with a request, change after the order closed, several problems | «Revisa el chat» (the body names the case) | Chat, on the message |
| Retries exhausted or permanent error | «No pudimos revisar un mensaje» | Chat, on the message |
| Removing the only item | «Revisa el pedido #N» | The order |
| That's all | «Pedido #N listo» | The order |
| New order after the previous one closed | «Pedido nuevo #N» | The new order |

- Bodies are in `seller-notice-texts.ts`, in Spanish and Brazilian Portuguese (the phone's language, as the app interface). «Un cliente» stands for the buyer until chats have a name.
- A notice never contains the buyer's text, phone or WhatsApp ID; it may name a catalog product and an order number. Order numbers are resolved from the order the message was applied to, not from the chat's current order; a deleted order or product falls back to a text without its number or name.
- Amounts use the same money format as the order's unit prices.
- Distinct titles for each «Revisa el chat» case were rejected: the title carries the action and the body names the case.
- **Silent misses:** a photo miss in a company whose catalog search readiness is not `ready` (no active products, visual search off, or no active product image indexed yet), and a text miss in a company with no active products, send no notice. The mobile WhatsApp screen shows the catalog hint instead. Reason: in that state visual search never answers, so every photo would notify.

## Order of processing and failures

| Topic | Rule | Reason |
| --- | --- | --- |
| Order per chat | Messages of one chat apply one at a time, in the order they reached core (queue `apply-chat-message`, ordering key = core chat ID). A message waiting for a retry holds back the later messages of its chat; other chats do not wait. | Each message is read against the order the previous ones left. |
| Fairness | At most 8 messages of one company run at once per worker process, out of 16 slots (`APPLY_CHAT_MESSAGE_CONCURRENCY`). | One company's live sale never takes more than half of a worker. Group concurrency is exact per worker process, not shared across replicas ([event-bus](event-bus.md)). |
| Each message once | The outcome row's primary key makes a repeated event, a resend or a reprocess end as `already_processed`, with no change and no second notice. | Resends and reprocessing are normal. |
| Temporary failures | Persistence, image storage, QR reader, embedder, product matcher and AI provider unavailability, and the attempt deadline, are retried: 8 retries from 5 s, exponential, capped at 100 s. | Founder decision: a temporary failure never loses a message. |
| Time bound | Each attempt ends by an 85 s deadline; pg-boss expires it at 90 s and detects expiry or a lost heartbeat (30 s) within 10 s. A job spends at most about 25 minutes from its first attempt to its last (excluding time queued behind earlier messages of its chat or waiting for a free slot). | The seller learns of a stuck message in bounded time. The model calls of interpretation and text identification honor the deadline; the image cascade is bounded by the chooser timeout (`PRODUCT_MATCH_TIMEOUT_MS`) and by job expiry, not by the deadline signal. |
| Permanent errors | Invalid stored data, a missing message, contact or seller, a currency mismatch, an invalid order, and invalid model or matcher responses record a `failed` outcome, publish the notice and complete the job. | They would repeat on every paid attempt. |
| Releasing a chat | A job that ends `failed` (retries exhausted, last attempt expired, worker crashed) goes to `apply-chat-message-dead-letter`, which records `failed` (`RETRIES_EXHAUSTED`) unless an outcome exists, publishes the notice if it is due and unsent, and then deletes the source job, which releases the chat. | A `failed` job blocks its chat's key until deleted. |
| Notice publication | If publishing `chat_message_processed` fails after the commit, the job completes and the notice is lost (logged). A crash between commit and publication is recovered by the re-run, which finds the outcome with an unsent notice due and publishes it. | The notice is a secondary effect; the order change stands and the chat never waits for a notice. |
| Without an AI key | Without `OPENAI_API_KEY`, interpretation is disabled: a photo without caption follows the deterministic add path, a caption is ignored, and texts are skipped (`interpretation_disabled`, no row). | Development and tests run without paid providers. |
| Cost | Every text with letters or digits costs at least one Decision request; a retry repeats every paid stage. | — |

## Consistency

- Image reading, identification and every model call run outside the transaction. Inside it, the contact is locked first (without creating a customer), the outcome is re-checked, then the open order is locked (`findOrderForUpdate`) and re-checked with `isOpenForMessageItems`. Reason: locking the contact serializes the messages of one chat even if two jobs of one key overlap, so two concurrent messages create one customer and one order; locking the order serializes against payments, delivery, stock, cancellation and checkout.
- Item references are re-checked against the locked order: a variant that left the order meanwhile reports `unclear_item`.
- A message applies to the order as it is when it is applied. If the order closed meanwhile, the closed-order rules apply.
- No unique index enforces "one open order per chat": openness depends on payments and checkout in other tables, so the locks guarantee it. If an older order's payment is voided, the chat can have two open orders; the most recent one is used.
- Publication of `message_created` is retried only by mobile resending `POST /api/messages` with the same identity. Rejected alternatives: a periodic republisher (needs cross-company access to RLS-protected messages and a scheduler) and enqueueing the job inside the message transaction (the event bus port exposes no transactions).

## Known limitations

- No operation edits the items of an existing order from web or mobile. A wrong item added by a message, or one a message failed to add, can only be fixed by cancelling the order.
- A misread removal or change («no me gusta ese color, ¿tienes otro?» read as a removal) applies silently; the order keeps no per-item trace of what each message changed.
- Two items of the same product with close labels («Polo · M» and «Polo · L») can still be chosen wrongly with high confidence.
- A message that reaches core out of chat order (a photo whose upload was retried after a later text) is applied in the order received: «quita la gorra» before the photo of the gorra reports «Revisa el chat», then the photo adds it.
- Not handled: audio, video, documents, stickers, view-once images, reactions, edited or deleted messages, group chats, several products in one photo found by visual search, and replying to the buyer.

## Operation

- Log events: `orders_chat_message_applied`, `orders_chat_message_skipped`, `orders_chat_message_retry_scheduled`, `orders_chat_message_failed` (`source`: permanent or dead letter), `orders_chat_message_notice_publish_failed` and `orders_chat_queue_blocked`, with company, message, event, chat and order IDs, outcome kinds, tools and codes. The core chat ID is logged because it is the queue key and not personal data.
- A chat held by a `failed` job raises `orders_chat_queue_blocked`; the runbook is in [event-bus](event-bus.md#blocked-keys).
- To reprocess a job, retry it in pg-boss; resending the message does not work because the event is already marked as dispatched. Reprocessing is safe because of `ChatMessageOutcome`, but a late reprocess may land in a different open order. A message with a `failed` outcome is not applied again.

```sql
SELECT id, singleton_key, data->'metadata'->>'eventId' AS message_id, output->>'message', completed_on
FROM pgboss.job
WHERE name = 'apply-chat-message' AND state = 'failed';
```

- The queue `add-message-products-to-order` has no handler. Its pg-boss queue and any jobs in it are dropped by hand on environments that still have it. `message_created` jobs whose payload lacks `chatId` fail permanently as invalid stored data and go to the dead-letter queue.

## Display

Orders from chats have `source: "whatsapp"`. Core web and mobile show a WhatsApp icon labelled "WhatsApp" and no link to the chat. The buyer is shown as name, else phone; "Público general" is reserved for orders without a buyer. Items changed by messages show like any item; the mentioned price note is described in [orders](orders.md#mentioned-price).
