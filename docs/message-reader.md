# Message reader

The technical design of the staged reading behind [message-to-order](message-to-order.md): how a message becomes decided changes. The behavior (rules, decisions, notices) lives there; the seller's review, undo and link rules live in [order-review](order-review.md). This document holds the architecture, the contracts and the operational limits.

Code: `apps/core/src/features/orders/{domain,application,infrastructure}/reader/`. The reader stays in the `orders` feature because it owns outcomes, pendings and order transitions; `chats` exposes the context capability through `chats/composition.ts` (its `index.ts` is not extended) and `products` exposes the catalog search and photo identification.

## Pipeline

```text
message_created ─▶ apply-chat-message (ordered per chat, 85 s attempt deadline)
  ├─ context (code, bounded): open order, pendings, photo memory, last 12 messages / 48 h, last photo outcome
  ├─ photo cascade (QR, visual 0.8); its summary goes to the trace
  ├─ intent stage (model port)      → requests | no_intent | unsure, buyer language, address spans of unmasked messages
  ├─ extraction stage (model port)  → per request: target, values, quantity, price, change verb, each with its quote
  │    └─ confirming extraction starts together with it when an intent is high risk
  ├─ resolution stage (model port)  → per mention: catalog choice among searched candidates, catalog values
  ├─ checks (pure)                  → resolved actions with certainty signals; agreement (pure)
  └─ transaction: lock Contact → Order → ChatPendings → decide (pure) → apply → change rows, OrderMessage, outcome
─▶ after commit: trace and masked texts (best effort), chat_message_processed when a notice is due
```

On a captioned photo the intent stage starts concurrently with the photo cascade, because intent reads only the message kind and the caption.

## Decisions

| Topic | Decision | Reason |
| --- | --- | --- |
| Stages | Context (code), intent, extraction and resolution (models), checks, certainty and decision (pure), trace. | Understanding is the model's, checking is code's; each model stage can be measured and replaced alone. |
| Stage ports | One application port per model stage, named by intention: `readIntent`, `extractRequests`, `chooseProducts`, each taking `reading: "primary" \| "confirming"`. No generic "LLM" port exists in application. | Application depends on what a stage means, not on a provider. |
| Stage configuration | Per stage and reading: provider (`openai` or `fake`), model and prompt version from env `READER_<STAGE>_PROVIDER`, `_MODEL`, `_PROMPT`; confirming readings use `READER_<STAGE>_CONFIRM_*` and take what they leave unset from the primary. Each stage keeps its versions in its own file. Reasoning effort and output limit belong to the prompt version. Startup fails on an unknown version, an unpriced model, or the fake provider in production. | Changing one stage's model touches no other stage and no policy. |
| Default models | `gpt-6-luna` on every stage, reasoning effort `none`. Adjustable per stage. | Lowest cost that meets the targets; `none` is the lowest effort the model accepts. |
| Second opinion | A confirming reading is a configuration. Extraction has one by default (`extraction_confirm-v1`). `Agreement` is a pure function over the resolved actions of the primary and confirming chains; a stage without a confirming configuration reuses the primary result. A strong model on any stage is an env change plus a composition line, never a policy change. | Keeps the policy independent of how many opinions exist. |
| Confirming chain | Starts together with the primary extraction only when an intent is remove, change quantity or change variant (the kinds that can reach high certainty with high risk). It is aborted as soon as the checks show no action needs it; its partial cost is still recorded. | Pays for a second opinion only where the policy can use it. |
| Time budget | Each stage's signal combines the job signal with the stage timeout (`READER_STAGE_TIMEOUT_MS`, 10 s) capped by what is left of the reading budget (`READER_READING_BUDGET_MS`, 60 s, under the 85 s deadline). A stage does not start with less than 2 s left; it ends as `DEADLINE_EXCEEDED`, retried as usual. | A reading never outlives its attempt. |
| Decision policy | A pure function of signals, risk and agreement, evaluated inside the transaction on the locked state. | The same inputs give the same decision without a model. |
| Justifying words | Every datum carries a quote; `verifyQuotes` (pure) checks it is a substring of the current message ignoring case and whitespace. Unverified data is dropped; only targets may come from context. | Nothing the buyer did not say is applied. |

## Stage contracts

