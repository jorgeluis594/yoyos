# Message to order without silent losses: technical design

**Status:** draft for review: no open questions; §17 lists the decisions taken unless the founder objects. Based on `docs/drafts/pedidos-por-mensaje-que-la-ia-no-pierda.md` (commit `a55f70c2`). Base: `jorgeluis594/pedidos-por-mensaje-que-la-ia-no-pierda` at `a55f70c2` (main at `ae7715ef`), plus `origin/main` `65bd3d70` (PR #248) that the coordinator merges in before wave 0 (§16).

Holdout v3 is private and spent: its cases are cited by id only. No text of this document, of a prompt or of a committed case copies or paraphrases its messages.

## 1. Technical goal

Every incoming message that asks for something either changes the chat order correctly or produces a seller notice. The reader gains one action kind (`payment_request`), a pending target and a `decrease` mode for quantity changes, and two context facts (the chat's latest order is closed; which pending or item the photo just sent left). The domain check turns a no-intent caption on a product photo into the photo's fixed answer, resolves an unnamed quantity after the photo just sent onto what that photo left, applies set, lower and raise to named items and pendings, and records a payment request as a problem that carries the order state and the pendings left. Products adds not-sellable products to the text candidates so a named inactive product reaches «Producto no disponible». The chat keeps one new structured memory per chat (the last read incoming message was a photo, and what it left) in the existing `ChatPendings` row. Settings reach the production worker with upper bounds, and the worst-case reader cost at those bounds is a blocking test. The eval harness gains described photos in private runs (including «matched nothing»), reader answers and invalid-action reasons in dev records, case-level photo partitioning, a consistency metric and the metrics the product draft reports apart.

```text
message_created ─▶ apply-chat-message (ordered per chat; unchanged queue, deadline and retries)
   ├─ skip: outgoing, or a text with no letter or digit (no row, no memory change)
   ├─ photo cascade (QR, visual 0.8)                                                      outside the transaction
   ├─ context: chat order target → latestOrder; pendings (pendingLife); ChatPendings.lastIncomingPhoto
   │           → photoJustSent marker on one pending or item; products (shown + pendings' + items' + sellable
   │           candidates + not-sellable candidates), ceiling READER_MAX_PRODUCTS (bounded)    outside the transaction
   ├─ reader: one call (schema + payment_request, change_quantity on a pending, decrease)   outside the transaction
   ├─ domain: checkReaderAnswer → ResolvedChatAction[]                                     pure
   │           (no_intent on a product photo → fixed answer; photo + only never-does requests → fixed answer + them;
   │            unnamed set after the photo just sent → its pending or item; quantity-only completion otherwise → unnamed_add)
   └─ transaction: lock Contact → outcome re-check → lock Order → lock ChatPendings → pendingLife
                   → applyChatActions (payment_requested filled with order state and pendings left)
                   → nextLastIncomingPhoto(message, previous, applied) → save order, ChatPendings (pendings, readyRemembered,
                     lastIncomingPhoto), OrderMessage, ChatMessageOutcome
─▶ chat_message_processed (only when a notice is due) ─▶ send-chat-message-notice (new body: payment request)
dead letter / permanent failure: record failed → lastIncomingPhoto = null (same transaction) → notice → release
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| No-intent caption on a product photo | `checkReaderAnswer` answers `no_intent` on `photo_product` with `fixedShownAnswer(context)` and no `captionDoubt`: the shown product is added (one sellable variant) or left pending with «Falta la variante», silent when added, exactly as a photo without caption. |
| Photo whose caption asks only what the chat never does | When every action of a `photo_product` answer is `payment_request` or `not_allowed`, the check prepends the fixed shown answer: the product follows the photo rules and the requests stay problems. A caption with any action about the shown product (`add` of the shown product, `decline_shown`, `complete_pending`) is read as today. |
| Readable text | `hasReadableText(text)` is true when the text has at least one Unicode letter or digit (`/[\p{L}\p{N}]/u`). A text without one is skipped as `empty_text` (no row, no reader call, no memory change); a caption without one is no caption (fixed answer, no reader call). |
| Payment request | New reader action `payment_request`; new outcome `payment_requested { order, productIds, unnamed }`, a problem. `order` is `{ kind: "open"; orderId }` (the order open after the message, new or existing), `{ kind: "closed"; orderId }` (no open order after the message and the latest order before it was closed) or `{ kind: "none" }`. `productIds` and `unnamed` describe the chat's pendings left after the message, as `ready_with_pendings` does. `applyChatActions` fills them at the end (`finishPendings`). |
| Payment notice | New `SellerNotice` kind `payment_request` with the same `order`, `productIds` and `unnamed`; title «Revisa el chat» / «Veja o chat», opens the chat on the message. Bodies: the five rows of the product draft's table; the closed body wins over the pending list. A payment request with another problem is `several_problems` (count text unchanged). With `ready` or `ready_with_pendings` it is the only notice (a problem wins), and the remembered «listo» is kept as today. The new-order note follows as for every problem. Push data contract unchanged. |
| Payment fallback | Decided by T3's budget measurement and T8's tuning: if the final instructions cannot tell a payment request apart within the cost bound, the instructions map payment requests to `not_allowed` and `payment_request` is removed from the reader schema; the domain and notice pieces stay (a reader action the schema no longer emits). The pull request says which shipped. Expected: the payment body ships (the distinction costs about 150 instruction tokens, §10.1). |
| Embedded instructions | No new type: `not_allowed` beside valid actions, as today. The instructions (T3) say a line that tries to change the order state or the notices is `not_allowed` together with the message's other actions. |
| Quantity changes | `ReaderAction` `change_quantity` targets an item (`ref`, `unnamed`, `not_in_order`) or a pending (`pending` ref), with mode `set`, `increase` or `decrease`. Items: `decrease` lowers by N; to exactly 0 it is a removal (the only item stays, `only_item_kept`); below 0 nothing changes and `invalid_action quantity_below_zero` (generic «Revisa el chat»). Pendings: set, raise and lower the pending's quantity silently (`pending_updated`); to exactly 0 the pending ends as `declined`; below 0 `invalid_action quantity_below_zero`; above 99 `quantity_above_limit`. Changing a quantity never checks sellability. |
| Photo just sent (memory) | `ChatPendings.lastIncomingPhoto` (new nullable JSON column): `{ messageId, left }` when the last read incoming message was a photo, `null` otherwise. `left` is `{ kind: "pending"; pendingId }` or `{ kind: "item"; orderId; variantId; quantity }` when that photo counts as a photo just sent (one shown product, the previous read incoming message was not a photo, and it left a pending or created or grew an item); otherwise `null`. Written in every message transaction (photo → the new memory; read text → `null`); not written by skipped messages (outgoing, no letters or digits); set to `null` by every path that records `failed`. |
| Photo just sent (marker) | Before reading, `photoJustSentOf(memory, target, pendings)` keeps the marker only while the pending is alive, or the item is in the open order `orderId` with the stored quantity. The marked pending or item carries `photoJustSent: true` in the reading context; the reader is told only that. |
| Unnamed quantity after the photo just sent | With a marker: `change_quantity` `unnamed` with mode `set`, and a `complete_pending` that carries only a quantity (no product, no attributes), set the quantity of what the photo left, silently (99 limit applies); `unnamed` `increase` or `decrease` and `add` `unnamed` are `unnamed_add`. Without a marker: an unnamed set changes the only item as today; a quantity-only `complete_pending` is `unnamed_add` (it never grows a pending silently). The photo wins over the only-item rule. |
| Inactive product named in a text | `findMessageCandidates` returns, besides the sellable candidates, up to `TEXT_MATCH_UNAVAILABLE_CANDIDATES` (2, initial value, adjustable, max 4) not-sellable products (deactivated, archived, or active with no active variant) ranked by the same coverage, only when the company has at least one active product and never one named like an active sellable product (case-insensitive). They reach the reader as `sellable: false` (name only, no variants: a few tokens each). An add of one reports `product_not_available`. In a `one_of`, a not-sellable product whose normalized name equals a sellable one's is dropped. Deleted products are never candidates (`not_identified`). |
| Closed latest order | `ChatReadingContext.latestOrder` is `open`, `closed` or `none` (cancelled counts as none). The context tells the reader when the latest order is closed; a change to it is answered with item `not_in_order`, which the existing transition reports as `order_closed` («…que ya no se puede modificar»). If the token budget does not allow the line, it is left out and the generic body stays; the pull request says which shipped. |
| Prices | No code change: other currencies are already dropped by `statedMoney`, and a stated price is already kept on adds. The instructions (T3) say a price in another currency is never `not_allowed` unless it asks to change a price, and a price that identifies the product goes in the add's `price`. |
| `invalid_action` reasons | New reasons `malformed` (an incomplete or inconsistent reader action; today folded into `unknown_reference`) and `quantity_below_zero`. Both notify with the generic body. |
| Reader settings bounds | Zod `max()` on every reader setting, read from one exported bound so the worst-case test renders at it: `READER_MAX_PRODUCTS` max = the largest value whose worst case fits US$0.003 (expected 18, measured by T3 and re-measured by T8; default = max), `READER_MAX_ITEMS` max 40, `READER_MAX_TEXT_CHARS` max 2000, `AI_TIMEOUT_MS` max 80000 (under the 85 s attempt deadline), `CHAT_PENDING_TTL_DAYS` max 30, `TEXT_MATCH_CANDIDATES` max 8 (`MAX_CANDIDATES`), `TEXT_MATCH_UNAVAILABLE_CANDIDATES` max 4, `TEXT_MATCH_MAX_WORDS` max 30, `TEXT_MATCH_PAIR_BUDGET` max 50000, `APPLY_CHAT_MESSAGE_CONCURRENCY` 1 to 64. A value above its bound fails at startup. `AI_READER_MODEL` stays a free string: its cost is a property of the model's price, not of a number code can bound; changing it requires re-running T3's measurement. |
| Worst-case cost test | The worst case of `chat-reader.model-text.test.ts` (PR #248) becomes blocking: rendered at the settings' upper bounds, with the o200k count, input plus 1,000 output tokens at `gpt-6-luna` prices must be at most US$0.003. Compacting per-combination prices and raising the ceiling back to 24 stay in Todoist `6hrqHJghCXGwX26V`, which the founder scheduled after this task. The US$0.003 bound never changes. |
| Production worker | `compose.prod.yaml` `worker` gets `AI_READER_MODEL`, `AI_TIMEOUT_MS`, `CHAT_PENDING_TTL_DAYS`, `READER_MAX_PRODUCTS`, `READER_MAX_ITEMS`, `READER_MAX_TEXT_CHARS`, `TEXT_MATCH_CANDIDATES`, `TEXT_MATCH_MIN_SIMILARITY`, `TEXT_MATCH_PAIR_BUDGET`, `TEXT_MATCH_MIN_WORDS`, `TEXT_MATCH_MAX_WORDS`, `TEXT_MATCH_UNAVAILABLE_CANDIDATES` and `APPLY_CHAT_MESSAGE_CONCURRENCY`, each `${VAR:-<code default>}`. `PRODUCT_MATCHER_PROVIDER` and `PRODUCT_MATCHER_MODEL` stay: the visual chooser (`openai-product-chooser.ts`) still reads them. |
| Eval: described photos in private runs | Private message cases and conversation steps run with `photo: { shows }` (product key, `not_product`, or the new `not_found`: a photo that matched nothing), plus optional `label`, identified by hand as the interpretation pass does. Photo files stay refused. The README states it. |
| Eval: dev-only diagnostics | In a run with `EVAL_SPLIT=dev` and no `EVAL_PRIVATE_DIR`, each record keeps `readerAnswer` (the reader's validated JSON output, through the adapter's `observe` option) and `invalidReasons` (the `reason` of each `invalid_action`). Test-split and private records keep neither. |
| Eval: photo cases apart | Each record carries `photoCase`: the message is a photo, or it belongs to a conversation with a photo in any step. The gate lines are reported whole, without photo cases and photo cases only. The holdout v4 88% gate reads the line without photo cases. |
| Eval: consistency | For every case run more than once: consistent when all repetitions have the same signature. Reported as consistent / repeated, whole and per family, also in a private run's aggregate lines. `EVAL_REPEAT_TAGS=all` repeats every case. |
| Eval: metrics apart | Silent adds on question captions (messages tagged `question-caption` whose actual result added the shown product with no notice), payment requests inside a count (outcomes with `payment_requested` and notice `several_problems`), notices by kind (which bodies shipped: `payment_request`, `order_closed`). |
| Eval: dev cases | Written from the updated rules sheet by a worker who does not tune (T5), with ids that fall in the dev split. Relabeled by rule: `int-photo-emoji-caption` and its paraphrases (pending, `variant_missing`, no reader call) and `conv-unnamed-add-after-photo` (pending ×3 silent, then the color completes it with ×3). |
| Measurement | T8 tunes on `EVAL_SPLIT=dev` with real models: at most 6 full dev runs (the first is the baseline) and at most 25 subset runs (`EVAL_CASES` or tags), cost of each run reported. T9 reads the frozen test once. T10 runs holdout v4 once (every case 3 times, first repetition scored) and the 12 holdout v3 photo cases once, from folders outside the repository, by an isolated runner. |
| Baselines | Holdout v3 `2026-10-29T17-19-31-446Z` (`~/yoyos-orquestacion/un-solo-modelo/holdout-v3-private/runs/`). The frozen test report `2026-10-29T17-14-51-084Z` is not on this machine: the comparison uses the gate lines published in PR #237 (§15). |
| Contracts and mobile | No change to `shared/contracts/` or to mobile. The push data stays `{ v: 1, companyId, messageId, target }`. |
| Deferred with real risk | Editing order items from web or mobile (release gate, already recorded): a wrong silent change can still only be fixed by cancelling the order. A product photo resent with a comment grows a single-variant item silently (accepted by the founder's rule). |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Use case | `apps/core/src/features/orders/application/apply-chat-message.ts` | `hasReadableText` checks only non-blank (`:139`). Text skip reason `empty_text`. `applyPhoto` reads a caption only when readable; `answerFor` gives the fixed answer for a photo without caption. Transaction: lock contact → outcome → order target → pendings → `pendingLife` → `applyChatActions` → save. Modified. |
| Reading context | `orders/application/reading-context.ts` (`selectReadingProducts`, `listedItems`, `buildReadingContext`) | Priority: shown, variant pendings, doubtful candidates, items, text candidates; no latest-order state, no photo marker. Modified. |
| Check | `orders/domain/chat-reading.ts` (`checkReaderAnswer`, `fixedShownAnswer`) | `no_intent` returns `[no_intent]` for every kind (`:131`), so a product photo with a no-intent caption is dropped. `doubt` on a photo falls back to the fixed answer. `not_allowed` → `request_not_allowed`. `malformed` → `invalid_action unknown_reference`. `change_quantity` has `increase` and `set` on items only. A quantity-only `complete_pending` updates the pending. Modified. |
| Order and pendings transitions | `orders/domain/chat-order.ts` (`applyChatActions`, `finishPendings`), `pending-transitions.ts` (`advancePending`, `draftPending`, `declinePending`) | No pending quantity change; no item decrease by N. Modified. |
| Pendings type and row | `orders/domain/chat-pendings.ts` (`ChatPendings = { pendings, readyRemembered }`, `chatPendingsSchema`); `infrastructure/chat-pending-repository.ts` (deletes the row when no pending and no «listo»); table `ChatPendings (companyId, chatId, pendings Json, readyRemembered, updatedAt)` | Extended with `lastIncomingPhoto`. |
| Outcomes | `orders/domain/chat-message-outcome.ts` (union and Zod schema; `invalid_action` reasons `unknown_reference`, `not_the_shown_product`, `quantity_not_whole`, `text_too_long`, `too_many_actions`) | Extended. Stored as JSON in `ChatMessageOutcome`; no SQL change. |
| Failed outcome | `infrastructure/chat-message-outcome-repository.ts` `recordFailedOutcome`, called by `chat-message-handler.ts` for permanent errors and the dead letter | Also clears `lastIncomingPhoto`. |
| Notices | `orders/domain/seller-notice.ts` (`sellerNoticeKinds`, `SellerNotice`, `chooseSellerNotice`, `noticeReferences`), `presentation/seller-notice-texts.ts` (es, pt-BR) | `request_not_allowed` → `not_applied`. New kind `payment_request`. |
| Reader adapter | `orders/infrastructure/openai-chat-reader.ts` (`readerRequestSettings`, effort `none`, `max_output_tokens` 2000), `chat-reader-schema.ts` (one constant schema, `actionKinds`, `convertAction`), `chat-reader-text.ts`, `chat-reader-context-text.ts`, `chat-reader.model-text.json` and test | Modified. The adapter exposes no hook to read its output. |
| Token measurement | `chat-reader.model-text.test.ts` in `origin/main` after PR #248 (merge `65bd3d70`, 30/10/2026 15:57): o200k count; worst case 29,860 input tokens at 24 products, US$0.003486, reported without blocking; usual case 2,603 tokens, US$0.00076, blocking. Not yet in the integration branch. | The coordinator merges `origin/main` before wave 0. T3 makes the worst case blocking. |
| Reader settings | `orders/infrastructure/chat-message-limits-env.ts` (`READER_MAX_PRODUCTS` default 24, no max; `READER_MAX_ITEMS` 40; `READER_MAX_TEXT_CHARS` 2000; `CHAT_PENDING_TTL_DAYS` 7), `chat-reader-env.ts` (`AI_READER_MODEL` `gpt-6-luna`, `AI_TIMEOUT_MS` 20000, no max), `chat-message-policy.ts` (`APPLY_CHAT_MESSAGE_CONCURRENCY` via `Number(...) \|\| 16`), `products/composition.ts` (`TEXT_MATCH_*`, `PRODUCT_MATCH*`, `PRODUCT_MATCHER_*`) | Bounds added. |
| Production worker | `compose.prod.yaml` service `worker` | Passes R2, `OPENAI_API_KEY`, `PRODUCT_MATCHER_*`, `IMAGE_*`, `PRODUCT_MATCH_*`; none of the reader, pendings, text-match or concurrency settings. |
| `PRODUCT_MATCHER_*` | `products/composition.ts:84–113` | Still used by the visual chooser. Kept. |
| Text candidates | `products/infrastructure/text-candidates.ts` (`coverageQuery`: `status = 'active'` and an active variant), `application/find-message-candidates.ts` (`MessageCandidates`) | Only sellable products. Extended with not-sellable ones. |
| Products for reading | `products/domain/reading-product.ts` (`sellable`), `infrastructure/reading-products.ts` | An archived product reads `sellable: false`, name only; deleted is absent. Reused as is. |
| Eval private loader | `apps/core/evals/cases/private.ts` (`loadPrivateData`) | Refuses `pass: "image"` and photo `file`s; `photo: { shows }` (product key or `not_product`, optional `label`) already loads. The holdout v3 translation dropped its 12 photo cases (7 messages, 5 conversations) because the README says private runs have no photos and because one needs «matched nothing», which `shows` cannot say. |
| Eval photo identification | `evals/lib/production.ts` `photoIdentification` | `shows` → visual 0.95, `label` → QR, `not_product`; no `not_found`. |
| Eval records and report | `evals/lib/case-record.ts`, `run-case.ts`, `report.ts` (`GateLines`, flips), `suite-output.ts`, `model-suite.ts` | No reader answer, no invalid-action reason beyond outcome kinds, no photo-case partition, no consistency rate, no tag metrics. |
| Eval kinds | `evals/cases/schema.ts` (`outcomeKinds` hand copy; `noticeKind` from `sellerNoticeKinds`); README «Private files format» lists both | Extended with `payment_requested` and `payment_request`. |
| Eval cases | `evals/cases/interpretation.ts`, `conversations.ts`, `paraphrases.ts`, `split.ts` (SHA-256 of the base id) | `int-photo-emoji-caption` (test) expects silence; `conv-unnamed-add-after-photo` (test) expects the unnamed-add notice. Relabeled. |
| Prompt-overlap rule | `evals/lib/prompt-overlap.test.ts` | Unchanged; covers the new instructions and the new cases. |
| Holdout v4 | `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v4-private/` | Being written by an isolated writer outside the repository (catalog draft only on 30/10). Translated by T7. |

## 4. Gaps this design closes

1. A product photo with a no-intent caption is dropped silently (§6.1, T2).
2. A payment request is read as no intent and gets no notice; an embedded instruction next to a valid add gets none (§6.1, §6.3, T2, T3).
3. Clear quantity changes on a named item or pending end in a generic notice: no decrease by N, no pending quantity change, «one more of X» read as an unnamed add (§6.1, T2, T3).
4. A set quantity right after a product photo cannot be applied: earlier messages are never read and nothing records what the photo left (§6.2, §7, T6).
5. A named inactive product never reaches the reader, so it ends as «Producto no reconocido» (§5.2, T1).
6. A text or caption of emoji only costs a reader call (§5.1, T6).
7. The reader's worst case is 16% over the cost bound, the settings have no upper bound and never reach the production worker (§10.1, T3).
8. The eval cannot run described photos in private runs nor a photo that matched nothing, keeps no reader answer, and does not report photo cases apart, consistency or the product draft's extra metrics (§12.1, T4).

## 5. Use cases

### 5.1 `applyChatMessage` (modified), feature `orders`

`input`, `access` (`{ companyId, messageId }` from the queue payload) and output unchanged. Deps change:

```ts
// ApplyChatMessageDependencies: unchanged entries omitted.
findChatPendings: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>;          // now with lastIncomingPhoto
findChatPendingsForUpdate: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>; // same
saveChatPendings: (chatId: ChatId, pendings: ChatPendings) => Promise<Result<null, PersistenceError | InvalidStoredData>>;
findMessageCandidates: (text: string) => Promise<Result<MessageCandidates, PersistenceError>>; // MessageCandidates gains unavailableProductIds
```

`ReadingTrace` gains `photoJustSent: boolean`. Errors unchanged.

Flow (changes in bold):
1. Outcome exists → `already_processed`. Message missing → `MESSAGE_NOT_FOUND`. Outgoing → skipped.
2. **A text with no letter or digit → skipped `empty_text`** (no row, no memory change).
3. Load the chat state unlocked: target, pendings, `pendingLife`, **`lastIncomingPhoto` and `photoJustSentOf(memory, target, alive pendings)`**.
4. Photo: cascade; **a caption with no letter or digit is no caption**. Text: candidates.
5. Build the context: **`latestOrder` from the target**, **the marker on the pending or item**, products with **`unavailableProductIds` after the sellable candidates** under the ceiling.
6. Reader (or the fixed answer), then `checkReaderAnswer`.
7. Transaction: lock contact; re-check outcome; lock order target; lock `ChatPendings`; `pendingLife`; `applyChatActions`; **`nextLastIncomingPhoto(message kind, stored.lastIncomingPhoto, applied, shownProductIds)`**; save order, pendings row (pendings, «listo», **memory**) when changed, `OrderMessage`, outcome.
8. After commit: notice as today.

The marker is computed outside the lock. Under the lock the resolved actions carry their own fallback (`otherwise`), so a pending that ended or an item that changed meanwhile ends as `unnamed_add`, never as a silent change to something else.

### 5.2 `findMessageCandidates` (modified), feature `products`, public composition

```ts
export type MessageCandidates = Readonly<{
  productIds: readonly ProductId[];            // sellable, ranked (unchanged)
  /** Not-sellable products (deactivated, archived, or active with no active variant) the words name; never a deleted one. */
  unavailableProductIds: readonly ProductId[];
  matchCount: number; durationMs: number; timedOut: boolean; wordsSearched: number;
}>;
```

Flow: same words, word cap and statement as today, in one statement:
1. Rank every non-deleted company product by coverage (sum of `word_similarity` ≥ `minSimilarity`), as today.
2. Sellable rows (`status = 'active'` with an active variant): the top `TEXT_MATCH_CANDIDATES`.
3. Not-sellable rows: the top `TEXT_MATCH_UNAVAILABLE_CANDIDATES`, only when the company has an active product, and never one whose `lower(name)` equals the `lower(name)` of an active sellable product of the company (`NOT EXISTS` in the same statement). The statement returns a `sellable` column and code makes the two cuts.
4. Timeout → both lists empty, `timedOut: true` (unchanged).

Errors: `PERSISTENCE_UNAVAILABLE` (unchanged).

### 5.3 Notice delivery (unchanged use case, new kind)

`describe-chat-message-notice.ts` and `send-chat-message-notice` are unchanged; `noticeReferences` reads the order id inside `payment_request.order` and its product ids, so names and numbers are loaded in the same two queries.

### 5.4 Unchanged use cases

`registerMobileMessage`, the queue policy (deadline, retries, ordering key), the dead-letter flow (except that `recordFailedOutcome` also clears the memory), payments, checkout and every order use case.

## 6. Domain and typing

### 6.1 Reading: `orders/domain/chat-reading.ts`

```ts
export type ChatReadingContext = Readonly<{
  kind: "text" | "photo_product" | "photo_not_product";
  text: string | null;
  /** The chat's latest order as the buyer sees it: a cancelled order counts as none. */
  latestOrder: "open" | "closed" | "none";
  items: readonly ReadingItem[];
  pendings: readonly ReadingPending[];
  products: readonly ReadingProduct[];
  truncated: boolean;
}>;
export type ReadingItem = Readonly<{ /* unchanged fields */ photoJustSent: boolean }>;
export type ReadingPending = Readonly<{ ref: ReadingRef; pending: ChatPending; photoJustSent: boolean }>;

/** Where a quantity change points: an order item as before, or a pending by its reference. */
export type ReaderQuantityTarget = ReaderItem | Readonly<{ kind: "pending"; ref: ReadingRef }>;

export type ReaderAction =
  | /* add, complete_pending, decline_pending, decline_shown, remove, change_variant, set_price, ready, variant_only, variant_for_pendings, not_allowed: unchanged */
  | Readonly<{ kind: "change_quantity"; target: ReaderQuantityTarget; mode: "increase" | "set" | "decrease"; quantity: number }>
  /** The buyer wants to pay now or asks to be sent something to pay. */
  | Readonly<{ kind: "payment_request" }>
  | Readonly<{ kind: "malformed" }>;
```

Justification: `latestOrder` is the one fact the reader lacks to answer a change after a closed order (the target's `closed` variant is not in the context today). `photoJustSent` is a flag on the existing line types, not a new type, because exactly one line carries it. `ReaderQuantityTarget` exists because a pending is not an item and `ReaderItem` has no pending kind; reusing `ReaderItem` keeps `remove`, `change_variant` and `set_price` unchanged.

`checkReaderAnswer(answer, context, options)` changes, in this precedence:
1. `no_intent` on `photo_product` → `checkReaderAnswer(fixedShownAnswer(context), context, { captionDoubt: false })`.
2. `actions` on `photo_product` where every action is `payment_request` or `not_allowed` → the fixed shown actions first, then the requests.
3. `payment_request` → `report payment_requested` with `order: { kind: "none" }`, `productIds: []`, `unnamed: 0`; `applyChatActions` fills it.
4. `malformed` → `invalid_action malformed`.
5. `change_quantity`:
   - target `pending` ref → `change_pending_quantity { pendingId, mode, quantity, otherwise: report unclear_item }` (unknown ref → `invalid_action unknown_reference`); non-whole → `quantity_not_whole`.
   - target `unnamed` with a marked line → mode `set`: the marked item (`set_quantity` on its variant) or the marked pending (`change_pending_quantity set`, `otherwise: report unnamed_add`); mode `increase` or `decrease` → `unnamed_add`.
   - target `unnamed` without a marked line, and `ref` or `not_in_order` → as today, plus `decrease` → `lower_quantity { target, quantity }`.
6. `complete_pending` with `product: null`, no attributes and a quantity → an unnamed quantity: if its pending is the marked one, `change_pending_quantity set`; otherwise `unnamed_add`. A `complete_pending` with attributes or a product is unchanged («3 de esos en M negro» completes the marked pending with ×3).
7. `add` with product `unnamed` → `unnamed_add` (unchanged, also with a marker).
8. `one_of` with not-sellable products whose normalized name equals a listed sellable product's → those are dropped before the doubt rule; one left → that product.

New resolved actions in `orders/domain/chat-order.ts`:

```ts
export type ResolvedChatAction =
  | /* unchanged kinds */
  | Readonly<{ kind: "lower_quantity"; target: ItemTarget; quantity: PositiveInteger }>
  | Readonly<{ kind: "change_pending_quantity"; pendingId: ChatPendingId; mode: "increase" | "set" | "decrease"; quantity: number; otherwise: ResolvedChatAction }>;
```

`lower_quantity`: result above 0 → `quantity_lowered`; exactly 0 → removal (`removed`, or `only_item_kept` for the only item); below 0 → `invalid_action quantity_below_zero`. `change_pending_quantity` applies `changePendingQuantity` (§6.2) when the pending is alive, otherwise `otherwise`.

`finishPendings` fills every `payment_requested` outcome: `order` from the target after the message (`open` with its id), else from the original target (`closed` with its id), else `none`; `productIds` and `unnamed` from `describePendings(left)`. It never changes `readyRemembered` beyond today's rules: a «listo» in a message with a payment request is remembered as today.

### 6.2 Pendings: `chat-pendings.ts` and `pending-transitions.ts`

```ts
/** What the last read incoming message left, when it was a photo. Null when the last read incoming message was not a photo. */
export type LastIncomingPhoto = Readonly<{
  messageId: ChatMessageId;
  /** Null when the photo does not count as the photo just sent: no single shown product, right after another photo, or it left nothing. */
  left: PhotoLeft | null;
}>;
export type PhotoLeft =
  | Readonly<{ kind: "pending"; pendingId: ChatPendingId }>
  | Readonly<{ kind: "item"; orderId: OrderId; variantId: VariantId; quantity: PositiveInteger }>;
export type ChatPendings = Readonly<{ pendings: readonly ChatPending[]; readyRemembered: boolean; lastIncomingPhoto: LastIncomingPhoto | null }>;
```

Justification: the product rule needs two facts about earlier messages (the previous one was a photo, and what it left) and forbids reading their text. They are chat state written under the same lock as the pendings, so they live in the same row; a separate table would be one more lock and write for one value.

`changePendingQuantity(set, { pendingId, mode, quantity }, env): PendingStep` (pure, `pending-transitions.ts`): the new quantity is `quantity` (set), `pending.quantity + quantity` (increase) or `pending.quantity - quantity` (decrease). Above 99 → `quantity_above_limit` with the pending's product, unchanged. Exactly 0 → the pending ends, `pending_ended declined`. Below 0 → `invalid_action quantity_below_zero`. Otherwise `pending_updated`, `lastChangedAt = now`, price kept with its `forQuantity`. No notice in the success cases.

### 6.3 Photo memory: `orders/domain/photo-just-sent.ts` (new)

```ts
export type IncomingMessageKind = "text" | "photo";
/** The memory after a message: a photo stores what it left when it counts; a read text clears it. */
export function nextLastIncomingPhoto(input: Readonly<{ messageId: ChatMessageId; kind: IncomingMessageKind; previous: LastIncomingPhoto | null;
  shownProductIds: readonly ProductId[]; applied: AppliedChatActions }>): LastIncomingPhoto | null;
/** The line the reader is told about, while it is still what the photo left. */
export function photoJustSentOf(memory: LastIncomingPhoto | null, target: ChatOrderTarget, pendings: readonly ChatPending[]): PhotoLeft | null;
```

`nextLastIncomingPhoto`:
1. Text → `null`.
2. Photo with `previous !== null` (right after another photo), or with a shown-product count other than 1 (non-product, matched nothing, several products) → `{ messageId, left: null }`.
3. Photo of one product: an `added` outcome for that product → `{ kind: "item", orderId: order after the message, variantId, quantity: the item's quantity after the message }`; otherwise a `pending_created`, `pending_updated` or `pending_split` outcome whose pending (in `applied.pendings`) has that product as subject → `{ kind: "pending", pendingId }`; otherwise `left: null` (declined, `not_identified`, `product_not_available`, `quantity_above_limit`).

`photoJustSentOf`: `left` pending → alive in `pendings`; `left` item → target open with `order.id === orderId` and an item of `variantId` with `quantity`; otherwise `null`.

### 6.4 Outcomes and notices

```ts
// chat-message-outcome.ts additions
export type PaymentOrder = Readonly<{ kind: "open" | "closed"; orderId: OrderId }> | Readonly<{ kind: "none" }>;
| Readonly<{ kind: "payment_requested"; order: PaymentOrder; productIds: readonly ProductId[]; unnamed: number }>
| Readonly<{ kind: "invalid_action"; orderId: OrderId | null; reason: "unknown_reference" | "not_the_shown_product" | "quantity_not_whole" | "text_too_long" | "too_many_actions" | "malformed" | "quantity_below_zero" }>

// seller-notice.ts additions (sellerNoticeKinds gains "payment_request")
| Readonly<{ kind: "payment_request"; order: PaymentOrder; productIds: readonly ProductId[]; unnamed: number }>   // inside ProblemNotice
```

`problemOf(payment_requested)` → `payment_request`. `namedProductOf` returns null for it (the count text never names the pending products of a payment). `noticeReferences` adds `order.orderId` when present. Texts (`seller-notice-texts.ts`, `paymentRequest(order, missing)`):

| `order` | Pendings left | es | pt-BR |
| --- | --- | --- | --- |
| open #N | none | «Un cliente quiere pagar el pedido #N.» | «Um cliente quer pagar o pedido #N.» |
| none | none | «Un cliente quiere pagar.» | «Um cliente quer pagar.» |
| closed #N | any | «Un cliente quiere pagar, pero el pedido #N ya tiene un pago o está cerrado. Revisa el chat.» | «Um cliente quer pagar, mas o pedido #N já tem um pagamento ou está fechado. Veja o chat.» |
| open #N | X | «Un cliente quiere pagar el pedido #N, pero falta completar X.» | «Um cliente quer pagar o pedido #N, mas falta completar X.» |
| none | X | «Un cliente quiere pagar, pero falta completar X.» | «Um cliente quer pagar, mas falta completar X.» |

X is the «listo»-with-pendings list (`listWithMore`, up to three names, «y N más» / «e mais N», unnamed counted). An order that no longer exists renders as `none`. The new-order note is appended by `renderSellerNotice` as for every problem.

| Layer | Types and authority |
| --- | --- |
| Reader adapter | Produces `ReaderAnswer` from the strict JSON; owns every model-facing word. |
| Domain (`chat-reading.ts`) | Decides what each reader action means against the context, including the photo marker and the photo rules. |
| Domain (`chat-order.ts`, `pending-transitions.ts`, `photo-just-sent.ts`) | Applies the actions, fills payment outcomes, computes the next memory. |
| Application | Loads, wires, locks and saves; no rule. |
| Presentation | Notice texts. |

## 7. Persistence

- `ChatPendings` gains `lastIncomingPhoto Json?` (nullable, no default). Migration `add_chat_last_incoming_photo`, generated with `prisma migrate dev --create-only`: one `ALTER TABLE "ChatPendings" ADD COLUMN "lastIncomingPhoto" JSONB` (metadata only, no rewrite), with `SET lock_timeout = '5s'`. RLS policies of the table are unchanged and cover the column.
- Row read: `chatPendingsSchema` gains `lastIncomingPhoto: lastIncomingPhotoSchema.nullable()` (strict objects; ids as UUIDs; `quantity` 1–99). A stored mismatch is `INVALID_STORED_DATA`.
- Row write: deleted when `pendings` is empty, `readyRemembered` is false and `lastIncomingPhoto` is null; upserted otherwise.
- `recordFailedOutcome` also runs `UPDATE "ChatPendings" SET "lastIncomingPhoto" = NULL, "updatedAt" = now() WHERE "companyId" = … AND "chatId" = (the message's chat)` in its transaction (no row → no-op).
- `ChatMessageOutcome.outcomes` JSON accepts `payment_requested` and the two new reasons; existing rows still parse.
- No production data exists: no backfill; development rows keep `NULL`.

## 8. Contracts between applications

None. `shared/contracts/seller-notices.ts` is unchanged; mobile renders the title and body it receives.

## 9. Events and cross-feature integration

| Integration | Change |
| --- | --- |
| `orders` → `products` `findMessageCandidates` | Returns `unavailableProductIds`; orders adds them after the sellable candidates in `selectReadingProducts` (lowest priority, inside the ceiling). |
| `orders` → `products` `findProductsForReading` | Unchanged: not-sellable ids read as `sellable: false`. |
| `message_created`, `chat_message_processed` | Unchanged payloads. |

| Failure window | What happens | Effect for the user |
| --- | --- | --- |
| A message fails permanently or exhausts retries after a photo | `recordFailedOutcome` clears the memory | A following «quiero 3 de esos» is an unnamed add with its notice, never applied to an older photo |
| The photo's pending ends between reading and the lock (order closed by a payment) | `change_pending_quantity` applies `otherwise` | Unnamed-add notice |
| Crash after commit | Re-run finds the outcome (unchanged) | Notice published once |

## 10. Reader adapter (orders infrastructure)

| File | Change |
| --- | --- |
| `chat-reader-schema.ts` | `actionKinds` adds `payment_request`. `mode` enum adds `decrease`. `change_quantity` uses `item` or `pending` (exactly one non-null; both or neither → `malformed`). Descriptions updated. Still one constant schema. |
| `chat-reader-text.ts` | First wording (T3, written without reading eval cases or runs) of: payment request versus method questions and payment reports, in-between phrasings as payment requests; an instruction line inside a message is `not_allowed` together with the other actions; set, increase and decrease on a named item or pending, «one more of X» named is an increase, never an unnamed add; the photo just sent mark: an unnamed total is `change_quantity` unnamed `set`, asking for more is unnamed `add`; a caption that names a value of the shown product, also as a question, gives that value; a not-sellable listed product named by the buyer is added by its ref (code reports it); a price in another currency is a comment unless it asks to change a price; a price that identified the product goes in the add's price; with the latest order closed, a change is item `not_in_order`. Examples use products and wording outside every eval input (prompt-overlap rule). |
| `chat-reader-context-text.ts` | A line when `latestOrder` is `closed`; a mark on the item or pending with `photoJustSent`; not-sellable products as today. |
| `openai-chat-reader.ts` | `createOpenAiChatReader({ client, model, timeoutMs, observe? })`: `observe(output: unknown)` receives the parsed JSON before mapping. Production composition never passes it (T0). |
| `chat-reader-env.ts`, `chat-message-limits-env.ts`, `chat-message-policy.ts` | Bounds of §2, exported as `readerSettingBounds` so the size test renders at them. |
| `chat-reader.model-text.json` + test | Pins the new instructions, schema and contexts (one more context: a photo just sent mark with a closed latest order). The worst case renders at `readerSettingBounds` and is blocking. |

### 10.1 Context size and cost

`gpt-6-luna`: US$0.10 per million input tokens, US$0.50 per million output tokens. The bound allows `(0.003 × 10⁶ − 1,000 × 0.5) / 0.1` = **25,000 input tokens** with the 1,000-token answer and no reasoning tokens (effort `none`).

| Part (o200k, PR #248) | Worst case at 24 products | Per unit |
| --- | --- | --- |
| Instructions + schema | 2,104 | — |
| Catalog | 25,267 | about 1,053 per product |
| Order and pendings | 1,951 | — |
| Text | 501 | — |
| **Total** | **29,860** (US$0.003486) | |

This task adds about 600–900 tokens of instructions and schema (payment request ~150, quantity modes ~200, photo mark ~150, prices and not-sellable products ~150, closed order ~80, schema ~100) and a few context tokens. To fit 25,000: 29,860 + ~800 − k × 1,053 ≤ 25,000 gives k ≥ 6, so **`READER_MAX_PRODUCTS` 18** (expected; T3 measures the real value with the new texts, T8 re-measures at the end and may raise it if the tuned instructions are shorter). The usual case (12 products) is unaffected: about 3,400 tokens, US$0.0008. Not-sellable candidates cost about 10 tokens each. Compacting per-combination prices to win back products is Todoist `6hrqHJghCXGwX26V`, after this task.

## 11. Transactions and concurrency

1. Company scope (`transaction(companyId)`).
2. `lockContact` serializes the messages of the chat (unchanged).
3. Outcome re-check; order target `FOR UPDATE`; `ChatPendings` `FOR UPDATE` (now also the memory).
4. `pendingLife`, `applyChatActions`, `nextLastIncomingPhoto` (pure).
5. Writes: order (new or changed items), `ChatPendings` (pendings, «listo», memory) only when changed, `OrderMessage`, `ChatMessageOutcome`.
6. Commit; notice after.

The memory is written only under the contact lock and the pendings row lock, so two messages of one chat never interleave its read and write. `recordFailedOutcome` runs when the chat's queue key is held by the failed job, so no message of that chat runs concurrently. A repeated message ends as `already_processed` before any write, so the memory never advances twice for one message.

## 12. Code organization

| File | Change | Task |
| --- | --- | --- |
| `orders/domain/chat-message-outcome.ts` (+ test) | `payment_requested`, `PaymentOrder`, two reasons | T0 |
| `orders/domain/seller-notice.ts`, `presentation/seller-notice-texts.ts` (+ tests) | `payment_request` kind, choice, references, texts | T0 |
| `orders/domain/chat-reading.ts` | Types (§6.1) in T0 with compile glue that keeps today's behavior (`payment_request` → `request_not_allowed`; pending target and `decrease` → `invalid_action malformed`); rules in T2 | T0, T2 |
| `orders/domain/chat-order.ts`, `pending-transitions.ts`, `chat-pendings.ts` (functions), `chat-reading-fixtures.ts`, `chat-criteria.test.ts` and tests | Rules of §6.1–6.2 | T2 |
| `orders/domain/chat-pendings.ts` (types and schema) | `LastIncomingPhoto`, `PhotoLeft`, schema | T0 |
| `orders/domain/photo-just-sent.ts` (+ test) | New (§6.3) | T6 |
| `orders/application/apply-chat-message.ts`, `reading-context.ts`, `chat-message-handler.ts` | §5.1 | T6 (T0: `buildReadingContext` sets `latestOrder` and `photoJustSent: false` as glue) |
| `orders/infrastructure/chat-pending-repository.ts` (+ integration test) | Column read/write, deletion rule | T0 |
| `orders/infrastructure/chat-message-outcome-repository.ts` (+ integration test) | Clear the memory on `failed` | T6 |
| `orders/infrastructure/openai-chat-reader.ts` | `observe` option | T0 |
| `orders/infrastructure/chat-reader-schema.ts`, `chat-reader-text.ts`, `chat-reader-context-text.ts`, `chat-reader.model-text.*`, `chat-reading-fixtures.ts` (infrastructure), `chat-reader-env.ts`, `chat-message-limits-env.ts`, `chat-message-policy.ts` | §10 | T3 (T0: `convertAction` glue for the new type shape) |
| `orders/composition.ts` | Wiring of the memory and the candidates | T6 |
| `products/application/find-message-candidates.ts` | `unavailableProductIds` type (T0, empty list); behavior (T1) | T0, T1 |
| `products/infrastructure/text-candidates.ts`, `domain/message-words.ts`, `composition.ts` (+ tests) | §5.2, `TEXT_MATCH_*` bounds | T1 |
| `prisma/schema.prisma`, `prisma/migrations/*_add_chat_last_incoming_photo` | §7 | T0 |
| `compose.prod.yaml`, `apps/core/.env.example` | §2 | T3 |
| `apps/core/evals/cases/schema.ts` | `payment_requested` in `outcomeKinds` (T0); `shows: "not_found"` (T4) | T0, T4 |
| `apps/core/evals/README.md` | Kind lists (T0); every other section (T4) | T0, T4 |
| `apps/core/evals/lib/**`, `cases/private.ts`, `scripts/check-private.ts` (new) | §12.1 | T4 |
| `apps/core/evals/cases/interpretation.ts`, `conversations.ts`, `paraphrases.ts` | Relabels and new dev cases | T5 |

### 12.1 Eval harness (`apps/core/evals`)

| Piece | Change |
| --- | --- |
| `cases/schema.ts` | `shownPhoto.shows` accepts `"not_found"` (a photo that matched nothing); `label` stays only with a product key. |
| `lib/production.ts` | `photoIdentification`: `not_found` → `{ kind: "not_found" }`. The reader is built with `observe` only when diagnostics are on (dev, not private). The memory needs no eval change: conversations apply every message for real. |
| `lib/case-record.ts`, `lib/run-case.ts` | `CaseRecord` gains `photoCase: boolean` (always), `readerAnswer: unknown \| null` and `invalidReasons: readonly string[] \| null` (null unless diagnostics are on). |
| `lib/eval-env.ts` | Diagnostics on when `EVAL_SPLIT=dev` and `EVAL_PRIVATE_DIR` is unset. `EVAL_REPEAT_TAGS=all` repeats every case. |
| `lib/report.ts`, `lib/rebuild.ts` | `GateLines` whole, `withoutPhoto` and `photo`. `consistency: { repeated, consistent, percent }` whole and per family. `tagMetrics.questionCaptionSilentAdds { messages, silentAdds }`, `paymentInCount { paymentRequests, insideCount }`, `noticesByKind`. Rebuild recomputes them. |
| `lib/suite-output.ts`, `lib/model-suite.ts` | A private run's stdout adds the three gate lines, consistency and the tag metrics: counts only, no ids. |
| `cases/private.ts` | Unchanged rules (photo files refused); its doc comment and errors no longer say photos are unavailable. |
| `scripts/check-private.ts` (new) | `pnpm exec tsx evals/scripts/check-private.ts <dir>` validates `catalog.json` and `cases.json` with `loadPrivateData` and prints counts per pass, kind and photo case. No model call, no case text. |
| `README.md` | «Private runs» says described photos run and are reported apart; «Private files format» adds `not_found`; the record diagnostics, the photo partition, consistency and metrics in «Report». |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `orders_chat_message_applied` | info | `chat-message-handler.ts` | existing fields + `["photoJustSent"]` |
| `orders_chat_message_skipped` | info | `chat-message-handler.ts` | unchanged; `reason: "empty_text"` now also for texts with no letter or digit |
| `orders_chat_message_failed` | error | `chat-message-handler.ts` | unchanged (the memory is cleared in the same write) |
| `message_candidates_found` | info | `products/infrastructure/text-candidates.ts` | existing + `["unavailableCount"]` |
| Startup failure for a setting above its bound | — | Zod parse at composition (existing behavior: the process does not start) | the variable name only |

Never logged: the buyer's text or caption, the reader's answer (only `actionKinds`, which already includes `payment_request` as a kind name), prompts, phone numbers, WhatsApp ids.

## 14. Tests

### Core unit

`orders/domain/chat-reading.test.ts`
- `test("a product photo whose caption the reader reads as no intent adds the shown single-variant product like a photo without caption")`
- `test("a product photo whose caption the reader reads as no intent leaves the shown product pending with variant missing when it has several variants")`
- `test("a no-intent caption on a photo of a product already pending replaces that pending without a notice")`
- `test("a photo whose caption only asks to pay still adds the shown product and reports the payment request")`
- `test("a photo whose caption only carries an instruction to the system still adds the shown product and reports a request not allowed")`
- `test("a declining caption still keeps the shown product out")`
- `test("a payment request becomes a payment_requested report and changes nothing")`
- `test("an add and a not_allowed in one answer apply the add and report the request")`
- `test("a malformed action reports invalid_action malformed and the rest of the answer applies")`
- `test("a quantity change on a pending reference resolves to a pending quantity change")`
- `test("an unknown pending reference in a quantity change reports invalid_action unknown_reference")`
- `test("an unnamed set right after a photo that left a pending sets that pending")`
- `test("an unnamed set right after a photo that grew an item sets that item even when the order has another single item")`
- `test("an unnamed increase right after a photo is an unnamed add")`
- `test("an unnamed add of a product right after a photo is an unnamed add")`
- `test("a quantity-only pending completion on the photo's pending sets it")`
- `test("a quantity-only pending completion with no photo just sent is an unnamed add")`
- `test("a pending completion with values right after a photo completes the pending with the stated quantity")`
- `test("an unnamed set with no photo just sent changes the only item as before")`
- `test("a one_of between an active product and an inactive one with the same name chooses the active one")`
- `test("an add of a listed not-sellable product reports product_not_available")`

`orders/domain/chat-order.test.ts`
- `test("lowering an item by N leaves the rest and reports quantity_lowered")`
- `test("lowering an item to exactly zero removes it")`
- `test("lowering the only item to exactly zero keeps it and reports only_item_kept")`
- `test("lowering an item by more than it has changes nothing and reports quantity_below_zero")`
- `test("a pending quantity change on a pending that ended applies its fallback")`
- `test("a payment request with an open order records the order it went to")`
- `test("a payment request that also creates a new order after a closed one records the new order")`
- `test("a payment request after a closed order records the closed order")`
- `test("a payment request with no order records none")`
- `test("a payment request with a pending left records the pending's products")`
- `test("a payment request with listo and a pending left keeps listo remembered")`

`orders/domain/chat-pendings.test.ts`
- `test("setting a pending's quantity keeps its values and price and sends no notice")`
- `test("raising a pending by one adds a unit")`
- `test("lowering a pending to zero ends it as declined")`
- `test("lowering a pending below zero changes nothing and reports quantity_below_zero")`
- `test("setting a pending above 99 changes nothing and reports quantity_above_limit")`
- `test("a stored pendings row with a last incoming photo reads back equal")`
- `test("a stored last incoming photo with an item of quantity 0 reads as invalid stored data")`

`orders/domain/photo-just-sent.test.ts`
- `test("a single product photo that left a pending remembers the pending")`
- `test("a single product photo that added a single-variant product remembers the item and its quantity")`
- `test("a single product photo that grew an existing item remembers the grown quantity")`
- `test("a photo right after another photo remembers no leftover")`
- `test("a non-product photo, a photo that matched nothing and a declined photo remember no leftover")`
- `test("a read text clears the memory")`
- `test("the marker is dropped when the photo's pending ended")`
- `test("the marker is dropped when the photo's item changed quantity or its order is no longer open")`

`orders/domain/chat-criteria.test.ts` (product criteria with fixed reader answers)
- `test("criteria 1 to 4: photo captions read as no intent, doubted, question and emoji-only")`
- `test("criteria 5 to 9 and 34: payment requests, method questions, embedded instructions and pendings left")`
- `test("criteria 10 to 14: set, lower and one more on named items and pendings")`
- `test("criteria 15 to 26: the quantity for the photo just sent")`
- `test("criteria 27 to 30: inactive products, prices and the closed order")`

`orders/domain/seller-notice.test.ts`
- `test("a payment_requested outcome alone chooses the payment request notice")`
- `test("a payment_requested outcome with ready chooses the payment request notice")`
- `test("a payment_requested outcome with another problem chooses several problems counting both")`
- `test("notice references include the payment order and its pending products")`

`orders/presentation/seller-notice-texts.test.ts`
- `test("renders every payment request body in es and pt-BR")`
- `test("the closed-order payment body is used whether or not a pending is left")`
- `test("a payment request that created a new order ends with the new-order note")`
- `test("a payment request on a deleted order renders the body without an order")`

`orders/application/apply-chat-message.test.ts`
- `test("a text with only emoji or punctuation is skipped without a reader call or a memory change")`
- `test("a caption with only emoji counts as no caption and makes no reader call")`
- `test("the context carries the latest order state and the photo just sent marker")`
- `test("a photo transaction saves the next memory and a text transaction clears it")`
- `test("not-sellable candidates are given after the sellable ones within the ceiling")`

`orders/infrastructure/chat-reader-schema.test.ts`
- `test("maps a payment_request action")`
- `test("maps a change_quantity on a pending reference with mode decrease")`
- `test("a change_quantity with both an item and a pending is malformed")`

`orders/infrastructure/chat-reader.model-text.test.ts`
- `test("pins every model-facing text, the one schema, the request settings and the worst-case size of the reader")` (existing, new pins)
- `test("the worst case at the settings' upper bounds costs at most US$0.003")`
- `test("the usual case costs at most US$0.003")` (existing)

`orders/infrastructure/chat-reader-env.test.ts`, `chat-message-limits-env.test.ts`
- `test("a reader setting above its upper bound fails at startup")`
- `test("defaults are within the upper bounds")`

`products/application/find-message-candidates.test.ts`
- `test("returns not-sellable products apart from the sellable candidates")`

`apps/core/evals/lib/*.test.ts`
- `test("a private case with a photo described as matched nothing loads and is identified as not found")`
- `test("a private case with a photo file is still refused")`
- `test("records of a dev run keep the reader answer and the invalid action reasons")`
- `test("records of a test-split or private run keep no reader answer")`
- `test("a conversation with a photo in any step marks every one of its records as a photo case")`
- `test("the gate is reported whole, without photo cases and for photo cases")`
- `test("consistency counts the repeated cases whose repetitions share one signature")`
- `test("counts silent adds on question captions and payment requests inside a count")`
- `test("a private run's stdout carries the new aggregate lines and no case id")`
- `test("check-private prints counts only")`
- `test("EVAL_REPEAT_TAGS=all repeats every case")`

`apps/core/evals/cases/*.test.ts` (existing parse tests stay green with the new cases)
- `test("every new dev case falls in the dev split")`

### Core integration

`orders/infrastructure/chat-pending-repository.integration.test.ts`
- `test("saves and reads a last incoming photo with no pending")`
- `test("deletes the row when there is no pending, no listo and no memory")`

`orders/infrastructure/chat-message-outcome-repository.integration.test.ts`
- `test("recording a failed outcome clears the chat's last incoming photo")`

`products/infrastructure/text-candidates.integration.test.ts`
- `test("a named deactivated product is returned as not sellable")`
- `test("an active product with no active variant is returned as not sellable")`
- `test("an inactive product with the same name as an active one is not returned")`
- `test("a company with no active products returns no not-sellable candidates")`
- `test("a deleted product is never returned")`

`orders/application/apply-chat-message.integration.test.ts` (fake reader, real database)
- `test("a photo then «quiero 3 de esos» sets the photo's pending to 3 without a notice")`
- `test("a photo of a single-variant product then a set quantity sets the item without a notice")`
- `test("a photo, an outgoing seller reply and an emoji text, then a set quantity still apply to the photo")`
- `test("two photos in a row then a set quantity change nothing and notify an unnamed add")`
- `test("a photo then «gracias» then a set quantity notify an unnamed add")`
- `test("a payment request with an open order and a pending left records the payment outcome and its notice is due")`
- `test("a named deactivated product reports product not available")`
- `test("a failed message after a photo makes a following set quantity an unnamed add")`

### Web E2E

None: no web screen changes.

### Pending manual checks

The founder's WhatsApp test of the product draft («Real test on WhatsApp», blocks A to G), carried in the final pull request; the build, environment, phone and which payment body arrived are recorded there.

## 15. Limits and checks during implementation

- **Merge before wave 0.** PR #248 is in `origin/main` (`65bd3d70`) but not in the integration branch. The coordinator merges `origin/main` before dispatching T0; T3 needs its tokenizer test.
- **Tokenizer.** o200k is a proxy for `gpt-6-luna` (PR #248). T8 compares the bound with the real `input_tokens` of the dev runs and reports both.
- **Test baseline file.** `2026-10-29T17-14-51-084Z` is not on this machine (the PR #237 worktree is gone). T9 compares with the gate lines published in PR #237 and the informe (5 ignored actions in the frozen test, three of them `int-photo-emoji-caption`). Holdout v3's baseline file exists.
- **Holdout v3 expectations.** The 12 photo cases were written before this task's rules. The translator (T7) keeps the source expectation and adds the expectation of this task's rule where a rule changed (for example a no-intent caption on a single-variant photo), counting those cases in its translation report; the measurement judges nothing.
- **Strict mode.** The schema keeps every field required; `item` and `pending` both nullable on `change_quantity`.
- **Raising the ceiling.** After `6hrqHJghCXGwX26V` compacts prices, the bound moves back toward 24 there, not here.
- Left out: several products per photo, image context, index-based candidates (`6hrWWWJQVCmcM2W3`), item editing from web or mobile, a notice for payment reports.

## 16. Implementation plan

### Order and parallelism

```text
Before wave 0 (coordinator): merge origin/main (PR #248) into the integration branch.
Wave 0:  T0 contracts, types, migration, repository, payment notice, adapter seam
Wave 1 (parallel, after T0):  T1 products candidates   T2 domain rules   T3 reader adapter + budget + settings
                              T4 eval tooling          T5 dev cases and relabels (non-tuner; needs the updated rules sheet)
Wave 2 (parallel):  T6 use case and wiring (after T1, T2, T3)
                    T7 private translation: holdout v4 and the 12 holdout v3 photo cases (after T4 and the holdout v4 writer; outside the repo)
Wave 3:  T8 tuning on EVAL_SPLIT=dev (after T5, T6), real models, capped runs
Wave 4:  T9 frozen test, once (after T8)
Wave 5:  T10 private measurement, once each (after T7, T9): holdout v4, then the holdout v3 photo cases
Wave 6:  T11 docs promotion and pull request (coordinator, after T10)
```

| Wave | Task | Owns (no overlap within a wave) |
| --- | --- | --- |
| 0 | T0 | `orders/domain/chat-message-outcome.ts`, `seller-notice.ts`, `presentation/seller-notice-texts.ts`, `chat-pendings.ts` (types, schema), `chat-reading.ts` (types + glue), `application/reading-context.ts` (glue only), `infrastructure/chat-reader-schema.ts` (glue only), `infrastructure/chat-pending-repository.ts`, `infrastructure/openai-chat-reader.ts`, `products/application/find-message-candidates.ts` (type), `products/infrastructure/text-candidates.ts` (empty list only), `prisma/**`, `evals/cases/schema.ts` (`outcomeKinds`), `evals/README.md` (kind lists), their tests |
| 1 | T1 | `products/**` except `domain/reading-product.ts` |
| 1 | T2 | `orders/domain/chat-reading.ts`, `chat-order.ts`, `pending-transitions.ts`, `chat-pendings.ts` (functions), `mentioned-price.ts`, `domain/chat-reading-fixtures.ts`, `chat-criteria.test.ts` and the domain tests |
| 1 | T3 | `orders/infrastructure/chat-reader-schema.ts`, `chat-reader-text.ts`, `chat-reader-context-text.ts`, `chat-reader.model-text.json`, `chat-reader.model-text.test.ts`, `infrastructure/chat-reading-fixtures.ts`, `chat-reader-env.ts`, `chat-message-limits-env.ts`, `application/chat-message-policy.ts`, `compose.prod.yaml`, `apps/core/.env.example`, their tests |
| 1 | T4 | `apps/core/evals/**` except `cases/interpretation.ts`, `cases/conversations.ts`, `cases/paraphrases.ts` |
| 1 | T5 | `evals/cases/interpretation.ts`, `conversations.ts`, `paraphrases.ts` |
| 2 | T6 | `orders/application/apply-chat-message.ts`, `reading-context.ts`, `chat-message-handler.ts`, `orders/domain/photo-just-sent.ts`, `infrastructure/chat-message-outcome-repository.ts`, `orders/composition.ts`, their unit and integration tests |
| 2 | T7 | nothing in the repository: `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v4-private/{catalog,cases}.json`, `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v3-photos-private/` |
| 3 | T8 | `chat-reader-text.ts`, the schema descriptions in `chat-reader-schema.ts`, `chat-reader-context-text.ts`, the pinned JSON, the `READER_MAX_PRODUCTS` bound, `TEXT_MATCH_*` defaults |

`apps/core/.env.example` is shared by T1 (`TEXT_MATCH_UNAVAILABLE_CANDIDATES`) and T3; T3 owns it and adds that line with the name and default fixed here, so T1 does not touch it.

### T0. Contracts, types, migration and payment notice

**Scope:**
- Outcome `payment_requested` with `PaymentOrder`, reasons `malformed` and `quantity_below_zero`, schema and tests.
- `SellerNotice` `payment_request` (tuple and union), `problemOf`, `namedProductOf`, `noticeReferences`, the es and pt-BR bodies of §6.4 with tests.
- Types of §6.1 (`latestOrder`, `photoJustSent`, `ReaderQuantityTarget`, `change_quantity` with `target` and `decrease`, `payment_request`) with compile glue that keeps today's behavior: `payment_request` → `request_not_allowed`; a pending target or `decrease` → `invalid_action malformed`; `buildReadingContext` sets `latestOrder` from the target and `photoJustSent: false`; `convertAction` emits the new shape from today's fields.
- `LastIncomingPhoto`, `PhotoLeft`, `ChatPendings.lastIncomingPhoto` and its schema; the column, the migration `add_chat_last_incoming_photo` (database-migrations skill) and the repository (read, write, deletion rule).
- `MessageCandidates.unavailableProductIds` (type; `searchProductsByCoverage` returns `[]`).
- `createOpenAiChatReader` `observe` option.
- `payment_requested` in `evals/cases/schema.ts` `outcomeKinds` and the README kind lists.

**Out of scope:** any rule of §6 beyond glue; reader texts; products query; use case wiring; eval tooling.
**Acceptance criteria:**
1. `chooseSellerNotice([payment_requested(open #1023, no pendings)])` renders «Revisa el chat» — «Un cliente quiere pagar el pedido #1023.», and in pt-BR «Veja o chat» — «Um cliente quer pagar o pedido #1023.»; all five bodies of §6.4 render in both languages.
2. `[payment_requested(closed #1023, Polo básico left)]` renders the closed body; `[payment_requested(none), variant_missing]` renders «Revisa el chat» counting 2.
3. A pendings set with no pending, `readyRemembered: false` and a last incoming photo saved for chat A reads back equal; set to null with no pending, the row is deleted; company B reads nothing for chat A.
4. A stored `lastIncomingPhoto` with `quantity: 0` reads as `INVALID_STORED_DATA`; existing outcome rows and existing pendings rows (column `NULL`) still parse.
5. With today's reader output every existing unit and integration test is green: behavior is unchanged.
6. `scripts/ci.sh --fast` green.

**Tests:** the T0 titles of §14 (outcome, notice, texts, stored row, repository integration).
**Depends on:** the coordinator's merge of `origin/main`.

### T1. Not-sellable products among text candidates

**Scope:** §5.2 in `text-candidates.ts` and `find-message-candidates.ts`; `TEXT_MATCH_UNAVAILABLE_CANDIDATES` (default 2, max 4) and the `max()` bounds of every `TEXT_MATCH_*` in `products/composition.ts`; `unavailableCount` in `message_candidates_found`; the opt-in benchmark still runs.
**Out of scope:** orders wiring (T6); `.env.example` and compose (T3); any index or SECURITY DEFINER function (`6hrWWWJQVCmcM2W3`).
**Acceptance criteria:**
1. Catalog with «Casaca jean» deactivated and «Casaca denim» active: «quiero la casaca jean en L» returns «Casaca denim» among `productIds` and «Casaca jean» in `unavailableProductIds`.
2. An active product whose variants are all inactive is returned in `unavailableProductIds`.
3. An inactive «Polo básico» and an active «Polo básico»: only the active one is returned.
4. A company with only inactive products returns both lists empty.
5. A deleted product is never returned.
6. The benchmark's p95 at 10,000 products stays within 10% of its value before the change (recorded in the PR).
7. `TEXT_MATCH_CANDIDATES=9` fails at startup.

**Tests:** the products unit and integration titles of §14.
**Depends on:** T0.

### T2. Domain rules

**Scope:** `checkReaderAnswer` precedence of §6.1; `lower_quantity` and `change_pending_quantity` in `applyChatActions`; `changePendingQuantity`; `payment_requested` filled in `finishPendings`; the `one_of` same-name rule; the criteria tests with fixed reader answers.
**Out of scope:** the memory (`photo-just-sent.ts`, T6), reader texts, wiring, notices (T0).
**Acceptance criteria:**
1. With fixed reader answers, product criteria 1–30 and 33–34 give the outcomes and the order of the product draft (photo memory supplied as a context marker).
2. No answer drops a unit or grows a pending without a named reference or a marker: a quantity-only `complete_pending` with no marker always ends `unnamed_add`.
3. A pending quantity change whose pending ended under the lock applies its fallback (`unclear_item` for a named pending, `unnamed_add` for the marked one).
4. No payment is created, voided or rejected by any transition (the order state machine is not called for payments).
5. No natural-language string is added under `orders/domain` (grep in the PR).

**Tests:** the `chat-reading`, `chat-order`, `pending-transitions`, `chat-pendings` and `chat-criteria` titles of §14.
**Depends on:** T0.

### T3. Reader adapter, token budget and settings

**Scope:**
- Schema (`payment_request`, `decrease`, `pending` on `change_quantity`), `convertAction`, context text (closed line, photo mark), the first wording of the new rules in `chat-reader-text.ts` (§10), written without reading eval cases or runs.
- Budget: the worst case renders at `readerSettingBounds` and becomes blocking; `READER_MAX_PRODUCTS` bound and default set to the largest value whose worst case, with the new texts, costs at most US$0.003; the measured tokens and cost per part recorded in the pinned JSON and the PR.
- Settings: bounds of §2 in `chat-reader-env.ts`, `chat-message-limits-env.ts`, `chat-message-policy.ts`; `compose.prod.yaml` worker variables; `.env.example` (including `TEXT_MATCH_UNAVAILABLE_CANDIDATES=2`).

**Out of scope:** tuning against evals (T8); compacting per-combination prices (`6hrqHJghCXGwX26V`); changing the model, the effort or the US$0.003 bound.
**Acceptance criteria:**
1. A recorded strict output with `payment_request` maps to `{ kind: "payment_request" }`; `change_quantity` with `pending: "Q1"`, `mode: "decrease"`, `quantity: 1` maps to a pending target; with both `item` and `pending` it maps to `malformed`.
2. The worst-case test, at the bounds, passes at ≤ US$0.003 and fails if `READER_MAX_PRODUCTS`'s bound is raised by one (shown in the PR).
3. `READER_MAX_PRODUCTS=30` (above the bound) fails at startup; unset gives the bound.
4. `docker compose -f compose.prod.yaml config` lists every variable of §2 on `worker` with the code defaults.
5. The prompt-overlap test is green; the pinned JSON changes only by the new texts and settings.

**Tests:** the infrastructure titles of §14.
**Depends on:** T0 and the merge of PR #248.

### T4. Eval tooling

**Scope:** every row of §12.1.
**Out of scope:** writing or relabeling cases (T5); running paid evals.
**Acceptance criteria:**
1. A private folder (in the scratchpad) with a two-product catalog, one message case whose photo `shows: "not_found"` and one conversation starting with a described photo loads with `check-private.ts`, which prints counts only.
2. A record fixture of a dev run keeps `readerAnswer` and `invalidReasons`; the same fixture under `EVAL_SPLIT=test` or a private dir keeps `null`.
3. The report of a fixture run shows the gate whole, without photo cases and photo cases only; a conversation with a photo step counts all its records as photo case.
4. Consistency, silent adds on question captions, payment requests inside a count and notices by kind appear in the report and in a private run's stdout, with no case id or text.
5. `pnpm --dir apps/core test:unit` green; the README test green.

**Tests:** the `evals/lib` titles of §14.
**Depends on:** T0.

### T5. Dev cases and relabels (written by a non-tuner)

**Scope:** from the updated rules sheet (private path given by the coordinator), never from holdout v3 or runs:
- Relabel `int-photo-emoji-caption` and its paraphrases (pending, `variant_missing`, outcomes with `pending_created`) and `conv-unnamed-add-after-photo` (pending ×3 silent, then the color completes it ×3), citing the rule in a comment.
- New dev cases, ids chosen so they fall in the dev split, covering: a caption with letters read as no intent on a variants product, on a single-variant product and on a product already in the order; question captions (tag `question-caption`), and a question naming a variant value; payment requests, method questions, payment reports and in-between phrasings by the boundary; payment requests in a caption, with «listo», with a pending left (open order and no order), after a closed order, with a new order in the same message; an embedded instruction next to an add and next to a quantity above 99; set, lower by N, one more of X and lower to exactly 0 and below 0 on named items and pendings, the product draft's quantity example; set and add wording after a photo, with and without another only item, after a photo burst, after «gracias», after a declined photo, after a seller reply; a named decline of a pending left without order (the WhatsApp test's F2 and cleanup); a named inactive product with a similar active one; a price in another currency as a comment and as a request; a price that identified the product; a change after a closed order; an emoji-only text.
- Dev equivalents of the cited cases `hv3-59`, `hv3-70`, `hv3-40`, `hv3-41`, `hv3-42`, `hv3-67`, `hv3-54`, `hv3-32`, `hv3-62`, `hv3-71`, `hv3-10` and of the test cases `int-photo-emoji-caption`, `conv-unnamed-add-after-photo` and `hold-price-hint-rayas`, written from the rule, with other products, colors and wording; new cases tagged `consistency` where the product draft cites flips.

**Out of scope:** running evals, reading runs, prompts, tooling.
**Acceptance criteria:**
1. `pnpm --dir apps/core test:unit` parses every table; the prompt-overlap test is green.
2. Every new case id hashes into `dev` (test title of §14).
3. No case text shares a three-word run with holdout v3 (checked by the coordinator with the private file, outside the repository; the result goes in the PR as a count).
4. Each family listed above has at least one case.

**Tests:** the case parse tests and the dev-split title.
**Depends on:** T0 and the coordinator's rules sheet. The writer is not the author of T3 or T8.

### T6. Use case and wiring

**Scope:** §5.1 and §6.3: `hasReadableText` with letters or digits, `latestOrder` and the marker in the context, not-sellable candidates in `selectReadingProducts`, `nextLastIncomingPhoto` in the transaction, `recordFailedOutcome` clearing the memory, `photoJustSent` in the trace and the log, wiring in `orders/composition.ts`.
**Out of scope:** domain rules (T2), reader texts (T3), eval wiring (T4).
**Acceptance criteria:**
1. With a fake reader and the real database, every integration title of §14 passes.
2. «👍» and «...» are skipped with no reader call; a photo with caption «😍😍» gets the fixed answer with no reader call.
3. A photo, then an outgoing message, then «👍», then a set quantity applies to the photo; a photo, then a failed message, then a set quantity is `unnamed_add`.
4. `scripts/ci.sh` (full) green.

**Tests:** the `apply-chat-message`, `photo-just-sent` and repository titles of §14.
**Depends on:** T1, T2, T3.

### T7. Private translation (isolated, outside the repository)

**Scope:** an agent that does not tune and does not read the repository's runs:
1. Holdout v4: from the isolated writer's rules sheet, catalog and cases in `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v4-private/`, write `catalog.json` and `cases.json` there in the README «Private files format», photos as `photo: { shows }` (with `label` or `not_found` when the case says so).
2. Holdout v3 photo cases: from `~/yoyos-orquestacion/un-solo-modelo/holdout-v3-private/`, write `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v3-photos-private/catalog.json` (the v3 catalog) and `cases.json` with only `hv3-03`, `hv3-63`–`hv3-68`, `hv3-c01`, `hv3-c04`, `hv3-c06`, `hv3-c08`, `hv3-c11`, the photo described by the case's own identification; where this task changed a rule, the expectation of the new rule is added as an alternative.
3. Validate both with `check-private.ts`; a translation report with counts only next to each `cases.json`.

**Out of scope:** running models; copying anything into the repository.
**Acceptance criteria:** both folders load with `check-private.ts`; the translation reports list cases written, dropped (with reason category) and relabeled alternatives, counts only; `git status` of the worktree is clean.
**Depends on:** T4 merged, and the holdout v4 writer's files.

### T8. Tuning on dev

**Scope:** with the files T8 owns, using only `EVAL_SPLIT=dev` (`EVAL_CASES` and tags for subsets), real OpenAI and the Claude judge (authorized by the founder in the Todoist task):
- Run 1 (baseline): full dev, `EVAL_REPEAT_TAGS=consistency,pinned-miss,question-caption`.
- At most 6 full dev runs in total and 25 subset runs; the cost of each run in the PR. Reaching the cap with gates not met stops the task with a report to the coordinator.
- Keeps the worst-case test green after every change; at the end, re-measures and sets the `READER_MAX_PRODUCTS` bound to the largest value that fits.
- Decides the payment fallback and the closed-order line by measurement (§2) and says which shipped.

**Out of scope:** the test split, private folders, eval cases, domain rules, the US$0.003 bound, the model and its effort.
**Acceptance criteria:**
1. Last full dev run: 0 ignored actions (photo cases included), 0 wrong silent changes, the product draft's cited cases right through their dev equivalents, cost per message ≤ US$0.003.
2. The dev report shows consistency, silent adds on question captions, payment requests inside a count and notices by kind.
3. The prompt-overlap test and `scripts/ci.sh` are green; the schema still does not depend on the context.

**Depends on:** T5, T6.

### T9. Frozen test, once

**Scope:** with the code frozen after T8, one `EVAL_SPLIT=test` run with `EVAL_REPEAT_TAGS=consistency,pinned-miss`. No change after it.
**Acceptance criteria:** the PR reports the test gate lines (whole, without photo cases, photo cases), 0 ignored actions as the gate, consistency, cost, and the comparison with PR #237's published test lines.
**Depends on:** T8.

### T10. Private measurement, once each

**Scope:** an isolated runner:
1. `EVAL_PRIVATE_DIR=/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v4-private EVAL_REPEAT_TAGS=all` (every case 3 times, first scored).
2. `EVAL_PRIVATE_DIR=/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v3-photos-private`, once, as a measurement.

Only the aggregate lines leave the folders.
**Acceptance criteria:** the PR reports, for holdout v4: right % without photo cases (gate ≥ 88%), ignored actions and wrong silent changes including photo cases (gates 0), photo cases apart, consistency, the metrics apart and cost per message (gate ≤ US$0.003); for the holdout v3 photo cases, their gate lines as a measurement, compared with nothing. A gate not met is reported per family to the founder as not met (a later attempt needs holdout v5).
**Depends on:** T7, T9.

### T11. Docs promotion and pull request

**Scope:** the coordinator's final step: rewrite `docs/message-to-order.md` from both drafts with the tuned values (rules, notices, settings and bounds, cost per message, the memory), update `docs/notifications.md` where it lists notice bodies, keep the evals README as T4 left it, delete both drafts (Documentation skill), run the memory maintainer. The pull request carries the WhatsApp test steps, the measurement lines of T8–T10, which payment body and closed-order text shipped, CI for core, mobile and landing, and the decisions for the founder to confirm.
**Acceptance criteria:** no doc names a removed or renamed piece; every link resolves; `docs/drafts/` holds neither draft.
**Depends on:** T10.

### Final verification

The founder runs the WhatsApp test of the product draft on a real phone against the deployed branch (worker with the reader settings and the AI key), and marks every step in the pull request. Results go in the pull request, not in this draft.

## 17. Open items and questions

```
Questions (answer with the option number):

None.

Decided unless objected:
- READER_MAX_PRODUCTS bound and default drop from 24 to the largest value whose worst case fits US$0.003 with the new texts (expected 18); the worst-case test becomes blocking. Compacting per-combination prices and raising it back stay in Todoist 6hrqHJghCXGwX26V, after this task.
- Upper bounds: READER_MAX_ITEMS 40, READER_MAX_TEXT_CHARS 2000, AI_TIMEOUT_MS 80000, CHAT_PENDING_TTL_DAYS 30, TEXT_MATCH_CANDIDATES 8, TEXT_MATCH_UNAVAILABLE_CANDIDATES 4, TEXT_MATCH_MAX_WORDS 30, TEXT_MATCH_PAIR_BUDGET 50000, APPLY_CHAT_MESSAGE_CONCURRENCY 1–64; above a bound the process does not start. AI_READER_MODEL stays free text (changing it means re-measuring cost).
- compose.prod.yaml worker gets every reader, pendings, text-match and concurrency variable with the code defaults; PRODUCT_MATCHER_* stays (the visual chooser uses it).
- The photo just sent is remembered in a new nullable JSON column ChatPendings.lastIncomingPhoto (message id and the pending or item it left), written in each message transaction, cleared by a read text and by a failed message; nothing of the buyer's text is stored.
- A quantity-only pending completion without a photo just sent is an unnamed add (it no longer grows a pending silently).
- Payment request: new reader action, outcome payment_requested and notice kind payment_request with the five bodies; fallback to the generic body only if the measurement leaves no room.
- Lowering below zero (item or pending) reports a new invalid_action reason quantity_below_zero (generic body); a malformed reader action gets its own reason malformed.
- Up to 2 not-sellable products (deactivated, archived, or with no active variant) are added to the text candidates, never one named like an active product, never in a company with no active products.
- Eval: dev runs keep the reader's JSON answer and invalid-action reasons; test and private runs do not.
- Eval: private runs take photos described by the case, including a new «matched nothing»; photo files stay refused.
- Eval: gates reported whole, without photo cases and photo cases only (a conversation with any photo step is a photo case whole); consistency over repetitions; holdout v4 runs every case 3 times with the first scored.
- Tuning cap: at most 6 full dev runs and 25 subset runs; reaching it with gates unmet stops and reports.
- New dev cases fall in the dev split only; the frozen test changes only by the two relabels.
- The 12 holdout v3 photo cases keep their source expectations, plus the new rule's expectation as an alternative where this task changed the rule; they judge nothing.
- The frozen-test baseline report file is not on this machine; the comparison uses PR #237's published lines.
```
