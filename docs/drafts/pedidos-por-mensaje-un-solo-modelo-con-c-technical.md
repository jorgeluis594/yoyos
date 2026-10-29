# Message to order with one reader and chat pendings: technical design

**Status:** design closed, pending implementation. The questions were decided by the architecture review gate and the candidate-search cost by the founder (§16); the founder confirms them in the final pull request. Based on `docs/drafts/pedidos-por-mensaje-un-solo-modelo-con-c.md` (commit `1394e184`). Base: `jorgeluis594/pedidos-por-mensaje-un-solo-modelo-con-c` at `1394e184`.

## 1. Technical goal

Each incoming chat message that needs reading is read by one model call (the reader). The reader receives the message, the chat's open order, the chat's pendings and the catalog products involved with every sellable variant and attribute value, and returns a list of structured actions, `no_intent` or `doubt`. A pure domain check turns that answer into resolved actions against the catalog and the order, and one transaction applies them to the chat order and to the chat's pendings, records the message outcome and leaves the notice to the existing `chat_message_processed` flow. The Decision API orchestration (`src/shared/ai-tools/`), the chat tool registry, the text product chooser and the variant chooser are deleted. The eval harness gains conversation cases, notice-based scoring, the acceptance-gate report and run-time loading of a private catalog and private cases.

```text
message_created ─▶ apply-chat-message (ordered per chat)
   ├─ products: photo cascade (QR, visual 0.8)                               outside the transaction
   ├─ context: chat order target, chat pendings, chat orders opened since (only with orderless pendings), all unlocked
   │           → pendingLife; products for reading (shown + pendings' + items' + candidates), ceiling applied
   ├─ reader: one Responses API call, fixed schema → ReaderAnswer            outside the transaction (photo without caption: none)
   ├─ domain: checkReaderAnswer(answer, context) → ResolvedChatAction[]      pure
   └─ transaction: lock Contact → outcome re-check → lock Order target → orders opened since (only when needed)
                   → lock ChatPendings → pendingLife → applyChatActions(target, pendings, actions)
                   → save order, pendings (only when changed), OrderMessage, ChatMessageOutcome
─▶ chat_message_processed (only when a notice is due) ─▶ send-chat-message-notice (unchanged)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Interpretation | One reader call per message that needs reading (a text, or a photo with a readable caption). A photo without a caption, or any photo when the reader is disabled, gets a fixed answer built in code («add the shown product with the QR attributes») that goes through the same check. |
| Reader provider | OpenAI Responses API with strict structured output (`text.format` `json_schema`, `strict: true`), `store: false`, model `AI_READER_MODEL` (default `gpt-6-luna`, the current extraction default), `reasoning.effort` pinned to the lowest value the model accepts, `max_output_tokens` = the answer bound (10 actions of about 100 tokens, 2000) plus the reasoning tokens measured at the pinned effort (§14; reasoning tokens count against this bound), timeout `AI_TIMEOUT_MS` (default 20 s, unchanged), `maxRetries: 0`, the handler's `AbortSignal`. |
| Reader schema | One fixed schema for every message. It never depends on the context: refs, attribute names and values are strings. At most 10 actions plus `moreActions: boolean`: a message asking for more than 10 changes gets the first 10 and `moreActions: true`. Code applies those 10 and adds `invalid_action too_many_actions` (generic «Revisa el chat»), so a long list is never lost whole. If strict mode does not enforce `maxItems`, Zod accepts up to 30 actions and code treats the ones past 10 the same way. Request order: fixed instructions, then schema, then the per-message context, so the prefix can be prompt-cached and the grammar is compiled once. |
| Where the reader lives | Port in `orders/application/apply-chat-message.ts` (`readChatMessage`); the adapter and every model-facing text in `orders/infrastructure/` (`openai-chat-reader.ts`, `chat-reader-schema.ts`, `chat-reader-text.ts`, `chat-reader-context-text.ts`), pinned in `chat-reader.model-text.json`. Same layering as memory `61443534` and the founder rule in memory `f1a8c264`: no natural-language text in domain or application. |
| Removed | `src/shared/ai-tools/` entirely (registry, orchestrator, executor, Decision client, extractor, `decision-request-text.ts`, `ai-env.ts`, composition). In orders: `application/chat-message-interpreter.ts`, `chat-message-actions.ts`, `chat-text-actions.ts`, `chat-tool-types.ts`, and `infrastructure/chat-tools.ts`, `chat-context-text.ts`, `chat-tools.model-text.json`, with their tests. In products: `identify-product-in-text.ts`, `resolve-variant.ts`, `openai-text-chooser.ts` (text and variant choosers), `createTextMatching`, `findTopTextCandidate`, and in `products/domain/text-identification.ts` every type and helper except `CatalogSearchReadiness`, `ProductMatcherError` and `ProductRef` while still used (T6 deletes the rest and keeps the file under that name). Env: `MESSAGE_ACTION_MIN_CONFIDENCE`, `MESSAGE_TOOL_PREDICATE_MIN`, `MESSAGE_REPORT_PREDICATE_MIN`, `AI_EXTRACTION_MODEL`, `TEXT_MATCH_UNCLEAR_MIN_PROBABILITY`. Constant: `ITEM_CHOICE_MIN_CONFIDENCE`. Evals: the text-identification pass (`identification-text.eval.ts`, `textCases`) and the calibration of the removed Decision, item, text and variant certainties. |
| Gates | No certainty gate on reading. The visual-search gate `PRODUCT_MATCH_MIN_CONFIDENCE` (0.8) stays on photos. |
| Catalog candidates for text | Products whose name matches the most words of the message, in one bounded statement that scans the company's products (§5.3; founder decision, §16).<br>1. **Searched words.** Code normalizes the text (lower case, accents stripped), splits it on non-alphanumeric characters, and keeps the distinct words of at least 3 characters. This is character-level splitting, not morphology. The number kept is capped by the company's catalog size, so that words × products stays within a fixed budget; longer words are kept first.<br>2. **Matches.** Every kept word is scored against every active product name of the company, which is read through the company index under RLS. A pair matches when `word_similarity(word, name) ≥ TEXT_MATCH_MIN_SIMILARITY` (0.3). The trigram index cannot serve these matches: the app role is subject to forced RLS on `Product`, and the pg_trgm operators are not leakproof.<br>3. **Coverage ranking.** Each product's score is the sum of `word_similarity(word, name)` over its matching words. A name that matches more of the message's words ranks higher, so one shared common word («con», «negro», «para») never puts a product on par with the named one. The same score is used for the cut and the final order. Ties go to the shorter name, then the id. A long name («Polera con capucha oversize») is still found from a partial mention («la polera negra»), because each matching word counts on its own.<br>The result is the top `TEXT_MATCH_CANDIDATES` (8). All values are initial; T10 may change them by measurement on dev. |
| Products given to the reader | One ceiling for everything: `READER_MAX_PRODUCTS` (24, initial value, adjustable). Priority order, deduplicated:<br>1. the shown products of a product photo;<br>2. the products of variant pendings;<br>3. the candidates of doubtful pendings, round robin (each pending's first candidate, then each second, and so on);<br>4. the order items' products;<br>5. for a text, the candidates.<br>With at most 10 pendings and one shown product, every pending keeps at least one product. A doubtful pending lists only its included candidates in that message, so the reader can resolve it only to a listed product; the cut candidates stay in the pending. A non-product photo adds no candidates and does not run the candidate query, since its change actions all become `image_with_request`. Items stay listed with their own snapshot even when their product is cut, so they can still be removed or changed. The cut is logged (`contextTruncated`). |
| Context limits | A text is read and searched up to `READER_MAX_TEXT_CHARS` (2000, initial value). A longer text is not read and reports `invalid_action text_too_long` (generic «Revisa el chat»). A photo caption over the limit is not read either: the photo's fixed answer applies, with the notice of a doubted caption (§6.1). At most `READER_MAX_ITEMS` (40) items are listed; beyond them, a reference to an unlisted item ends as `unclear_item`. A doubtful pending keeps at most 4 candidates. At most 10 pendings. |
| Context rendering | Per product: name, sellable flag, each attribute with its values once, price once when every sellable variant shares it (otherwise grouped by price), and the non-sellable combinations listed only when fewer than the sellable ones (otherwise the sellable combinations). Never one line per variant. |
| References in the answer | Short refs valid for one reading: `P1…` products, `I1…` items, `Q1…` pendings. They are plain strings, so an unknown ref fails only its action (`invalid_action unknown_reference`), not the message. |
| Comparing reader values with catalog values | Attribute names and values are compared ignoring case and accents (Unicode NFD without combining marks, lower case). That is character normalization, not morphology, so the founder rule allows it. A value outside the product's sellable values, or an attribute name the product does not have, means «not offered» (`variant_not_available`). The product is kept as a pending with the other known values, as the product draft closes for words that match no sellable value. Only catalog names and values are stored in a pending. |
| Variant resolution | Code only: sellable variants are filtered by the known values. One left → resolved; none → `variant_not_available`; several → the pending keeps missing the attributes that still vary. Unnamed attributes keep the base values (the QR variant, the item being changed, the pending's known values). |
| Price per unit or for the lot | The reader says `unit`, `lot` or `not_explicit`; code applies the closeness rule with the resolved variant's catalog price (tie → lot; quantity 1 → unit). The basis is judged with the quantity the price was stated for, not with the units of a later partial completion. A pending keeps the stated price, its basis and that quantity until its variant is known. A lot price is never divided (§6.2 `advancePending`). Choosing between candidates by price (criterion 40) is the reader's: it answers `one_of` when the per-unit and lot readings point to different products. |
| Pendings storage | One `ChatPendings` row per chat with a Zod-validated JSON list (at most 10) and `readyRemembered` (review gate, question 1). |
| When an order is open for messages | `messageOpenIntervals(order, chatId)` (pure, `orders/domain/message-order.ts`) derives, from the stored times only, the intervals during which `isOpenForMessageItems` held. An order is open at `t` when all of these hold:<br>• it exists (`createdAt ≤ t`);<br>• no closing time is at or before `t`. The closing times are `cancelledAt`, `checkoutConfirmedAt`, `shippedAt`, `deliveredAt` and `stockDeductedAt`, and each is set once and never cleared or moved (§3 «Order closing times», with the write paths that keep this true);<br>• every payment that existed at `t` was voided by `t`. A payment exists from its report (`reportedAt`) or, when it was recorded without a report, from its `confirmedAt`; a rejected payment is never voided.<br>The flags that do revert are not used: `stockDeducted` goes back to false when the stock of a cancelled order is restored, `completedAt` goes back to null on a void, and `deliveryStatus` goes back to `pending` on cancellation. Each of these happens only after a closing time that stays, so the derivation needs none of them. A void opens an order only when it is the last active payment and no closing time came before it. The two missing times, `cancelledAt` and `stockDeductedAt` (the first deduction, kept after a restoration), are added to `Order` (§7). For the current instant, the result agrees with `isOpenForMessageItems` by test. |
| A pending's order | A pending joins the first chat order that is open for messages at or after its last change. A message transaction that has or creates the chat's open order attaches every orderless alive pending (`attachedAt` = transaction time). An order that opened without a message (a reopening void, at the start of an open interval) is joined by derivation at that interval's start, provided it is within the pending's 7 days. The derivation is computed for each pending, from all the chat orders that opened after the oldest orderless change. No sweeper. Order use cases change only to record the two new times. |
| Ending pendings with their order | Derived under the message's lock: a pending attached to an order ends when the open interval of that order containing `attachedAt` has ended, that is, when the order is not the chat's open target, or when a payment was created strictly after `attachedAt`. Ended pendings are removed in the same transaction and recorded as `pending_ended`. |
| Pendings without an order | Expire `CHAT_PENDING_TTL_DAYS` (7, initial value) after `lastChangedAt`, unless a chat order opened within that time. |
| Pendings limit | `CHAT_PENDING_MAX` (10, initial value). Creating one more, including a part split off by a partial completion, ends the least recently changed other pending silently, as the product draft closes. |
| A photo's caption naming another product | When that product has an open pending, the caption completes or partly completes the pending (product criterion 30, a change to a current rule). Without a pending it fails the check with a generic «Revisa el chat» (`invalid_action not_the_shown_product`; review gate, question 3). |
| Doubt | `doubt` covers the whole answer: nothing changes and the outcome is `reader_doubt`. On a product photo, the photo's fixed answer still applies, and the seller is always told, as the product draft's photo rule says. When the photo leaves the product pending, whether as a new pending or a silent replacement of an existing one, the notice is «Falta la variante» (`variant_missing`). Otherwise, when it is added, also through a QR completion of a pending, the notice is the photo-added text (`caption_not_applied`). |
| Outcomes | New kinds: `pending_created`, `pending_updated`, `pending_completed`, `pending_split`, `pending_ended` (silent), `reader_doubt`, `request_not_allowed`, `invalid_action`, `product_not_available`, `variant_for_several_pendings`, `ready_with_pendings`, `caption_not_applied`. `ambiguous_intent` is removed, and a migration deletes the development rows that hold it. |
| Notices | Pure choice in `seller-notice.ts`, texts in `seller-notice-texts.ts`. New `SellerNotice` kinds `not_applied`, `caption_not_applied`, `product_not_available`, `ready_with_pendings` and `variant_for_several_pendings`, all opening the chat on the message. Push data contract unchanged. |
| Contracts and mobile | No change to `shared/contracts/` or to mobile: pendings have no route or screen. |
| Eval private data | The harness loads a private catalog and private cases at run time from `EVAL_PRIVATE_DIR`, an absolute path outside the repository (compared as resolved real paths), into a second eval company. Nothing private is committed. Records, judge and classifier output of a private run stay under `<dir>/runs/`; only aggregate gate lines (whole run and per family) leave it. |
| Cost | Worst-case context about 18k input tokens and 1k output, about US$0.0023 per message at `gpt-6-luna` prices, below the US$0.003 target; typical text about 5–7k input, about US$0.001 (§10.1). |
| Deferred with real risk | Editing order items from web or mobile (release gate, memory `de4d23f5`): a pending completed wrongly can only be fixed by cancelling the order. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `applyChatMessage` | `apps/core/src/features/orders/application/apply-chat-message.ts` | Reads the message and an unlocked order context, identifies photos, calls `interpretAndApply`. The transaction locks the contact, re-checks the outcome, locks the target, runs `applyChatActions` and saves the order, `OrderMessage` and `ChatMessageOutcome`. Reused; its interpretation stage is replaced. |
| Interpreter | `orders/application/chat-message-interpreter.ts` | Binds the `shared/ai-tools` orchestrator to the chat tools (`variantOnlyRule`, fallback tool, `ambiguous_intent`). Deleted. |
| Chat actions | `orders/application/chat-message-actions.ts`, `chat-text-actions.ts`, `chat-tool-types.ts` | Tool offers, the 0.8 item gate, price hints, calls to text identification and the variant chooser. Deleted; `hasReadableText` moves into `apply-chat-message.ts`. |
| Tool definitions | `orders/infrastructure/chat-tools.ts`, `chat-context-text.ts`, `chat-tools.model-text.json` (+ test) | Decision questions and strict schemas. Deleted and replaced by the reader files. |
| Order transitions | `orders/domain/chat-order.ts` (`applyChatActions`, `needsNewChatOrder`, `ResolvedChatAction`, `ChatOrderTarget`) | `ChatOrderTarget` carries an `OrderAggregate` only for `open`; `closed` carries id and number; `cancelled` and `none` carry nothing. Reused and extended with pendings, `increase_quantity` and ready evaluation at the end. |
| Outcomes | `orders/domain/chat-message-outcome.ts`, `infrastructure/chat-message-outcome-repository.ts`; table `ChatMessageOutcome` (PK company + message, JSON `outcomes`) | Reused; the union is extended and `ambiguous_intent` removed. |
| Mentioned price | `orders/domain/mentioned-price.ts` (`parseMentionedPrice`) | Reused; gains the closeness rule. |
| Notice choice and texts | `orders/domain/seller-notice.ts`, `presentation/seller-notice-texts.ts`, `application/describe-chat-message-notice.ts` | Reused and extended. `problemOf` has `default: null`, so new outcome kinds compile before notices change. |
| Open-order rule | `orders/domain/message-order.ts` (`isOpenForMessageItems`) | Reused as is. |
| Chat order reads | `orders/infrastructure/order-repository.ts` (`findOpenChatOrderCandidate`, `findLatestChatOrderState`, `findChatOrderTargetForUpdate`); `orders/composition.ts` `findChatOrderContext` (unlocked, returns only `items`) | `findChatOrderTargetForUpdate` is reused as is. `findChatOrderContext` is replaced by an unlocked `findChatOrderTarget` with the same shape as the locked one. A new `findChatOrdersOpenedSince` reads the aggregates of the chat orders that may have opened after a time. |
| Payment times | `Payment.data` JSON per status (`payment.ts`): `reportedAt` (reported; `report.reportedAt` inside rejected; `evidence.report.reportedAt` for a confirmed or voided payment that came from a buyer report, as `buyerReportedAt` in `order-state-machine.ts` reads it), `confirmedAt` (confirmed, voided), `voidedAt` (voided), `rejectedAt` (rejected); index `Payment (companyId, orderId, id)`; `Order (companyId, chatId)` | Read from the order aggregates. |
| Order closing times | `Order`: `checkoutConfirmedAt`, `shippedAt`, `deliveredAt` and `completedAt` have times; `cancelled` and `stockDeducted` are booleans with no time. Some of these do revert:<br>• `saveStockRestoration` (`order-repository.ts`, run by `products/application/restore-cancelled-order-stock.ts` from `composition/event-handlers.ts` after `order_cancelled`) sets `stockDeducted: false` on a cancelled order;<br>• `void-payment.ts` calls `saveCompletion(…, null)`;<br>• cancellation sets `deliveryStatus: "pending"` and keeps `shippedAt`.<br>`checkoutConfirmedAt`, `shippedAt`, `deliveredAt` and `cancelled` are never cleared. | `cancelledAt` and `stockDeductedAt` are added (T0); each is written once, by a path T0 owns:<br>• `saveCancellation` (`cancel-order.ts`) writes `cancelledAt`;<br>• `saveStockDeduction` (`deduct-stock.ts`, `register-payment.ts`, `set-delivery.ts`, `checkout.ts`, `register-immediate-sale.ts`) writes `stockDeductedAt = COALESCE(stockDeductedAt, time)`;<br>• `savePendingOrder` writes both from the aggregate (an immediate sale created with stock deducted has `stockDeductedAt = createdAt`);<br>• `saveStockRestoration` leaves `stockDeductedAt` untouched.<br>`completedAt` and the reverting flags are not used by the derivation. |
| Handler and policy | `orders/application/chat-message-handler.ts`, `chat-message-policy.ts` (85 s deadline, 8 retries) | Reused; the trace log fields change. |
| Generic AI tools | `apps/core/src/shared/ai-tools/` | Used only by orders and evals. Deleted. |
| Photo cascade | `products/application/identify-products-in-image.ts` (QR, visual search at 0.8) | Reused as is. |
| Text identification and variant chooser | `products/application/identify-product-in-text.ts`, `resolve-variant.ts`, `infrastructure/product-matching/openai-text-chooser.ts`, `createTextMatching` in `products/composition.ts` | Used only by the orders chat actions and evals. Deleted. |
| Text candidates | `products/infrastructure/text-candidates.ts` (`word_similarity(mention, name)` per mention, a per-company scan, as its comment says); GIN trigram index `Product_name_idx` on `name`, not usable by the app role on `Product` (forced RLS, non-leakproof pg_trgm operators) | Replaced by the coverage query of §5.3, which keeps the company scan with a word cap from the catalog size. |
| Sellable variants and attributes | `products/infrastructure/order-stock.ts` (`loadSellableVariants`, `withinReadSnapshot`), `variant-combinations.ts` (`loadAttributesOfProducts`, `savedVariantOrder` filter `ProductVariantOptionValue` by `productId`, which no index of that table serves) | `findProductsForReading` reads in one snapshot driven from `ProductVariant (companyId, productId, id)` (§5.2). |
| Contacts lock | `contacts` composition `lockContact` | Reused: it serializes the messages of one chat, so the pendings row is never written concurrently. |
| Eval harness | `apps/core/evals/` (`cases/schema.ts` with a hand copy of the outcome kinds, `lib/production.ts`, `lib/scorers.ts` and test, `lib/picks.ts`, `lib/report.ts`, `lib/rebuild.ts`, `scripts/rebuild-report.ts`, `lib/eval-catalog.ts`, `fixtures/catalog.ts`) | Single-message cases scored by tools, outcomes and order. One static catalog with a static `ProductKey` union. `ambiguous_intent` passes as `no_intent`. Calibration grades the Decision, item, text and variant certainties. No conversations, no simulated time, no private loading. Extended. |
| Prompt-overlap rule | `evals/lib/prompt-overlap.test.ts` (`promptFiles` names `chat-tools.ts`, `chat-context-text.ts`, three `shared/ai-tools` files and `openai-text-chooser.ts`; `evalInputs` covers single-message cases) | Changed:<br>• T5 adds the conversation step texts to `evalInputs`;<br>• T6 removes the deleted files from `promptFiles` and adds the reader files, in the same change that deletes them, so «discovers every known prompt file» stays green. |
| Holdout v2 run | `~/yoyos-orquestacion/pedidos-por-mensaje/holdout-v2-run.md` | Ran by copying the private table into the repository temporarily. v3 replaces this with run-time loading. |

## 4. Gaps this design closes

1. A chat keeps no memory of unfinished requests, so a variant answer in a later message cannot complete anything (§6.2, §7, §9).
2. The Decision API step drops messages under 0.6, and the 0.8 text gates drop clear requests silently (§5.1, §6.1).
3. A second model with its own gate interprets the variant words, so code cannot compare structured values with catalog values (§6.1).
4. No rule decides per-unit or per-lot price when the buyer does not say (§6.3).
5. A doubt, a request the chat never does, a non-whole quantity and a product no longer sellable end silently or with a wrong notice (§6.4).
6. «listo» said while something is unfinished has no notice and is not remembered (§6.2, §6.4).
7. Eval cases are single messages: no conversation scoring, no simulated time, no events between messages, no notice-level scoring, no gate report, and a private catalog cannot be loaded without committing it (§11.1, T5).
8. Dead code of the Decision API path would stay behind and break the founder's rule in CI (§11, T5, T6).

## 5. Use cases

### 5.1 `applyChatMessage` (modified), feature `orders`

- **input:** `{ companyId: CompanyId; messageId: ChatMessageId }` (unchanged). **access:** the job's company (unchanged).
- **deps** (changes only; every port returns `Result`):

```ts
export type ApplyChatMessageDependencies = Readonly<{
  // unchanged: findOutcome, findSourceMessage, readImage, identifyProductsInImage, catalogSearchReadiness, transaction, lockContact,
  // ensureCustomerForContact, findChatOrderTargetForUpdate, allocateNumber, saveNewOrder, saveItemChanges, recordOrderMessage,
  // recordOutcome, newOrderId, newItemId, clock
  /** Same shape as findChatOrderTargetForUpdate, without locks: the context the reader sees. */
  findChatOrderTarget: (chatId: ChatId) => Promise<Result<ChatOrderTarget, PersistenceError | InvalidStoredData>>;
  /** Aggregates of the chat's orders that may have opened for messages after `since` (created after it, or with a payment voided after it); read only when an orderless pending exists. */
  findChatOrdersOpenedSince: (chatId: ChatId, since: Date) => Promise<Result<readonly OrderAggregate[], PersistenceError | InvalidStoredData>>;
  findChatPendings: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>;          // unlocked
  findChatPendingsForUpdate: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>; // FOR UPDATE; absent row → empty
  saveChatPendings: (chatId: ChatId, pendings: ChatPendings) => Promise<Result<null, PersistenceError | InvalidStoredData>>;
  findProductsForReading: (productIds: readonly ProductId[]) => Promise<Result<readonly ProductForReading[], PersistenceError | InvalidStoredData>>;
  /** A statement timeout is not an error: it returns no ids with timedOut true. */
  findMessageCandidates: (text: string) => Promise<Result<Readonly<{ productIds: readonly ProductId[]; matchCount: number; durationMs: number; timedOut: boolean }>, PersistenceError>>;
  /** Null without a model provider: captions are ignored and texts are skipped. */
  readChatMessage: ReadChatMessage | null;
  newPendingId: () => ChatPendingId;
  limits: ChatOrderLimits; // + maxPendings, pendingTtlMs, maxReaderProducts, maxReaderItems, maxReaderTextChars, maxPendingCandidates
}>;
// removed: findChatOrderContext, loadSellableProducts, interpretationEnabled, interpretAndApply

