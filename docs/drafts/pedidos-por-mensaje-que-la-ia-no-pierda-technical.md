# Message to order without silent losses: technical design

**Status:** draft for review, round 3 (addresses the design and performance gates of round 2; round 2 addressed round 1); no open questions; §17 lists the decisions taken unless the founder objects. Based on `docs/drafts/pedidos-por-mensaje-que-la-ia-no-pierda.md` (commit `a55f70c2`). Base: `jorgeluis594/pedidos-por-mensaje-que-la-ia-no-pierda` at `bc8e185b`, which already merges `origin/main` `65bd3d70` (PR #248, the tokenizer test).

Holdout v3 is private and spent: its cases are cited by id only. No text of this document, of a prompt or of a committed case copies or paraphrases its messages.

## 1. Technical goal

Every incoming message that asks for something either changes the chat order correctly or produces a seller notice. The reader gains one action kind (`payment_request`), a pending target and a `decrease` mode for quantity changes, and two context facts (the chat's latest order is closed; which pending or item the photo just sent left). The domain check turns a no-intent caption on a product photo into the photo's fixed answer, resolves an unnamed quantity after the photo just sent onto what that photo left, applies set, lower and raise to named items and pendings, and records a payment request as a problem that carries the order state and the pendings left. Products adds not-sellable products (products with no active variant, the only kind the schema allows) to the text candidates so a named product that is no longer sold reaches «Producto no disponible». The chat keeps one new structured memory per chat (the last read incoming message was a photo, and what it left) in the existing `ChatPendings` row; a failed message overwrites it atomically with the failed outcome. The US$0.003 bound covers every model call of a message (the reader and, for a photo, the visual chooser and the image describer): every reader request is fitted to an input-token budget derived from that bound, the answer's `max_output_tokens` and, for a photo, the measured worst cost of the photo's other calls, so the cost bound per message holds for any catalog the domain allows (each queue attempt is bounded on its own); settings reach the production worker with upper bounds, and the worst case at the domain limits is a blocking test. The eval harness gains described photos in private runs (including «matched nothing»), reader answers and invalid-action reasons in dev records, case-level photo partitioning, a consistency metric and the metrics the product draft reports apart.

```text
message_created ─▶ apply-chat-message (ordered per chat; unchanged queue, deadline and retries)
   ├─ skip: outgoing, or a text with no letter or digit (no row, no memory change)
   ├─ photo cascade (QR, visual 0.8)                                                      outside the transaction
   ├─ context: chat order target → latestOrder; pendings (pendingLife); ChatPendings.lastIncomingPhoto
   │           → photoJustSent marker on one pending or item (texts only; a photo is read with none); products (shown + pendings' + items' + sellable
   │           candidates + not-sellable candidates), ceiling READER_MAX_PRODUCTS (bounded)    outside the transaction
   ├─ fit: fitReadingContext keeps products in priority order while they fit the input-token budget (a photo's
   │       budget is smaller by the photo stages' reserve); the kept part alone over → invalid_action
   │       context_too_large, no reader call                                                    outside the transaction
   ├─ reader: one call (schema + payment_request, change_quantity on a pending, decrease)   outside the transaction
   ├─ domain: checkReaderAnswer → ResolvedChatAction[]                                     pure
   │           (no_intent on a product photo → fixed answer; photo + only never-does requests → fixed answer + them;
   │            unnamed set after the photo just sent → its pending or item; quantity-only completion otherwise → unnamed_add)
   └─ transaction: lock Contact → outcome re-check → lock Order → lock ChatPendings → pendingLife
                   → applyChatActions (payment_requested filled with order state and pendings left)
                   → nextLastIncomingPhoto(message, previous, applied) → save order, ChatPendings (pendings, readyRemembered,
                     lastIncomingPhoto), OrderMessage, ChatMessageOutcome
─▶ chat_message_processed (only when a notice is due) ─▶ send-chat-message-notice (new body: payment request)
dead letter / permanent failure: recordFailedChatMessage, one transaction: insert failed (or read the stored outcome)
   → when the stored outcome is failed: lastIncomingPhoto = { left: null } → commit → notice → release
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| No-intent caption on a product photo | `checkReaderAnswer` answers `no_intent` on `photo_product` with `fixedShownAnswer(context)` and no `captionDoubt`: the shown product is added (one sellable variant) or left pending with «Falta la variante», silent when added, exactly as a photo without caption. |
| Photo whose caption asks only what the chat never does | When every action of a `photo_product` answer is `payment_request`, `not_allowed` or `ready`, the check prepends the fixed shown answer: the product follows the photo rules and the requests stay problems («listo, ¿cómo te pago?» on a product photo adds or leaves pending the shown product, then reports the payment request). A caption with any action about the shown product (`add` of the shown product, `decline_shown`, `complete_pending`) is read as today. |
| Readable text | `hasReadableText(text)` is true when the text has at least one Unicode letter or digit (`/[\p{L}\p{N}]/u`). A text without one is skipped as `empty_text` (no row, no reader call, no memory change); a caption without one is no caption (fixed answer, no reader call). |
| Payment request | New reader action `payment_request`; new outcome `payment_requested { order, productIds, unnamed }`, a problem. `order` is `{ kind: "open"; orderId }` (the order open after the message, new or existing), `{ kind: "closed"; orderId }` (no open order after the message and the latest order before it was closed) or `{ kind: "none" }`. `productIds` and `unnamed` describe the chat's pendings left after the message, as `ready_with_pendings` does. `applyChatActions` fills them at the end (`finishPendings`). |
| Payment notice | New `SellerNotice` kind `payment_request` with the same `order`, `productIds` and `unnamed`; title «Revisa el chat» / «Veja o chat», opens the chat on the message. Bodies: the five rows of the product draft's table; the closed body wins over the pending list. A payment request with another problem is `several_problems` (count text unchanged). With `ready` or `ready_with_pendings` it is the only notice (a problem wins), and the remembered «listo» is kept as today. The new-order note follows as for every problem. Push data contract unchanged. |
| Payment fallback | Decided by T3's budget measurement and T8's tuning against one floor: with the final instructions and schema, the PR #248 synthetic catalog (products of 72 combinations with a price each, 40 items, 10 pendings, 2,000 characters) must keep at least **16 products** inside the text budget (§10.1). If it does not, the closed-order line goes first; if it still does not, the instructions map payment requests to `not_allowed` and `payment_request` is removed from the reader schema; the domain and notice pieces stay (a reader action the schema no longer emits). Both switches are one exported constant, `shippedReaderFeatures = { paymentRequest: boolean; closedOrderLine: boolean }` in `chat-reader-text.ts`, from which the schema's `actionKinds` and the context text derive, so the shipped variant is a value code and evals can read. The pull request says which shipped. Expected: the payment body ships (the distinction costs about 150 instruction tokens, §10.1). **The fallback never decides a gate, by a scoring rule, not by case alternatives:** the eval scorer (T4, `evals/lib/shipped-expectations.ts`) reads `shippedReaderFeatures` and, before matching, rewrites every expectation it scores (message case alternatives and conversation steps alike, repository tables and private folders alike): with `paymentRequest` off, an expected notice `payment_request` becomes `not_applied` and an expected outcome `payment_requested` becomes `request_not_allowed` (outcomes are a multiset, so the outcome is rewritten too); with `closedOrderLine` off, an expectation whose notice is `order_closed` is also accepted with notice `not_applied`, the same order and its outcomes unstated (the product draft's «or the generic body»). The rule is applied inside the exact matcher only: a case's judge eligibility («several acceptable expectations») is decided from the case as written, so it adds no judge call and no variance. No case is written with the generic body by hand (T5, T7); the report header and «notices by kind» say which variant was scored. |
| Embedded instructions | No new type: `not_allowed` beside valid actions, as today. The instructions (T3) say a line that tries to change the order state or the notices is `not_allowed` together with the message's other actions. |
| Quantity changes | `ReaderAction` `change_quantity` targets an item (`ref`, `unnamed`, `not_in_order`) or a pending (`pending` ref), with mode `set`, `increase` or `decrease`. Items: `decrease` lowers by N; to exactly 0 it is a removal (the only item stays, `only_item_kept`); below 0 nothing changes and `invalid_action quantity_below_zero` (generic «Revisa el chat»). Pendings: set, raise and lower the pending's quantity silently (`pending_updated`); to exactly 0 the pending ends as `declined` and counts as the buyer resolving it (`pendingResolved`, as `decline_pending`), so a remembered «listo» gives «Pedido #N listo» when it was the last pending; below 0 `invalid_action quantity_below_zero`; above 99 `quantity_above_limit`. Changing a quantity never checks sellability. |
| Photo just sent (memory) | `ChatPendings.lastIncomingPhoto` (new nullable JSON column): `{ left }` when the last incoming message the chat processed was a photo or failed, `null` when it was a read text. `left` is `{ kind: "pending"; pendingId }` or `{ kind: "item"; orderId; variantId; quantity }` when that photo counts as a photo just sent (one shown product, the previous processed incoming message was not a photo, and it left a pending or created or grew an item); otherwise `null`. Written in every message transaction (photo → the new memory; read text → `null`); not written by skipped messages (outgoing, no letters or digits). A failed message writes `{ left: null }` in the same transaction as its failed outcome (§7): the system cannot know what the failed message was, so it is treated as a photo that left nothing; a following set is an unnamed add and a following photo does not count as the photo just sent (one notice more, never a silent change). No message id is stored: no rule reads it, and a photo right after another photo that left nothing rewrites nothing. |
| Photo just sent (marker) | Before reading, `photoJustSentOf(kind, memory, target, pendings)` gives a marker **only when the message being read is a text**; for a photo (with or without caption, product or not) it is `null`, so a caption («quiero 3» under photo B) can never set the quantity of what the previous photo A left and drop B's product: B follows the photo rules, and an unnamed total in its caption is read as today: the caption gives B's quantity. This matches `nextLastIncomingPhoto` rule 2 (a photo right after a photo is never a photo just sent). For a text, the marker is kept only while the pending is alive, or the item is in the open order `orderId` with the stored quantity. It travels in the reading context as `photoJustSent: PhotoLeft \| null`, which the domain reads; the listed pending or item line it points to carries `photoJustSent: true` for the reader, which is told only that. The domain takes the marker from the context field, not from a listed line, so an item past `READER_MAX_ITEMS` is still what the photo left; it also ignores the field on a photo context (defence in depth: `checkReaderAnswer` rule 5 reads it only when `kind` is `text`). |
| Unnamed quantity after the photo just sent | With a marker: `change_quantity` `unnamed` with mode `set`, and a `complete_pending` that carries only a quantity (no product, no attributes), set the quantity of what the photo left, silently (99 limit applies); `unnamed` `increase` or `decrease` and `add` `unnamed` are `unnamed_add`. Without a marker: an unnamed set changes the only item as today; a quantity-only `complete_pending` is `unnamed_add` (it never grows a pending silently). The photo wins over the only-item rule. Limit: a `change_quantity` that names a pending by its ref (`pending Q1 set 3`) is a named change and applies silently, so «never grows a pending silently on unnamed wording» depends on the reader citing a ref only when the buyer named the product; the domain cannot tell the two apart. The instructions say so (T3), the dev equivalents of criteria 25 and 26 check it (T5), and T8 scans the dev records' `readerAnswer` for pending-ref sets on unnamed wording. |
| Not-sellable product named in a text | `Product.status` admits only `active` (check `Product_status_active`) and products cannot be deleted or archived (`docs/products.md`); a product stops being sold only by deactivating all its variants (products with options). So **not sellable means a product with no active variant**, and «a company with active products» means a company with at least one product with an active variant (the meaning of `hasActiveProducts` in `catalog-search-readiness.ts`). `findMessageCandidates` returns, besides the sellable candidates, up to `TEXT_MATCH_UNAVAILABLE_CANDIDATES` (2, initial value, adjustable, max 4) products with no active variant, ranked by the same coverage, only when the company has a product with an active variant, and never one with the same name as a matched sellable product. **Same name has one meaning everywhere:** equal `productNameKey(name)` (`products/domain/product-name-key.ts`: lower case, and the accents of `productNameFolds` removed: á à â ä ã é è ê ë í ì î ï ó ò ô ö õ ú ù û ü ñ ç); the SQL builds the same key with `translate(lower(name), from, to)` from the same constant, and the `one_of` rule calls the function, so «Polo básico» and «polo basico» are twins in both. In a company with no product with an active variant both lists stay empty and the miss stays silent, as the product draft says. They reach the reader as `sellable: false` (name only, no variants: a few tokens each). An add of one reports `product_not_available`. In a `one_of`, a not-sellable product with the same name as a sellable one is dropped; the instructions (T3) also tell the reader that when the words fit a sellable and a not-sellable product equally, it picks the sellable one (product rule «Producto no disponible», «the words fit both equally»). |
| Closed latest order | `ChatReadingContext.latestOrder` is `open`, `closed` or `none` (cancelled counts as none). The context tells the reader when the latest order is closed; a change to it is answered with item `not_in_order`, which the existing transition reports as `order_closed` («…que ya no se puede modificar»). If the floor of the payment fallback is not met, this line is left out first and the generic body stays; the pull request says which shipped. |
| Prices | No code change: other currencies are already dropped by `statedMoney`, and a stated price is already kept on adds. The instructions (T3) say a price in another currency is never `not_allowed` unless it asks to change a price, and a price that identifies the product goes in the add's `price`. |
| `invalid_action` reasons | New reasons `malformed` (an incomplete or inconsistent reader action; today folded into `unknown_reference`), `quantity_below_zero` and `context_too_large` (the request does not fit the input-token budget even with only the products it cannot drop; no reader call, as `text_too_long`). All three notify with the generic body. |
| Cost per message | **Decided by the coordinator (round 3).** The US$0.003 worst case covers every model call of one message: the reader and, for a photo, the visual chooser and the image describer (with `IMAGE_EMBEDDER_PROVIDER=openai`) and its embedding, when they run. Reason: the founder's gate (Todoist task: «El costo por mensaje sigue en US$0,003 o menos»; product draft, cost gate) is per message, and the eval meter already counts a photo's calls together (`evals/lib/report.ts` `allowedCalls`). Discarded: a cap on the reader call only (a captioned photo near the reader's budget would pass the test and still cost more than US$0.003). How: the photo stages have a measured worst cost, `photoStagesReserveUsd` (§10.1), bounded by `PRODUCT_MATCH_CANDIDATES` max 8, the chooser's fixed image size (1,024 px, `product-chooser.ts`) and a new describer `max_output_tokens`; a photo message's reader budget is the text budget minus that reserve, so reserve + reader ≤ US$0.003. A queue retry is a separate attempt and is not added: each attempt is bounded on its own, and a message that fails after the reader call and is retried pays again (rare: a lock or transaction timeout, a crash before commit; at most 9 attempts by `chatMessagePolicy`). The pull request and `docs/message-to-order.md` say «per message, per attempt». Keeping the reader's answer across attempts is out of scope. |
| Reader input-token budget | The cost bound is enforced on every request, not on a fixture. `readerRequestSettings.maxOutputTokens` drops from 2,000 to **1,000** (the 10-action answer the bound already assumed; effort `none` gives 0 reasoning tokens, and reasoning would count inside it anyway). Two budgets, chosen by the context's `kind`: **text** `floor((0.003 × 10⁶ − 1,000 × 0.5) / 0.1 / tokenizerRatio)` = 25,000 o200k tokens with `tokenizerRatio` 1.00 until T8 measures it (§10.1); **photo** `floor(((0.003 − photoStagesReserveUsd) × 10⁶ − 1,000 × 0.5) / 0.1 / tokenizerRatio)`, about 15,000 with the default local embedder and 12,500 with the OpenAI describer at the initial reserve (§10.1). A photo budget under 8,000 tokens fails at startup (the usual captioned photo is about 3,400). Before the reader call, `fitReadingContext` (reader infrastructure, exposed to the use case as a port) counts **in priority order with early exit**: first the part never cut (instructions and schema, counted once at module load; the text; the listed items and pendings; the shown product), with `isWithinTokenLimit(part, budget)`, which stops counting at the budget, so a part over the budget is `context_too_large` without tokenizing the rest; then each product block in `selectReadingProducts` order with `isWithinTokenLimit(block, remaining)`; the first block that does not fit and every lower-priority block are dropped without being tokenized, setting `truncated`. The tokenizer work is therefore bounded by about the budget plus one partial block (≤ ~30 ms), whatever the catalog. A final `isWithinTokenLimit` of the whole rendered request confirms the fit (block sums can differ from the joined text by separators) and drops one more product if it does not. Items, pendings and the text are never cut (the only-item rule reads the listed items). Drop order, one for all sections: from the tail of `selectReadingProducts`: not-sellable candidates, then text candidates, then items' products, then doubtful pendings' candidates, then variant pendings' products; never the shown product. A doubtful pending whose candidates were dropped makes its `one_of` resolve as unclear: a notice, never a silent change. `gpt-tokenizer` moves from devDependencies to dependencies. An answer cut at 1,000 tokens is `INVALID_AI_RESPONSE` (permanent: `failed` with «No pudimos revisar», never silent and never retried). |
| Reader settings bounds | Zod `max()` on every reader setting, read from one exported `readerSettingBounds` so the worst-case test renders at it: `READER_MAX_PRODUCTS` max 24 and default 24 (today's value, kept: the token budget, not the count, bounds the cost), `READER_MAX_ITEMS` max 40, `READER_MAX_TEXT_CHARS` max 2000, `CHAT_PENDING_TTL_DAYS` max 30, `TEXT_MATCH_CANDIDATES` max 8 (today `MAX_CANDIDATES`, 26; the default is 8), `TEXT_MATCH_UNAVAILABLE_CANDIDATES` max 4, `TEXT_MATCH_MAX_WORDS` max 30, `TEXT_MATCH_PAIR_BUDGET` max 50000. Photo stages: `PRODUCT_MATCH_CANDIDATES` max 8 (today 26; default 5 kept), the image describer gets `max_output_tokens` 300 and effort `none` (its answer is at most 80 words, about 110 tokens). Time: `AI_TIMEOUT_MS` **max 35000** (default 20000 kept) and `PRODUCT_MATCH_TIMEOUT_MS` max 20000 (today's default), so the slowest attempt fits the 85 s attempt deadline with 4 s to spare: image description and the visual chooser, each up to `PRODUCT_MATCH_TIMEOUT_MS` (20 + 20), the 1 s candidate search, the reader (35) and the message transaction's 5 s timer (its lock waits end inside it) = 81 s; the 4 s left cover the image read from R2, the unlocked state reads, the local embedding and the fit, and T8 checks the sum against the measured photo path (the largest `latencyMs` of dev photo cases). Pool: `APPLY_CHAT_MESSAGE_CONCURRENCY` 1 to 16 (today's default is the bound), parsed with Zod instead of `Number(...) \|\| 16`; the worker's pool is **28** (`DATABASE_POOL_MAX`, on the production worker and in `compose.yaml`): every worker queue at full concurrency takes 24 (16 messages, 4 notices, 2 for the second policy in `chat-message-policy.ts`, 1 for the shared event handlers, 1 for photo indexing), plus 4 of headroom. The count rests on an invariant stated next to the bound in `chat-message-policy.ts`: a job holds at most one connection at a time (no query on the base client inside an open transaction, no `Promise.all` of reads); the message path keeps it today (the candidate search, then the message transaction). A value above its bound fails at startup. `AI_READER_MODEL`, `PRODUCT_MATCHER_MODEL` and `IMAGE_DESCRIBE_MODEL` stay free strings: their cost is a property of the model's price, not of a number code can bound; changing one requires re-running T3's and T8's measurements. |
| Worst-case cost test | Blocking. Reader (`chat-reader.model-text.test.ts`, T3): the worst case is defined from the domain limits, not from PR #248's fixture: `READER_MAX_PRODUCTS` products at `productOptionLimits` (3 options of 30 values of 30 code points, 100 variants, a different price per variant, both without and with the «Sold combinations» list, which a product with at most 2,000 combinations and few sold renders), 200-character names (`Product.name VarChar(200)`), `READER_MAX_ITEMS` items and 10 pendings with those names and values, and a text of `READER_MAX_TEXT_CHARS` UTF-16 units, each in four scripts (Latin, CJK, emoji, supplementary-plane CJK), as a text and as a captioned photo. For every one the test asserts that the fitted request is within its budget or the result is `context_too_large`, and that budget × input price + 1,000 × output price + reserve ≤ US$0.003 for any reserve the startup check admits. Photo stages (`visual-stages-cost.test.ts`, T1): at `PRODUCT_MATCH_CANDIDATES` 8 with a detail image and the OpenAI describer, the pinned worst tokens give at most `photoStagesReserveUsd`. Whole message (`chat-message-cost.test.ts`, T6): with every setting at its bound, the worst photo message (reserve of the configured stages + photo budget + answer limit) and the worst text message cost at most US$0.003. It also asserts the 16-product floor on PR #248's fixture (text budget) and that the usual case drops nothing as a text and as a captioned photo. Compacting per-combination prices stays in Todoist `6hrqHJghCXGwX26V`, after this task. The US$0.003 bound never changes. |
| Production worker | `compose.prod.yaml` `worker` gets `AI_READER_MODEL`, `AI_TIMEOUT_MS`, `CHAT_PENDING_TTL_DAYS`, `READER_MAX_PRODUCTS`, `READER_MAX_ITEMS`, `READER_MAX_TEXT_CHARS`, `TEXT_MATCH_CANDIDATES`, `TEXT_MATCH_MIN_SIMILARITY`, `TEXT_MATCH_PAIR_BUDGET`, `TEXT_MATCH_MIN_WORDS`, `TEXT_MATCH_MAX_WORDS`, `TEXT_MATCH_UNAVAILABLE_CANDIDATES` and `APPLY_CHAT_MESSAGE_CONCURRENCY`, each as `${VAR:-}`: every parser already treats an empty value as unset, so the code holds the only default and a tuned default leaves no stale copy. `DATABASE_POOL_MAX: ${DATABASE_POOL_MAX:-28}`, and `compose.yaml` moves from 24 to 28. `PRODUCT_MATCHER_PROVIDER` and `PRODUCT_MATCHER_MODEL` stay: the visual chooser (`openai-product-chooser.ts`) still reads them. |
| Eval: described photos in private runs | Private message cases and conversation steps run with `photo: { shows }` (product key, `not_product`, or the new `not_found`: a photo that matched nothing), plus optional `label`, identified by hand as the interpretation pass does. Photo files stay refused. The README states it. |
| Eval: dev-only diagnostics | In a run with `EVAL_SPLIT=dev` and no `EVAL_PRIVATE_DIR`, each record keeps `readerAnswer` (the reader's raw parsed JSON before schema validation and mapping, through the adapter's `observe` option, so answers that end as `INVALID_AI_RESPONSE` are kept too; the raw text when it is not JSON) and `invalidReasons` (the `reason` of each `invalid_action`). Test-split and private records keep neither. |
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
| Failed outcome | `infrastructure/chat-message-outcome-repository.ts` `recordFailedOutcome`, called by `chat-message-handler.ts` for permanent errors and the dead letter | Runs a `createMany … skipDuplicates` outside any transaction; when it writes no row it reads the stored outcome to decide the notice. Replaced by the application step `recordFailedChatMessage` (§5.4): one transaction that also writes the memory. |
| Notices | `orders/domain/seller-notice.ts` (`sellerNoticeKinds`, `SellerNotice`, `chooseSellerNotice`, `noticeReferences`), `presentation/seller-notice-texts.ts` (es, pt-BR) | `request_not_allowed` → `not_applied`. New kind `payment_request`. |
| Reader adapter | `orders/infrastructure/openai-chat-reader.ts` (`readerRequestSettings`, effort `none`, `max_output_tokens` 2000; `INVALID_AI_RESPONSE` is a permanent error in `apply-chat-message.ts:70`), `chat-reader-schema.ts` (one constant schema, `actionKinds`, `convertAction`), `chat-reader-text.ts`, `chat-reader-context-text.ts`, `chat-reader.model-text.json` and test | Modified. The adapter exposes no hook to read its output. |
| Token measurement | `chat-reader.model-text.test.ts` (PR #248, already in the integration branch through `bc8e185b`): o200k count with `gpt-tokenizer` 4.0.3 (a devDependency); a synthetic «worst case» of 24 products of 6 × 12 combinations with 8-token names gives 29,860 input tokens, US$0.003486, reported without blocking; usual case 2,603 tokens, US$0.00076, blocking. The synthetic case is far below the domain limits (§10.1). | T3 replaces the synthetic worst case with the domain worst case and makes it blocking. |
| Reader settings | `orders/infrastructure/chat-message-limits-env.ts` (`READER_MAX_PRODUCTS` default 24, no max; `READER_MAX_ITEMS` 40; `READER_MAX_TEXT_CHARS` 2000; `CHAT_PENDING_TTL_DAYS` 7), `chat-reader-env.ts` (`AI_READER_MODEL` `gpt-6-luna`, `AI_TIMEOUT_MS` 20000, no max), `chat-message-policy.ts` (`APPLY_CHAT_MESSAGE_CONCURRENCY` via `Number(...) \|\| 16`; `chatMessageDeadlineMs` 85,000), `products/composition.ts` (`TEXT_MATCH_*`; `PRODUCT_MATCH_TIMEOUT_MS` 20,000 is the timeout of the OpenAI client shared by the image describer and the visual chooser; `PRODUCT_MATCHER_*`). Every parser drops empty values before parsing, so an empty variable means the code default. | Bounds added. |
| Production worker | `compose.prod.yaml` service `worker` | Passes R2, `OPENAI_API_KEY`, `PRODUCT_MATCHER_*`, `IMAGE_*`, `PRODUCT_MATCH_*`; none of the reader, pendings, text-match or concurrency settings, and no `DATABASE_POOL_MAX` (pool of 10 by `persistance.ts:15`; `compose.yaml` sets 24). |
| `PRODUCT_MATCHER_*` | `products/composition.ts:84–113` | Still used by the visual chooser. Kept. |
| Photo stages' model calls | `products/application/identify-products-in-image.ts:97,107` (one `embedImage` and one `chooseProduct` per photo), `infrastructure/product-matching/product-chooser.ts` (images resized to at most 1,024 px; customer image, optional detail image and up to `PRODUCT_MATCH_CANDIDATES` candidates, today max `MAX_CANDIDATES` 26, default 5), `openai-product-chooser.ts` (Decisions API, no output limit; a choice and a predicate), `openai-image-embedder.ts` (only with `IMAGE_EMBEDDER_PROVIDER=openai`, default `local`: a `gpt-6-luna` description with no `max_output_tokens`, then a `text-embedding-3-small` call) | Recorded chooser calls (7,836 calls in the PR #237 dev runs under `~/yoyos-orquestacion/pedidos-por-mensaje/eval-runs`): billed input median 2,058, max 6,352 tokens, billed output 0. The describer has no recorded calls (the evals ran the local embedder). Bounded and reserved (§2 «Cost per message»). |
| Text candidates | `products/infrastructure/text-candidates.ts` (`coverageQuery`: `status = 'active'` and an active variant, `LIMIT` 8; the word cap counts `status = 'active'` products, that is every product), `application/find-message-candidates.ts` (`MessageCandidates`) | Only sellable products. Extended with products with no active variant. |
| Product states | `prisma/migrations/20260924060712_add_products` (`Product_status_active`: `status = 'active'`), `20261026212625_add_product_options` (`ProductVariant_status_valid`: `active` or `inactive`); `docs/products.md` («There is no product deletion, archiving or category») | A product is never deactivated, archived or deleted; a product with options stops being sold when every variant is inactive. `hasActiveProducts` (`products/infrastructure/catalog-search-readiness.ts`) already means «a product with an active variant». |
| Products for reading | `products/domain/reading-product.ts` (`sellable`), `infrastructure/reading-products.ts` (loads active variants only) | A product with no active variant reads `sellable: false`, name only. Reused as is. |
| Domain limits that size a rendering | `products/domain/product-structure.ts` `productOptionLimits` (3 options, 30 values each, 100 variants, option and value names of 30 code points); `Product.name VarChar(200)`; `ProductVariant.salePrice` up to 999,999,999.99; `OrderItem.productName` and `variantAttributes` copied from the product; `maxChatPendings` 10; `chat-reader-context-text.ts` lists «Sold combinations» for a product of at most 2,000 combinations when fewer are sold than not | §10.1 measures the rendering at these limits. |
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
5. A named product with no active variant never reaches the reader, so it ends as «Producto no reconocido» (§5.2, T1).
6. A text or caption of emoji only costs a reader call (§5.1, T6).
7. Nothing bounds the cost of a message: a single product at the domain limits renders 11,600 to 150,000 tokens, the synthetic worst case is already 16% over the bound, a captioned photo adds the visual chooser and the describer to the reader, the settings have no upper bound and never reach the production worker, whose pool is smaller than its queues (§2 «Cost per message», §10.1, T1, T3, T6).
8. A failed message leaves the photo memory as it was, so a retry after a partial write could apply a later quantity to an older photo (§5.4, §7, T6).
9. The eval cannot run described photos in private runs nor a photo that matched nothing, keeps no reader answer, does not report photo cases apart, consistency or the product draft's extra metrics, and cannot accept the payment fallback in conversation steps (§12.1, T4).

## 5. Use cases

### 5.1 `applyChatMessage` (modified), feature `orders`

`input`, `access` (`{ companyId, messageId }` from the queue payload) and output unchanged. Deps change:

```ts
// ApplyChatMessageDependencies: unchanged entries omitted.
findChatPendings: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>;          // now with lastIncomingPhoto
findChatPendingsForUpdate: (chatId: ChatId) => Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>>; // same
saveChatPendings: (chatId: ChatId, pendings: ChatPendings) => Promise<Result<null, PersistenceError | InvalidStoredData>>;
findMessageCandidates: (text: string) => Promise<Result<MessageCandidates, PersistenceError>>; // MessageCandidates gains unavailableProductIds
/** Reader infrastructure: the context whose whole request fits the input-token budget of its kind (text, or photo: minus the photo stages' reserve), keeping products in priority order. */
fitReadingContext: (context: ChatReadingContext) => Result<FittedReadingContext, ContextTooLarge>;
```

```ts
// orders/application/read-chat-message.ts, next to ReadChatMessage
export type FittedReadingContext = Readonly<{ context: ChatReadingContext; countedInputTokens: number; droppedProducts: number }>;
export type ContextTooLarge = Readonly<{ code: "CONTEXT_TOO_LARGE"; countedInputTokens: number }>;
```

`ReadingTrace` gains `photoJustSent: boolean`, `countedInputTokens` and `droppedForBudget`. Errors unchanged: `CONTEXT_TOO_LARGE` is not an error of the use case, it becomes the outcome `invalid_action context_too_large`.

Flow (changes in bold):
1. Outcome exists → `already_processed`. Message missing → `MESSAGE_NOT_FOUND`. Outgoing → skipped.
2. **A text with no letter or digit → skipped `empty_text`** (no row, no memory change).
3. Load the chat state unlocked: target, pendings, `pendingLife`, **`lastIncomingPhoto` and `photoJustSentOf(message kind, memory, target, alive pendings)`, which is `null` for a photo**.
4. Photo: cascade; **a caption with no letter or digit is no caption**. Text: candidates.
5. Build the context: **`latestOrder` from the target**, **the marker (`photoJustSent`, texts only) and its flag on the listed pending or item**, products with **`unavailableProductIds` after the sellable candidates** under the ceiling.
6. **When the reader is called: `fitReadingContext` with the budget of the message's kind; `CONTEXT_TOO_LARGE` → `invalid_action context_too_large` with no reader call (as `text_too_long`).** Reader on the fitted context (or the fixed answer), then `checkReaderAnswer` on the same fitted context, so every ref the reader saw resolves and no ref it did not see does.
7. Transaction: lock contact; re-check outcome; lock order target; lock `ChatPendings`; `pendingLife`; `applyChatActions`; **`nextLastIncomingPhoto(message kind, stored.lastIncomingPhoto, applied, shownProductIds)`**; save order, pendings row (pendings, «listo», **memory**) when changed, `OrderMessage`, outcome.
8. After commit: notice as today.

What each kind of incoming message does to the memory (§6.3):

| Message | Transaction | Memory after |
| --- | --- | --- |
| Outgoing | none (skipped) | unchanged: the reader never sees outgoing messages, so a seller reply between the photo and «quiero 3» keeps the photo just sent |
| Text with no letter or digit (`empty_text`) | none (skipped) | unchanged («👍» is not a message in between) |
| Text while the reader is off (`reader_disabled`) | none (skipped) | unchanged; while the reader is off no text is read, so no marker can be used; limit in §15 |
| Text read by the reader, or answered without a call (`text_too_long`, `context_too_large`) | yes | `null`: it is an incoming message in between, so a later set quantity is an unnamed add |
| Photo (any) | yes | `nextLastIncomingPhoto` (§6.3) |
| Failed message | `recordFailedChatMessage` | `{ left: null }` (§5.4) |

The marker is computed outside the lock. Under the lock both marked targets are re-checked: `change_pending_quantity` applies only while its pending is alive, and `set_marked_item_quantity` only while the open order is the remembered one and its item of the remembered variant still has the remembered quantity; otherwise each applies its `otherwise` (`unnamed_add`), never a silent change to something else.

### 5.2 `findMessageCandidates` (modified), feature `products`, public composition

```ts
export type MessageCandidates = Readonly<{
  productIds: readonly ProductId[];            // sellable (a product with an active variant), ranked (unchanged)
  /** Products with no active variant the words name, ranked; empty when the company has no product with an active variant. */
  unavailableProductIds: readonly ProductId[];
  /** Sellable matches before the cut (unchanged meaning). */
  matchCount: number; durationMs: number; timedOut: boolean; wordsSearched: number;
}>;
```

«Not sellable» is the only state the schema allows besides sellable: a product (always `status = 'active'`) whose variants are all inactive. There is no deactivated, archived or deleted product (§3).

Flow: same words, word cap, timeout and transaction as today; one statement whose cut happens in SQL, so at most `TEXT_MATCH_CANDIDATES + TEXT_MATCH_UNAVAILABLE_CANDIDATES` rows (12 at the bounds) leave the database whatever the catalog size:

```sql
WITH matched AS (            -- today's scan: company products, coverage over the words at or above minSimilarity
  SELECT p.id, p.name, sum(m.sim) AS coverage,
         EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active') AS sellable
  FROM "Product" p CROSS JOIN LATERAL (...) m
  WHERE p."companyId" = $company AND m.sim >= $minSimilarity
  GROUP BY p.id, p.name),
keyed AS (                   -- one sort: does a sellable product with the same name key match too?
  SELECT m.*, bool_or(m.sellable) OVER (PARTITION BY translate(lower(m.name), $foldFrom, $foldTo)) AS sellableTwin
  FROM matched m),
ranked AS (
  SELECT id, sellable, row_number() OVER (PARTITION BY sellable ORDER BY coverage DESC, length(name), id) AS rank,
         count(*) FILTER (WHERE sellable) OVER () AS matches
  FROM keyed
  WHERE sellable OR (NOT sellableTwin           -- a not-sellable row survives only with no sellable twin
    AND EXISTS (SELECT 1 FROM "Product" a WHERE a."companyId" = $company      -- and beside a sellable product of the company
                AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = a."companyId" AND v."productId" = a.id AND v.status = 'active'))))
SELECT id, sellable, matches FROM ranked
WHERE (sellable AND rank <= $candidates) OR (NOT sellable AND rank <= $unavailableCandidates)
ORDER BY sellable DESC, rank;
```

1. Rank the company's matched products by coverage, as today; `sellable` is the existing active-variant `EXISTS`, now a column instead of a filter.
2. Same-name rule, without a new index or table scan: two products with the same name have the same `word_similarity` to every word, so a sellable twin of a matched not-sellable product is in `matched` too. A twin that differs only by accents or case («Polo básico» and «polo basico») can score slightly differently and miss the threshold; then the not-sellable row is returned, the reader sees it as `sellable: false`, and the `one_of` rule or «Producto no disponible» gives a notice, never a silent change (§15). The check is a window over the matched rows (`bool_or … OVER (PARTITION BY name key)`): one sort of the M matched rows, M log M, instead of a correlated subplan under `OR`, which PostgreSQL cannot pull up into an anti-join and which would cost U × M comparisons (round-2 performance finding 1). `$foldFrom` and `$foldTo` are the two strings of `productNameFolds` (`products/domain/product-name-key.ts`), the same constant `productNameKey` uses, so SQL and the domain share one meaning of «same name».
3. Company rule: the uncorrelated `EXISTS` is evaluated once per statement (an InitPlan) and stops at the first product with an active variant; when a sellable row matched, it is already true.
4. Cut per partition with `row_number()`: the top `TEXT_MATCH_CANDIDATES` sellable rows and the top `TEXT_MATCH_UNAVAILABLE_CANDIDATES` not-sellable rows. `matches` counts sellable matches (today's `matchCount`).
5. Timeout → both lists empty, `timedOut: true` (unchanged). The row schema becomes `{ id, sellable, matches }`.
6. Benchmark (T1 AC5): besides today's words, at least one broad word that matches thousands of rows of the 10,000-product catalog («polo», «negro» style, seeded so), with `EXPLAIN (ANALYZE)` of the statement before and after recorded in the PR.

Errors: `PERSISTENCE_UNAVAILABLE` (unchanged).

### 5.3 Notice delivery (unchanged use case, new kind)

`describe-chat-message-notice.ts` and `send-chat-message-notice` are unchanged; `noticeReferences` reads the order id inside `payment_request.order` and its product ids, so names and numbers are loaded in the same two queries.

### 5.4 `recordFailedChatMessage` (new application step), feature `orders`

Replaces the handler's direct call to the repository's `recordFailedOutcome`, for permanent errors and for the dead letter. It exists so that the failed outcome and the photo memory are written atomically, and so that the rule «a failed message leaves no photo just sent» is visible in the application and testable with fakes instead of hidden in a repository (guide 4.3).

```ts
// orders/application/record-failed-chat-message.ts
export type RecordFailedChatMessageDependencies = Readonly<{
  transaction: <T, E>(work: () => Promise<Result<T, E>>) => Promise<Result<T, E | PersistenceError>>; // company-scoped
  /** Inserts `failed` unless the message has an outcome; returns what is stored after the call. Requires the active transaction. */
  insertFailedOutcome: (messageId: ChatMessageId, errorCode: ChatMessageFailureCode) =>
    Promise<Result<Readonly<{ inserted: boolean; stored: StoredChatMessageOutcome | null }>, PersistenceError | InvalidStoredData>>;
  /** Upserts the memory of the message's chat, keeping its pendings and «listo»; no row for a message that does not exist. Requires the active transaction. */
  saveLastIncomingPhotoOfMessageChat: (messageId: ChatMessageId, memory: LastIncomingPhoto) => Promise<Result<null, PersistenceError>>;
}>;
export function recordFailedChatMessage(deps: RecordFailedChatMessageDependencies):
  (messageId: ChatMessageId, errorCode: ChatMessageFailureCode) => Promise<Result<FailedOutcomeResult, PersistenceError | InvalidStoredData>>;
```

Flow, in one `transaction(companyId)`:
1. `insertFailedOutcome` (`INSERT … ON CONFLICT DO NOTHING`, then the stored row when nothing was inserted; a missing message is `stored: null`, as today's `P2003` path).
2. When the stored outcome is `failed` (written now, or written by an earlier attempt of this message whose memory write did not commit): `saveLastIncomingPhotoOfMessageChat(messageId, memoryAfterFailure())`, where `memoryAfterFailure()` is `{ left: null }` (`photo-just-sent.ts`, pure). When the stored outcome is a successful application, nothing else is written: that message may itself be the photo just sent, and its transaction already wrote the memory.
3. `publishNotice` is computed as today (`inserted`, or an existing row whose notice is due and not claimed).

Both writes commit or neither does, so a retry after a partial failure cannot exist; step 2 also covers a row written by an older version of the code. The write never creates a marker (`left` is `null`), so even if the dead letter runs after a later message of the chat, the worst effect is one extra unnamed-add notice, never a silent change. Lock order: the outcome row (primary key), then the `ChatPendings` row; the message transaction takes the `ChatPendings` row before inserting its own outcome, but for a different message, so no cycle exists.

### 5.5 Unchanged use cases

`registerMobileMessage`, the queue policy (deadline, retries, ordering key), the dead-letter handler (it calls `recordFailedChatMessage`), payments, checkout and every order use case.

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
  /** What the photo just sent left, while it still is; always null when `kind` is not `text`. The domain reads this, not the line flags, so an unlisted item still counts. */
  photoJustSent: PhotoLeft | null;
  truncated: boolean;
}>;
/** `photoJustSent` on a line only tells the reader which listed line the photo left. */
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

Justification: `latestOrder` is the one fact the reader lacks to answer a change after a closed order (the target's `closed` variant is not in the context today). The reader sees `photoJustSent` as a flag on the existing line types, not a new type, because at most one line carries it; the domain reads the context's `photoJustSent` (`PhotoLeft`), because the remembered item can be past `READER_MAX_ITEMS` and have no line. `ReaderQuantityTarget` exists because a pending is not an item and `ReaderItem` has no pending kind; reusing `ReaderItem` keeps `remove`, `change_variant` and `set_price` unchanged.

`checkReaderAnswer(answer, context, options)` changes, in this precedence:
1. `no_intent` on `photo_product` → `checkReaderAnswer(fixedShownAnswer(context), context, { captionDoubt: false })`.
2. `actions` on `photo_product` where every action is `payment_request`, `not_allowed` or `ready` → the fixed shown actions first, then the answer's actions.
3. `payment_request` → `report payment_requested` with `order: { kind: "none" }`, `productIds: []`, `unnamed: 0`; `applyChatActions` fills it.
4. `malformed` → `invalid_action malformed`.
5. `change_quantity`:
   - target `pending` ref → `change_pending_quantity { pendingId, mode, quantity, otherwise: report unclear_item }` (unknown ref → `invalid_action unknown_reference`); non-whole → `quantity_not_whole`.
   - target `unnamed` with `context.photoJustSent` (only on a `text` context) → mode `set`: the remembered item (`set_marked_item_quantity { orderId, variantId, expectedQuantity, quantity, otherwise: report unnamed_add }`) or the remembered pending (`change_pending_quantity set`, `otherwise: report unnamed_add`); mode `increase` or `decrease` → `unnamed_add`.
   - target `unnamed` without `photoJustSent`, and `ref` or `not_in_order` → as today, plus `decrease` → `lower_quantity { target, quantity }`.
6. `complete_pending` with `product: null`, no attributes and a quantity → an unnamed quantity: if its pending is the remembered one (`photoJustSent.kind === "pending"` with its id), `change_pending_quantity set`; otherwise `unnamed_add`. A `complete_pending` with attributes or a product is unchanged («3 de esos en M negro» completes the marked pending with ×3).
7. `add` with product `unnamed` → `unnamed_add` (unchanged, also with a marker).
8. `one_of` with not-sellable products whose `productNameKey` equals a listed sellable product's → those are dropped before the doubt rule; one left → that product.

New resolved actions in `orders/domain/chat-order.ts`:

```ts
export type ResolvedChatAction =
  | /* unchanged kinds */
  | Readonly<{ kind: "lower_quantity"; target: ItemTarget; quantity: PositiveInteger }>
  | Readonly<{ kind: "change_pending_quantity"; pendingId: ChatPendingId; mode: "increase" | "set" | "decrease"; quantity: number; otherwise: ResolvedChatAction }>
  | Readonly<{ kind: "set_marked_item_quantity"; orderId: OrderId; variantId: VariantId; expectedQuantity: PositiveInteger; quantity: number; otherwise: ResolvedChatAction }>;
```

`lower_quantity`: result above 0 → `quantity_lowered`; exactly 0 → removal (`removed`, or `only_item_kept` for the only item); below 0 → `invalid_action quantity_below_zero`. `change_pending_quantity` applies `changePendingQuantity` (§6.2) when the pending is alive, otherwise `otherwise`; when it ends the pending at exactly 0 it sets `pendingResolved`, as `decline_pending`. `set_marked_item_quantity` applies today's `set_quantity` on `variantId` only when the open order under the lock is `orderId` and its item of `variantId` has `expectedQuantity`; otherwise `otherwise`.

`finishPendings` fills every `payment_requested` outcome: `order` from the target after the message (`open` with its id), else from the original target (`closed` with its id), else `none`; `productIds` and `unnamed` from `describePendings(left)`. It never changes `readyRemembered` beyond today's rules: a «listo» in a message with a payment request is remembered as today.

### 6.2 Pendings: `chat-pendings.ts` and `pending-transitions.ts`

```ts
/** The last processed incoming message was a photo (or failed, which counts as a photo that left nothing). Null after a read text. */
export type LastIncomingPhoto = Readonly<{
  /** Null when the photo does not count as the photo just sent: no single shown product, right after another photo, or it left nothing. */
  left: PhotoLeft | null;
}>;
export type PhotoLeft =
  | Readonly<{ kind: "pending"; pendingId: ChatPendingId }>
  | Readonly<{ kind: "item"; orderId: OrderId; variantId: VariantId; quantity: PositiveInteger }>;
export type ChatPendings = Readonly<{ pendings: readonly ChatPending[]; readyRemembered: boolean; lastIncomingPhoto: LastIncomingPhoto | null }>;
```

Justification: the product rule needs two facts about earlier messages (the previous one was a photo, and what it left) and forbids reading their text. No message id is kept: no rule reads it, and without it a photo after a photo that left nothing changes nothing in the row, so the write is skipped. They are chat state written under the same lock as the pendings, so they live in the same row; a separate table would be one more lock and write for one value.

`changePendingQuantity(set, { pendingId, mode, quantity }, env): PendingStep` (pure, `pending-transitions.ts`): the new quantity is `quantity` (set), `pending.quantity + quantity` (increase) or `pending.quantity - quantity` (decrease). Above 99 → `quantity_above_limit` with the pending's product, unchanged. Exactly 0 → the pending ends, `pending_ended declined`, and the step reports it as resolved by the buyer (`applyChatActions` sets `pendingResolved`). Below 0 → `invalid_action quantity_below_zero`. Otherwise `pending_updated`, `lastChangedAt = now`, price kept with its `forQuantity`. No notice in the success cases.

### 6.3 Photo memory: `orders/domain/photo-just-sent.ts` (new)

```ts
export type IncomingMessageKind = "text" | "photo";
/** The memory after a message: a photo stores what it left when it counts; a read text clears it. */
export function nextLastIncomingPhoto(input: Readonly<{ kind: IncomingMessageKind; previous: LastIncomingPhoto | null;
  shownProductIds: readonly ProductId[]; applied: AppliedChatActions }>): LastIncomingPhoto | null;
/** The line the reader is told about, while it is still what the photo left; null when the message being read is a photo. */
export function photoJustSentOf(kind: IncomingMessageKind, memory: LastIncomingPhoto | null, target: ChatOrderTarget, pendings: readonly ChatPending[]): PhotoLeft | null;
/** The memory a failed message leaves: as a photo that left nothing (§5.4). */
export function memoryAfterFailure(): LastIncomingPhoto;
```

`nextLastIncomingPhoto`:
1. Text → `null`.
2. Photo with `previous !== null` (right after another photo), or with a shown-product count other than 1 (non-product, matched nothing, several products) → `{ left: null }`.
3. Photo of one product: an `added` outcome for that product → `{ kind: "item", orderId: order after the message, variantId, quantity: the item's quantity after the message }`; otherwise a `pending_created`, `pending_updated` or `pending_split` outcome whose pending (in `applied.pendings`) has that product as subject → `{ kind: "pending", pendingId }`; otherwise `left: null` (declined, `not_identified`, `product_not_available`, `quantity_above_limit`).

`photoJustSentOf`: `kind` `photo` → `null` (a caption never acts on the previous photo; the product rule «two or more incoming photos in a row make any following "N de esos" an unnamed add» and the photo rules for the photo's own product); `left` pending → alive in `pendings`; `left` item → target open with `order.id === orderId` and an item of `variantId` with `quantity`; otherwise `null`.

`memoryAfterFailure()` → `{ left: null }`.

### 6.4 Outcomes and notices

```ts
// chat-message-outcome.ts additions
export type PaymentOrder = Readonly<{ kind: "open" | "closed"; orderId: OrderId }> | Readonly<{ kind: "none" }>;
| Readonly<{ kind: "payment_requested"; order: PaymentOrder; productIds: readonly ProductId[]; unnamed: number }>
| Readonly<{ kind: "invalid_action"; orderId: OrderId | null; reason: "unknown_reference" | "not_the_shown_product" | "quantity_not_whole" | "text_too_long" | "too_many_actions" | "malformed" | "quantity_below_zero" | "context_too_large" }>

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
- Row write: deleted when `pendings` is empty, `readyRemembered` is false and `lastIncomingPhoto` is null; upserted otherwise; skipped when nothing changed (as today).
- Failed message (§5.4), both statements in the caller's company-scoped transaction (`requireActiveTransaction`):
  - `chat-message-outcome-repository.ts` `insertFailedOutcome`: `INSERT INTO "ChatMessageOutcome" … ON CONFLICT ("companyId", "messageId") DO NOTHING`; when no row was inserted, the stored row is read in the same transaction (`findOutcome`). The insert is written as `INSERT … SELECT … FROM "ChatMessage" WHERE id = $messageId`, so a missing message inserts nothing and returns `stored: null` (today's `P2003` path) without a foreign-key error aborting the transaction; that path keeps today's `chat_message_outcome_without_message` warning. The `outcomes` JSON is built by the domain and validated with the outcome Zod schema before the raw statement is sent (as `createMany` does today), and the stored row read back is parsed with the same schema. Replaces `recordFailedOutcome`.
  - `chat-pending-repository.ts` `saveLastIncomingPhotoOfMessageChat`: `INSERT INTO "ChatPendings" ("companyId", "chatId", "pendings", "readyRemembered", "lastIncomingPhoto", "updatedAt") SELECT companyId, chatId, '[]', false, $memory, now() FROM "ChatMessage" WHERE id = $messageId ON CONFLICT ("companyId", "chatId") DO UPDATE SET "lastIncomingPhoto" = EXCLUDED."lastIncomingPhoto", "updatedAt" = EXCLUDED."updatedAt"`: pendings and «listo» are kept; served by `ChatMessage @@unique([companyId, id])` and the `ChatPendings` primary key.
- `ChatMessageOutcome.outcomes` JSON accepts `payment_requested` and the three new reasons; existing rows still parse.
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
| A message fails permanently or exhausts retries after a photo | `recordFailedChatMessage` writes `failed` and `{ left: null }` in one transaction | A following «quiero 3 de esos» is an unnamed add with its notice, never applied to an older photo |
| The memory write fails after the failed outcome would have been inserted | Both roll back; the handler retries; the retry inserts and writes again | Same as above, once |
| An earlier attempt left a `failed` row without the memory (code before this change) | The retry finds the stored `failed` and writes `{ left: null }` | Same as above |
| The dead letter runs after a later message of the chat was processed | `{ left: null }` overwrites a newer memory | At most one extra unnamed-add notice; never a silent change |
| The photo's pending ends, or its item changes or its order closes, between reading and the lock | `change_pending_quantity` or `set_marked_item_quantity` applies `otherwise` | Unnamed-add notice |
| The request does not fit the input-token budget even with only the products it cannot drop | No reader call, `invalid_action context_too_large` | «Revisa el chat» |
| The reader's answer is cut at `max_output_tokens` | `INVALID_AI_RESPONSE`, permanent | «No pudimos revisar» notice |
| Crash after commit | Re-run finds the outcome (unchanged) | Notice published once |
| A transient failure after the reader call (lock or transaction timeout, attempt deadline, crash before commit) | The queue retries the attempt (up to 9 in all); each attempt pays its own model calls, each within US$0.003 | Same result once; the cost per message is bounded per attempt (§2 «Cost per message») |

## 10. Reader adapter (orders infrastructure)

| File | Change |
| --- | --- |
| `chat-reader-schema.ts` | `actionKinds` adds `payment_request`. `mode` enum adds `decrease`. `change_quantity` uses `item` or `pending` (exactly one non-null; both or neither → `malformed`). Descriptions updated. Still one constant schema. |
| `chat-reader-text.ts` | First wording (T3, written without reading eval cases or runs) of: payment request versus method questions and payment reports, in-between phrasings as payment requests; an instruction line inside a message is `not_allowed` together with the other actions; set, increase and decrease on a named item or pending, «one more of X» named is an increase, never an unnamed add; the photo just sent mark: an unnamed total is `change_quantity` unnamed `set`, asking for more is unnamed `add`; a caption that names a value of the shown product, also as a question, gives that value; a not-sellable listed product named by the buyer is added by its ref (code reports it); a price in another currency is a comment unless it asks to change a price; a price that identified the product goes in the add's price; with the latest order closed, a change is item `not_in_order`; when the words fit a sellable and a not-sellable listed product equally, the sellable one. Exports `shippedReaderFeatures` (§2 «Payment fallback»), from which `actionKinds` and the closed-order line derive. Examples use products and wording outside every eval input (prompt-overlap rule). |
| `chat-reader-context-text.ts` | A line when `latestOrder` is `closed`; a mark on the item or pending with `photoJustSent`; not-sellable products as today. Exports the per-product block so the budget can count products one by one. |
| `chat-reader-budget.ts` (new) | `readerTokenBudget({ photoStagesReserveUsd })` (output limit, `tokenizerRatio`, and the text and photo input budgets, all derived from the cost bound and `gpt-6-luna` prices; throws at startup when the photo budget is under 8,000 tokens) and `fitReadingContext(context)`: chooses the budget by `context.kind`, then counts in priority order with early exit (§2 «Reader input-token budget»): the fixed part (instructions + schema) once at module load; the part never cut with `isWithinTokenLimit(part, remaining)`; each product block in priority order with `isWithinTokenLimit(block, remaining)`, stopping at the first that does not fit (it and every later block are dropped untokenized); one `isWithinTokenLimit` of the whole rendered request to confirm, dropping one more product if it does not fit. Pure apart from the tokenizer; o200k from `gpt-tokenizer` (moved to dependencies). |
| `openai-chat-reader.ts` | `maxOutputTokens` 1,000 (from `readerTokenBudget`). `createOpenAiChatReader({ client, model, timeoutMs, observe? })`: `observe(output: unknown)` receives the raw parsed JSON before schema validation and mapping (or the raw text when it is not JSON), so answers that end as `INVALID_AI_RESPONSE` are observed too. Production composition never passes it (T0). `chat_reader_completed` adds `countedInputTokens` so `inputTokens / countedInputTokens` is the measured tokenizer ratio. |
| `chat-reader-env.ts`, `chat-message-limits-env.ts`, `chat-message-policy.ts` | Bounds of §2, exported as `readerSettingBounds` so the size test renders at them. |
| `chat-reader.model-text.json` + test | Pins the new instructions, schema, settings, budget and contexts (one more context: a photo just sent mark with a closed latest order). The domain worst cases of §10.1 are blocking. |

### 10.1 Context size and cost

`gpt-6-luna`: US$0.10 per million input tokens, US$0.50 per million output tokens (as `evals/lib/model-meter.ts`). With `max_output_tokens` M, effort `none` (0 reasoning tokens, which would count inside M anyway), the worst-case cost of a call is `input × 0.1 + M × 0.5` per million, so the input budget is `(0.003 × 10⁶ − 0.5 M) / 0.1 = 30,000 − 5 M` tokens. M = 1,000 gives **25,000 input tokens**; M = 2,000 (today) would give 20,000.

Why a budget and not a product count. Measured with o200k (`gpt-tokenizer` 4.0.3) on a copy of `productLines`, one product at `productOptionLimits` with a 200-character name and a different price per variant renders:

| Script of names and values | 3 options × 30 values, no sold list | ≤ 2,000 combinations, 100 sold, «Sold combinations» listed | 200-char name | Item line at the limits | Text of 2,000 UTF-16 units |
| --- | --- | --- | --- | --- | --- |
| Latin | 11,607 | 20,427 | 100 | 209 | 1,001 |
| CJK (BMP) | 41,643 | 73,467 | 383 | 755 | 3,791 |
| Emoji | 47,388 | 84,054 | 428 | 842 | 2,161 |
| CJK (supplementary plane) | 84,997 | 150,671 | 795 | 1,536 | 3,969 |

One product can exceed the whole budget, so no value of `READER_MAX_PRODUCTS` bounds the cost, and neither does any cap on items or text alone. The request is therefore counted and fitted before every call (§2 «Reader input-token budget»):
- What is never cut: instructions and schema (about 2,900 tokens with this task), the text (bounded by `READER_MAX_TEXT_CHARS`), the listed items and pendings (the only-item rule and refs depend on them) and the shown product.
- What is cut: products, from the tail of `selectReadingProducts` (not-sellable candidates, text candidates, items' products, doubtful pendings' candidates, variant pendings' products), each drop setting `truncated`. A doubtful pending whose candidates were dropped resolves as unclear (a notice). An item or pending whose product was dropped still renders by name («a product that is not listed» for a pending), so its refs keep working.
- When even that does not fit (a shown product at the limits in a non-Latin script, or 40 items with 200-character CJK names), the message gets `context_too_large` and the generic notice. With Latin names at the limits, 40 items, 10 doubtful pendings of 4 candidates and a 2,000-character text take about 17,000 tokens with the fixed part, which leaves about 8,000 for products; a realistic catalog never reaches this path (the measured counts go in the pinned JSON).

Expected effect on what the reader sees (PR #248's synthetic catalog, products of 72 combinations with a price each, about 1,053 tokens per product): 29,860 tokens at 24 products today + ~800 for this task's texts → about 18 products fit (the earlier draft's expected ceiling, now reached by the budget instead of a count). The floor of §2 (16 products of that catalog, text budget) is what the payment fallback and the closed-order line are measured against. A captioned photo of that catalog keeps about 10 products with the local embedder and 8 with the OpenAI describer: the shown product, pendings' and items' products come first, so this cuts text candidates, which a caption rarely needs; it is not a gate and is reported by T8 (share of photo calls that dropped products). The usual case (12 realistic products, 2,603 tokens today, about 3,400 with this task, US$0.0008) drops nothing. Not-sellable candidates cost about 10 tokens each.

The answer side: a strict 10-action answer of realistic values is about 1,000 tokens (10 × ~100, the figure PR #248 already assumed). T3 measures with o200k a strict 10-action answer whose values are the PR #248 fixture's and records it in the pinned JSON; if it is over 900 (less than 10% headroom), T3 stops and escalates instead of raising M, because every 100 output tokens cost 500 input tokens of budget. An answer cut at M is `INVALID_AI_RESPONSE`, a permanent failure with «No pudimos revisar»: never silent, never retried, never billed twice.

Tokenizer. o200k is a proxy for `gpt-6-luna`. `tokenizerRatio` starts at 1.00. T8 computes `inputTokens / countedInputTokens` from `chat_reader_completed` over every reader call of its dev runs **and over a handful of direct reader calls whose fitted request sits at the budget** (PR #248's synthetic catalog in Latin, and one non-Latin domain worst case; a few cents), because dev calls are mostly about 3,400 tokens dominated by the fixed part, and the billed ratio of catalog text at 25,000 tokens can be higher than any ratio seen at 3,400. It sets `tokenizerRatio` to the largest observed ratio rounded up to 0.01 when it is above 1.00 (the budget divides by it), so the bound holds on the billed tokens, not on the proxy. It is done before T10 reports the cost per message. The non-Latin worst cases still rest on one measured non-Latin call (§15).

Photo stages. A photo message runs at most one image description (only with `IMAGE_EMBEDDER_PROVIDER=openai`) with its embedding, and one visual chooser call (`identify-products-in-image.ts`), with images resized to at most 1,024 px. Their worst billed cost is bounded by the settings, not by the catalog:
- chooser: input = fixed text + (customer image + detail image + `PRODUCT_MATCH_CANDIDATES` max 8) × tokens of one 1,024-px image; output = a choice and a predicate (billed 0 in all 7,836 recorded calls; reserved at 100);
- describer: one 1,024-px image + its prompt; output ≤ `max_output_tokens` 300 (new, with effort `none`); embedding of at most 300 tokens at US$0.02 per million (under US$0.00001).

`products/infrastructure/product-matching/visual-stages-cost.ts` (T1) pins the worst billed tokens per call and computes `photoStagesReserveUsd(config)` from the configured candidates and embedder provider, at `gpt-6-luna` prices. Initial values from the recorded chooser calls (max 6,352 billed input tokens with at most 7 images, about 910 per image): chooser about 9,400 input tokens at 8 candidates (US$0.00099 with its output reserve), describer about 1,000 input and 300 output (US$0.00025). Reserve: about US$0.00099 with the local embedder (default) and US$0.00125 with the OpenAI describer, so the photo reader budget is about 15,000 and 12,500 tokens. T8 measures the exact billed tokens with a few direct calls at the bounds (8 candidates plus a detail image, all at 1,024 px; one description) and pins the larger of measured and initial values. These are billed tokens, so no tokenizer ratio applies to them. Compacting per-combination prices to win back products is Todoist `6hrqHJghCXGwX26V`, after this task.

## 11. Transactions and concurrency

1. Company scope (`transaction(companyId)`).
2. `lockContact` serializes the messages of the chat (unchanged).
3. Outcome re-check; order target `FOR UPDATE`; `ChatPendings` `FOR UPDATE` (now also the memory).
4. `pendingLife`, `applyChatActions`, `nextLastIncomingPhoto` (pure).
5. Writes: order (new or changed items), `ChatPendings` (pendings, «listo», memory) only when changed, `OrderMessage`, `ChatMessageOutcome`.
6. Commit; notice after.

The memory is written only under the contact lock and the pendings row lock, so two messages of one chat never interleave its read and write. A failed message writes its outcome and `{ left: null }` in one company-scoped transaction (§5.4): outcome row, then the `ChatPendings` row by upsert (no cycle with the message transaction, which inserts the outcome of a different message). A permanent error runs it while the chat's queue key is held by the failed job; the dead letter may run later, and its write can only remove a marker, never create one. A repeated message ends as `already_processed` before any write, so the memory never advances twice for one message.

## 12. Code organization

| File | Change | Task |
| --- | --- | --- |
| `orders/domain/chat-message-outcome.ts` (+ test) | `payment_requested`, `PaymentOrder`, three reasons | T0 |
| `orders/application/read-chat-message.ts` | `FittedReadingContext`, `ContextTooLarge` types | T0 |
| `orders/domain/seller-notice.ts`, `presentation/seller-notice-texts.ts` (+ tests) | `payment_request` kind, choice, references, texts | T0 |
| `orders/domain/chat-reading.ts` | Types (§6.1) in T0 with compile glue that keeps today's behavior (`payment_request` → `request_not_allowed`; pending target and `decrease` → `invalid_action malformed`); rules in T2 | T0, T2 |
| `orders/domain/chat-order.ts`, `pending-transitions.ts`, `chat-pendings.ts` (functions), `chat-reading-fixtures.ts`, `chat-criteria.test.ts` and tests | Rules of §6.1–6.2 | T2 |
| `orders/domain/chat-pendings.ts` (types and schema) | `LastIncomingPhoto`, `PhotoLeft`, schema | T0 |
| `orders/domain/photo-just-sent.ts` (+ test) | New (§6.3), including `memoryAfterFailure` | T6 |
| `orders/application/apply-chat-message.ts`, `reading-context.ts`, `chat-message-handler.ts` | §5.1 (including the memory table); the handler calls `recordFailedChatMessage` | T6 (T0: `buildReadingContext` sets `latestOrder` and `photoJustSent: null` / `false` as glue) |
| `orders/application/record-failed-chat-message.ts` (+ unit test with fakes) | New (§5.4) | T6 |
| `orders/infrastructure/chat-pending-repository.ts` (+ integration test) | Column read/write, deletion rule, `saveLastIncomingPhotoOfMessageChat` | T0 |
| `orders/infrastructure/chat-message-outcome-repository.ts` (+ integration test) | `insertFailedOutcome` inside the caller's transaction, replacing `recordFailedOutcome` | T6 |
| `orders/infrastructure/openai-chat-reader.ts` | `observe` option (T0); `maxOutputTokens` from the budget and `countedInputTokens` in the log (T3) | T0, T3 |
| `orders/infrastructure/chat-reader-schema.ts`, `chat-reader-text.ts`, `chat-reader-context-text.ts`, `chat-reader-budget.ts` (new), `chat-reader.model-text.*`, `chat-reading-fixtures.ts` (infrastructure), `chat-reader-env.ts`, `chat-message-limits-env.ts`, `chat-message-policy.ts`, `apps/core/package.json` and `pnpm-lock.yaml` (`gpt-tokenizer` to dependencies) | §10 | T3 (T0: `convertAction` glue for the new type shape) |
| `orders/composition.ts`, `orders/composition/chat-message-cost.test.ts` (new), `apps/core/evals/lib/production.ts` (the new `fitReadingContext` and `recordFailedChatMessage` dependencies only) | Wiring of the memory, the budget (with the photo stages' reserve from products), the failure step and the candidates; the whole-message worst-case test | T6 |
| `products/domain/product-name-key.ts` (+ test) | `productNameFolds`, `productNameKey` (§2 «Not-sellable product») | T0 |
| `products/infrastructure/product-matching/visual-stages-cost.ts` (+ test), `openai-image-embedder.ts`, `products/composition.ts` | Worst billed tokens of the photo stages and `photoStagesReserveUsd`; describer `max_output_tokens` 300 and effort `none`; `PRODUCT_MATCH_CANDIDATES` max 8; `VisualSearchSetup.photoStagesReserveUsd` (0 when visual search is off) | T1 |
| `products/application/find-message-candidates.ts` | `unavailableProductIds` type (T0, empty list); behavior (T1) | T0, T1 |
| `products/infrastructure/text-candidates.ts`, `domain/message-words.ts`, `composition.ts` (+ tests, benchmark fixtures) | §5.2, `TEXT_MATCH_*` and `PRODUCT_MATCH_TIMEOUT_MS` bounds | T1 |
| `prisma/schema.prisma`, `prisma/migrations/*_add_chat_last_incoming_photo` | §7 | T0 |
| `compose.prod.yaml`, `compose.yaml` (`DATABASE_POOL_MAX` 28 only), `apps/core/.env.example`, `src/shared/infrastructure/persistance.ts` (doc comment «worker 28» only) | §2 (`${VAR:-}`, `DATABASE_POOL_MAX`) | T3 |
| `apps/core/evals/cases/schema.ts` | `payment_requested` in `outcomeKinds` (T0); `shows: "not_found"` (T4) | T0, T4 |
| `apps/core/evals/README.md` | Kind lists (T0); every other section (T4) | T0, T4 |
| `apps/core/evals/lib/**`, `cases/private.ts`, `scripts/check-private.ts` (new) | §12.1 | T4 |
| `apps/core/evals/cases/interpretation.ts`, `conversations.ts`, `paraphrases.ts`, `cases/new-dev-cases.test.ts` (new) | Relabels, new dev cases, and the test that every new case id falls in the dev split | T5 |

### 12.1 Eval harness (`apps/core/evals`)

| Piece | Change |
| --- | --- |
| `cases/schema.ts` | `shownPhoto.shows` accepts `"not_found"` (a photo that matched nothing); `label` stays only with a product key. |
| `lib/production.ts` | `photoIdentification`: `not_found` → `{ kind: "not_found" }`. The reader is built with `observe` only when diagnostics are on (dev, not private). The memory needs no eval change: conversations apply every message for real. |
| `lib/case-record.ts`, `lib/run-case.ts` | `CaseRecord` gains `photoCase: boolean` (always), `readerAnswer: unknown \| null` and `invalidReasons: readonly string[] \| null` (null unless diagnostics are on). |
| `lib/eval-env.ts` | Diagnostics on when `EVAL_SPLIT=dev` and `EVAL_PRIVATE_DIR` is unset. `EVAL_REPEAT_TAGS=all` repeats every case. |
| `lib/shipped-expectations.ts` (new), `lib/scorers.ts` | The payment-fallback scoring rule of §2: `shippedExpectations(expectations, shippedReaderFeatures)` rewrites `payment_request` / `payment_requested` to `not_applied` / `request_not_allowed` when the payment action is off, and adds a matcher-only alternative with notice `not_applied` (order kept, outcomes unstated) for an `order_closed` expectation when the closed-order line is off. Applied to message cases and conversation steps, from repository tables and private folders; judge eligibility stays computed from the case as written. |
| `lib/report.ts`, `lib/rebuild.ts` | The report header carries the scored `shippedReaderFeatures`. `GateLines` whole, `withoutPhoto` and `photo`. `consistency: { repeated, consistent, percent }` whole and per family. `tagMetrics.questionCaptionSilentAdds { messages, silentAdds }`, `paymentInCount { paymentRequests, insideCount }`, `noticesByKind`. Rebuild recomputes them. |
| `lib/suite-output.ts`, `lib/model-suite.ts` | A private run's stdout adds the three gate lines, consistency and the tag metrics: counts only, no ids. |
| `cases/private.ts` | Unchanged rules (photo files refused); its doc comment and errors no longer say photos are unavailable. |
| `scripts/check-private.ts` (new) | `pnpm exec tsx evals/scripts/check-private.ts <dir>` validates `catalog.json` and `cases.json` with `loadPrivateData` and prints counts per pass, kind and photo case. No model call, no case text. |
| `README.md` | «Private runs» says described photos run and are reported apart; «Private files format» adds `not_found`; the record diagnostics, the photo partition, consistency and metrics in «Report». |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `orders_chat_message_applied` | info | `chat-message-handler.ts` | existing fields + `["photoJustSent", "countedInputTokens", "droppedForBudget"]` |
| `orders_chat_message_skipped` | info | `chat-message-handler.ts` | unchanged; `reason: "empty_text"` now also for texts with no letter or digit |
| `orders_chat_message_failed` | error | `chat-message-handler.ts` | unchanged (the memory is written in the same transaction as the failed outcome) |
| `chat_reader_completed` | info | `openai-chat-reader.ts` | existing + `["countedInputTokens", "budget"]` (`budget`: `text` or `photo`) (the o200k count of the request; with `inputTokens` it gives the tokenizer ratio T8 measures) |
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
- `test("a photo whose caption is listo and a payment request still adds the shown product and reports the payment request")`
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
- `test("an unnamed set right after a photo that grew an item past the listed items sets that item")`
- `test("a one_of between a sellable product and a not-sellable one with the same name chooses the sellable one")`
- `test("a one_of between a sellable product and a not-sellable one named the same up to accents and case chooses the sellable one")`
- `test("a photo context never resolves an unnamed set onto a marker, even if one is supplied")`
- `test("an add of a listed not-sellable product reports product_not_available")`

`orders/domain/chat-order.test.ts`
- `test("lowering an item by N leaves the rest and reports quantity_lowered")`
- `test("lowering an item to exactly zero removes it")`
- `test("lowering the only item to exactly zero keeps it and reports only_item_kept")`
- `test("lowering an item by more than it has changes nothing and reports quantity_below_zero")`
- `test("a pending quantity change on a pending that ended applies its fallback")`
- `test("a set on the remembered item applies its fallback when the item's quantity changed or its order closed under the lock")`
- `test("lowering the last pending to zero with listo remembered marks the order ready")`
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
- `test("a failed message leaves a memory with no leftover")`
- `test("a photo right after a failed message remembers no leftover")`
- `test("a photo message is read with no marker, even right after a photo just sent")`
- `test("the marker is dropped when the photo's pending ended")`
- `test("the marker is dropped when the photo's item changed quantity or its order is no longer open")`

`orders/domain/chat-criteria.test.ts` (product criteria with fixed reader answers)
- `test("criteria 1 to 4: photo captions read as no intent, doubted, question and emoji-only")`
- `test("criteria 5 to 9 and 34: payment requests, method questions, embedded instructions and pendings left")`
- `test("criteria 10 to 14: set, lower and one more on named items and pendings")`
- `test("criteria 15 to 26: the quantity for the photo just sent")`
- `test("criteria 27 to 30: products with no active variant, prices and the closed order")`

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
- `test("a context over the input-token budget gets context_too_large without a reader call")`
- `test("the reader and the check receive the same fitted context")`
- `test("a text skipped with the reader off or with no letter or digit leaves the memory unchanged")`
- `test("a text answered text_too_long or context_too_large clears the memory")`

`orders/application/record-failed-chat-message.test.ts` (fakes)
- `test("a newly recorded failure writes a memory with no leftover in the same transaction")`
- `test("a retry that finds a stored failure writes the memory again and publishes the notice only if it is due")`
- `test("a stored successful outcome writes no memory")`
- `test("a failed memory write rolls back the failed outcome")`
- `test("a missing message writes nothing and publishes no notice")`

`orders/infrastructure/chat-reader-schema.test.ts`
- `test("maps a payment_request action")`
- `test("maps a change_quantity on a pending reference with mode decrease")`
- `test("a change_quantity with both an item and a pending is malformed")`

`orders/infrastructure/chat-reader-budget.test.ts`
- `test("keeps products in priority order while they fit the budget and drops the rest from the first that does not fit")`
- `test("drops not-sellable candidates first, then text candidates, items' products and pendings' candidates, never the shown product")`
- `test("does not tokenize product blocks after the first that does not fit")`
- `test("a part never cut that is over the budget is context_too_large without tokenizing any product")`
- `test("never drops an item, a pending or the text")`
- `test("the count of the whole rendered request confirms the fit")`
- `test("a photo context uses the text budget reduced by the photo stages' reserve")`
- `test("a reserve that leaves a photo budget under 8,000 tokens fails at startup")`

`orders/infrastructure/chat-reader.model-text.test.ts`
- `test("pins every model-facing text, the one schema, the request settings, the budget and the measured sizes of the reader")` (existing, new pins)
- `test("the input budget plus the answer limit cost at most US$0.003")`
- `test("every domain worst case, in Latin, CJK, emoji and supplementary-plane names, as a text and as a captioned photo, fits its budget or is context_too_large")`
- `test("the photo budget plus the answer limit plus any admitted reserve cost at most US$0.003")`
- `test("the synthetic catalog of PR #248 keeps at least 16 products within the budget")`
- `test("a strict 10-action answer of realistic values takes at most 900 tokens")`
- `test("the usual case drops no product and costs at most US$0.003")` (existing, extended)

`orders/infrastructure/chat-reader-env.test.ts`, `chat-message-limits-env.test.ts`
- `test("a reader setting above its upper bound fails at startup")`
- `test("defaults are within the upper bounds")`
- `test("the slowest attempt at the time bounds, including the message transaction's timer, fits the attempt deadline")`
- `test("AI_TIMEOUT_MS above 35000 fails at startup")`
- `test("APPLY_CHAT_MESSAGE_CONCURRENCY above 16 fails at startup")`

`products/application/find-message-candidates.test.ts`
- `test("returns not-sellable products apart from the sellable candidates")`

`products/domain/product-name-key.test.ts`
- `test("two names that differ only by case and Spanish or Portuguese accents have the same key")`

`products/infrastructure/product-matching/visual-stages-cost.test.ts`, `openai-image-embedder.test.ts`, `products/composition.test.ts`
- `test("the photo stages at their bounds, with a detail image and the OpenAI describer, cost at most the reserve")`
- `test("the reserve with the local embedder leaves out the describer")`
- `test("the describer request sets max_output_tokens 300 and effort none")`
- `test("PRODUCT_MATCH_CANDIDATES above 8 fails at startup")`

`orders/composition/chat-message-cost.test.ts`
- `test("with every setting at its bound, the worst photo message and the worst text message cost at most US$0.003")`

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
- `test("a conversation step expecting the payment notice is right with the generic body when the payment action is not shipped, and wrong when it is")`
- `test("a private message case expecting order_closed also accepts the generic body when the closed-order line is not shipped")`
- `test("the fallback alternative never makes a case eligible for the judge")`
- `test("the report header says which reader features were scored")`

`apps/core/evals/cases/*.test.ts` (existing parse tests stay green with the new cases)
- `test("every new dev case falls in the dev split")`

### Core integration

`orders/infrastructure/chat-pending-repository.integration.test.ts`
- `test("saves and reads a last incoming photo with no pending")`
- `test("deletes the row when there is no pending, no listo and no memory")`
- `test("saving the memory of a message's chat keeps its pendings and listo")`
- `test("saving the memory of a message's chat creates the row when the chat has none")`

`orders/infrastructure/chat-message-outcome-repository.integration.test.ts`
- `test("inserting a failed outcome for a message with an outcome writes nothing and returns the stored one")`
- `test("inserting a failed outcome for a missing message writes nothing, logs chat_message_outcome_without_message and keeps the transaction usable")`

`orders/application/record-failed-chat-message.integration.test.ts`
- `test("a failed message after a photo leaves the failed outcome and a memory with no leftover")`
- `test("a retry after the memory write failed records the failure once and writes the memory")`
- `test("a failure of a message that was applied leaves the memory the message wrote")`

`products/infrastructure/text-candidates.integration.test.ts`
- `test("a named product whose variants are all inactive is returned as not sellable")`
- `test("a not-sellable product with the same name as a sellable one is not returned")`
- `test("a not-sellable product named like a sellable one up to accents and case is not returned when both match")`
- `test("a company whose products all have only inactive variants returns no candidates")`
- `test("at most the configured sellable and not-sellable candidates leave the statement, and matchCount counts sellable matches")`
- `test("the benchmark catalog seeds not-sellable products, some named like sellable ones, and a broad word matching thousands of rows")` (opt-in benchmark, `CANDIDATES_BENCH=1`)

`orders/application/apply-chat-message.integration.test.ts` (fake reader, real database)
- `test("a photo then «quiero 3 de esos» sets the photo's pending to 3 without a notice")`
- `test("a photo of a single-variant product then a set quantity sets the item without a notice")`
- `test("a photo, an outgoing seller reply and an emoji text, then a set quantity still apply to the photo")`
- `test("two photos in a row then a set quantity change nothing and notify an unnamed add")`
- `test("a photo then a second photo with caption «quiero 3» leaves the first photo's pending unchanged and gives the second photo's product quantity 3")`
- `test("a photo then a text too long then a set quantity notify an unnamed add")`
- `test("a photo then «gracias» then a set quantity notify an unnamed add")`
- `test("a payment request with an open order and a pending left records the payment outcome and its notice is due")`
- `test("a named product whose variants are all inactive reports product not available")`
- `test("a failed message after a photo makes a following set quantity an unnamed add")`

### Web E2E

None: no web screen changes.

### Pending manual checks

The founder's WhatsApp test of the product draft («Real test on WhatsApp», blocks A to G), carried in the final pull request; the build, environment, phone and which payment body arrived are recorded there.

## 15. Limits and checks during implementation

- **PR #248.** Already merged into the integration branch (`bc8e185b`); nothing waits for it.
- **Tokenizer.** o200k is a proxy for `gpt-6-luna` (PR #248). The budget divides by `tokenizerRatio`, which T8 sets from the measured `inputTokens / countedInputTokens` of its dev calls and of direct calls at the budget (§10.1); T8 reports the ratio and the cost per message on both counts. The dev catalogs are Latin, so the non-Latin worst cases rest on one measured non-Latin call at the budget plus o200k: accepted as a limit (sellers write in Spanish and Portuguese).
- **Cost per attempt.** The US$0.003 bound holds per queue attempt (§2 «Cost per message»): a message retried after the reader call pays again, up to 9 attempts. Rare; keeping the answer across attempts is a separate change.
- **Reader off.** A text skipped as `reader_disabled` leaves the memory unchanged. If the reader is turned back on, a marker can survive texts the reader never read (only within the pending's TTL and while the item keeps its quantity). It exists only across a configuration change and is accepted.
- **Context too large.** A shown product at the domain limits in a non-Latin script, or 40 items with 200-character CJK names, cannot fit 25,000 tokens; those messages get `context_too_large` and «Revisa el chat». Accepted as a known limit (sellers write in Spanish and Portuguese; a realistic product is about 50 to 1,000 tokens). Compacting prices (`6hrqHJghCXGwX26V`) is what would shrink it.
- **Same-name doubt.** The `one_of` rule drops a not-sellable product only when its `productNameKey` equals a sellable one's, and the instructions tell the reader to prefer the sellable product on an equal fit. A near-identical name (one letter apart), or a reader that ignores the instruction, can still give «Producto no disponible»: a notice, not a silent change, so accepted as a known limit.
- **Pending refs on unnamed wording.** A reader that answers `pending Q1 set 3` to an unnamed «quiero 3 de esos» changes the pending silently; the domain cannot tell (§2). Checked by T5's cases and T8's scan of `readerAnswer`.
- **Benchmark.** The opt-in candidates benchmark seeds about 10% of products with only inactive variants, a tenth of those named like a sellable product, includes a broad word that matches thousands of rows, records `EXPLAIN (ANALYZE)` and the p95 at 10,000 products before and after; the statement must stay within 10% of its p95 before (memory: that cell is already over 150 ms; its fix is `6hrWWWJQVCmcM2W3`).
- **Test baseline file.** `2026-10-29T17-14-51-084Z` is not on this machine (the PR #237 worktree is gone). T9 compares with the gate lines published in PR #237 and the informe (5 ignored actions in the frozen test, three of them `int-photo-emoji-caption`). Holdout v3's baseline file exists.
- **Holdout v3 expectations.** The 12 photo cases were written before this task's rules. The translator (T7) keeps the source expectation and adds the expectation of this task's rule where a rule changed (for example a no-intent caption on a single-variant photo), counting those cases in its translation report; the measurement judges nothing.
- **Strict mode.** The schema keeps every field required; `item` and `pending` both nullable on `change_quantity`.
- **Ceiling.** `READER_MAX_PRODUCTS` stays 24; the budget decides how many products a large catalog actually sends. After `6hrqHJghCXGwX26V` compacts prices, more of them fit without touching the bound.
- Left out: several products per photo, image context, index-based candidates (`6hrWWWJQVCmcM2W3`), item editing from web or mobile, a notice for payment reports.

## 16. Implementation plan

### Order and parallelism

```text
Wave 0:  T0 contracts, types, migration, repository, payment notice, adapter seam
Wave 1 (parallel, after T0):  T1 products candidates   T2 domain rules   T3 reader adapter + budget + settings
                              T4 eval tooling          T5 dev cases and relabels (non-tuner; needs the updated rules sheet)
Wave 2 (parallel):  T6 use case and wiring (after T1, T2, T3, T4)
                    T7 private translation: holdout v4 and the 12 holdout v3 photo cases (after T4 and the holdout v4 writer; outside the repo)
Wave 3:  T8 tuning on EVAL_SPLIT=dev (after T5, T6), real models, capped runs
Wave 4:  T9 frozen test, once (after T8)
Wave 5:  T10 private measurement, once each (after T7, T9): holdout v4, then the holdout v3 photo cases
Wave 6:  T11 docs promotion and pull request (coordinator, after T10)
```

| Wave | Task | Owns (no overlap within a wave) |
| --- | --- | --- |
| 0 | T0 | `orders/domain/chat-message-outcome.ts`, `seller-notice.ts`, `presentation/seller-notice-texts.ts`, `chat-pendings.ts` (types, schema), `chat-reading.ts` (types + glue), `application/reading-context.ts` (glue only), `application/read-chat-message.ts` (types), `infrastructure/chat-reader-schema.ts` (glue only), `infrastructure/chat-pending-repository.ts`, `infrastructure/openai-chat-reader.ts`, `products/application/find-message-candidates.ts` (type), `products/infrastructure/text-candidates.ts` (empty list only), `products/domain/product-name-key.ts`, `prisma/**`, `evals/cases/schema.ts` (`outcomeKinds`), `evals/README.md` (kind lists), their tests |
| 1 | T1 | `products/**` except `domain/reading-product.ts` and `domain/product-name-key.ts` |
| 1 | T2 | `orders/domain/chat-reading.ts`, `chat-order.ts`, `pending-transitions.ts`, `chat-pendings.ts` (functions), `mentioned-price.ts`, `domain/chat-reading-fixtures.ts`, `chat-criteria.test.ts` and the domain tests |
| 1 | T3 | `orders/infrastructure/chat-reader-schema.ts`, `chat-reader-text.ts`, `chat-reader-context-text.ts`, `chat-reader-budget.ts` (new), `openai-chat-reader.ts`, `chat-reader.model-text.json`, `chat-reader.model-text.test.ts`, `infrastructure/chat-reading-fixtures.ts`, `chat-reader-env.ts`, `chat-message-limits-env.ts`, `application/chat-message-policy.ts`, `compose.prod.yaml`, `compose.yaml` (pool line), `src/shared/infrastructure/persistance.ts` (comment), `apps/core/.env.example`, `apps/core/package.json`, `pnpm-lock.yaml`, their tests |
| 1 | T4 | `apps/core/evals/**` except `cases/interpretation.ts`, `cases/conversations.ts`, `cases/paraphrases.ts`, `cases/new-dev-cases.test.ts` |
| 1 | T5 | `evals/cases/interpretation.ts`, `conversations.ts`, `paraphrases.ts`, `cases/new-dev-cases.test.ts` (new) |
| 2 | T6 | `orders/application/apply-chat-message.ts`, `reading-context.ts`, `chat-message-handler.ts`, `record-failed-chat-message.ts` (new), `orders/domain/photo-just-sent.ts`, `infrastructure/chat-message-outcome-repository.ts`, `orders/composition.ts`, `orders/composition/chat-message-cost.test.ts`, `apps/core/evals/lib/production.ts` (wiring of the two new dependencies only, after T4 has merged), their unit and integration tests |
| 2 | T7 | nothing in the repository: `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v4-private/{catalog,cases}.json`, `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v3-photos-private/` |
| 3 | T8 | `chat-reader-text.ts`, the schema descriptions in `chat-reader-schema.ts`, `chat-reader-context-text.ts`, the pinned JSON, `tokenizerRatio` in `chat-reader-budget.ts`, `shippedReaderFeatures` in `chat-reader-text.ts`, the measured worst tokens in `products/infrastructure/product-matching/visual-stages-cost.ts`, the `TEXT_MATCH_*` defaults in `products/composition.ts` (the only copy: compose passes `${VAR:-}`) |

`apps/core/.env.example` is shared by T1 (`TEXT_MATCH_UNAVAILABLE_CANDIDATES`) and T3; T3 owns it and adds that line with the name and default fixed here, so T1 does not touch it.

### T0. Contracts, types, migration and payment notice

**Scope:**
- Outcome `payment_requested` with `PaymentOrder`, reasons `malformed`, `quantity_below_zero` and `context_too_large`, schema and tests.
- `SellerNotice` `payment_request` (tuple and union), `problemOf`, `namedProductOf`, `noticeReferences`, the es and pt-BR bodies of §6.4 with tests.
- Types of §6.1 (`latestOrder`, `photoJustSent`, `ReaderQuantityTarget`, `change_quantity` with `target` and `decrease`, `payment_request`) with compile glue that keeps today's behavior: `payment_request` → `request_not_allowed`; a pending target or `decrease` → `invalid_action malformed`; `buildReadingContext` sets `latestOrder` from the target, the context's `photoJustSent: null` and the lines' `photoJustSent: false`; `convertAction` emits the new shape from today's fields. `FittedReadingContext` and `ContextTooLarge` in `read-chat-message.ts`.
- `LastIncomingPhoto`, `PhotoLeft`, `ChatPendings.lastIncomingPhoto` and its schema; the column, the migration `add_chat_last_incoming_photo` (database-migrations skill) and the repository (read, write, deletion rule, and `saveLastIncomingPhotoOfMessageChat` of §7, which requires an active transaction).
- `MessageCandidates.unavailableProductIds` (type; `searchProductsByCoverage` returns `[]`).
- `products/domain/product-name-key.ts`: `productNameFolds` and `productNameKey` (§2 «Not-sellable product»), used by T1's SQL and T2's `one_of` rule.
- `createOpenAiChatReader` `observe` option (raw parsed output before validation, or the raw text).
- `payment_requested` in `evals/cases/schema.ts` `outcomeKinds` and the README kind lists.

**Out of scope:** any rule of §6 beyond glue; reader texts; products query; use case wiring; eval tooling.
**Acceptance criteria:**
1. `chooseSellerNotice([payment_requested(open #1023, no pendings)])` renders «Revisa el chat» — «Un cliente quiere pagar el pedido #1023.», and in pt-BR «Veja o chat» — «Um cliente quer pagar o pedido #1023.»; all five bodies of §6.4 render in both languages.
2. `[payment_requested(closed #1023, Polo básico left)]` renders the closed body; `[payment_requested(none), variant_missing]` renders «Revisa el chat» counting 2.
3. A pendings set with no pending, `readyRemembered: false` and a last incoming photo saved for chat A reads back equal; set to null with no pending, the row is deleted; company B reads nothing for chat A. `saveLastIncomingPhotoOfMessageChat` keeps an existing row's pendings and «listo», creates the row when there is none, and writes nothing for a message that does not exist.
4. A stored `lastIncomingPhoto` with `quantity: 0` reads as `INVALID_STORED_DATA`; existing outcome rows and existing pendings rows (column `NULL`) still parse.
5. With today's reader output every existing unit and integration test is green: behavior is unchanged.
6. `productNameKey("Polo Básico") === productNameKey("polo basico")`.
7. `scripts/ci.sh --fast` green.

**Tests:** the T0 titles of §14 (outcome, notice, texts, stored row, repository integration).
**Depends on:** nothing (PR #248 is already in the integration branch).

### T1. Not-sellable products among text candidates

**Scope:** §5.2 in `text-candidates.ts` and `find-message-candidates.ts` (not sellable = no active variant; the cut per partition in SQL; the same-name rule as a window over the matched rows with `productNameKey`'s folds; the company rule as one `EXISTS`); the photo stages' bounds and reserve (§2 «Cost per message», §10.1 «Photo stages»): `visual-stages-cost.ts` with the initial worst tokens, `PRODUCT_MATCH_CANDIDATES` max 8, the describer's `max_output_tokens` 300 and effort `none`, `VisualSearchSetup.photoStagesReserveUsd` exported from `products/composition.ts`; `TEXT_MATCH_UNAVAILABLE_CANDIDATES` (default 2, max 4), the `max()` bounds of every `TEXT_MATCH_*` and `PRODUCT_MATCH_TIMEOUT_MS` max 20000 in `products/composition.ts`; `unavailableCount` in `message_candidates_found`; the opt-in benchmark seeds not-sellable products and a broad word (§5.2 step 6, §15) and records `EXPLAIN (ANALYZE)` and p95 before and after.
**Out of scope:** orders wiring (T6); `.env.example` and compose (T3); any index or SECURITY DEFINER function (`6hrWWWJQVCmcM2W3`); paid calls (T8 measures the photo stages).
**Acceptance criteria:**
1. Catalog with «Casaca jean» (options, every variant deactivated) and «Casaca denim» (an active variant): «quiero la casaca jean en L» returns «Casaca denim» among `productIds` and «Casaca jean» in `unavailableProductIds`.
2. A «Polo básico» with every variant inactive and another «polo básico» with an active variant: only the sellable one is returned, in `productIds`; the same with «polo basico» when both match.
3. A company whose products all have only inactive variants returns both lists empty for a text that names one of them (the miss stays silent).
4. With 20 matching sellable and 10 matching not-sellable products, the statement returns exactly 8 + 2 rows (checked on the raw rows) and `matchCount` is 20.
5. The benchmark, with about 10% not-sellable products and a broad word that matches thousands of rows, keeps its p95 at 10,000 products within 10% of its value before the change (both recorded in the PR with the `EXPLAIN (ANALYZE)` plans); the plan shows a `WindowAgg` and no correlated SubPlan over `matched`.
6. `TEXT_MATCH_CANDIDATES=9`, `PRODUCT_MATCH_CANDIDATES=9` and `PRODUCT_MATCH_TIMEOUT_MS=20001` fail at startup.
7. `photoStagesReserveUsd` at 8 candidates with a detail image and the OpenAI describer is at most US$0.00125 with the initial values, and leaves out the describer with the local embedder; the describer request carries `max_output_tokens: 300` and effort `none` (recorded request in the test).

**Tests:** the products unit and integration titles of §14.
**Depends on:** T0.

### T2. Domain rules

**Scope:** `checkReaderAnswer` precedence of §6.1 (including `ready` in rule 2 and the marker read from `context.photoJustSent` on a text context only); `lower_quantity`, `change_pending_quantity` (with `pendingResolved` at exactly 0) and `set_marked_item_quantity` in `applyChatActions`; `changePendingQuantity`; `payment_requested` filled in `finishPendings`; the `one_of` same-name rule with `productNameKey`; the criteria tests with fixed reader answers.
**Out of scope:** the memory (`photo-just-sent.ts`, T6), reader texts, wiring, notices (T0).
**Acceptance criteria:**
1. With fixed reader answers, product criteria 1–30 and 33–34 give the outcomes and the order of the product draft (photo memory supplied as a context marker).
2. Given reader refs only for products the buyer named, no answer drops a unit or grows a pending without a named reference or a marker: a quantity-only `complete_pending` with no marker always ends `unnamed_add`. (A ref the reader cites for unnamed wording is a named change; §2 «Unnamed quantity» limit.)
3. A pending quantity change whose pending ended under the lock applies its fallback (`unclear_item` for a named pending, `unnamed_add` for the marked one); a set on the remembered item whose quantity or order changed applies `unnamed_add`.
4. Lowering the last pending to exactly 0 with «listo» remembered gives `ready` as `decline_pending` does.
5. No payment is created, voided or rejected by any transition (the order state machine is not called for payments).
6. No natural-language string is added under `orders/domain` (grep in the PR).

**Tests:** the `chat-reading`, `chat-order`, `pending-transitions`, `chat-pendings` and `chat-criteria` titles of §14.
**Depends on:** T0.

### T3. Reader adapter, token budget and settings

**Scope:**
- Schema (`payment_request`, `decrease`, `pending` on `change_quantity`), `convertAction`, context text (closed line, photo mark), `shippedReaderFeatures` (both `true`), the first wording of the new rules in `chat-reader-text.ts` (§10, including the sellable product on an equal fit), written without reading eval cases or runs.
- Budget (§2, §10.1): `chat-reader-budget.ts` (`readerTokenBudget` with the text and photo budgets from a `photoStagesReserveUsd` parameter, `fitReadingContext` in priority order with early exit), `maxOutputTokens` 1,000, `countedInputTokens` in `chat_reader_completed`, `gpt-tokenizer` moved to dependencies; the blocking domain worst cases, the 16-product floor on the synthetic catalog and the 10-action answer size in `chat-reader.model-text.test.ts`; the measured tokens and cost per part recorded in the pinned JSON and the PR. If the answer measurement is over 900 tokens or the floor is not met with the first wording, escalate before changing anything else.
- Settings: bounds of §2 in `chat-reader-env.ts` (`AI_TIMEOUT_MS` max 35000), `chat-message-limits-env.ts` (`READER_MAX_PRODUCTS` max 24), `chat-message-policy.ts` (`APPLY_CHAT_MESSAGE_CONCURRENCY` with Zod, 1 to 16; the one-connection-per-job invariant as a comment next to the bound); `compose.prod.yaml` worker variables as `${VAR:-}` plus `DATABASE_POOL_MAX` 28, `compose.yaml` 24 → 28 and the `persistance.ts` comment; `.env.example` (including `TEXT_MATCH_UNAVAILABLE_CANDIDATES=2`).

**Out of scope:** tuning against evals (T8); compacting per-combination prices (`6hrqHJghCXGwX26V`); changing the model, the effort or the US$0.003 bound.
**Acceptance criteria:**
1. A recorded strict output with `payment_request` maps to `{ kind: "payment_request" }`; `change_quantity` with `pending: "Q1"`, `mode: "decrease"`, `quantity: 1` maps to a pending target; with both `item` and `pending` it maps to `malformed`.
2. Every domain worst case of §2 (four scripts, both product shapes, items, pendings and text at their bounds, as a text and as a captioned photo) ends within its budget or as `context_too_large`; the test fails if the text budget is raised by one token above `30,000 − 5 × maxOutputTokens`, or the photo budget above it minus the reserve in tokens (shown in the PR).
3. `fitReadingContext` on PR #248's synthetic catalog keeps at least 16 products as a text and drops from the tail in the order of §2; on the usual case it drops nothing as a text and as a captioned photo; it never drops the shown product; with a spy tokenizer, no product block after the first that does not fit is tokenized, and the 24-product supplementary-plane worst case fits in under 50 ms.
4. `READER_MAX_PRODUCTS=25`, `AI_TIMEOUT_MS=35001` and `APPLY_CHAT_MESSAGE_CONCURRENCY=17` fail at startup; unset gives the code default.
5. `docker compose -f compose.prod.yaml config` lists every variable of §2 on `worker`, empty unless set, and `DATABASE_POOL_MAX` 28.
6. The prompt-overlap test is green; the pinned JSON changes only by the new texts, settings, budget and measured sizes.

**Tests:** the infrastructure titles of §14.
**Depends on:** T0.

### T4. Eval tooling

**Scope:** every row of §12.1, including the payment-fallback scoring rule (`shipped-expectations.ts`).
**Out of scope:** writing or relabeling cases (T5); running paid evals; deciding which variant ships (T8).
**Acceptance criteria:**
1. A private folder (in the scratchpad) with a two-product catalog, one message case whose photo `shows: "not_found"` and one conversation starting with a described photo loads with `check-private.ts`, which prints counts only.
2. A record fixture of a dev run keeps `readerAnswer` and `invalidReasons`; the same fixture under `EVAL_SPLIT=test` or a private dir keeps `null`.
3. The report of a fixture run shows the gate whole, without photo cases and photo cases only; a conversation with a photo step counts all its records as photo case.
4. Consistency, silent adds on question captions, payment requests inside a count and notices by kind appear in the report and in a private run's stdout, with no case id or text.
5. With `shippedReaderFeatures.paymentRequest` set to `false` in the test, a conversation step and a message case that expect notice `payment_request` and outcome `payment_requested` are right when the run gives `not_applied` and `request_not_allowed`, and wrong when it gives the payment notice; with it `true`, the reverse. With `closedOrderLine` `false`, a case expecting `order_closed` is right with `not_applied` and the expected order. Neither rule makes a single-expectation case eligible for the judge.
6. `pnpm --dir apps/core test:unit` green; the README test green (README «Scoring» states the rule).

**Tests:** the `evals/lib` titles of §14.
**Depends on:** T0.

### T5. Dev cases and relabels (written by a non-tuner)

**Scope:** from the updated rules sheet (private path given by the coordinator), never from holdout v3 or runs:
- Relabel `int-photo-emoji-caption` and its paraphrases (pending, `variant_missing`, outcomes with `pending_created`) and `conv-unnamed-add-after-photo` (pending ×3 silent, then the color completes it ×3), citing the rule in a comment.
- New dev cases, ids chosen so they fall in the dev split, covering: a caption with letters read as no intent on a variants product, on a single-variant product and on a product already in the order; question captions (tag `question-caption`), and a question naming a variant value; payment requests, method questions, payment reports and in-between phrasings by the boundary; payment requests in a caption, with «listo» (also «listo» plus a payment request on a product photo), with a pending left (open order and no order), after a closed order, with a new order in the same message; an embedded instruction next to an add and next to a quantity above 99; set, lower by N, one more of X and lower to exactly 0 and below 0 on named items and pendings, the product draft's quantity example; set and add wording after a photo, with and without another only item, after a photo burst, after «gracias», after a declined photo (the «after a seller reply» family is not written: the eval conversation schema has no outgoing step and the reader never sees outgoing messages; T6's integration test covers it); a named decline of a pending left without order (the WhatsApp test's F2 and cleanup); a named product whose variants are all inactive, with a similar sellable one; a price in another currency as a comment and as a request; a price that identified the product; a change after a closed order; an emoji-only text.
- Dev equivalents of the cited cases `hv3-59`, `hv3-70`, `hv3-40`, `hv3-41`, `hv3-42`, `hv3-67`, `hv3-54`, `hv3-32`, `hv3-62`, `hv3-71`, `hv3-10` and of the test cases `int-photo-emoji-caption`, `conv-unnamed-add-after-photo` and `hold-price-hint-rayas`, written from the rule, with other products, colors and wording; new cases tagged `consistency` where the product draft cites flips. The dev equivalents of criteria 25 and 26 (a set quantity after «gracias» or after a photo burst, with one pending alive) expect the unnamed-add notice, so a reader that cites the pending's ref for unnamed wording fails them.
- Cases state only the expectation of the shipped design (`payment_request`, `order_closed`); the generic body is accepted by T4's scoring rule when the fallback ships (§2 «Payment fallback»), so no case lists it by hand.
- `cases/new-dev-cases.test.ts`: every case id added by this task falls in the dev split.

**Out of scope:** running evals, reading runs, prompts, tooling.
**Acceptance criteria:**
1. `pnpm --dir apps/core test:unit` parses every table; the prompt-overlap test is green.
2. Every new case id hashes into `dev` (test title of §14).
3. No case text shares a three-word run with holdout v3 (checked by the coordinator with the private file, outside the repository; the result goes in the PR as a count).
4. Each family listed above has at least one case.
5. No case lists `not_applied` as an alternative of a payment-request or closed-order expectation (grep in the PR), so judge eligibility is unchanged.

**Tests:** the case parse tests and the dev-split title.
**Depends on:** T0 and the coordinator's rules sheet. The writer is not the author of T3 or T8.

### T6. Use case and wiring

**Scope:** §5.1, §5.4 and §6.3: `hasReadableText` with letters or digits, `latestOrder` and the marker in the context (texts only; `photoJustSentOf(kind, …)` is `null` for a photo), the memory table of §5.1, not-sellable candidates in `selectReadingProducts`, `fitReadingContext` before the reader and `context_too_large`, `nextLastIncomingPhoto` in the transaction, `recordFailedChatMessage` (application step, `insertFailedOutcome` in the outcome repository, `memoryAfterFailure`) called by both handler paths, `photoJustSent`, `countedInputTokens` and `droppedForBudget` in the trace and the log, wiring in `orders/composition.ts` (the budget built with `photoStagesReserveUsd` from products) and of the two new dependencies in `evals/lib/production.ts`; the whole-message cost test `chat-message-cost.test.ts`.
**Out of scope:** domain rules (T2), reader texts and the budget itself (T3), the rest of the eval tooling (T4).
**Acceptance criteria:**
1. With a fake reader and the real database, every integration title of §14 passes.
2. «👍» and «...» are skipped with no reader call; a photo with caption «😍😍» gets the fixed answer with no reader call.
3. A photo, then an outgoing message, then «👍», then a set quantity applies to the photo; a photo, then a failed message, then a set quantity is `unnamed_add`; a photo of Polo básico (pending), then a photo of Gorra trucker with caption «quiero 3», leaves the Polo básico pending unchanged and the Gorra trucker follows the photo rules with ×3; a photo, then a text answered `text_too_long`, then a set quantity is `unnamed_add`.
4. A failure whose memory write fails leaves no `failed` row; the retry writes both; a retry that finds a stored `failed` row writes the memory; a failure on an applied message changes no memory.
5. A fake `fitReadingContext` that answers `CONTEXT_TOO_LARGE` gives `invalid_action context_too_large` with no reader call; otherwise the reader and `checkReaderAnswer` receive the same fitted context.
6. With every setting at its bound and the OpenAI describer, the worst photo message and the worst text message cost at most US$0.003 (`chat-message-cost.test.ts`).
7. `scripts/ci.sh` (full) green.

**Tests:** the `apply-chat-message`, `record-failed-chat-message`, `photo-just-sent` and repository titles of §14.
**Depends on:** T1, T2, T3, T4 (T6 edits `evals/lib/production.ts`, which T4 owns).

### T7. Private translation (isolated, outside the repository)

**Scope:** an agent that does not tune and does not read the repository's runs:
1. Holdout v4: from the isolated writer's rules sheet, catalog and cases in `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v4-private/`, write `catalog.json` and `cases.json` there in the README «Private files format», photos as `photo: { shows }` (with `label` or `not_found` when the case says so).
2. Holdout v3 photo cases: from `~/yoyos-orquestacion/un-solo-modelo/holdout-v3-private/`, write `/home/jorge/yoyos-orquestacion/que-la-ia-no-pierda/holdout-v3-photos-private/catalog.json` (the v3 catalog) and `cases.json` with only `hv3-03`, `hv3-63`–`hv3-68`, `hv3-c01`, `hv3-c04`, `hv3-c06`, `hv3-c08`, `hv3-c11`, the photo described by the case's own identification; where this task changed a rule, the expectation of the new rule is added as an alternative.
   Neither folder lists the generic payment or closed-order body: T4's scoring rule accepts it when the fallback ships (§2 «Payment fallback»).
3. Validate both with `check-private.ts`; a translation report with counts only next to each `cases.json`.

**Out of scope:** running models; copying anything into the repository.
**Acceptance criteria:** both folders load with `check-private.ts`; the translation reports list cases written, dropped (with reason category) and relabeled alternatives, counts only; `git status` of the worktree is clean.
**Depends on:** T4 merged, and the holdout v4 writer's files.

### T8. Tuning on dev

**Scope:** with the files T8 owns, using only `EVAL_SPLIT=dev` (`EVAL_CASES` and tags for subsets), real OpenAI and the Claude judge (authorized by the founder in the Todoist task):
- Run 1 (baseline): full dev, `EVAL_REPEAT_TAGS=consistency,pinned-miss,question-caption`.
- At most 6 full dev runs in total and 25 subset runs; the cost of each run in the PR. Reaching the cap with gates not met stops the task with a report to the coordinator.
- Keeps the worst-case tests and the 16-product floor green after every change.
- Measures `inputTokens / countedInputTokens` over every reader call of its runs and over a handful of direct reader calls at the budget (PR #248's synthetic catalog in Latin and one non-Latin domain case), and sets `tokenizerRatio` (§10.1); reports the ratio, the largest billed input and the share of text and of photo calls that dropped products for the budget.
- Measures the photo stages' worst billed tokens with a few direct calls at the bounds (chooser with 8 candidates and a detail image at 1,024 px; one description) and pins the larger of measured and initial values in `visual-stages-cost.ts`; the whole-message cost test stays green.
- Reports the largest `latencyMs` of the dev photo cases against the 85 s attempt deadline.
- Scans the dev records' `readerAnswer` for `change_quantity` or `complete_pending` with a pending ref on cases whose wording names no product, and reports the count (it must be 0).
- Decides the payment fallback and the closed-order line against the floor (§2) by setting `shippedReaderFeatures`, and says which shipped.

**Out of scope:** the test split, private folders, eval cases, domain rules, the US$0.003 bound, the model and its effort.
**Acceptance criteria:**
1. Last full dev run: 0 ignored actions (photo cases included), 0 wrong silent changes, the product draft's cited cases right through their dev equivalents, cost per message ≤ US$0.003 on billed tokens of every model call of the message (reader, chooser, describer), 0 pending-ref answers on unnamed wording; the tokenizer ratio and the photo stages' tokens are measured at the budget and the bounds before T10.
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
**Acceptance criteria:** the PR reports, for holdout v4: right % without photo cases (gate ≥ 88%), ignored actions and wrong silent changes including photo cases (gates 0), photo cases apart, consistency, the metrics apart and cost per message over all its model calls, per attempt (gate ≤ US$0.003), and which reader features were scored; for the holdout v3 photo cases, their gate lines as a measurement, compared with nothing. A gate not met is reported per family to the founder as not met (a later attempt needs holdout v5).
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

Decided by the coordinator (round 3):
- Cost per message: the US$0.003 cap covers every model call of one message — the reader and, for a photo, the visual chooser and the image describer with its embedding when they run. A photo message's reader input budget is the text budget minus the measured worst cost of those calls (photoStagesReserveUsd, bounded by PRODUCT_MATCH_CANDIDATES max 8, 1,024-px images and the describer's max_output_tokens 300), so the worst photo message stays ≤ US$0.003. A queue retry is a separate attempt and is not added: the bound holds per attempt (up to 9). Reason: the task's «El costo por mensaje sigue en US$0,003 o menos» and the product draft's cost gate are per message. Discarded: a cap on the reader call only.

Decided unless objected:
- The US$0.003 worst case is enforced on every reader request: max_output_tokens drops from 2,000 to 1,000; the text input is fitted to 30,000 − 5 × 1,000 = 25,000 o200k tokens and a photo's to that minus the photo stages' reserve (about 15,000 with the local embedder, 12,500 with the OpenAI describer; under 8,000 the process does not start), both divided by the tokenizer ratio T8 measures. Products are kept in priority order with early exit, so tokenizing is bounded whatever the catalog; never the shown product, items, pendings or text; drop order from the tail: not-sellable candidates, text candidates, items' products, doubtful pendings' candidates, variant pendings' products. A request whose kept part does not fit gets no reader call and the generic «Revisa el chat» (new invalid_action reason context_too_large). gpt-tokenizer becomes a production dependency. The blocking tests cover the domain limits in four scripts, as a text and as a captioned photo, the photo stages at their bounds and the whole message.
- The tokenizer ratio is measured on dev calls and on a few direct calls at the budget (Latin and one non-Latin case), before T10; the photo stages' billed tokens are measured by T8 with a few direct calls at the bounds.
- The image describer (only with IMAGE_EMBEDDER_PROVIDER=openai) gets max_output_tokens 300 and effort none; PRODUCT_MATCH_CANDIDATES gets max 8 (default 5 kept).
- READER_MAX_PRODUCTS stays 24 (max 24): the budget, not the count, bounds the cost; PR #248's synthetic catalog keeps about 18 products as a text and about 8 to 10 as a captioned photo. Floor: that catalog must keep at least 16 products as a text; below it the closed-order line goes first, then the payment distinction. Compacting per-combination prices stays in Todoist 6hrqHJghCXGwX26V, after this task.
- An answer cut at 1,000 output tokens is INVALID_AI_RESPONSE (failed, «No pudimos revisar»); T3 escalates if a realistic 10-action answer is over 900 tokens.
- Upper bounds: READER_MAX_ITEMS 40, READER_MAX_TEXT_CHARS 2000, AI_TIMEOUT_MS 35000 and PRODUCT_MATCH_TIMEOUT_MS 20000 (the photo path fits the 85 s deadline including the transaction's 5 s timer: 20 + 20 + 1 + 35 + 5 = 81 s; T8 checks it against measured photo latencies), CHAT_PENDING_TTL_DAYS 30, TEXT_MATCH_CANDIDATES 8, TEXT_MATCH_UNAVAILABLE_CANDIDATES 4, TEXT_MATCH_MAX_WORDS 30, TEXT_MATCH_PAIR_BUDGET 50000, APPLY_CHAT_MESSAGE_CONCURRENCY 1–16; above a bound the process does not start. AI_READER_MODEL, PRODUCT_MATCHER_MODEL and IMAGE_DESCRIBE_MODEL stay free text (changing one means re-measuring cost).
- compose.prod.yaml worker gets every reader, pendings, text-match and concurrency variable as ${VAR:-} (the code holds the only default) and DATABASE_POOL_MAX 28 (24 for the queues at full concurrency plus 4 of headroom; compose.yaml moves to 28 too); the one-connection-per-job invariant is written next to the concurrency bound; PRODUCT_MATCHER_* stays (the visual chooser uses it).
- The photo just sent is remembered in a new nullable JSON column ChatPendings.lastIncomingPhoto ({ left }: the pending or item it left, no message id), written in each message transaction and cleared by any text that goes through the transaction (read, text_too_long, context_too_large); skipped texts (no letter or digit, reader off) and outgoing messages leave it unchanged. A failed message writes { left: null } in the same transaction as its failed outcome (application step recordFailedChatMessage), also on a retry that finds a stored failed outcome, never when the stored outcome is a success; a following set is then an unnamed add and a following photo is not a photo just sent (one notice more, never a silent change). Nothing of the buyer's text is stored.
- The photo-just-sent marker is given only when the message being read is a text: a photo's caption («quiero 3») never changes what the previous photo left; the photo's own product follows the photo rules.
- The domain reads the photo just sent from the context, so a remembered item past READER_MAX_ITEMS still counts; a set on the remembered item is re-checked under the lock (same open order, same quantity) or becomes an unnamed add.
- A caption on a product photo whose only actions are payment_request, not_allowed or ready still gets the photo's fixed answer first.
- Lowering a pending to exactly 0 ends it as declined and counts as resolved by the buyer, so a remembered «listo» gives «Pedido #N listo».
- A quantity-only pending completion without a photo just sent is an unnamed add (it no longer grows a pending silently).
- Payment request: new reader action, outcome payment_requested and notice kind payment_request with the five bodies; fallback to the generic body only if the measurement leaves no room. The shipped variant is one constant, shippedReaderFeatures, which T8 sets.
- The fallback never decides a gate by a scoring rule: the eval scorer reads shippedReaderFeatures and, when the payment action is off, scores expected payment_request / payment_requested as not_applied / request_not_allowed, and when the closed-order line is off, also accepts not_applied for an expected order_closed. It applies to message cases and conversation steps, in repository tables, holdout v4 and the holdout v3 photo cases alike; no case lists the generic body by hand, and the rule never makes a case eligible for the judge.
- Lowering below zero (item or pending) reports a new invalid_action reason quantity_below_zero (generic body); a malformed reader action gets its own reason malformed.
- Not sellable means a product with no active variant (the schema has no deactivated, archived or deleted product). Up to 2 of them are added to the text candidates, cut in SQL (at most 8 + 2 rows leave the database), never one with the same name as a matched sellable product (one meaning of «same name», productNameKey: case and Spanish and Portuguese accents folded, in SQL as a window over the matched rows and in the one_of rule), and only in a company with a product with an active variant; otherwise the miss stays silent. The reader is told to prefer the sellable product when the words fit both equally.
- A reader that cites a pending's ref for unnamed wording changes it silently; the domain cannot tell. Checked by dev cases for criteria 25 and 26 and by T8's scan of the reader answers (must be 0).
- Eval: dev runs keep the reader's raw parsed answer (also when it ends as INVALID_AI_RESPONSE) and invalid-action reasons; test and private runs do not.
- Eval: the «after a seller reply» family is not written as an eval case (the schema has no outgoing step and the reader never sees outgoing messages); the integration test covers it.
- Eval: private runs take photos described by the case, including a new «matched nothing»; photo files stay refused.
- Eval: gates reported whole, without photo cases and photo cases only (a conversation with any photo step is a photo case whole); consistency over repetitions; holdout v4 runs every case 3 times with the first scored.
- Tuning cap: at most 6 full dev runs and 25 subset runs; reaching it with gates unmet stops and reports.
- New dev cases fall in the dev split only; the frozen test changes only by the two relabels.
- The 12 holdout v3 photo cases keep their source expectations, plus the new rule's expectation as an alternative where this task changed the rule; they judge nothing.
- The frozen-test baseline report file is not on this machine; the comparison uses PR #237's published lines.
```