Each stage adapter is a prompt version, a JSON schema, a Zod parser and a `StructuredModel` (infrastructure only). Nothing unvalidated leaves the adapter. Two implementations exist: the OpenAI Responses adapter (strict `json_schema`, `store: false`, no inner retries, the caller's abort signal) and a scripted fake, refused in production. Each version has a pinned model-text file (instructions, schema, settings and token counts of reference inputs) checked by a unit test, so a prompt change is deliberate. Instructions come before the per-message input for prompt caching. Prompts never carry eval inputs.

A stage answer still invalid after one in-stage retry is `INVALID_AI_RESPONSE` (permanent, `failed`). Each result carries a `StageCall` (stage, reading, provider, model, prompt version, usage, cost, duration, attempts) that the trace stores; it never carries prompt text.

| Stage | Input | Output |
| --- | --- | --- |
| Intent | The current message, the context messages, the order lines, the pendings, the photo memory and the photo of this message | `requests` (kind and quote each), `no_intent` (with reason) or `unsure`; the buyer language (`es`, `pt`); address spans of unmasked messages |
| Extraction | The same input and the intents | Per request: target (`named`, `item`, `pending`, `photo_same_message`, `photo_just_sent`, `context`, `none`), values, quantity (`add`, `set`, `decrease`), price (amount, currency, basis), change verb |
| Resolution | The product mentions (a request that names its product by words) and the values-only mentions (a request that carries values for a product its target fixes: the pending, the order item or the photo; that product is its only candidate), with their candidate products (name, sellable flag, attribute values) | Per mention: `chosen` (product, catalog values with quotes, and `unmatched` quotes for value words that fit no value of the product), `between` (2 to 4, with the values every candidate offers) or `none`. A choice outside the candidates is retried once inside the stage, then the mention becomes `not_identified`. A value that is not in the catalog is never a reason to refuse the answer: it becomes unmatched. Checks use these mapped values on every path (completing a pending, changing a variant, a photo's caption, «otro igual»), compare the buyer's words letter by letter only when the resolution did not cover them, and report unmatched words as `variant_not_available`. Two values of one attribute in one request are never applied: the request stays `variant_only` and the seller is asked. Code never infers a split; when the buyer asks for one of each, the intent stage gives one request per value and each is applied on its own. |

Short references (`M1…` context messages, `I1…` items, `Q1…` pendings, `P1…` products) are valid for one reading.

## Context

`loadReadingContext` makes three reads outside the transaction: the recent chat messages (row comparison `(sentAt, id) < (anchor, messageId)` so the index `(companyId, chatId, sentAt, id)` serves it; the anchor is the message's `sentAt`, or its `receivedAt` when null), the stored masks of those messages, and the outcome of the latest incoming photo in the window. It returns the order target, the pendings with their life, the photo memory and builds the `ReadingInput`.

## Input budgets

Deterministic bounds apply before any stage call, measured on the real rendered input (a fixed 360-character frame and 48 characters of overhead per context message count toward it), so a reading never fails because of size.

| Bound | Value (env, adjustable) |
| --- | --- |
| Current text | 2,000 characters (`READER_MAX_TEXT_CHARS`; longer → `text_too_long`) |
| Context messages | 12 (`READER_CONTEXT_MESSAGES`), 48 h (`READER_CONTEXT_HOURS`), each cut to 500 characters (`READER_CONTEXT_MESSAGE_CHARS`) |
| Order lines listed | 40 (`READER_MAX_ITEMS`; an unlisted item reference gives `unclear_item`) |
| Pendings | 10 (domain constant) |
| Requests per message | 10 (the rest give `too_many_actions`) |
| Candidates per mention | 5 (`READER_CANDIDATES_PER_MENTION`) |
| Products rendered in resolution | Name, sellable flag, and per attribute either all its values (when the mention names words for it) or its name and value count; at most 30 values per attribute, then «y N más» |
| Stage input | 24,000 characters per rendered input (`READER_STAGE_INPUT_MAX_CHARS`) |

When a rendered input would exceed the stage bound it is cut in a fixed order: drop the oldest context messages; lower the candidates per mention to 1; drop the attribute values of products the mention does not name; then fill what is left in a fixed priority (current message, requests and their mentions, order lines newest first, pendings, candidates by search rank) and omit the rest. An omitted order line behaves as an unlisted item (`unclear_item`) and a mention whose candidates were all omitted becomes `not_identified`: permanent decisions, never a retryable error. Reason: a character budget is deterministic without a tokenizer at runtime; at most about 2 tokens per character in non-Latin scripts it keeps every input under about 48k tokens, inside the model window.

## Catalog search

All of a message's mentions are searched in one statement (`findMentionCandidates`), one transaction and one connection, with per-mention coverage and a per-mention limit. The statement's cost is words × active products and the trigram index cannot serve it under forced RLS, so the bound is per statement.

- **Pair budget:** `READER_MENTION_PAIR_BUDGET` 100,000 pairs (about 450 ms at the measured 4.5 µs per pair). The total of searched words is `clamp(floor(budget / activeProducts), 3, 30 × mentions)`; the floor of 3 wins over the budget above about 33,000 active products, where only the timeout bounds it.
- **Sharing words:** `allocateMentionWords` hands the total round-robin over the mentions in request order, each turn giving a mention its longest word not yet searched, at most 30 per mention, so every mention gets one word before any gets a second. A mention left with no word is not searched and becomes `not_identified` (urgent with the which-product question).
- **Candidates:** the first 5 of each mention plus the products of the photo, the items and the pendings. The photo, the items and the pendings only fill slots; a mention that was starved or timed out is given the chat's products instead. An unavailable twin (a deactivated product with the same name key as a sellable match) is excluded from the candidates the model chooses among, and only used to report `product_not_available`. The first QR product of a photo feeds the candidates.
- **Time:** the 1 s budget covers the wait for a connection and the statement. A pool-wait timeout and a statement timeout both give an empty, timed-out result for every mention, never a retryable error.
- **Pool:** on the primary path a message holds one connection at a time; with `APPLY_CHAT_MESSAGE_CONCURRENCY` 16 the reader needs 16 of the worker's pool of 24. The confirming search can overlap the product load, which is safe because its wait sits inside its own budget.

## Certainty, risk and decision

Pure functions in `domain/reader/`:

- `CertaintySignals`: `quotesComplete`, `targetNamed` (`named`, `photo_same_message`, `photo_just_sent_set`, `context`), `variantChangeVerb` (`present`, `absent`, `not_applicable`), `candidates` (`single`, `several`). `isHighCertainty` holds when all four signals hold; `photo_just_sent_set` counts as named only for set wording on what the photo left while it is unchanged.
- `riskOf(action)`, `agreementOf(primary, confirming)` (`agree` when the confirming chain resolves to the same action kind, target, variant and quantity; `disagree`; `not_run`) and `decideChange`, which implements the decision table of [message-to-order](message-to-order.md#decision). The photo-then-variant guard is a precondition of the decision.
- Doubt reasons: `variant_changed`, `quantity_set`, `added_by_reference`, `removed`, `price_noted`, `caption_unread` and `inherited` (which wraps an original reason and never nests). Reasons are structured data; presentation renders their text.
- Pending doubt: a pending change that is not high certainty carries a doubt with a point time and no acknowledgement; completing or splitting it gives each created item an `inherited` mark unless the message restates the same value with the same number or a review already acknowledged the point.

## Change records and undo

Every item change a message makes is recorded in `OrderItemChange`: the line before and after (copied name, combination, SKU, unit price, mentioned price, position), the decision, the doubt reason, the quote id, the review that showed it and its verdict. Marks, «Cambios por mensajes», undo, verdicts and evaluation labels derive from these rows. Each change gets a per-order sequence number `seq` assigned under the order lock, which orders changes by commit and is the high-water mark a review loads. A change a later change replaces points to it (`supersededById`) and no longer asks for review; undoing the later message makes the earlier change current again, so its mark returns. `OrderMessage` keeps the pendings that differ before and after the message, so a message that only changed a point can be listed and undone; it also marks the messages that closed a link-notice cycle.

`undoMessageChanges` is all or nothing per message, only while the order is open for messages, under the order lock then the chat's pendings lock. It restores each touched line and pending individually, never writing the ones the message did not touch, and moves no stock because an order open for messages has none deducted. It is refused when a touched line or pending is no longer as the message left it (acknowledging a point in a review is not a change; an undone later message does not count as a later change), when it would empty the order, when a restored variant is no longer sellable, or when the order moved on. The same pure function computes availability before the seller confirms. A repeat of an undone message answers the current state.

Verdict rules: the first verdict stays, except `undone`, which replaces `kept`, `quantity_changed` and `removed` while the order is open for messages. `not_reviewed` is final. It is written, as one set-based statement, when an order completes (payment completing a delivered order, or delivery of a paid order, on either delivery path) or is cancelled; voiding a payment leaves verdicts unchanged.

## Review, link actions and items step

The items step of `editOrder` is split into `planItemsEdit` (plan and apply, reading only), `writeItemsEdit` (save lines, set edit verdicts and `Order.sellerActedAt`) and `settleEditStock` (the single stock tail: one `order_edited` in the transaction, the deducted-order rollback rule, `product_stock_increased`, `stockDue`). `editOrder` keeps the checks that span parts (applied parts, locks, revisions, `ORDER_CHANGED`) and `confirmOrderReview` calls the same functions for its corrections, each caller running the stock tail once after all its parts.

- **Review projection:** `loadOrderReview` builds it from the order, its changes, the chat's pendings, the latest order of the chat and the trace quotes (only the `quotes` column). `messageRows` holds the 5 newest rows with `moreRows`; each row carries its undo availability and the pendings that would come back or end (`pendings: { back, end }`). A missing or expired trace only removes the quotes.
- **Confirming:** `confirmOrderReview` is idempotent through a client UUID (`OrderReview`); a repeat is rebuilt from stored rows, and the repeat check runs again under the order lock. It confirms exactly the change ids and points the review showed. A new change on a corrected item, a new mark or a new point answers `REVIEW_OUTDATED`; a seller edit since loading answers `ORDER_CHANGED`, detected by rebuilding the loaded items revision from the changes newer than the review's `changesThrough`. New sure changes are left unreviewed and returned as `changedMeanwhile`. Verdicts and `reviewId` go only to the shown changes.
- **Link actions:** `recordLinkAction` inserts an `OrderLinkAction` keyed by a client UUID (a repeat succeeds without writing) and takes no order lock. «Pedido #N cambió» is armed by a link action newer than the last message that closed a cycle; both that notice and an urgent notice carrying the changed-after-link suffix close the cycle. A link action committed concurrently with a message is seen by the next change; the change still shows in the next review.
- **Order lists:** `toReview` comes from one batched read per page (change rows of the listed orders, pendings of their chats, the latest order of each chat) fed to the pure `reviewStatus`. Lists never read traces or reviews.
- **Mobile item editing:** `PATCH /api/orders/:orderId/items` calls `editOrder` with only the items part; the contract is `shared/contracts/order-items-edit.ts` and the web edit imports its line and revision schemas.
- **Open questions:** the chat view asks core for the open questions of the messages it shows. The closing facts are stored columns (`ChatPendings.lastRequestAt`, the last message read with order intent; `Order.sellerActedAt`, the last items edit, undo or confirmed review), so the lookup is by primary keys. A point id is a deterministic UUID derived from message id and index, a message shows at most 3 points, the answer lists only messages with open points, and each point names the product(s) it asks about.

## Traces and masking

| Aspect | Rule | Reason |
| --- | --- | --- |
| Trace | `MessageTrace` (PK company and message): one per message read, written after commit, best effort. It holds timing, the photo summary, each stage's `StageCall`, input summary (references and catalog data, never prompt text), masked output and error code, the quotes (masked, at most 80 characters), each decision with its signals, risk and agreement, and the cost. A stage record without a call is not stored. | Evidence to debug and evaluate each stage. |
| Masked texts | `MessageMaskedText` stores a message's masked text once; traces reference context messages by id. | Bounds trace size and output tokens. |
| Masking | Phones: a digit-run rule in code (runs of 7 or more digits, with separators or a leading `+`, keep the first 3 and last 2: «+51 9•• ••• •12»). Addresses: the spans the intent stage reports, replaced by «[dirección]»; a span that is not a substring of its message is ignored. A stored stage output keeps address spans only as counts. If the intent stage fails, the current text is withheld. | Understanding is the model's; the digit rule needs no language. |
| Retention | `delete-expired-message-traces`, hourly: a `SECURITY DEFINER` lookup lists the companies with expired rows, then each company deletes traces and masked texts past `expiresAt` in batches of `MESSAGE_TRACE_DELETE_BATCH` (500) until a batch comes back short. `MESSAGE_TRACE_RETENTION_DAYS` is 90. A masked text expires 90 days after its own message, so a trace referencing it as context can outlive it by up to the 48-hour window; the reader then shows the text as expired. | The 90-day limit bounds how long buyer text copies exist. |
| Access | Only a CLI inside the core container: `trace:read --company <uuid> --message <uuid>[,…]`. Each reader holds a personal token; `TRACE_READERS` holds `name:sha256(token)` pairs set in the deployment env; the CLI reads the token from standard input (never argv or env), compares in constant time, writes a `MessageTraceRead` audit row (reader, message ids, time) in the same transaction, and prints nothing if the audit fails. `trace:reader-token <name>` prints a new token and its env line. There is no HTTP route and no seller session can read traces. Every OS user in the container is `node`, so the OS user proves nothing. | Named, recorded access closes the risk of buyer texts of every company being read through a seller path. |
| Verdict labels | `verdicts:report --since <YYYY-MM-DD> --until <YYYY-MM-DD>` (until exclusive, at most 366 days; same token) prints counts of verdicts by decision, doubt kind, verdict and label strength through a `SECURITY DEFINER` aggregate that returns counts only. Strong labels: «kept» on a doubtful change, and any correction or undo. Weak: «kept» on an applied change. `not_reviewed` is no label and unverdicted changes are summed apart. | Seller verdicts become text-free evaluation labels. |

Size is about 3–6 KB per trace plus one 0.5–2 KB masked text per message; at 10k messages a day that is 4–7 GB at the 90-day steady state. If delete bloat appears, a daily partitioned table is the fallback. A missed address stays readable to audited named readers for up to 90 days.

## Persistence

Every new table has `companyId` defaulting to `current_setting('app.company_id')`, `ENABLE` and `FORCE ROW LEVEL SECURITY` with a company-isolation policy, and composite foreign keys including `companyId`. Strict Zod schemas parse every JSON column; invalid stored data is `INVALID_STORED_DATA`.

| Table / column | Purpose |
| --- | --- |
| `OrderItemChange` | One row per item change a message made (see above). `itemId` has no FK because edits replace lines. Unique `(companyId, messageId, orderId, position)` and `(companyId, orderId, seq)`; a partial index serves the unverdicted, unsuperseded rows. |
| `OrderReview` | One per confirmed review, keyed by a client UUID: reviewer, origin (`link`, `detail`), shown points, corrected items, `changesThrough` and `confirmedThrough`. |
| `OrderLinkAction` | One per recorded link action (`copy`, `share`, `open`), keyed by a client UUID. |
| `OrderMessage` (+) | Pendings before and after, `undoneAt`, `undoneById`, `linkChangeNotice`; index `(companyId, orderId, createdAt)`. |
| `Order` (+) | `sellerActedAt`; index `(companyId, chatId, createdAt DESC)` so the latest order of a chat is a top-1 read. |
| `ChatPendings` (+) | `lastIncomingPhoto`, `lastRequestAt`; each pending gains `doubt`, `pointSince`, `acknowledgedAt`. |
| `MessageTrace`, `MessageMaskedText`, `MessageTraceRead` | Traces, masks and the audit of reads. The audit holds no text and is kept. |
| Functions | `companies_with_expired_message_traces(cutoff)` and `message_change_verdict_counts(since, until)` (counts only, no company, order or text). |

Cross-tenant reads are limited to these functions and the catalog-retention lookup; the app role can execute them, so they return only ids (lookups) or counts (verdicts). Writes under the order lock are set-based (one statement per verdict kind, one for `reviewId`, one for superseding). Index builds on existing tables are `CONCURRENTLY` and re-runnable; each replaced index is dropped in its own single-statement migration. Verdicts, review and link tables follow the conventions of [persistence](persistence.md).

## Contracts

All in `shared/contracts/`, validated by core on requests and responses and by mobile on every response; contracts change in place.

| File | Use |
| --- | --- |
| `order-review.ts` | `GET /api/orders/:orderId/review[?rows=all]` (the projection); `POST /api/orders/:orderId/reviews` (confirm; errors `REVIEW_OUTDATED`, `ORDER_CHANGED`, `DELIVERY_LOCKED`, `ORDER_CANCELLED`, `LAST_ITEM`, `VARIANT_NOT_FOUND`) |
| `order-message-undo.ts` | `POST /api/orders/:orderId/messages/:messageId/undo` (`UNDO_REFUSED` with reason) |
| `order-link-actions.ts` | `POST /api/orders/:orderId/link-actions` |
| `order-items-edit.ts` | `PATCH /api/orders/:orderId/items` |
| `message-questions.ts` | `POST /api/messages/questions` (1–100 message ids) |
| `orders.ts` | `revisions` on the aggregate and `toReview` on the summary |
| `seller-notices.ts` | Notice kinds `payment_request` and `order_changed_after_link`; payload unchanged |

Texts never travel as UI copy, except the suggested questions (text for the buyer, rendered by core in the buyer's language) and catalog names.

## Failure windows

| Window | What happens |
| --- | --- |
| A stage fails temporarily or the reading budget runs out | The job retries as usual; every stage reruns; later messages of the chat wait |
| Stage answer invalid twice | `failed` outcome and the notice «No pudimos revisar un mensaje» |
| Crash after commit, before the trace | The trace is missing; the re-run is `already_processed` and writes none |
| Review confirm or undo response lost | The client repeats with the same id; the answer is rebuilt, an undone message returns success |
| Link action not recorded | Retried once, then dropped; «Pedido #N cambió» is not armed for that cycle |

## Configuration

`apps/core/.env.example` holds: `READER_<STAGE>[_CONFIRM]_PROVIDER|_MODEL|_PROMPT` (stages `INTENT`, `EXTRACTION`, `RESOLUTION`), `READER_STAGE_TIMEOUT_MS`, `READER_READING_BUDGET_MS`, `AI_TIMEOUT_MS` (provider timeout of each stage's OpenAI client; default 20 s, above the stage timeout), `READER_MAX_PRODUCTS` (products in the context of a photo answer), the budgets of [Input budgets](#input-budgets), `READER_CANDIDATES_PER_MENTION`, `READER_MENTION_PAIR_BUDGET`, `MESSAGE_TRACE_RETENTION_DAYS`, `MESSAGE_TRACE_DELETE_BATCH`, `TRACE_READERS` and `VERDICT_REPORT_TIMEOUT_MS`. Model prices live in `src/shared/infrastructure/model-prices.ts`; a model without a price fails startup.

## Latency and cost

Per text message, before caching, at the default models: intent about US$0.00034 and 1.5 s, extraction about 0.00047 and 2.0 s, resolution about 0.00035 and 1.5 s, the catalog search 0.3 s, the transaction 0.3 s: about US$0.0012 and 5.8 s p95. A message with a high-risk intent also pays the confirming extraction (about US$0.0005) even if the checks then abort it; a confirming chain that finds new mention words adds about 1.8 s. Photo messages have their own p95 (about 6.1 s) and about US$0.001 for the cascade. The evaluation reports photo and text messages apart. Cost levers, in order: prompt caching of the fixed instructions (each stage's instructions must reach the provider's cacheable prefix), then a cheaper model on resolution.

## Observability

Events (fields are ids, kinds, counts and timings; never message or caption text, quotes, question text, prompts, model output, names, phones, addresses, WhatsApp IDs or totals):

- Stages: `reader_stage_completed`, `reader_stage_failed`, `reader_stage_retried_invalid_answer`, `reader_input_cut`, `reader_quote_dropped`.
- Message: `orders_chat_message_applied` (stage calls, decision kinds, doubtful and urgent counts, confirming run, context size, queue and decision time, cost), `reader_trace_save_failed`.
- Seller actions: `order_message_undone`, `order_message_undo_refused`, `order_review_confirmed`, `order_review_outdated`, `order_review_conflict`, `order_link_action_recorded`.
- Operations: `message_traces_deleted`, `message_trace_read`, `message_trace_read_refused`, `verdict_labels_reported`.

## Evaluation harness

`apps/core/evals` (README there): `EVAL_REPEATS` (default 3) runs the whole selected set N times, scores each run and reports mean and range per metric; `eval:compare` calls a metric better or worse only when the ranges do not overlap; `EVAL_MODELS=fake` runs the whole harness at zero cost with scripted stage answers; a run that can call a model needs `EVAL_PAID=1` and prints its estimate first; verdict-label counts are embedded in the report when `EVAL_VERDICTS_FROM` is given, with weak labels apart; a private folder inside the repository is refused and private run summaries hold ids and failure types only. See [message-to-order](message-to-order.md#evaluation) for the metrics and the holdout rules.

## Limits

- Phones written with `/` or `_` separators or with full-width digits are stored unmasked, and long digit runs that are not phones (for example a list of sizes such as «36 38 40 42») are masked.
- Missed addresses stay readable to audited named readers for up to 90 days.
- The three-word floor above about 33,000 active products exceeds the pair budget; a timeout leaves every mention of the message `not_identified` (urgent).
- A high-risk message whose confirming chain finds new mention words adds about 1.8 s; no lever removes it, and the p95 target is checked by the evaluation.
- An item removed by mistake whose undo is refused can be added back only from the web, at the current price.
- Messages without a send time never appear as context.