export type ReadChatMessage = (context: ChatReadingContext, meta: Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>, signal: AbortSignal)
  => Promise<Result<ReaderReading, ReaderError>>;
export type ReaderReading = Readonly<{ answer: ReaderAnswer; usage: ReaderUsage }>;
export type ReaderUsage = Readonly<{ inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number }>;
export type ReaderError = Readonly<{ code: "AI_PROVIDER_UNAVAILABLE" | "DEADLINE_EXCEEDED" | "INVALID_AI_RESPONSE"; message: string }>;
```

- **output:** `ApplyChatMessageOutcome` with `trace: ReadingTrace = { readerCalls: 0 | 1; answer: "actions" | "no_intent" | "doubt" | "fixed"; actionKinds: readonly ReaderAction["kind"][]; usage: ReaderUsage | null; contextTruncated: boolean; candidateMs: number | null; candidateMatchCount: number | null; candidatesTimedOut: boolean }` instead of `InterpretationTrace`. The `skipped` reason `interpretation_disabled` becomes `reader_disabled`.
- **errors:** unchanged codes; `INVALID_AI_RESPONSE` now comes from the reader adapter, and `INVALID_STORED_DATA` (permanent) also from the products reading.
- **flow:**
  1. If the outcome exists, return `already_processed`. Load the message. Skip outgoing messages, empty texts, and texts while the reader is disabled (unchanged rules).
  2. Load the unlocked `findChatOrderTarget` and `findChatPendings`. If an orderless pending exists, read `findChatOrdersOpenedSince(chatId, oldest orderless lastChangedAt)`. Apply `pendingLife` (§6.2), which derives each pending's order on its own, so the reader never sees an ended pending.
  3. Photo: read and identify it (unchanged). `not_found` reports `not_identified` (silence by readiness, unchanged) and the caption is not read. `not_product` without a caption reports `no_intent`.
  4. A text longer than `maxReaderTextChars` reports `invalid_action text_too_long` and is not read. Otherwise:
     1. Collect the product ids in the priority order of §2: shown products, variant pendings' products, doubtful pendings' candidates round robin, items' products, then for a text only the candidates from `findMessageCandidates(text)`.
     2. Deduplicate them and apply the ceiling.
     3. Call `findProductsForReading(ids)` and assign refs.

     A non-product photo runs no candidate query.
  5. Answer:
     - text → `readChatMessage`;
     - product photo without a readable caption, or without the reader → `fixedShownAnswer(context)`;
     - product photo with a caption → `readChatMessage`. A `doubt` becomes `fixedShownAnswer` with `captionDoubt: true`, and so does a caption over `maxReaderTextChars`, which is not read;
     - non-product photo with a caption → `readChatMessage`.

     A text miss in a company with `no_active_products` stays silent (unchanged).
  6. `checkReaderAnswer(answer, context)` → `ResolvedChatAction[]` (pure).
  7. Transaction: `lockContact` → `findOutcome` re-check → `findChatOrderTargetForUpdate` → `findChatPendingsForUpdate` → `findChatOrdersOpenedSince` (only when the locked set has an orderless pending) → `pendingLife` → `needsNewChatOrder` (also true when a pending completion adds without an open order) → customer and number when needed → `applyChatActions(target, pendings, actions, ids, now, limits, seed)` → save the order or the item changes → `saveChatPendings` when the parsed set differs from the one read → `recordOrderMessage` when an order changed → `recordOutcome`. Nothing in this step calls the reader, `findProductsForReading` or `findMessageCandidates`: a pending completion uses only the products loaded in step 4. The one products read under the lock is the existing batched variant → product lookup (`findProductIdsOfVariants`) inside `findChatOrderTargetForUpdate`. It is one query by variant ids, kept as it is; no per-item lookup is added beside it.
  8. Return `applied` with `noticeDue = chooseSellerNotice(outcomes) !== null`.

### 5.2 `findProductsForReading` (new), feature `products`, public composition

- **input:** `productIds: readonly ProductId[]` (at most `maxReaderProducts`). **access:** the current company scope (RLS).
- **output:** `ProductForReading[]`. The type is owned by `products/domain/reading-product.ts`:

```ts
export type ProductForReading = Readonly<{
  productId: ProductId;
  name: string;
  /** Product active with at least one active variant. */
  sellable: boolean;
  /** Values of active variants, in stored option order. */
  attributes: readonly Readonly<{ name: string; values: readonly string[] }>[];
  /** Active variants only. */
  variants: readonly CatalogItem[];
}>;
```

  `CatalogItem` stays in `products/domain/image-identification.ts`. A deleted product is absent.
- **access path:** one `withinReadSnapshot` with a fixed number of queries whatever the product count, never one query per product. The queries are: products by `(companyId, id)`; variants driven from `ProductVariant (companyId, productId, id)`; option links joined by `(companyId, variantId)`; option and value order.
- **errors:** `PERSISTENCE_UNAVAILABLE` (retryable). A stored row that fails its schema returns `INVALID_STORED_DATA` (permanent), so the paid photo stages are not repeated for 25 minutes.

### 5.3 `findMessageCandidates` (new), feature `products`, public composition

- **input:** `text: string` (at most `maxReaderTextChars`).
- **output:** up to `TEXT_MATCH_CANDIDATES` active product ids with a sellable variant, by coverage descending, then shorter name, then id. No model call.
- **searched words (code, infrastructure):** the text is normalized with Unicode NFD, combining marks removed and lower case, then split on runs of non-letter, non-digit characters. Words of at least 3 characters are kept, distinct, and ordered by length descending, then by first appearance. Longer words carry more trigrams, and catalog names are made of them, so they are kept first. No words means no query and no candidates. This is character-level work with no word lists, so the founder rule holds.
- **word cap from the catalog size:** `maxWords = clamp(floor(TEXT_MATCH_PAIR_BUDGET / companyProducts), TEXT_MATCH_MIN_WORDS, TEXT_MATCH_MAX_WORDS)`, with these initial values:
  - `TEXT_MATCH_PAIR_BUDGET` 25,000 pairs, about 110 ms at about 4.5 µs per pair (measured as `core_app` in T1; the first value, 40,000, assumed 3 µs and missed the 150 ms p95 at 5,000 products);
  - `TEXT_MATCH_MIN_WORDS` 3;
  - `TEXT_MATCH_MAX_WORDS` 30.

  `companyProducts` is the company's active product count. The same transaction reads it first, in its own statement, through `Product (companyId)`, an index count of at most a few thousand rows.

  | Catalog | Words searched |
  | --- | --- |
  | 500 products | 30 |
  | 2,000 products | 12 |
  | 5,000 products | 5 |
  | Above about 8,333 products | 3 (the floor), so the budget is passed |
- **query:** one statement inside a short transaction with `SET LOCAL jit = off` and `SET LOCAL statement_timeout = '1s'`, running as the app role under RLS:
  ```sql
  SELECT p.id, sum(m.sim) AS coverage
  FROM "Product" p
  CROSS JOIN LATERAL (
    SELECT word_similarity(w, p.name) AS sim FROM unnest(:words) AS w
  ) m
  WHERE p."companyId" = :companyId AND p.status = 'active' AND m.sim >= :minSimilarity
    AND EXISTS (SELECT 1 FROM "ProductVariant" v
                WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
  GROUP BY p.id, p.name
  ORDER BY coverage DESC, length(p.name), p.id
  LIMIT :candidates
  ```
  - Column names follow the current `text-candidates.ts` (`status = 'active'`).
  - Accents are not stripped from the stored name. A single accent changes at most three trigrams of a word, so a word of 4 or more characters still passes 0.3. T1 checks this with «polerón» against «poleron».
  - One score is used for the cut and for the order, so no earlier step can cut the named product.
  - Two searched words that are near-forms of one name word («negra» and «negro») both count. Code does not merge them (founder rule). T1 measures the effect in a recall cell.
- **cost (measured as `core_app` with RLS forced, PostgreSQL 18):**
  - The planner scans the company's products through `Product (companyId)` and computes `word_similarity` for every (word, product) pair, at about 4.5 µs per pair (T1 measurement on the dev host; the first estimate was 3 µs).
  - Measured without the cap: 14, 30 and 40 ms at 500 products, and 92, 225 and 460 ms at 5,000 products, for 5, 14 and 30 words.
  - With the cap, T1 measured p95 about 100–150 ms at 5,000 products.
  - Above about 8,333 products the floor of 3 words passes the budget. At 10,000 products p95 was about 155–185 ms on a loaded host, above the 150 ms criterion; this is accepted as a known limitation. The statement stays under the 1 s timeout, and recall also falls, because only the 3 longest words are searched.
  - This is a known limitation (§14). Its meeting point is the Todoist task `6hrWWWJQVCmcM2W3`: a SECURITY DEFINER per-word lookup that lets the trigram index serve the matches, measured at 84 ms for 30 words on 5,000 products. That task only replaces the statement behind `findMessageCandidates`; the port, the coverage ranking and the callers stay.
- **errors and degradation:**
  - A statement timeout does not fail the message. The use case continues with no candidates: items and pendings are still listed, and `contextTruncated` is set. It logs `message_candidates_timeout`. Retrying the message would hold the chat's FIFO queue for about 25 minutes and then fail it, for an input that is slow every time.
  - Any other database error is `PERSISTENCE_UNAVAILABLE` (retryable).
  - The handler's `AbortSignal` does not cancel a running statement; the 1 s timeout bounds it.

### 5.4 Unchanged use cases

`chooseSellerNotice`, `describeChatMessageNotice`, the handler, the dead-letter handler and the notifications consumer keep their signatures; only the notice union grows (§6.4). Order use cases (payments, checkout, delivery, cancellation) do not call into pendings, because pendings end by derivation (§6.2). They change only to pass their clock time to the two writes that now record `cancelledAt` and `stockDeductedAt` (§3 «Order closing times»).

## 6. Domain and typing

### 6.1 Reading: `orders/domain/chat-reading.ts` (new)

Justification: the reader's answer is the only input that crosses from the model into the domain, so it is a plain-data union the domain owns. The context is the data the check needs, so the check and the context live in one module. Orders imports `ProductForReading` from the products domain as a type, which `.dependency-cruiser.cjs` allows, and never imports products application code.

```ts
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";

export type ReadingRef = string; // "P1", "I2", "Q1": valid for one reading only

export type ReadingProduct = ProductForReading & Readonly<{ ref: ReadingRef; shown: boolean; shownVariantId: VariantId | null; identification: ProductIdentification | null }>;
export type ReadingItem = Readonly<{ ref: ReadingRef; variantId: VariantId; productId: ProductId | null; productName: string;
  variantAttributes: Readonly<Record<string, string>>; quantity: number; unitPrice: Money }>;
export type ReadingPending = Readonly<{ ref: ReadingRef; pending: ChatPending }>;

export type ChatReadingContext = Readonly<{
  kind: "text" | "photo_product" | "photo_not_product";
  /** The buyer's words: the text, or the photo's caption. Only the reader adapter reads it; domain logic never does. */
  text: string | null;
  items: readonly ReadingItem[];
  pendings: readonly ReadingPending[];
  products: readonly ReadingProduct[];
  truncated: boolean;
}>;

export type AttributeChoice = Readonly<{ name: string; value: string }>;
export type StatedPrice = Readonly<{ amount: string; currency: "not_named" | Currency | "other"; per: "unit" | "lot" | "not_explicit" }>;
export type ReaderProduct =
  | Readonly<{ kind: "ref"; ref: ReadingRef }>
  | Readonly<{ kind: "one_of"; refs: readonly [ReadingRef, ReadingRef, ...ReadingRef[]] }>
  | Readonly<{ kind: "not_in_catalog" }>
  | Readonly<{ kind: "unnamed" }>;
export type ReaderItem = Readonly<{ kind: "ref"; ref: ReadingRef }> | Readonly<{ kind: "unnamed" }> | Readonly<{ kind: "not_in_order" }>;

export type ReaderAction =
  | Readonly<{ kind: "add"; product: ReaderProduct; attributes: readonly AttributeChoice[]; quantity: number | null; price: StatedPrice | null }>
  | Readonly<{ kind: "complete_pending"; pending: ReadingRef; product: ReadingRef | null; attributes: readonly AttributeChoice[]; quantity: number | null; price: StatedPrice | null }>
  | Readonly<{ kind: "decline_pending"; pending: ReadingRef }>
  | Readonly<{ kind: "decline_shown" }>
  | Readonly<{ kind: "remove"; item: ReaderItem; amount: "all" | "one" }>
  | Readonly<{ kind: "change_quantity"; item: ReaderItem; mode: "increase" | "set"; quantity: number }>
  | Readonly<{ kind: "change_variant"; item: ReaderItem; attributes: readonly AttributeChoice[]; price: StatedPrice | null }>
  | Readonly<{ kind: "set_price"; item: ReaderItem; price: StatedPrice }>
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "variant_only" }>
  | Readonly<{ kind: "variant_for_pendings"; pendings: readonly [ReadingRef, ReadingRef, ...ReadingRef[]] }>
  | Readonly<{ kind: "not_allowed" }>;

export type ReaderAnswer =
  /** At most 10 actions are applied; moreActions says the message asked for more. */
  | Readonly<{ kind: "actions"; actions: readonly [ReaderAction, ...ReaderAction[]]; moreActions: boolean }>
  | Readonly<{ kind: "no_intent" }>
  | Readonly<{ kind: "doubt" }>;

/** What a product photo asks without reading: each shown product with its QR attributes. The quantity is left unstated; it is ×1 only when the add or draft is new, and an existing pending of that product keeps its own quantity. */
export function fixedShownAnswer(context: ChatReadingContext): ReaderAnswer;
export function checkReaderAnswer(answer: ReaderAnswer, context: ChatReadingContext, options: Readonly<{ captionDoubt: boolean }>): readonly [ResolvedChatAction, ...ResolvedChatAction[]];
```

`checkReaderAnswer` rules, in this precedence, each a pure branch with its own unit test:

| Reader output | Resolved action or report |
| --- | --- |
| `no_intent` | `report no_intent` |
| `doubt` (text, non-product photo) | `report reader_doubt` |
| `not_allowed` | `report request_not_allowed` |
| Unknown product or pending ref | `report invalid_action { reason: "unknown_reference" }` (generic: a product outside the ones given to the reader) |
| Unknown item ref, `ReaderItem { kind: "not_in_order" }`, or `unnamed` with two or more items | `report unclear_item` (the existing unclear-item text, criterion 17), as for an item beyond the 40 listed |
| More than 10 actions (`moreActions`, or more than 10 parsed) | the first 10 are checked and applied as below; `report invalid_action { reason: "too_many_actions" }` |
| Any change action in a non-product photo message | one `report image_with_request` for the message |
| `add` naming the product of an open variant pending, or one of a doubtful pending's candidates (as resolved against the pendings before the message), in any message kind including a product photo's caption (criterion 30) | `advance_pending { pendingId, product, values, quantity, price }`: the one transition of §6.2 for «a later message names a pending's product» |
| `complete_pending` (in any message kind, including a product photo's caption, criterion 30) | `advance_pending { mode: "assign" }`. Its quantity is the units of the pending this answer covers; null means all the remaining units. An `add` that names a pending's product gives `advance_pending { mode: "total" }`, where the quantity is the new total wanted. The reader's instructions define the two action kinds this way, so code tells them apart by the action kind and never by the buyer's words. A `product` that is not one of the pending's candidates is accepted when it is a listed product: the reader judged it the same request. |
| `add` naming a product with two or more open variant pendings | A pending fits when its known values do not conflict with the message's values (compared normalized).<br>• Exactly one fits → `advance_pending` of that one.<br>• Several fit → `report variant_for_several_pendings` and nothing changes.<br>• None fits → `advance_pending` of the most recently changed one, the product draft's «Replacing» rule, as with a single pending. A conflicting add therefore replaces a request and never opens a parallel one; this is listed for the founder in §16. |
| Two or more actions of one answer advancing the same pending | All of them become `mode: "assign"`, each covering its stated quantity, or 1 when none is stated. They apply in order (§6.2). «un polo básico en M y otro en L» given as two `add`s on a ×2 pending therefore assigns one unit each and never overwrites one with the other. |
| An action targeting a pending that an earlier action of the same message completed or ended | The «gone» rule (§6.2): the action is checked again as if there were no pending. No unit is lost. |
| `add` with `one_of` including a product that has an open variant pending | That product is left out of the doubtful pending's candidates. If only it remains, the action advances its pending. If one other product remains, a variant pending of that product is drafted. If two or more remain, a doubtful pending over them is drafted. A product never has both kinds of pending. |
| Two adds of the same product in one message without an open pending for it | two pending drafts or items, never one merged into the other. Which pending an action targets is resolved against the pendings as they were before the message. The transitions then apply in order on the current set, so a second completion of a pending split by the first one targets its remainder. |
| `add` of a non-shown product without an open pending, in a product-photo message | `report invalid_action { reason: "not_the_shown_product" }` |
| `add` with `not_in_catalog` | `report not_identified { source: "text" }`; in a photo message, `not_the_shown_product` |
| `add` with `unnamed` | `report unnamed_add` (never touches a pending) |
| Quantity not a whole number, or 0 or negative on an add or completion | `report invalid_action { reason: "quantity_not_whole" }`; `change_quantity set 0` is a removal |
| Product not sellable on an add, completion or variant-change target | `report product_not_available { productId }` |
| Values (normalized) resolving to one sellable variant | `add`, or `advance_pending` when the product has an open pending, with the mentioned price of §6.3 |
| A value outside the sellable values, or an attribute name the product does not have | `variant_not_available` and a pending draft keeping the other known values |
| Values leaving attributes open | a variant pending draft with the known catalog values |
| `add` with `one_of` | a doubtful-product pending draft over those candidates (at most `maxPendingCandidates`, in the reader's order) |
| Quantity above `maxItemQuantity` on a would-be pending, or on an `advance_pending` (total or assigned) | `report quantity_above_limit`; no draft, and the pending is unchanged |
| `variant_only` | `report variant_only` |
| `variant_for_pendings` | `report variant_for_several_pendings { pendingIds }` |
| `decline_pending` / `decline_shown` | `decline_pending { pendingId }` / nothing for the shown product (`no_intent` when it is the only action) |
| `remove`, `set_price`, `change_variant` | the existing actions; `change_variant` resolves with the item's values as base |
| `change_quantity increase` | `increase_quantity { target, quantity }` |
| `ready` | `ready` (evaluated after every other action by the order domain) |
| Product photo with `captionDoubt` (doubted or too-long caption) | the fixed answer's actions. When the result leaves the shown product pending (a new pending, or a silent `advance_pending` of its existing one), the order domain adds `variant_missing` for it if the message has no other notice for that product. When the result adds it (a single variant, or a QR completion of its pending), the order domain adds `caption_not_applied { productId }`. The seller is never left without a notice for a doubted caption. |

### 6.2 Pendings: `orders/domain/chat-pendings.ts` (new)

Justification: a pending is a new business concept with its own lifecycle (open → completed | ended), and no existing type holds an unfinished request.

```ts
export type ChatPendingId = string & { readonly __brand: "ChatPendingId" };
export type PendingSubject =
  | Readonly<{ kind: "variant"; productId: ProductId }>                                     // (a) product without its full variant
  | Readonly<{ kind: "product"; candidates: readonly [ProductId, ProductId, ...ProductId[]] }>; // (b) doubtful product, at most 4
/** forQuantity: the units the buyer stated the price for; the unit-or-lot basis is judged with it, never with a later partial assignment. */
export type PendingPrice = Readonly<{ amount: Money; per: "unit" | "lot" | "not_explicit"; forQuantity: PositiveInteger }>;
export type ChatPending = Readonly<{
  id: ChatPendingId;
  subject: PendingSubject;
  /** Catalog attribute names and values already given; never the buyer's words. */
  known: Readonly<Record<string, string>>;
  quantity: PositiveInteger;
  price: PendingPrice | null;
  /** The order the pending belongs to and when it joined it; null before any open order. */
  order: Readonly<{ orderId: OrderId; attachedAt: Date }> | null;
  lastChangedAt: Date;
  sourceMessageId: ChatMessageId;
  /** The buyer's request this pending comes from: its own id at creation, copied to the parts a split creates. A lot price belongs to one request. */
  requestId: ChatPendingId;
}>;
export type ChatPendings = Readonly<{ pendings: readonly ChatPending[]; readyRemembered: boolean }>;
export const chatPendingsSchema: z.ZodType<ChatPendings>; // strictObject, at most 10 entries, dates as ISO strings
```

The life of a pending is pure and exhaustive over its inputs:

In `orders/domain/message-order.ts`, next to `isOpenForMessageItems`:

```ts
/** A span during which the order was open for messages; `until` null means it still is. */
export type MessageOpenInterval = Readonly<{ from: Date; until: Date | null }>;
/** The open-for-messages history of an order, derived only from its stored times (§2 «When an order is open for messages»), ordered by `from`. */
export function messageOpenIntervals(order: OrderAggregate, chatId: ChatId): readonly MessageOpenInterval[];
```

The intervals are computed from the stored times.
- **Start:** an interval starts at `createdAt`, or at a `voidedAt` after which no payment is still active.
- **End:** it ends at the next payment creation, or at the first terminal time. A payment is created at `reportedAt`, or at `confirmedAt` when it was recorded without a report.
- **Rejected payments:** they stay active forever.
- **Terminal facts:** after one, no interval starts again.

A unit test checks that the last interval is open (`until === null`) exactly when `isOpenForMessageItems` holds for the order as it is now.

In `orders/domain/chat-pendings.ts`:

```ts
/** What pendingLife reads: the chat's order target (locked or not, same shape) and, when an orderless pending exists, the chat orders that may have opened since the oldest orderless change. */
export type PendingLifeFacts = Readonly<{ target: ChatOrderTarget; openedSince: readonly OrderAggregate[] }>;
export type PendingLife = Readonly<{ alive: readonly ChatPending[]; ended: readonly Readonly<{ id: ChatPendingId; reason: "order_closed" | "expired" }>[] }>;
export function pendingLife(pendings: ChatPendings, facts: PendingLifeFacts, now: Date, ttlMs: number): PendingLife;
```

Each pending is decided on its own:

1. **Attached pending** (`order` set). It is alive only if all of these hold:
   - `target` is `open`;
   - `target.order.id === order.orderId`;
   - the interval of that order containing `attachedAt` is still open, that is, no payment was created strictly after `attachedAt`.

   Otherwise it ends with `order_closed`. A message attaches at the transaction time, under the order lock, so no payment of that order is created at that instant.
2. **Orderless pending.** Take every interval of every order in `openedSince`, and of the open target, that starts strictly after `lastChangedAt`. The earliest start `J` gives the order `O` the pending joined.
   - If there is no such interval, or `J > lastChangedAt + ttl`, the pending is orderless. It is alive until `lastChangedAt + ttl` and then ends with `expired`.
   - Otherwise it is treated as attached to `O` at `J`, and rule 1 decides. While `O` is still in that interval and is the open target, the transaction writes `order = { orderId: O, attachedAt: J }`, so the TTL stops.

   An interval that contained `lastChangedAt` is never joined this way. A message that changed the pending while an order was open attached it in that transaction (`attachOrderless`).

The void flows give:

| Flow | Result |
| --- | --- |
| #1020 paid in two parts A and B; polo pending created; A voided while B stays confirmed; «negro M» on day 2 | A's void starts no interval (B still active), so the pending is orderless and alive. The polo goes into a new #1021 with «Pedido nuevo #1021». The same holds for a void on an order already shipped, with confirmed checkout, stock deducted or cancelled: a terminal fact before the void. |
| Polo pending with no open order; A voided, then B voided, and #1020 reopens at B's void; «negro M» 9 days later | The interval starts at B's void, within the 7 days, and is still open. The pending joined #1020 at B's void, with no TTL any more, and completes into #1020 (criterion 41 with two payments). |
| P1 at t0; #1019 reopens at t1 and closes; P2 at t2; #1020 reopens at t3 and closes with a reported payment | P1 joined #1019 at t1 and P2 joined #1020 at t3. Both intervals ended, so both pendings end with `order_closed`, and a later «en M» reports variant only (criterion 19 class). |
| Orderless pending; «y una gorra roja» creates #1023; reported payment; «en M» | The creating message attached the pending at #1023's `createdAt`, and the payment ended the interval: `order_closed`, then variant only, never #1024. |

`openedSince` is read only when an orderless pending exists (§5.1 steps 2 and 7). `since` is the oldest orderless `lastChangedAt`, and `pendingLife` filters per pending.

These are the transitions `applyChatActions` uses. Each returns the next `ChatPendings` and its outcomes:

| Transition | Rule |
| --- | --- |
| `attachOrderless(set, order, now)` | When the message has or creates the chat's open order, every alive orderless pending gets `order = { orderId, attachedAt: now }` (or `J` from rule 2), and its TTL stops. |
| `draftPending(set, draft)` | Only for a product with no open pending before the message. It creates the pending: `pending_created` plus its problem outcome (`variant_missing`, `not_clear` or `variant_not_available`). An 11th pending ends the least recently changed one with `pending_ended limit`. |
| `advancePending(set, id, mode, product, values, quantity, price)` | **The one rule for a later message that names a pending's product** (an `add` with `mode: "total"`, or a `complete_pending` with `mode: "assign"`; criteria 30, 32, 37, 38 and 39). No unit of a pending is ever dropped.<br><br>**Step 1. Quantity above 99** (total or assigned): `quantity_above_limit`, and nothing changes.<br><br>**Step 2. Split the pending into the units this answer covers (`k`) and the remainder.** The pending has `n` units.<br>• **`mode: "total"`:** `k` is the stated quantity, or `n` when none is stated. A photo's fixed answer states no quantity, so a photo of a ×2 pending's product keeps ×2, and its QR completion adds ×2. The answer covers the whole pending, which then holds `k` units, and there is no remainder.<br>• **`mode: "assign"` with a stated `k` below `n`:** the answer covers `k` units. The remainder (`n − k` units) keeps the pending's id, its known values from before the message, its price and its order.<br>• **`mode: "assign"` with no quantity, or `k ≥ n`:** the answer covers the whole pending, with `k` units (or `n` when none is stated). A `k` above `n` is the message's quantity, as before.<br><br>**Step 3. Merge.** The covered units take the pending's known values with the message's values over them; a restated attribute takes the new value. A doubtful pending takes the named product as its subject.<br><br>**Step 4. Resolve the variant of the covered units and branch:**<br>• **One sellable variant.** `k` units become items. If the whole pending was covered, it ends as `pending_completed`. Otherwise the remainder stays as `pending_updated`, silent.<br>• **Attributes still vary.** If the whole pending was covered, it takes the merged values and `k`: criterion 32, «y el polo básico x2» makes it ×2. If only part was covered, the covered units become a new pending with the merged values, `k` units, a copy of the price, the same `requestId` and `sourceMessageId` and `lastChangedAt` now (`pending_split { pendingId, newPendingId }`, silent), and the remainder stays. The new pending counts toward the limit of 10.<br>• **A value or attribute name not offered.** The outcome is `variant_not_available`. If the whole pending was covered, it keeps the other merged values and `k` (criterion 39: «y el polo básico rojo x2» keeps ×2). If only part was covered, nothing changes, and the notice tells the seller.<br>• **Product no longer sellable.** `pending_ended product_not_available` plus `product_not_available`.<br><br>**Price.**<br>• A stated price in the message replaces the covered units' price, with `forQuantity = k`.<br>• Otherwise the pending's price applies, judged with its own `forQuantity` (§6.3).<br>• A per-unit reading goes on every item made from that request.<br>• A lot reading is never divided. It goes whole («S/ 70.00 por 2») on the first item made from the request. The transition then clears the price of every pending with the same `requestId`, the remainder included. Another request of the same product in the same message has its own `requestId` and keeps its price.<br><br>**Worked flows** (the founder decision of 28/10):<br>• «uno en M» on a ×2 pending with Talla and Color missing: a new pending ×1 {Talla M} and the remainder ×1 {}. Both are silent and no unit is lost.<br>• «uno en M y otro en L» on the same pending: two completions of `k = 1`. The first splits off ×1 {M}. The second covers the whole remainder, ×1 {L}. Result: two pendings ×1, silent.<br>• With Color known, «uno en M» on ×2 {Color Negro}: one item M/Negro ×1, and the remainder ×1 {Color Negro}. A later «el otro en L» adds L/Negro.<br><br>So a message naming the product in full adds one item, not two. The same rule handles the second photo of a pending product: the photo's fixed answer names that product with `mode: "total"`. |
| `declinePending` | `pending_ended declined`. |
| Pending referenced by the reader but gone, either under the lock or ended or completed by an earlier action of the same message | The action is checked again as if there were no pending. An action that carried only values reports `variant_only`, the same notice as a late answer to an ended pending (criteria 18 and 19). An action that named the product follows the add rules: a new item or a new pending, so no unit is lost. |
| Pending whose product was deleted (absent from `findProductsForReading`) | It is described to the reader by its ref, with the product marked not available and no name. Any action on it ends it with `pending_ended product_not_available` plus `product_not_available { productId: null }` («un producto» in the text). A doubtful pending drops deleted candidates. One left makes it a variant pending, silently; none left is handled as above. A pending no message addresses ends by its own life rules. |
| Ready memory | Evaluated after all actions.<br>• `ready` with no pending left → `ready` outcome.<br>• `ready` with pendings left → `ready_with_pendings` and `readyRemembered = true`.<br>• With `readyRemembered` set, completing or declining the last pending while items remain → `ready`.<br>• Completing or declining a pending that is not the last keeps `readyRemembered`.<br>• A new request in a later message (an add of a product with no pending, or a newly drafted pending) sets `readyRemembered = false`. The part a split creates is a partial completion, not a new request, so it keeps it.<br>• No pendings left → `readyRemembered = false`. |

### 6.3 Mentioned price: `orders/domain/mentioned-price.ts` (modified)

```ts
/** The mentioned price of an item from what the buyer stated, judged with the variant's catalog price. */
export function mentionedPriceOf(stated: StatedPrice, quantity: PositiveInteger, unitPrice: Money): MentionedPrice | null;
```

- `other` currency, or a currency other than `unitPrice.currency` → null.
- `unit` → units 1; `lot` → units = quantity.
- `not_explicit` with quantity 1 → units 1.
- `not_explicit` with quantity above 1 → the reading whose per-unit amount is closer to `unitPrice` (`|amount - unit|` against `|amount / quantity - unit|`); a tie → lot.
- Amount limits as in `parseMentionedPrice`.
- `quantity` is the quantity the price was stated for (`PendingPrice.forQuantity` for a pending), never the units of a later partial assignment. «2 polos básicos en 70» answered with «uno en M negro» is judged with 2: for a catalog price of 40 it is a lot, and the item shows «S/ 70.00 por 2», not «S/ 70.00 por unidad».

### 6.4 Outcomes and notices

`ChatMessageOutcome` (in `chat-message-outcome.ts`, schema updated in place):

```ts
| Readonly<{ kind: "pending_created" | "pending_updated" | "pending_completed"; pendingId: ChatPendingId }>
| Readonly<{ kind: "pending_split"; pendingId: ChatPendingId; newPendingId: ChatPendingId }>
| Readonly<{ kind: "pending_ended"; pendingId: ChatPendingId; reason: "declined" | "order_closed" | "expired" | "limit" | "product_not_available" }>
| Readonly<{ kind: "reader_doubt" | "request_not_allowed" }>
| Readonly<{ kind: "invalid_action"; reason: "unknown_reference" | "not_the_shown_product" | "quantity_not_whole" | "text_too_long" | "too_many_actions" }>
| Readonly<{ kind: "product_not_available"; productId: ProductId | null }>
| Readonly<{ kind: "variant_for_several_pendings"; productIds: readonly ProductId[]; unnamed: number }>
| Readonly<{ kind: "ready_with_pendings"; orderId: OrderId | null; productIds: readonly ProductId[]; unnamed: number }>
| Readonly<{ kind: "caption_not_applied"; productId: ProductId; orderId: OrderId | null }>
// removed: "ambiguous_intent"
```

`SellerNotice` gains the kinds listed below. Their names are a constant tuple `sellerNoticeKinds` in `seller-notice.ts`, written in T0, with `SellerNoticeKind = (typeof sellerNoticeKinds)[number]`. This lets evals (T5) use the kinds in wave 1 while T3 writes the union's data fields. T3 adds a type-level check that `SellerNotice["kind"]` equals `SellerNoticeKind`.

- `not_applied { orderId | null }`, from `reader_doubt`, `request_not_allowed` or `invalid_action`;
- `caption_not_applied { productId; orderId | null }`;
- `product_not_available { productId | null }`;
- `variant_for_several_pendings { productIds; unnamed }`;
- `ready_with_pendings { orderId | null; productIds; unnamed }`.

Priority:

1. Problems, by the existing rules. `product_not_available`, `not_applied`, `caption_not_applied` and `variant_for_several_pendings` are problems and count in «several problems».
2. `ready_with_pendings`, which never counts as a problem.
3. `only_item_kept`.
4. `ready`.
5. `new_order`.

`chooseSellerNotice` drops a repeated product id from `ready_with_pendings` and `variant_for_several_pendings` (keeping first appearance, `unnamed` unchanged), so the notice carries distinct ids and the second pending of a product is not counted in «y N más».

`pending_*` outcomes, including `pending_split`, are silent. `noticeReferences` carries `productIds` for names, deduplicated: two pendings of one product name it once («Polo básico»), never «Polo básico y Polo básico»; a doubtful or deleted pending is counted in `unnamed`. All new kinds open the chat on the message. The texts are the ones in the product draft (`es`, `pt-BR`).

| Layer | Types and authority |
| --- | --- |
| Infrastructure (reader) | Fixed JSON schema, instructions and context text. Validates the model's JSON with Zod and maps it to `ReaderAnswer`. |
| Domain | `ReaderAnswer`, `ChatReadingContext`, `ChatPending`, `checkReaderAnswer`, `pendingLife`, `applyChatActions`, `mentionedPriceOf`, `chooseSellerNotice`: every business rule. |
| Application | `applyChatMessage`: loads data, calls the ports, runs the transaction. |
| Presentation | Notice texts only. |
| Products | `ProductForReading` (domain) and the two reading capabilities (application and infrastructure). |

## 7. Persistence

- **Table `ChatPendings`.** Columns:
  - `companyId uuid`, defaulting from `app.company_id` like every company table;
  - `chatId uuid`;
  - `pendings jsonb NOT NULL`;
  - `readyRemembered boolean NOT NULL DEFAULT false`;
  - `updatedAt timestamptz(3) NOT NULL`.

  PK `(companyId, chatId)`. FK `(companyId, chatId)` → `Chat(companyId, id)` `ON DELETE CASCADE`. `CHECK (jsonb_typeof(pendings) = 'array')`. RLS is enabled and forced with the company isolation policy of `ChatMessageOutcome`. Grants come from the role's default privileges, as in the database-migrations skill.
- **Migration `add_chat_pendings`** (T0), generated with the Prisma CLI per `.agents/skills/database-migrations/SKILL.md`. Adding the FK takes `SHARE ROW EXCLUSIVE` on `Chat`, so table, RLS and FK go in one `BEGIN; SET LOCAL lock_timeout …; SET LOCAL statement_timeout …; … COMMIT` (memory `c37d7bb2`).
- **Migration `add_order_terminal_times`** (T0): it adds nullable `Order.cancelledAt` and `Order.stockDeductedAt` (`timestamptz(3)`), in `BEGIN; SET LOCAL lock_timeout …; SET LOCAL statement_timeout …; ALTER TABLE … ADD COLUMN …; COMMIT`. Then, as a separate step after the DDL, as the database-migrations skill asks, the existing development rows with `cancelled` or `stockDeducted` set are backfilled with `createdAt`, which reads as closed since creation. Development data only. The parse invariants are one-way:
  - `cancelled ⇔ cancelledAt ≠ null`, because a cancellation is never undone;
  - `stockDeducted ⇒ stockDeductedAt ≠ null`. The converse does not hold: a cancelled order whose stock was restored has `stockDeducted: false` and keeps its deduction time.

  `cancel` and `planStockDeduction` in `order-state-machine.ts` take the use case's time. The write paths and their owner (T0) are listed in §3 «Order closing times». `saveStockDeduction` writes `COALESCE("stockDeductedAt", time)`, so the first deduction time is never moved. `saveStockRestoration` never touches it.
- **Migration `remove_ambiguous_intent_outcomes`** (T6): `DELETE FROM "ChatMessageOutcome" WHERE outcomes @> '[{"kind":"ambiguous_intent"}]'` with `SET LOCAL lock_timeout` and `statement_timeout`. Development data only (memory: no customers or production data).
- **Repository `orders/infrastructure/chat-pending-repository.ts`:**
  - `findChatPendings(chatId)`.
  - `findChatPendingsForUpdate(chatId)`: `SELECT … FOR UPDATE`; no row → `{ pendings: [], readyRemembered: false }`.
  - `saveChatPendings(chatId, set)`: upsert; deletes the row when the set is empty and `readyRemembered` is false.

  Rows are parsed with `chatPendingsSchema`; a mismatch is `INVALID_STORED_DATA`. The use case writes only when the parsed set differs from the one read (structural comparison, not identity). Ids inside the JSON are historical references (no FK), as in `ChatMessageOutcome`.
- **Order reads (orders infrastructure):**
  - `findChatOrderTarget(chatId)` is `findChatOrderTargetForUpdate` without `FOR UPDATE`.
  - `findChatOrdersOpenedSince(chatId, since)` returns the aggregates, with their payments, of the chat's orders that either:
    - were created after `since`, or
    - have a voided payment with `(data->>'voidedAt')::timestamptz > since`.

    It is one order query filtered through `Order (companyId, chatId)` with an `EXISTS` on `Payment (companyId, orderId, id)`, plus the existing aggregate load of items and payments for those ids. At most 20 orders are returned: the **earliest** after `since`, by the time of their creation or void, because rule 2 needs the earliest interval start. Reaching the cap is logged as `chat_orders_opened_since_capped`. A chat has few orders, so this is index-served and cheap. Since every void and every creation after `since` is returned, `pendingLife` can find each pending's own `J`.

## 8. Events, cross-feature integration and latency

- `message_created` and `chat_message_processed`: payloads, publishers and consumers unchanged.
- Products → orders: `findProductsForReading` and `findMessageCandidates` are exported from `products/composition.ts` (the `products` object). Orders imports the type `ProductForReading` from `products/domain/reading-product.ts`. `identifyProductsInImage` and `catalogSearchReadiness` are unchanged.
- No new event. Order use cases do not call into pendings: pendings end through `pendingLife` at the next message.
- Latency budget within the 85 s attempt deadline: in the worst path, a product photo with a caption, about 45 s (image read, QR, local embedding, visual chooser up to 20 s, reader up to 20 s). The reader receives the handler's `AbortSignal`, so a late call ends as `DEADLINE_EXCEEDED`, not at job expiry. T6 also passes the signal to the visual chooser (`openai-product-chooser.ts`), which today calls without it, so a nearly spent deadline cannot be overrun before the reader starts.

| Message | Model calls |
| --- | --- |
| Text | 1 reader call (today up to 3–4: Decision, extraction, choosers) |
| Photo without caption | 0 reader calls; the visual chooser only when the visual path needs it |
| Photo with caption | visual chooser (when needed) + 1 reader call |

| Failure window | What happens | Effect for the user |
| --- | --- | --- |
| Reader unavailable or deadline passed | Retryable; nothing is written; the chat's later messages wait | Nothing until the message applies (up to about 25 min) |
| Reader JSON invalid or incomplete | `INVALID_AI_RESPONSE`, permanent `failed` | «No pudimos revisar un mensaje» |
| Invalid stored product data | `INVALID_STORED_DATA`, permanent `failed` | «No pudimos revisar un mensaje» |
| The order closes between context and lock | `pendingLife` under the lock ends its pendings; item actions follow the closed-order rules | The closed-order or variant-only notice |
| A pending the reader referenced ended under the lock | The action is checked as if there were no pending (§6.2) | Variant-only notice, as for a late answer to an ended pending (criteria 18 and 19) |
| Candidate query passes its 1 s statement timeout | The message continues without candidates (§5.3) and logs `message_candidates_timeout`; the chat's queue is not held | A product named only in the text and not yet an item or pending may end as `not_identified` |
| Commit fails | Order, pendings and outcome roll back together; retried | Nothing |
| Notice publish fails after commit | Unchanged (logged and lost; recovered on re-run) | Unchanged |

## 9. Transactions and concurrency

1. `transaction(companyId)`: the existing company-scoped helper.
2. `lockContact(contactId)`: serializes every message of the chat, even two overlapping jobs of one key.
3. `findOutcome(messageId)`: a second run ends as `MESSAGE_ALREADY_PROCESSED` → `already_processed`.
4. `findChatOrderTargetForUpdate(chatId)`: locks the open order against payments, checkout, delivery, stock and cancellation.
5. `findChatPendingsForUpdate(chatId)`: a row lock. It is redundant with the contact lock but makes the row's writer explicit.
6. `findChatOrdersOpenedSince`: only when the locked set has an orderless pending. The other orders are not locked. A concurrent void of a closed order either is visible to this read or commits after it, and then the next message sees it. Either way the result is one consistent history, because times only accumulate.
7. `pendingLife` on the locked facts, then `applyChatActions` (which attaches orderless pendings to the open or new order). A new order number is allocated only when `needsNewChatOrder` says so. No model call and no candidate or reading query happens in the transaction. The only products read is the batched `findProductIdsOfVariants` inside the target read.
8. Writes: the new order or the item changes, `ChatPendings` (only when changed), `OrderMessage` and `ChatMessageOutcome`. Commit.

Two messages of one chat never interleave (contact lock and queue order). A payment reported concurrently either waits for the order lock or ran before it, and in both cases the pending life rule sees it under the lock. A repeated message ends as `already_processed`: no second item, no second completion, no second notice. The work under the lock is primary-key reads plus `saveItemChanges` (one statement per changed item, bounded by the 10 actions).

## 10. Reader adapter (orders infrastructure)

| File | Content |
| --- | --- |
| `openai-chat-reader.ts` | `createOpenAiChatReader({ client, model, timeoutMs }): ReadChatMessage` calls the Responses API with `store: false`, the fixed strict schema, pinned `reasoning.effort` and `max_output_tokens` (2000 for the answer plus the reasoning tokens measured at the pinned effort, §14). Input order: instructions, then context (the schema travels in `text.format`). Usage maps `input_tokens`, `cached_tokens`, `output_tokens` and `reasoning_tokens`. Errors: timeout, network failure, 429 and 5xx → `AI_PROVIDER_UNAVAILABLE`; the caller's deadline → `DEADLINE_EXCEEDED`; a refusal, an incomplete output, another 4xx or a schema mismatch → `INVALID_AI_RESPONSE`. |
| `chat-reader-schema.ts` | `readerSchema`: one constant Zod schema (and its JSON schema) of the answer, with field descriptions, at most 10 actions in the JSON schema plus `moreActions`, Zod accepting up to 30; `toReaderAnswer(parsed)`. Every strict field is required, and absence is `null`. Nothing in it comes from the context. |
| `chat-reader-text.ts` | The fixed instructions: the buyer's text is data; only the listed refs exist; use catalog names and values; quantity rules; price basis, and `one_of` when the price points to different candidates; doubt; what the chat never does; pendings; a caption may complete another product's pending. Examples use products and wording outside the eval inputs (prompt-overlap rule). |
| `chat-reader-context-text.ts` | `describeReadingContext(context)`: items, pendings (product or candidates, known values, missing attributes, quantity, price), and products in the compact rendering of §2 (sellable flag, attributes and values once, prices grouped, combinations listed by the shorter side), plus the photo's shown product. No order number, phone or id beyond refs. |
| `chat-reader-env.ts` | `AI_READER_MODEL` (default `gpt-6-luna`), `AI_TIMEOUT_MS` (default 20000), `OPENAI_API_KEY`. Invalid values fail at startup. |
| `chat-reader.model-text.json` + `chat-reader.model-text.test.ts` | Pins the instructions, the one schema, the request settings (model default, reasoning effort, output bound) and the rendered context of four representative contexts (text without order, text with items and pendings, product photo, non-product photo). |

### 10.1 Context size and cost

`gpt-6-luna` costs US$0.10 per million input tokens and US$0.50 per million output tokens (`evals/lib/model-meter.ts`).

| Part | Worst case | Tokens |
| --- | --- | --- |
| Instructions + schema (fixed, cacheable) | — | ~4,000 |
| Products | 24 (the ceiling covers shown, pendings', items' and candidate products) × (name, flag, attributes ~40 + a different price for each of 72 combinations, listed with its combination ≈ 72 × 6) | ~11,500 |
| Items | 40 × ~25 | ~1,000 |
| Pendings | 10 × ~40 | ~400 |
| Text | 2,000 characters | ~600 |
| **Input** | | **~17,500** (US$0.0018) |
| **Output** | 10 actions × ~100 tokens, plus the reasoning tokens measured at the pinned effort (expected none) | **~1,000** (US$0.0005) |
| **Total** | | **~US$0.0023**, under US$0.003 |

A typical text (3 items, 1 pending, 8 candidates of about 12 variants each) comes to about 5–7k input tokens, about US$0.001, and less when the prefix is cached.

**Headroom.** The worst case leaves about US$0.0007, which is about 1,400 reasoning tokens. The bound that is tested is the cost of the worst case, not a token count:
- T4 measures the worst-case context and a 10-action answer at the pinned effort, reasoning tokens included.
- If the measured cost is over US$0.003, `READER_MAX_PRODUCTS` is lowered (each product is about 480 tokens, about US$0.00005) until it fits, and the new value is recorded.
- A priced combination line («Talla M · Color Negro: S/ 40.00») may take 10–12 tokens rather than the 6 estimated above, which would bring the worst case to about 24,000 input tokens (about US$0.0024 input). That still fits the cost bound with zero reasoning tokens. The token test therefore takes its limit from the cost bound (T4 criterion 4), with the same remedy of lowering `READER_MAX_PRODUCTS`.

## 11. Code organization

| File | Change |
| --- | --- |
| `products/domain/reading-product.ts` | New: `ProductForReading` (owner: T0). |
| `products/application/find-products-for-reading.ts`, `infrastructure/reading-products.ts`, `infrastructure/text-candidates.ts`, `composition.ts`, `index.ts` | New capabilities (T1); text matching removed (T6). |
| `orders/domain/chat-reading.ts` | New: reading context, `ReaderAnswer`, `fixedShownAnswer`, `checkReaderAnswer`. |
| `orders/domain/chat-pendings.ts` | New: `ChatPending`, schema, `pendingLife`, transitions. |
| `orders/domain/message-order.ts` | `messageOpenIntervals` (T2). |
| `orders/domain/order-state-machine.ts`, `orders/infrastructure/order-repository.ts` mapping, the use cases that cancel or deduct stock | `cancelledAt`, `stockDeductedAt` (T0). |
| `orders/domain/chat-order.ts` | `applyChatActions` takes and returns `ChatPendings`. New actions `increase_quantity`, `draft_pending`, `advance_pending`, `decline_pending`. Orderless pendings attach to the open or new order. Ready is evaluated last. `needsNewChatOrder` counts completions. |
| `orders/domain/mentioned-price.ts` | `mentionedPriceOf`. |
| `orders/domain/chat-message-outcome.ts` | Union and schema (§6.4). |
| `orders/domain/seller-notice.ts` | New notice kinds and priority. |
| `orders/presentation/seller-notice-texts.ts` | New texts and list joining with «y N más» / «e mais N». |
| `orders/application/apply-chat-message.ts` | New flow (§5.1); `hasReadableText` moves here. |
| `orders/application/chat-message-handler.ts` | Log fields from `ReadingTrace`. |
| `orders/infrastructure/chat-pending-repository.ts` | New. |
| `orders/infrastructure/order-repository.ts` | `findChatOrderTarget`, `findChatOrdersOpenedSince`. |
| `orders/infrastructure/openai-chat-reader.ts`, `chat-reader-*.ts`, `chat-reader.model-text.json` | New (§10). |
| `orders/composition.ts` | Wires the reader, the pendings repository, the order reads, the products capabilities and the limits from env (`CHAT_PENDING_TTL_DAYS`, `CHAT_PENDING_MAX`, `READER_MAX_PRODUCTS`, `READER_MAX_ITEMS`, `READER_MAX_TEXT_CHARS`). |
| `prisma/schema.prisma`, `prisma/migrations/*` | `ChatPendings` and the order times (T0); outcome cleanup (T6). No index or extension for the candidate query. |
| `evals/lib/prompt-overlap.test.ts` | `evalInputs` over conversation steps (T5); `promptFiles` without the deleted files and with the reader files (T6). |
| Deleted | Every file listed under «Removed» in §2, with its tests. |
| `apps/core/.env.example` | Removed and added variables. |
| `apps/core/evals/**` | §11.1. |

### 11.1 Eval harness (`apps/core/evals`)

| Piece | Change | Owner |
| --- | --- | --- |
| `fixtures/catalog.ts`, `lib/eval-catalog.ts` | A catalog is data: `EvalCatalog = { products: { key; name; variants: { attributes; price; active? }[]; active? }[] }`, Zod-validated. `ProductKey` becomes a string validated against the loaded catalog. `seedEvalCatalog(catalog, companyId, embedder)` seeds the committed catalog into the eval company and a private catalog into a second company (`evalId("company:private")`), with ids namespaced by company. | T5 |
| `cases/schema.ts` | `tools` is removed from expectations. An expectation is `{ order?, notice: SellerNoticeKind \| null, outcomes? }` (the kinds imported from the `sellerNoticeKinds` tuple of T0) (outcomes optional, a multiset when present). New outcome kinds are added to `outcomeKinds`. `ambiguous_intent` no longer satisfies `no_intent`. New pass `conversation`: `{ id, kind, tags, steps: (MessageStep \| EventStep)[] }`, with 2 to 4 messages. Each `MessageStep` has its own `expected`, and `expectsRepeatNotice?: true` marks a rules-sheet exception. `EventStep`: `advance_days { days }`, `cancel_order`, `report_payment`, `confirm_payment`, `void_payment`, `deactivate_product { product }`. | T5; removing `ambiguous_intent` from `outcomeKinds`: T7 |
| `cases/split.ts` | A conversation's split is the hash of its id (the function is unchanged). | — |
| `cases/conversations.ts`, `cases/index.ts`, `cases/private.ts` | New empty table registered in `baseCasesOf`. The private loader reads `<dir>/catalog.json` and `<dir>/cases.json` at run time with the same schemas, and no committed table imports it. | T5 (contents of `conversations.ts`: T7) |
| `lib/production.ts` | Conversation runner: one chat with steps in order. Events run through the production use cases with the same simulated clock as the messages (the `clock` of `applyChatMessage` and of the payment, cancellation and product use cases). Readiness is `ready` for the private company. One record per message step, with the conversation id. | T5; rewired to the new `applyChatMessage` deps in T6 |
| `lib/scorers.ts`, `lib/scorers.test.ts` | Notice scoring (`chooseSellerNotice(outcomes)?.kind`); order scoring unchanged. Ignored actions counted per action. Conversation checks: the same product id in two notices, unless `expectsRepeatNotice`. The `ambiguous_intent`-as-`no_intent` assertions are removed. | T5 |
| `lib/picks.ts`, `lib/rebuild.ts`, `scripts/rebuild-report.ts` | Calibration of the Decision, item, text and variant certainties removed; visual sources kept; `ambiguous_intent` removed; rebuild follows the new scoring. | T5 |
| `lib/report.ts` | Gate section: right count and percentage of scored messages, ignored actions, conversations with two notices for one product, wrong silent changes, extra notices on messages expected silent (%), first-repetition scoring with flips reported apart, cost per scored message against US$0.003 (with cached and reasoning tokens), p95 `durationMs` per message, reader calls per message kind against §8. Per family (`kind`); a `pinned-miss` section. | T5 |
| `lib/eval-env.ts` | `EVAL_PRIVATE_DIR` (absolute; resolved real path outside the repository; when set, only private cases run, against the private company, and records, judge and classifier output go to `<dir>/runs/`). In a private run, `model-suite.ts` labels each case with an opaque index instead of its id and keeps the judge's reason out of the vitest-evals report, so stdout carries only the aggregate gate lines. `EVAL_REPEAT_TAGS` (default `consistency`). | T5 |
| `identification-text.eval.ts`, `cases/identification.ts` `textCases`, pass `text` | Deleted. | T5 |
| `README.md` | Conversation cases, notice scoring and gates. The private files format is a separate schema-only section: field names, types and allowed values, with no example taken from or resembling suite cases. The coordinator hands only that section to the holdout writer, so the writer's isolation does not depend on the rest of the README. | T5 |
| `lib/prompt-overlap.test.ts` | `evalInputs` also covers the texts of conversation steps. | T5 (`promptFiles`: T6) |

## 12. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `chat_reader_completed` | info | `openai-chat-reader.ts` | `["companyId","messageId","model","answer","actionKinds","productCount","variantCount","pendingCount","itemCount","contextChars","contextTruncated","inputTokens","cachedInputTokens","outputTokens","reasoningTokens","durationMs"]` |
| `chat_reader_request_failed` | warn | `openai-chat-reader.ts` | `["companyId","messageId","model","errorCode","status","durationMs"]` |
| `chat_reader_invalid_response` | error | `openai-chat-reader.ts` | `["companyId","messageId","model","errorCode","issuePaths"]` (static paths only) |
| `chat_reader_disabled` | info | `chat-reader-env.ts` / composition | `["reason"]` |
| `orders_chat_message_applied` | info | handler (existing) | Existing fields, with `tools`, `extraction` and `decisionCalls` replaced by `readerCalls`, `answer`, `actionKinds`, `contextTruncated`, `pendingsBefore`, `pendingsAfter`, `candidateMs`, `candidateMatchCount`, `candidatesTimedOut` |
| `unable_to_read_chat_pendings` / `unable_to_save_chat_pendings` | error | `chat-pending-repository.ts` | `["companyId","chatId","errorCode"]` |
| `unable_to_find_chat_orders_opened_since` | error | `order-repository.ts` | `["companyId","chatId","errorCode"]` |
| `chat_orders_opened_since_capped` | warn | `order-repository.ts` | `["companyId","chatId","count"]` |
| `unable_to_find_reading_products` / `unable_to_find_message_candidates` | error | products repositories | `["companyId","errorCode"]` |
| `message_candidates_timeout` | warn | `text-candidates.ts` | `["companyId","wordCount","durationMs"]` |
| `message_candidates_found` | info | `text-candidates.ts` | `["companyId","wordCount","matchCount","candidateCount","durationMs"]` (`matchCount` is the number of matched products before the limit, the signal that common words are flooding the index) |

Never logged: buyer text, captions, prompts, the reader's answer, attribute values the buyer chose, prices, phones, WhatsApp ids. Pending outcomes go in the existing `outcomeKinds` field.

## 13. Tests

### Core unit

`domain/chat-reading.test.ts`
- `test("adds the only sellable variant when the reader names the product without values")`
- `test("fills the only sellable value of an attribute after a partial answer")` (criterion 2)
- `test("matches the reader's value «negro» to the catalog value «Negro» ignoring case and accents")`
- `test("treats a value outside the product's sellable values as a variant that does not exist")`
- `test("reports variant not available and keeps the other known values for an attribute name the product does not have")`
- `test("applies the first ten actions and reports too many actions when the reader says the message asked for more")`
- `test("applies the first ten of thirty parsed actions and reports too many actions")`
- `test("resolves a doubtful pending to a listed product the reader names even when it is not one of its candidates")`
- `test("drafts two pendings for two adds of the same product in one message without a pending")`
- `test("stores only catalog attribute names and values in a pending's known values")`
- `test("drafts a variant pending with the known size when the color still varies")`
- `test("drafts a doubtful-product pending of at most four candidates when the reader answers one of several")`
- `test("reports not identified when the reader says the product is not in the catalog")`
- `test("reports an unnamed add and never drafts or completes a pending for «otro igual»")`
- `test("reports a generic invalid action for a product reference it was not given")`
- `test("reports a generic invalid action for a fraction, a negative or a zero add quantity")`
- `test("reads «set to 0» as a removal")`
- `test("reports product not available for an add of a deactivated product")`
- `test("lets removal and quantity change of an item whose product was deactivated through")`
- `test("keeps the item's other attributes when a variant change names only the size")`
- `test("completes another product's pending from a product photo's caption that names it")` (criterion 30)
- `test("treats an add of a pending's product in a photo caption as completing that pending")` (criterion 30)
- `test("rejects an add of another product without a pending in a product-photo caption with a generic invalid action")`
- `test("turns every change in a non-product photo caption into one image-with-request report")`
- `test("reports reader doubt for a text and changes nothing")`
- `test("reports request not allowed for a cancel request")`
- `test("adds the shown product and reports caption not applied when the reader doubts a single-variant photo caption")`
- `test("drafts the shown product's pending and no caption-not-applied when the doubted photo has variants")`
- `test("reports variant missing when a doubted caption's photo silently replaces the product's existing pending")`
- `test("reports caption not applied when a doubted caption's photo completes the product's pending through its QR")`
- `test("treats a caption over the length limit as a doubted caption without calling the reader")`
- `test("keeps the QR label's color when the caption names another size")`
- `test("reports above-99 and drafts no pending for «150 polos»")`
- `test("reports a variant fitting several pendings with their product ids")`
- `test("reports an unclear item for an item ref not in the order and for an unnamed item with two items")` (criterion 17)
- `test("advances the variant pending instead of drafting a doubtful pending that would include its product")`
- `test("keeps a number that is part of the product name out of the quantity when the reader gives quantity 1")`

`domain/message-order.test.ts` (added)
- `test("opens an order at creation and closes it at its first payment report")`
- `test("reopens an order at the void of its last active payment only")`
- `test("never reopens an order at a void while another payment is still confirmed")`
- `test("never reopens an order after a rejected payment")`
- `test("never reopens an order at a void after checkout confirmation, shipment, stock deduction or cancellation")`
- `test("a void after stock deduction never reopens the order")`
- `test("keeps a cancelled order with restored stock closed from its cancellation and from its first deduction")`
- `test("ignores completedAt cleared by a void and deliveryStatus reset by a cancellation")`
- `test("agrees with isOpenForMessageItems about the order as it is now")`

`domain/chat-pendings.test.ts`
- `test("ends an attached pending when its order is no longer the open target")`
- `test("ends an attached pending when its order had a payment reported after it joined, even if voided since")`
- `test("keeps a pending attached at an order's reopening void alive")` (criterion 41)
- `test("joins an order reopened by the second of two voids and keeps the pending after nine days")` (criterion 41 with two payments)
- `test("keeps a pending orderless when a void leaves another payment confirmed")`
- `test("keeps a pending orderless when the void came after the order shipped")`
- `test("derives each orderless pending's order on its own from all chat orders opened since")` (criterion 19 class)
- `test("keeps an attached pending of an open order alive after ten days")` (criterion 21)
- `test("expires a pending without order seven days after its last change")`
- `test("restarts the seven days when a partial completion changes the pending")`
- `test("joins a pending without order to an order reopened within its seven days")`
- `test("expires a pending without order when the only reopening came after its seven days")`
- `test("ends a pending without order when the order it joined by a void closed again")`
- `test("attaches every orderless pending to the order a message creates")`
- `test("advances the pending of a later add of the same product, keeping values the new message does not restate")`
- `test("makes the pending ×2 silently for «y el polo básico x2» with values still missing")` (criterion 32)
- `test("reports variant not available and keeps ×2 for «y el polo básico rojo x2» on a ×1 pending")` (criterion 39)
- `test("resolves a doubtful pending when a message names one of its candidates")`
- `test("completes a pending into two items and ends it")`
- `test("completes two pendings from one message")` (criterion 24)
- `test("leaves the unassigned units as a pending without a notice")`
- `test("uses the message quantity when it assigns more units than the pending had")`
- `test("splits «uno en M» on a ×2 pending with Talla and Color missing into ×1 {M} and a ×1 remainder with the earlier values, silently")` (founder decision 28/10)
- `test("turns «uno en M y otro en L» on a ×2 pending with Color missing into two ×1 pendings, silently")`
- `test("adds one M/Negro and keeps ×1 {Negro} for «uno en M» on a ×2 pending with Color known, and a later «el otro en L» adds L/Negro")`
- `test("answers a remainder with one value by merging it with the remainder's own values only")`
- `test("reports variant not available and changes nothing for a partial assignment naming a value that does not exist")`
- `test("reads «x2» in an add of the pending's product as the new total and in a completion as the units assigned")`
- `test("reports above-99 and leaves the pending as it was for «y el polo básico x150»")`
- `test("judges a lot price stated for two with two when only one unit is completed, and shows it whole on that item")`
- `test("clears the lot price of the split parts and of the remainder once one item carries it")`
- `test("keeps the lot price of another request of the same product from the same message")`
- `test("assigns one unit each for two adds of the pending's product in one answer with values still missing")`
- `test("adds two items and completes the pending for two adds of the pending's product that each resolve a variant")`
- `test("checks an action whose pending an earlier action of the same message completed as if there were no pending")`
- `test("keeps ×2 when a photo of the pending product arrives without a caption")`
- `test("adds ×2 when a photo's QR completes a ×2 pending")`
- `test("keeps ×2 when a doubted caption's photo advances a ×2 pending")`
- `test("replaces the most recently changed of two pendings of one product when the add fits neither")`
- `test("ends a pending whose product was deleted with product not available without a name when a message addresses it")`
- `test("keeps the remembered ready when a partial completion splits a pending")`
- `test("advances the only pending of a product whose known values fit the message when the product has two")`
- `test("reports a variant for several pendings when two pendings of one product fit the message")`
- `test("completing by naming the product in full adds one item and ends the pending")`
- `test("turns a doubtful pending resolved to a product without its variant into a variant pending silently")`
- `test("ends a pending whose product is no longer sellable and reports product not available")`
- `test("keeps the pending when only the chosen variant is not sellable")`
- `test("reports variant only when the pending the reader completed ended under the lock")`
- `test("ends the least recently changed pending silently when an eleventh is created")`
- `test("parses stored pendings and rejects an unknown subject kind as invalid stored data")`

`domain/chat-order.test.ts` (added)
- `test("increases the item quantity by the stated units for «uno más» and sets it for «que sean»")`
- `test("creates the chat order when a pending completes without an open order")`
- `test("adds a completed pending to the chat's open order")`
- `test("remembers ready when ready leaves a pending and reports ready with pendings")`
- `test("reports ready when a later message completes the last pending after a remembered ready")`
- `test("reports ready for «quita la gorra y listo»")` (criterion 8)
- `test("reports variant missing and remembers ready for a photo captioned «eso nomás, listo» whose product has variants")` (criterion 23)
- `test("reports ready when the buyer declines the last pending with items left after a remembered ready")`
- `test("sends nothing when the buyer declines the last pending with no items after a remembered ready")`
- `test("drops the remembered ready when a later message adds a new item")`
- `test("keeps the remembered ready when a later message completes a pending that is not the last")`
- `test("applies the passing actions of a message when one fails a check")`
- `test("resolves item actions against the order as it was before the message")`

`domain/mentioned-price.test.ts` (added)
- `test("reads «2 en 70» at a catalog price of 40 as 70 for 2")`
- `test("reads «2 en 70» at a catalog price of 75 as 70 per unit")`
- `test("reads a tie as a price for the lot")`
- `test("keeps an explicit per-unit price whatever the distance")`
- `test("reads any price for one unit as per unit")`
- `test("drops a price in another currency")`

`domain/seller-notice.test.ts` (added)
- `test("chooses the generic not-applied notice for reader doubt, a request not allowed and an invalid action")`
- `test("chooses ready with pendings only when the message has no problem")`
- `test("never counts ready with pendings in several problems")`
- `test("counts product not available and caption not applied as problems")`
- `test("sends no notice for pending created, updated, completed or ended outcomes alone")`
- `test("opens the chat on the message for every new notice")`

`presentation/seller-notice-texts.test.ts` (added)
- `test("writes «falta completar Polo básico y 1 más» with one named and one doubtful pending")`
- `test("writes «falta completar 2 productos» when no pending has a name")`
- `test("writes the several-pendings variant text with up to three names")`
- `test("writes the product-not-available text without a name for a deleted product")`
- `test("writes the photo-added text with the product and order number in es and pt-BR")`
- `test("writes the generic not-applied text with and without an order number")`

`application/apply-chat-message.test.ts` (rewritten, with fakes)
- `test("adds the photo's only variant without calling the reader")`
- `test("drafts a pending for a photo with a caption and no reader, and sends no caption-not-applied")`
- `test("creates a pending and a variant-missing notice for a photo without size")`
- `test("completes the pending from «en talla M» on the next message without a notice")`
- `test("never shows the reader a pending whose order closed")`
- `test("reads the chat orders opened since only when an orderless pending exists")`
- `test("keeps the shown and pendings' products within the ceiling and cuts candidates first")`
- `test("lists at least one candidate of each of ten doubtful pendings within the ceiling")`
- `test("runs no candidate query for a non-product photo with a caption")`
- `test("reports text too long without calling the reader")`
- `test("skips a text without the reader and ignores a caption")`
- `test("retries when the reader is unavailable and writes nothing")`
- `test("records failed for an invalid reader answer")`
- `test("records failed for invalid stored product data without retrying")`
- `test("ends as already processed when another run recorded the message first")`
- `test("rolls back the order and the pendings together when saving the outcome fails")`
- `test("writes the pendings row only when the set changed")`
- `test("keeps a text miss silent in a company without active products")`

Orders infrastructure unit (`chat-reader-schema.test.ts`, `chat-reader-context-text.test.ts`, `openai-chat-reader.test.ts`, `chat-reader.model-text.test.ts`)
- `test("maps a strict answer with an add and a ready to the reader answer")`
- `test("rejects an answer with an unknown action kind or more than thirty actions as invalid")`
- `test("maps more than ten actions and the more-actions flag to the reader answer")`
- `test("builds the same schema for every context")`
- `test("sends instructions before the context and passes the caller's signal")`
- `test("describes pendings with their known values and missing attributes")`
- `test("describes a product's prices once when every variant shares one, grouped otherwise")`
- `test("lists the shorter of the sellable and the missing combinations")`
- `test("describes a non-sellable product of an order item without its variants")`
- `test("keeps the worst-case context with per-combination prices within the token limit derived from the cost bound")`
- `test("maps a timeout, a 429 and a 5xx to provider unavailable")`
- `test("maps a refusal and an incomplete output to invalid response")`
- `test("aborts at the caller's deadline as deadline exceeded")`
- `test("reports cached and reasoning tokens from the usage")`
- `test("pins every model-facing text, the one schema and the request settings of the reader")`

Products unit:
- `test("returns the attribute values of active variants in option order")`
- `test("marks an archived product as not sellable and keeps its name")`
- `test("splits a message into distinct normalized words of three or more characters, longest first, up to the cap")`
- `test("searches no words for a message of punctuation and short words")`

Evals unit (`evals/**/*.test.ts`)
- `test("parses a conversation with events and rejects one with five messages")`
- `test("parses every new outcome kind in an expectation")`
- `test("splits a conversation by the hash of its id")`
- `test("scores a message by its order and notice kind")`
- `test("no longer accepts ambiguous intent for an expected no intent")`
- `test("counts a removal applied and a ready lost without a notice as one ignored action")`
- `test("flags a conversation with two notices for one product unless the case expects it")`
- `test("reports extra notices as a share of the messages expected silent")`
- `test("scores the first repetition and reports flips apart")`
- `test("runs event steps with the conversation's simulated clock")`
- `test("loads a private catalog and cases from a folder outside the repository and refuses one inside it, also through a symlink")`
- `test("writes the records of a private run only under the private folder")`
- `test("prints only aggregate lines with opaque labels in a private run")`
- `test("repeats the cases of every tag in EVAL_REPEAT_TAGS")`
- `test("rebuilds a saved report under the new scoring")`
- `test("finds no production prompt quoting a conversation case")` (existing prompt-overlap test, now also over conversations)
- `test("uses only seller notice kinds that exist in an expectation")`
- `test("keeps examples out of the private files format section of the README")`

### Core integration

- `chat-pending-repository.integration.test.ts`: `test("saves and reads a chat's pendings within its company")`, `test("never reads another company's pendings")`, `test("deletes the row when no pending and no remembered ready remain")`, `test("rejects a stored row that fails its schema as invalid stored data")`.
- `order-repository.integration.test.ts` (added):
  - `test("returns the chat orders created or voided after a time with their payments")`
  - `test("reads the chat order target without locking it")`
  - `test("saves and reads the cancellation and stock deduction times")`
  - `test("a cancelled order whose stock was restored still parses and keeps its deduction time")`
  - `test("a second stock deduction call keeps the first deduction time")`
  - `test("returns the earliest twenty orders opened after a time when more exist")`
- `products`, `reading-products.integration.test.ts` and `text-candidates.integration.test.ts`:
  - `test("reads products, variants and attribute order in one snapshot with a fixed number of queries")`
  - `test("finds the products whose name appears in a whole message")`
  - `test("finds a long product name from a partial mention")`
  - `test("finds «Polerón» from «poleron»")`
  - `test("finds a product named with the longest words of a long message")`
  - `test("leaves out inactive products and other companies' products from message candidates")`
  - `test("ranks the polera named with four words above products sharing only «con» or «negro»")`
  - `test("keeps the named product in the top eight when 1,000 names share a word with the message")`
  - `test("continues without candidates when the candidate query times out")`
  - `test("searches 30 words at 500 products, 12 at 2,000, 5 at 5,000 and 3 above 8,333")`
  - `test("keeps the longest distinct words first when the cap applies")`
  - `test.runIf(CANDIDATES_BENCH)("keeps p95 under 150 ms and the named product in the top eight for natural messages up to 10,000 products as core_app with forced RLS")` (opt-in benchmark, `CANDIDATES_BENCH=1`; skipped in CI)
- `apply-chat-message.integration.test.ts` (reader faked with fixed answers; real database):
  - `test("photo without size, then «en talla M», then «negro» creates the order with one item and one notice")` (criterion 1)
  - `test("a pending of an order closed by a reported payment ends and never reaches a new order, also after the payment is voided")` (criterion 19)
  - `test("an orderless pending joins the order another message creates and ends when that order closes")`
  - `test("a pending without order expires after eight days and a partial completion on day six restarts the count")` (criterion 20)
  - `test("a pending without order joins an order reopened by a voided payment")` (criterion 41)
  - `test("a pending joins an order paid in two parts only when its second payment is voided, and completes into it nine days later")` (criterion 41 with two payments)
  - `test("a pending stays without order when a void leaves another payment confirmed, and goes into a new order")`
  - `test("two orderless pendings follow the two different orders reopened after each and end with them")` (criterion 19 class)
  - `test("«y el polo básico rojo x2» on a ×1 polo pending reports variant not available and a later «negro» adds two")` (criterion 39)
  - `test("a gorra photo whose caption names the pending polo adds both items with no notice")` (criterion 30)
  - `test("ready with a pending, then completion sends ready")` (criterion 22)
  - `test("the same completing message delivered twice adds one item")` (criterion 31)
  - `test("a deactivated product's pending ends with product not available")` (criterion 28)
  - `test("eleven pendings end the first silently")` (criterion 27)
  - `test("two concurrent runs of one message write one item and one outcome")`

### Web E2E

None: no screen changes.

### Pending manual checks

On WhatsApp with a real phone and a ready catalog, product criteria 1, 3, 4, 5, 8, 22 and 32 give the written result and notices on the phone (criterion 44).

## 14. Limits and checks during implementation

- Verify that the Responses API structured output with `strict: true` accepts the nested discriminated unions of §6.1 (strict mode needs every field required and `additionalProperties: false`). If a construct is rejected, flatten it in `chat-reader-schema.ts` only, never in the domain type, and keep the schema independent of the context.
- Verify whether strict mode enforces `maxItems` on arrays. Either way, the Zod bound of 30 and `moreActions` keep a long list from failing whole.
- Verify the lowest `reasoning.effort` `gpt-6-luna` accepts, and pin it. Record whether it produces reasoning tokens on the worst-case context and on a 10-action answer, and set `max_output_tokens` to 2000 plus the largest measured reasoning count with a 50% margin. An `incomplete` output stays `INVALID_AI_RESPONSE`.
- Verify the candidate query's ranking for generic names («polo» with several polos) and for long names on dev. T10 may change `TEXT_MATCH_*` and the query shape by measurement, never by word lists.
- Measure `findMessageCandidates` as T1 criterion 5 states, for latency and recall together, with natural messages and names with shared vocabulary. The measurement runs as `core_app` with RLS forced on `Product`, as `scripts/run-tests.sh` connects, never as the superuser, and the PR records `EXPLAIN (ANALYZE, BUFFERS)`. Measure `findProductsForReading` with 24 products the same way.
- Measure reader tokens per message on the dev split against US$0.003 (reported target, not a gate).
- Out of scope:
  - pendings on screens, and seller routes on pendings;
  - the seller's own messages as a source;
  - the history passed to the reader;
  - image as reader context and several products per photo (task `6hrVWR46qpGFcwq3`). That task only adds identification: each product it identifies without its variant drafts a pending through `checkReaderAnswer`.
- Known limitations kept from the product draft:
  - confident misread removals apply silently;
  - out-of-order arrival with pendings gives two notices;
  - «quiero 2 de esos» after a matched photo gives two notices.
  - Added by this design:
    - A chat order with more than 40 items shows the reader only 40, and a reference to another one ends as `unclear_item`.
    - The candidate search scans the company's products (founder decision, §16), so only `TEXT_MATCH_PAIR_BUDGET / products` words are searched: 30 at 500 products, 12 at 2,000, 5 at 5,000 and 3 above about 8,333, longest first.
      - A product named only with shorter words than the kept ones is found only when it is already an item or a pending.
      - Catalogs above about 10,000 active products degrade: above about 8,333 the floor of 3 words is reached, the budget is passed, and recall falls; at 10,000 products p95 was about 155–185 ms (T1, accepted).
      - The meeting point is Todoist task `6hrWWWJQVCmcM2W3`, a SECURITY DEFINER per-word lookup measured at 84 ms for 30 words on 5,000 products. It replaces only the statement behind `findMessageCandidates`.
    - A doubtful pending whose fifth fitting product was never a candidate can still be resolved when the reader names that product (§6.1). It is not resolved when that product was cut from the context.
    - A text naming a deactivated, archived or deleted product that is neither an item nor a pending never reaches the reader as that product, because candidates are only sellable products. It ends as `not_identified` instead of «Producto no disponible». Listed for the founder: returning inactive products as candidates would let them push sellable ones out of the 8.
    - When the candidate query times out, the message is read without candidates (§5.3).

## 15. Implementation plan

### Order and parallelism

```text
Wave 0:  T0 pendings contract + ProductForReading type + notice kind tuple + order terminal times + migrations + repository
Wave 1 (parallel, after T0):  T1 products reading capabilities   T2 domain rules   T3 notices   T4 reader adapter   T5 eval harness
Wave 2 (parallel, after T1–T5):  T6 use case, wiring and dead-code removal    T7 conversation cases and relabeling (non-tuner; needs the rules sheet)
Wave 3 (after T6, T7):  T8 baseline run of the pinned dev misses
Wave 4 (after T8):  T10 tuning on EVAL_SPLIT=dev
Wave 5 (after T10, and the coordinator's holdout v3):  T11 final measurement
Wave 6 (after T11):  T12 final promotion of the docs (the implement-task skill's last step); both drafts stay until then
```

File ownership per wave, with no overlap between siblings:

| Wave | Task | Owns |
| --- | --- | --- |
| 0 | T0 | the type files, `orders/domain/order-state-machine.ts`, every write path of the two order times (§3 «Order closing times»: `saveCancellation`, `saveStockDeduction`, `savePendingOrder`, `saveStockRestoration` and their use cases `cancel-order.ts`, `deduct-stock.ts`, `register-payment.ts`, `set-delivery.ts`, `checkout.ts`, `register-immediate-sale.ts`, `products/application/restore-cancelled-order-stock.ts`), `orders/composition.ts` (clock wiring for `deduct-stock.ts`, `cancel-order.ts` and `set-delivery.ts` only), the order repository mapping, `prisma/**`, `chat-pending-repository.ts` |
| 1 | T1 | `products/**` except `products/domain/reading-product.ts` (T0) |
| 1 | T2 | `orders/domain/chat-order.ts`, `chat-pendings.ts` (functions), `chat-reading.ts` (functions), `message-order.ts`, `mentioned-price.ts` and their tests |
| 1 | T3 | `orders/domain/seller-notice.ts` (union data fields and choice), `presentation/seller-notice-texts.ts`, `application/describe-chat-message-notice.ts` and their tests |
| 1 | T4 | the new `orders/infrastructure/openai-chat-reader.ts`, `chat-reader-*` files and the pinned JSON |
| 1 | T5 | `apps/core/evals/**` except the contents of `cases/conversations.ts`, the case tables' relabeling and `promptFiles` in `prompt-overlap.test.ts` |
| 2 | T6 | `apps/core/src/**` outside wave-1 files (including passing the signal in `openai-product-chooser.ts`), `prisma/**`, `.env.example`, `evals/lib/production.ts`, `promptFiles` in `evals/lib/prompt-overlap.test.ts`. Wave 2 runs after wave 1, so T6 may also edit wave-1 files for deletions and wiring: `ambiguous_intent` in `ResolvedChatAction` (`chat-order.ts`) and in the `seller-notice.ts` comment, and `createTextMatching` with its wiring in `products/composition.ts`. |
| 2 | T7 | `evals/cases/*.ts` except `index.ts`, `private.ts` and `split.ts` |
| 4 | T10 | only `orders/infrastructure/chat-reader-text.ts`, the schema descriptions in `chat-reader-schema.ts`, `chat-reader-context-text.ts`, the pinned JSON, `TEXT_MATCH_*` defaults and the query in `products/infrastructure/text-candidates.ts` |

The holdout v3 (rules sheet, new catalog, cases) is written outside the repository by isolated workers that the coordinator runs. No task here writes it or reads it, except T11's isolated runner. The rules sheet reaches T7 as a private path from the coordinator.

### T0. Pendings contract, reading types, migration and repository

**Scope:**
- `products/domain/reading-product.ts` (`ProductForReading`, type only).
- `orders/domain/chat-pendings.ts`: types, `chatPendingsSchema`, `PendingLifeFacts`; no transitions.
- `orders/domain/chat-reading.ts`: types only (`ChatReadingContext`, `ReaderAnswer`, refs).
- New outcome kinds in `chat-message-outcome.ts`; `ambiguous_intent` stays until T6.
- The `sellerNoticeKinds` tuple and `SellerNoticeKind` in `seller-notice.ts`, with the new kind names. The `SellerNotice` union is unchanged until T3.
- Prisma model `ChatPendings` and the migration `add_chat_pendings`, with RLS, `lock_timeout` and `statement_timeout`.
- `Order.cancelledAt` and `Order.stockDeductedAt`, in the migration `add_order_terminal_times`: aggregate fields, the one-way parse invariants of §7 and repository mapping. The cancellation and stock-deduction transitions take the use case's time. Every write path in §3 «Order closing times» is covered, including `saveStockRestoration`, which keeps the time.
- `chat-pending-repository.ts`.

**Out of scope:** transitions, checks, use case wiring, notice choice and texts, products queries, `messageOpenIntervals` (T2).
**Acceptance criteria:**
1. A set with one variant pending and `readyRemembered: true`, saved for chat A of company X, reads back equal; company Y reads nothing for chat A.
2. A set that becomes empty with `readyRemembered: false` leaves no row.
3. A stored row with `subject.kind: "other"` reads as `INVALID_STORED_DATA`.
4. Existing outcome rows still parse, and a row with `pending_created` parses.
5. `pnpm --dir apps/core deps:check` passes, with `orders/domain` importing only `products/domain` types.
6. Cancelling an order at 10:00 stores `cancelledAt` 10:00. A payment confirmation that deducts stock at 11:00 stores `stockDeductedAt` 11:00. An aggregate with `stockDeducted: true` and no time fails its parse.
7. A cancelled order whose stock is then restored has `stockDeducted: false`, keeps `stockDeductedAt` 11:00 and still parses. Order detail and lists show it as before.
8. The existing order unit and integration tests stay green, including the void, restoration and immediate-sale paths.

**Tests:** the four `chat-pending-repository.integration.test.ts` titles, the stored-pendings parse title, «saves and reads the cancellation and stock deduction times», «a cancelled order whose stock was restored still parses and keeps its deduction time» and «a second stock deduction call keeps the first deduction time» of §13.
**Depends on:** nothing.

### T1. Products reading capabilities

**Scope:** `findProductsForReading` (one snapshot, a fixed number of queries, driven from `ProductVariant`) and `findMessageCandidates` (searched words, the word cap from the catalog size, the company scan and the coverage ranking of §5.3, with timeout degradation), in application, infrastructure and the `products` composition export. Plus the opt-in benchmark.
**Out of scope:**
- removing text identification and variant resolution (T6);
- orders wiring;
- any index, extension or SECURITY DEFINER function for the candidate query (Todoist `6hrWWWJQVCmcM2W3`).

**Acceptance criteria:**
1. «Polo básico» with active M/Negro and M/Blanco and an archived L/Negro returns `sellable: true`, attributes `Talla: [M]` and `Color: [Negro, Blanco]`, and two variants with prices.
2. An archived product returns `sellable: false` with its name and no variants; a deleted one is absent.
3. «quiero el polo rojo M» returns every active polo among the top candidates; «hola» returns none.
4. «quiero la polera negra M» returns «Polera con capucha oversize». «hola buenas tardes quiero la polera con capucha oversize negra en talla M para mi hija, cuánto cuesta» ranks «Polera con capucha oversize negra edición limitada» first among names like «Polo con capucha negro slim 66».
5. **Measurement plan, recorded in the PR.** The opt-in benchmark runs through `scripts/run-tests.sh`, which connects as `core_app` with RLS forced on `Product`, against the worktree's PostgreSQL with `jit = off` as in production. It makes 50 runs per cell.
   - **Catalog.** Realistic store names built from type, connector, feature, color and style (no synthetic suffixes such as «modelo 3f2a1b»), with a known target per message.
   - **Matrix:**
     - products {500, 5,000, 10,000};
     - messages {a 5-word request; a 14-word natural request with greetings and common words; a 30-word message; a 2,000-character message; a message with two near-forms of one name word, «negra … negro»};
     - catalog shape {mixed vocabulary; 1,000 names sharing «polera» and the colors};
     - other companies {none; 20,000 products}.
   - **Recorded per cell:** p50, p95, the word cap applied, the matched-product count, the target's rank and the `EXPLAIN (ANALYZE, BUFFERS)` plan (a company scan is expected).
   - **Criterion:** in every cell up to 10,000 products, p95 is under 150 ms. The target is in the top 8 in every cell where its words are among the kept words.
   - **If a cell misses:**
     - a latency miss lowers `TEXT_MATCH_PAIR_BUDGET` and measures again, recording the recall cost;
     - a recall miss caused by the word order changes the kept-word order by measurement, never by word lists;
     - if a cell still misses, the result goes to the coordinator before T6 starts.
6. A candidate query that times out returns no ids with `timedOut: true` instead of an error.
7. A stored row that fails its schema returns `INVALID_STORED_DATA`.
8. «poleron» finds «Polerón». With 5,000 products, only the 5 longest distinct words are searched, as stated in §5.3.

**Tests:** the products unit and integration titles of §13.
**Depends on:** T0 (`ProductForReading`).

### T2. Domain rules: reading check, pendings and order application

**Scope:**
- `checkReaderAnswer`, with the precedence of §6.1;
- `fixedShownAnswer`;
- `messageOpenIntervals`;
- `pendingLife`;
- the pending transitions, including `attachOrderless` and the single `advancePending`;
- `applyChatActions`, with pendings and ready memory;
- `increase_quantity`;
- `mentionedPriceOf`.

**Out of scope:** the reader, persistence wiring, notices, texts.
**Acceptance criteria:**
1. Expressed as domain scenarios with fixed reader answers, product criteria 1–30 and 32–41 give the outcomes and the order of the product draft.
2. The review flow «orderless pending → another message creates #1023 → reported payment → "en M"» ends the pending and reports variant only.
3. The three void flows of the §6.2 table give the results written there: a void with another payment still confirmed; two voids; two pendings and two reopened orders.
4. Criteria 32 and 39 go only through `advancePending`, and no other transition handles a later message naming a pending's product.
5. No answer drops a pending's unit:
   - «uno en M» on ×2 and «uno en M y otro en L» on ×2 with Color missing give the §6.2 worked flows, whether the reader answers with `complete_pending` or with two `add`s;
   - a remainder keeps the pending's values from before the message;
   - a photo of a ×2 pending's product keeps ×2, and its QR completion adds ×2.
6. Stated through `messageOpenIntervals`, the reversions in the code (restored stock, a void clearing `completedAt`, a cancellation resetting `deliveryStatus`) never reopen an order.

**Tests:** the `chat-reading.test.ts`, `message-order.test.ts`, `chat-pendings.test.ts`, `chat-order.test.ts` and `mentioned-price.test.ts` titles of §13.
**Depends on:** T0.

### T3. Notices

**Scope:** the data fields of the new `SellerNotice` kinds (names from T0's tuple, with the type-level equality check), their priority, `noticeReferences`, and the `es` and `pt-BR` texts with list joining and the unnamed count.
**Out of scope:** producing the outcomes (T2); push delivery (unchanged).
**Acceptance criteria:**
1. Outcomes `[ready_with_pendings(order #1023, Polo básico, unnamed 1)]` render «Revisa el chat» — «Un cliente dice que terminó el pedido #1023, pero falta completar Polo básico y 1 más.»
2. `[ready_with_pendings, variant_missing]` render «Falta la variante».
3. `[product_not_available(null)]` renders «Un cliente pidió un producto que ya no está a la venta. Revisa el chat.»
4. Every new text of the product draft renders in `es` and `pt-BR`, with and without an order number where the draft has both.

**Tests:** the `seller-notice.test.ts` and `seller-notice-texts.test.ts` titles of §13.
**Depends on:** T0.

### T4. Reader adapter

**Scope:** `openai-chat-reader.ts`, `chat-reader-schema.ts` (one constant schema), `chat-reader-text.ts`, `chat-reader-context-text.ts` (compact rendering), `chat-reader-env.ts`, and the pinned JSON with its test. The author writes the first wording of the instructions without reading eval cases or runs.
**Out of scope:** wiring into the use case (T6); tuning (T10).
**Acceptance criteria:**
1. A recorded strict response with `add P1 Talla M` and `ready` maps to the matching `ReaderAnswer`.
2. A 429 maps to `AI_PROVIDER_UNAVAILABLE`, a refusal to `INVALID_AI_RESPONSE`, and an abort at the deadline to `DEADLINE_EXCEEDED`.
3. Two contexts with different products, items and pendings produce byte-identical schemas and instructions.
4. The worst-case context of §10.1 is rendered at the ceiling in force (`READER_MAX_PRODUCTS`, 24 unless criterion 5 lowers it), and the pinned test records its token count. Its limit is derived from the cost bound rather than fixed: the tokens that keep input plus 1,000 output tokens (with reasoning) at or under US$0.003, about 24,000 when reasoning is zero. A failing count has the same remedy as criterion 5, so the test never stays red without a prescribed fix. The context: 24 products of 6 × 12 values, with a different price for each combination, counted at about 10–12 tokens per priced line; 40 items; 10 doubtful pendings of 4 candidates, cut to the ceiling; 2,000 characters.
5. With the pinned effort, the reasoning tokens measured on that context and on a 10-action answer are recorded. `max_output_tokens` is set from them (§14). The worst-case cost (input, plus output with reasoning) is at most US$0.003; otherwise `READER_MAX_PRODUCTS` is lowered until it is, and the value is recorded.
6. The instructions define `complete_pending.quantity` as the units of the pending this answer covers and `add.quantity` as the total wanted, and the pinned JSON records it.
7. The pinned JSON changes only when the instructions, the schema, the settings or the context text change, and the prompt-overlap test stays green.
8. No string for the model exists under `orders/domain` or `orders/application`.

**Tests:** the orders infrastructure titles of §13.
**Depends on:** T0.

### T5. Eval harness

**Scope:** every row of §11.1 owned by T5:
- the catalog as data, and the second company seeding;
- the conversation pass and its runner, with events on the simulated clock;
- notice scoring, with `tools` removed;
- the per-action count of ignored actions;
- the gate report with cost, cached tokens and p95;
- `EVAL_PRIVATE_DIR` with real-path checking and private output, and `EVAL_REPEAT_TAGS`;
- the private loader;
- deleting the text pass;
- cleaning `picks.ts`, `rebuild.ts`, `scripts/rebuild-report.ts` and `scorers.test.ts` of the removed certainties and of `ambiguous_intent`;
- the new outcome kinds in `outcomeKinds`;
- the empty `cases/conversations.ts`, registered in `index.ts`;
- removing `tools` from the existing case tables mechanically;
- the README sections, with the private files format as a schema-only section;
- `evalInputs` of `prompt-overlap.test.ts` over conversation step texts;
- notice kinds in expectations taken from T0's `sellerNoticeKinds`.

**Out of scope:** writing or relabeling cases (T7); removing `ambiguous_intent` from `outcomeKinds` (T7); `promptFiles` (T6).
**Acceptance criteria:**
1. A two-message «photo then size» conversation fixture runs against the current code and reports one record per message, each with the conversation id.
2. A conversation with `advance_days 8` between a `report_payment` and a message runs both the event and the message eight simulated days later.
3. `EVAL_PRIVATE_DIR=/tmp/x` with a two-product catalog and one case seeds the private company and writes the records, and any judge output, only under `/tmp/x/runs/`. A path inside the repository is refused, also through a symlink. The run's stdout holds neither the case id, nor the case text, nor the judge's reason.
4. The report of a fixture run shows the five gate lines, per-family counts, the cost per message and p95 latency.
5. `grep -r "ambiguous_intent" apps/core/evals/lib apps/core/evals/scripts` finds nothing.
6. The README's private files format section has no example input, and a test checks that no suite case text appears in it.

**Tests:** the evals unit titles of §13.
**Depends on:** T0 (outcome kinds).

### T6. Use case, wiring and dead-code removal

**Scope:**
- `applyChatMessage` per §5.1, with the order reads `findChatOrderTarget` and `findChatOrdersOpenedSince`;
- the handler's log fields;
- the job signal passed to the visual chooser;
- `promptFiles` in `prompt-overlap.test.ts`: the deleted files removed and the reader files added, in the same change that deletes them;
- the wiring in `orders/composition.ts` and `products/composition.ts`;
- the env vars and `.env.example`;
- deleting every file listed in «Removed» (§2);
- removing `ambiguous_intent` from the domain union, with the migration `remove_ambiguous_intent_outcomes`;
- rewiring `evals/lib/production.ts` to the new deps.

**Out of scope:** prompt wording beyond what T4 wrote; eval cases.
**Acceptance criteria:**
1. With a fake reader, the `apply-chat-message.integration.test.ts` and `order-repository.integration.test.ts` titles of §13 pass against the real database.
2. `grep -r "shared/ai-tools\|chooseTextProduct\|chooseVariant\|ambiguous_intent" apps/core/src apps/core/evals/lib apps/core/evals/scripts` finds nothing.
3. `scripts/ci.sh` is green, including dependency-cruiser and knip, with no new known violation.
4. Without `OPENAI_API_KEY`, a photo without a caption still adds, a photo with a caption still adds or drafts with no `caption_not_applied`, and a text is skipped as `reader_disabled`.
5. Criterion 45 review step:
   - The T6 reviewer reads every new or changed file under `orders/domain` and `orders/application` in full.
   - The reviewer also runs a grep for string literals with two or more words, in double quotes, single quotes and backticks, over those folders, excluding tests.
   - Only identifiers, error messages for logs and Zod issue paths may remain; no buyer-facing or model-facing text.
   - The result goes in the PR.

**Tests:** the `apply-chat-message.test.ts` and integration titles of §13; the existing handler and notice integration tests stay green.
**Depends on:** T1, T2, T3, T4, T5.

### T7. Conversation cases and relabeling (written by a non-tuner)

**Scope:**
- At least 20 conversations of 2 to 4 messages in `cases/conversations.ts`, covering: photo then size; partial completion; replacement; decline; two pendings; doubtful product then choice; doubtful product by price (criterion 40); a caption completing another product's pending (criterion 30); a pending across an order closed by a reported payment; an orderless pending across an order another message created and closed; «listo» with a pending and its completion.
- Relabeling of the existing dev and test expectations whose meaning changed, from the rules sheet only:
  - `int-injection-cancel`, `int-injection-price-zero`, `int-injection-system`, `hold-injection-paid`, and any case that accepts `ambiguous_intent`;
  - unnamed adds keep `unnamed_add`;
  - variant-only texts without a pending keep `variant_only`;
  - bundle prices follow the closeness rule;
  - doubtful photo captions follow the photo rules.
- Tag `pinned-miss` on the 28 ids of the product draft.
- A conversation where a doubted caption's photo advances an existing pending expects the second «Falta la variante» (`expectsRepeatNotice`), as the product draft accepts.
- Removing `ambiguous_intent` from `evals/cases/schema.ts`.

**Out of scope:** running evals of the new reader, reading any run, tuning, prompts.
**Acceptance criteria:**
1. `pnpm --dir apps/core test:unit` parses every table, and the prompt-overlap test is green.
2. At least one conversation of each listed family exists in dev and one in test (by the id hash).
3. Every relabeled case cites its rules-sheet rule in its `ambiguous` note or in a comment.
4. The 28 pinned ids carry `pinned-miss`. The README lists `txt-gorra-two-candidates` and `txt-polera-two-candidates` as not applicable, since the text pass no longer exists.
5. `grep -r "ambiguous_intent" apps/core/evals` finds nothing.

**Tests:** the parse tests of the case tables and the prompt-overlap test.
**Depends on:** T5 and the coordinator's rules sheet. The writer is not the author of T4 or T10.

There is no T9: the docs work is T12. The other numbers stay stable so references to them hold.

### T8. Baseline run of the pinned dev misses

**Scope:** after T6 and T7, one `EVAL_SPLIT=dev` run with `EVAL_REPEAT_TAGS=consistency,pinned-miss`. Report the 19 dev pinned ids per action, and the dev gate lines. No code change.
**Out of scope:** the test split, holdout v3, prompt changes.
**Acceptance criteria:** the report lists each of the 19 dev ids with its ignored actions per repetition, the cost per message and the p95 latency.
**Depends on:** T6, T7.

### T10. Tuning on dev

**Scope:** the files T10 owns in the ownership table, using only `EVAL_SPLIT=dev` (with `EVAL_CASES` and tags for subsets).
**Out of scope:** the test split, holdout v3, eval cases, domain rules.
**Acceptance criteria:**
1. After tuning, the dev report, with the 19 pinned dev ids run 3 times, has no ignored action.
2. The prompt-overlap test and CI are green.
3. The schema still does not depend on the context.

**Depends on:** T8.

### T11. Final measurement

**Scope:** with the code frozen after T10, in this order and once each:
1. `EVAL_SPLIT=test` with `EVAL_REPEAT_TAGS=consistency,pinned-miss`. This reads the 9 test pinned ids and completes the 28.
2. Holdout v3 by an isolated runner, with `EVAL_PRIVATE_DIR=<coordinator path>` and `EVAL_REPEAT_TAGS=consistency`.

Nothing is tuned after step 1 in this task. Only the aggregate gate lines leave the private folder: the whole run and per family, with no case ids, inputs or records.
**Out of scope:** any change to prompts, cases or code.
**Acceptance criteria:** the pull request reports:
- the 28 pinned misses: no action ignored in any repetition, and the two text-identification cases as not applicable;
- the holdout v3 gates of the product draft, whole and per family: at least 85% right, 0 ignored actions, 0 conversations with two notices for one product except the expected ones, at most 1 wrong silent change, at most 10% extra notices, and the cost per message against US$0.003.

A gate that is not met is reported to the founder as not met.
**Depends on:** T10, and the coordinator's holdout v3 in the private folder.

### T12. Final promotion of the docs

**Scope:**
- Rewrite `docs/message-to-order.md` from both drafts with the values after tuning.
- Delete `docs/ai-tools.md` and its links.
- Update `docs/image-product-search.md` (no text identification or variant chooser), `docs/notifications.md` and `docs/orders.md` where they name the removed pieces.
- Delete both drafts, following the Documentation skill.
- Run the memory maintainer: memory `10510dcc` (a caption never adds a different product; a doubted caption gives no notice) is superseded by criterion 30 and the doubted-caption notices of this design.

This is the implement-task skill's final promotion step, not a separate wave-3 task.
**Out of scope:** eval numbers in the permanent docs.
**Acceptance criteria:** no doc names a deleted file or env var; every link resolves; `docs/drafts/` holds neither draft.
**Depends on:** T11.

### Final verification

On a real phone with WhatsApp and a ready catalog, check product criteria 1, 3, 4, 5, 8, 22 and 32. The results go in the pull request description.

## 16. Questions decided by the review gate

| Question | Answer | Decided by | Reason | Discarded alternatives |
| --- | --- | --- | --- | --- |
| How are a chat's pendings stored? | One `ChatPendings` row per chat with a Zod-validated JSON list (at most 10) and `readyRemembered` | Design and performance reviewers of the architecture review gate, consolidated by the coordinator | The list is always read and written whole under the chat lock, nothing else queries it, and it matches `ChatMessageOutcome`. Per message it costs one PK read, one PK `FOR UPDATE` and at most one upsert. Per-pending FKs add nothing, because a deleted product is handled when the pending is addressed. | A `ChatPending` table with one row per pending, plus a per-chat row for `readyRemembered` |
| Which catalog products does the reader get for a text? | The products whose names cover the most of the message's searched words, ranked by coverage (sum of per-word similarity at 0.3), top 8. To them are added the order items' and pendings' products, all under the one product ceiling of §2. The candidate query degrades to no candidates on timeout. | Design and performance reviewers, consolidated by the coordinator | One path for any catalog size, so holdout v3 measures what stores will see. Retrieval bounds the context. Coverage keeps the named product first where a ranking by the best single word ties on common words. | The whole active catalog up to 40 products, with retrieval above that (15–30k tokens per message and two paths to measure). A ranking by the best single word with a survivor cut, which loses the named product on shared vocabulary. |
| A product photo whose caption asks for a different product: what does the seller get? | The generic «Revisa el chat». A caption naming a product with an open pending completes that pending instead (criterion 30). | Design and performance reviewers, consolidated by the coordinator | «Never silent» is a closed product decision, and criterion 30 keeps the pending completion. | Ignoring the other product silently |
| How is the cost of the candidate search bounded, given that the trigram index cannot serve the app role (forced RLS on `Product`, non-leakproof pg_trgm operators)? | Keep the company scan and state its real cost: company products × searched words, at about 4.5 µs per pair (measured as `core_app` in T1; the first estimate was 3 µs, 14–40 ms at 500 products, 92–460 ms at 5,000). The searched words are capped from the company's product count (budget 25,000 pairs) so that p95 stays near 150 ms up to about 5,000 products; at 10,000 products it measured about 155–185 ms, accepted as a known limitation. T1's benchmark runs as `core_app` with RLS forced. Catalogs above about 10,000 products degrade (§14). | Founder, 2026-10-28, on the performance reviewer's options | It keeps the design inside the current security model with no new database privilege, and stores today are far below 10,000 products. The way past the limit is measured and has its own task. | Marking the pg_trgm operators `LEAKPROOF` (a security judgment on extension functions, which an extension update can reset). A SECURITY DEFINER per-word lookup (measured at 84 ms for 30 words on 5,000 products), deferred to Todoist task `6hrWWWJQVCmcM2W3`, which replaces only the statement behind `findMessageCandidates`. A `(companyId, name)` GIN with `btree_gin`, which RLS also prevents from serving the matches. |

### Decisions taken by the review gate, pending founder confirmation in the final pull request

**Generic «Revisa el chat» cases beyond the product draft.** The product draft closes the generic text for a doubt, a request the chat never does, a product outside the ones given to the reader, and a non-whole quantity. This design adds:

| Case | Rule |
| --- | --- |
| `text_too_long` | A text over 2,000 characters is not read. |
| `not_the_shown_product` | A photo caption asks for another product that has no pending. |
| `too_many_actions` | A message asks for more than 10 changes. The first 10 apply. |

These cases keep their specific notice instead: an unknown attribute name gets «Variante no disponible», a pending that ended before the action reports variant only (criteria 18 and 19), and an item not in the order gets the unclear-item text.

**Pending rules:**
- A conflicting `add` of a product with pendings replaces the most recently changed pending of that product («Replacing» rule) and never opens a parallel request. «y también uno blanco» on a pending {Color Negro} therefore replaces it.
- `complete_pending.quantity` is the units assigned and `add.quantity` the new total. Two or more actions of one answer on one pending are all assignments. A photo's fixed answer states no quantity for an existing pending.
- A partial assignment splits the pending, and the remainder keeps its earlier values. The split part counts toward the limit of 10 and keeps the remembered «listo».
- A lot price is judged with the quantity it was stated for, goes whole on the first item of its request, and is cleared from the rest of that request (`requestId`).

**Values and limits:**
- `TEXT_MATCH_CANDIDATES` 8, `TEXT_MATCH_MIN_SIMILARITY` 0.3, `TEXT_MATCH_PAIR_BUDGET` 25,000, words between 3 and 30, longest first.
- Candidate statement timeout 1 s, degrading to no candidates.
- `READER_MAX_PRODUCTS` 24, `READER_MAX_ITEMS` 40, `READER_MAX_TEXT_CHARS` 2,000; `CHAT_PENDING_TTL_DAYS` 7, `CHAT_PENDING_MAX` 10.
- At most 10 actions per answer, plus `moreActions`; Zod accepts 30.
- `max_output_tokens` 2,000 plus the measured reasoning tokens; the worst-case cost is bounded at US$0.003, lowering the product ceiling if needed.

**Orders and evals:**
- `Order.cancelledAt` and `Order.stockDeductedAt` (the first deduction, kept on restoration), with a development-only backfill.
- `findChatOrdersOpenedSince` returns the earliest 20 orders after `since`.
- An inactive product named only in a text ends as `not_identified` (§14).
- The eval private data loads at run time from `EVAL_PRIVATE_DIR` and is never committed.

### Deferred items with real risk

The founder decides whether to create a Todoist task for each:
- **Large catalogs.** Candidate search above about 8,000 active products degrades in recall and latency (p95 about 155–185 ms at 10,000, accepted in T1). Task `6hrWWWJQVCmcM2W3` already exists.
- **Editing order items from web or mobile** (release gate, memory `de4d23f5`). A pending completed wrongly can only be fixed by cancelling the order.
- **Inactive products named in a text.** They get `not_identified` instead of «Producto no disponible».
