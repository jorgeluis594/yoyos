# Staged message reader: technical design

**Status:** design closed, pending implementation. The review gate answered the open questions (section 17); the founder confirms them in the final pull request. Based on `docs/drafts/lector-de-pedidos-por-mensaje-nueva-arqu.md` (product, closed 31/10/2026) and Todoist task `6hv99FVqgMmmJJR3` (founder decisions of 31/10 prevail). Base: integration branch `jorgeluis594/lector-de-pedidos-por-mensaje-nueva-arqu` at `e4970a07`. Reused pieces come from `origin/jorgeluis594/pedidos-por-mensaje-que-la-ia-no-pierda` (PR #313, closed unmerged).

## 1. Technical goal

Core reads every incoming chat message in stages instead of one model call:

- Code gathers a bounded context.
- Three model stages (intent, extraction, catalog resolution) turn the buyer's words into requests with their justifying quotes. Each stage sits behind its own port, with model and prompt chosen by configuration.
- Pure code checks the requests against the catalog and the order and assigns certainty and risk.
- An explicit pure policy decides each change: applied, applied «Con duda», «Por resolver», urgent or silent.

The changes of one message are applied in one transaction and recorded per item. With those records the seller can undo one message, see what messages changed, and confirm or correct the order in a review before taking the checkout link. Mobile gains item editing (remove, quantity). Every message read leaves a masked, company-isolated trace that is kept 90 days. Seller verdicts become text-free evaluation labels. The evaluation harness measures each stage over 3 runs with mean and range. Paid runs are an explicit step that the founder approves one by one.

```text
message_created ─▶ apply-chat-message (ordered per chat, unchanged queue, 85 s attempt deadline)
  ├─ shadow (phase 5): legacy single reader starts in parallel, result only to the trace
  ├─ context (code, bounded): open order, pendings, photo memory, last 12 msgs / 48 h, last photo outcome
  ├─ photo cascade (QR, visual 0.8), unchanged; its stage summary goes to the trace
  ├─ intent stage (model port)      → requests | no_intent | unsure, language, address spans of unmasked messages
  ├─ extraction stage (model port)  → per request: target, values, quantity, price, each with its quote
  │    └─ confirming extraction starts together with it when an intent is high risk
  ├─ resolution stage (model port)  → per mention: catalog choice among searched candidates, catalog values
  ├─ checks (pure)                  → ResolvedChatAction[] with certainty signals; agreement (pure)
  └─ transaction: lock Contact → Order → ChatPendings → decide (pure) → apply → change rows, OrderMessage, outcome
─▶ after commit: MessageTrace and masked texts (best effort), chat_message_processed when a notice is due

Seller: order detail / web view ── GET review ──▶ OrderReview projection
        link action ── POST link-actions        Confirmar revisión ── POST reviews (corrections + verdicts)
        Deshacer ── POST messages/:id/undo      mobile Editar productos ── PATCH items (editOrder)
Team:   trace:read CLI (audited)                verdicts:report CLI (counts, no text)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Owning feature | `orders` keeps the reader, because it owns the outcomes, pendings and order transitions. New code goes in `orders/{domain,application,infrastructure}/reader/` subfolders because of its volume. No new feature. `chats` gets a `composition.ts` for the context capability. |
| Stages | Context (code), intent, extraction and resolution (models), checks, certainty and decision (pure), trace. A confirming reading starts only for a high-risk intent and is aborted when the checks show no high-risk action needs it. Today only extraction has a confirming configuration. |
| Stage ports | One application port per model stage, named by intention: `readMessageIntent`, `extractOrderRequests`, `chooseCatalogProducts`. Each takes `reading: "primary" \| "confirming"`. There is no generic "LLM" port in application. |
| Stage configuration | Per stage and reading: provider (`openai` or `fake`), model and prompt version, read from env (`READER_<STAGE>_PROVIDER`, `_MODEL`, `_PROMPT`; confirming readings use `READER_<STAGE>_CONFIRM_*`). Each stage has its own prompt-version file. Reasoning effort and output token limit belong to the prompt version. Startup fails on an unknown version or an unpriced model. Changing one stage's configuration touches no other stage and no policy (founder decision 5). |
| Second opinion | A confirming reading is a configuration. `Agreement` is computed by a pure function over the resolved actions of the primary chain and the confirming chain. The confirming chain uses each stage's confirming configuration when one exists and reuses the primary result otherwise. A strong model on any stage is therefore an env change plus a composition line, never a policy change. |
| Default models | `gpt-6-luna` on every stage, reasoning effort `none`. Initial values, adjustable. |
| Catalog | Never pasted. Products reach the reading through `findMentionCandidates` (all of a message's mentions in one statement), the photo identification, the order items and the pendings. `READER_MAX_PRODUCTS` goes away (Todoist `6hrqHJghCXGwX26V` obsolete). Every input is bounded by the deterministic stage budgets of section 6.8. |
| Justifying words | Every datum carries a quote. Code checks that the quote is a substring of the current message, ignoring case and whitespace. A datum whose quote is missing or not found is dropped. Only targets may come from context. |
| Context | The last 12 messages of the chat, sent within the 48 hours before the message (by `sentAt`), in both directions. Each context text is capped at 500 characters. Plus the latest incoming photo's outcome inside that window, the open order, the pendings and the photo memory. Initial values, adjustable. |
| Time budget | Each stage's signal combines the job signal with the stage timeout (`READER_STAGE_TIMEOUT_MS`, 10 s) capped by what is left of the reading budget (`READER_READING_BUDGET_MS`, 60 s, under the 85 s attempt deadline). A stage does not start with less than 2 s left; it ends as `DEADLINE_EXCEEDED`, retried as today. |
| Decision policy | A pure function of signals, risk and agreement, evaluated inside the transaction on the locked state. The same inputs give the same decision without a model. |
| Change records | New table `OrderItemChange`: one row per item change a message made, holding the line before and after, the decision, the doubt reason, the quote id, the review and the verdict. Marks, «Cambios por mensajes», undo, verdicts and labels derive from it. |
| Items step | Three application functions are extracted from `editOrder`. `planItemsEdit` handles plan and apply, and the deducted `returns`; it only reads. `writeItemsEdit` handles save, verdicts and `Order.sellerActedAt`. `settleEditStock` is the single stock tail: one `order_edited` in transaction, the deducted rollback rule, `product_stock_increased` and `stockDue`. Each caller runs it once, after all its parts. `editOrder` keeps the checks that span parts (applied parts, locks, revisions, `ORDER_CHANGED`). `confirmOrderReview` calls both functions for its corrections. |
| Reviews | New table `OrderReview`, keyed by a client-generated UUID, so a repeat is idempotent. A review confirms exactly the change ids and «Por resolver» points it showed. The answer to a repeat is rebuilt from stored rows; it is not cached. |
| Link taken | New table `OrderLinkAction`, keyed by a client-generated UUID. «Pedido #N cambió» is armed by a link action newer than the last message that closed a cycle. Both «Pedido #N cambió» and an urgent notice carrying the changed-after-link suffix close the cycle. |
| Undo | `undoMessageChanges` is all or nothing per message and only works while the order is open for messages. It restores the lines and the pendings the message touched, each one individually. It is refused when a touched line or pending is no longer as the message left it, when it would empty the order, when a restored variant is no longer sellable, or when the order moved on. The same pure function computes whether undo is available before the seller confirms. |
| Mobile item editing | `PATCH /api/orders/:orderId/items` calls the existing `editOrder` with only the items part. The contract moves to `shared/contracts/order-items-edit.ts`. Mobile edits remove items and change quantities only. |
| Traces | New table `MessageTrace` (PK company and message): one per message read, written after commit, best effort. It references context messages by id. Masked texts are stored once per message in `MessageMaskedText`. Both are deleted hourly once 90 days have passed since the message (`MESSAGE_TRACE_RETENTION_DAYS` 90), and the deletion always catches up. |
| Masking | Phones are masked by a digit-run rule in code (no language rule). Addresses are masked by the spans the intent stage reports, once per message, for the current message and for any context message without a stored mask. A span that is not a substring of its message is ignored. If the intent stage fails, the current text is withheld. |
| Trace access | A CLI (`pnpm --dir apps/core trace:read`), run inside the core container (Coolify terminal or `docker exec`), where every OS user is `node`. The OS user therefore proves nothing. Each reader holds a personal token; `TRACE_READERS` holds `name:sha256(token)` pairs, set in the deployment's env by the founder. The CLI reads the token from standard input (never argv or env, so it stays out of shell history and `ps`), hashes it and compares in constant time. Each read writes a `MessageTraceRead` audit row in the same transaction, with the reader's name, the OS user (informative only) and the message ids. There is no HTTP route, and no seller session can read traces. |
| Verdict labels | `verdicts:report` (CLI) prints counts of change verdicts by decision, doubt reason, verdict and label strength (strong: «kept» on a doubtful change, or any correction or undo; weak: «kept» on an applied change). It reads through a `SECURITY DEFINER` aggregate that returns counts only. The eval report includes these counts. `trace:read` shows the verdicts of a traced message's changes while its trace lives. |
| Suggested questions | Built from structured data (problem kind, catalog product, attribute, at most 3 values). The use case returns `SuggestedQuestion`; presentation renders it with the es and pt-BR templates, in the language the intent stage reports for the buyer. They are stored in the outcome as structured data, never as buyer text. |
| Open questions | The chat view asks core for the open questions of the messages it shows. The closing facts are stored columns, so the lookup is by primary keys: `ChatPendings.lastRequestAt` (the last message read with intent `requests`), `Order.sellerActedAt` (the last edit of items, undo or confirmed review). |
| Order lists | `toReview` comes from one batched read per page: change rows of the listed orders, pendings of their chats and the latest order of each chat, fed to the pure `reviewStatus`. Lists never read traces or reviews. |
| Shadow | Phase 5 only. The legacy single reader (`ReadChatMessage`) starts in parallel when the reading starts and never applies anything. Its answer kind, action kinds and usage go to the trace (`READER_SHADOW_LEGACY`, default `true`). The wait after commit is at most `min(READER_SHADOW_WAIT_MS 3000, time left)`. T17 removes it after the founder's test, on the integration branch. |
| Evaluation | The existing `apps/core/evals` harness is extended in place:<br>- `EVAL_REPEATS` (default 3) now runs the whole selected set N times, scores every run and reports mean and range.<br>- New: a compare command and a zero-cost fake mode.<br>- An explicit paid gate (`EVAL_PAID=1`) with a printed estimate.<br>Paid steps E1–E3 and H run only after the founder approves each one. |
| Frozen holdout | Built outside the repository by a Codex agent with sol 6.1 that never touches prompts, in the committed case schema, and loaded from `EVAL_PRIVATE_DIR`. Reports carry only ids and failure types. |
| #313 pieces | Ported file by file from the branch (`git show origin/<branch>:<path>`) into the tasks listed in section 3.2. Nothing is merged from the branch. |
| Migrations | Six migrations in T0:<br>1. A SQL-only delete of development `ChatMessageOutcome` and `ChatPendings` rows, whose old JSON the new strict schemas reject.<br>2. The Prisma-generated DDL.<br>3. A SQL-only migration that builds the indexes on existing tables `CONCURRENTLY`.<br>4–5. One single-statement migration per old index replaced (`DROP INDEX CONCURRENTLY IF EXISTS`).<br>6. A SQL-only migration with the `SECURITY DEFINER` functions.<br>No data conversion, because there are no customers. |

## 3. Verified current state

### 3.1 Code on the base

| Piece | Location | State |
| --- | --- | --- |
| `message_created` `{ companyId, chatId, messageId }` | `chats/application/events.ts`, wired in `src/composition/event-handlers.ts` | Reused unchanged. |
| Queue `apply-chat-message` (ordering key chat, group company 8/16, 8 retries, 85 s deadline, dead letter) | `orders/application/chat-message-policy.ts`, `chat-message-handler.ts` | Reused unchanged. |
| `applyChatMessage(input, deps, signal)`, `ApplyChatMessageDependencies`, `ReadingTrace`, `applyInTransaction` | `orders/application/apply-chat-message.ts` | Reading part replaced by the stages (T13). Transaction kept and extended (T1, T13). |
| Single reader port `ReadChatMessage`, `createChatReaderFromEnv` (null without `OPENAI_API_KEY`), adapter, schema (12 kinds), texts, pinned `chat-reader.model-text.json`, `AI_READER_MODEL` | `orders/application/read-chat-message.ts`, `orders/infrastructure/openai-chat-reader.ts`, `chat-reader-*.ts`, `composition.ts:788` | Kept only as the shadow during phase 5. Removed by T17. |
| `ChatReadingContext`, `ReaderAnswer`, `checkReaderAnswer`, `fixedShownAnswer` | `orders/domain/chat-reading.ts` | `fixedShownAnswer` is kept (photo without caption). `checkReaderAnswer` is kept for the shadow and removed by T17. |
| `applyChatActions`, `ResolvedChatAction`, `needsNewChatOrder` | `orders/domain/chat-order.ts` | Reused. Gains the #313 action kinds (T5). |
| Pendings: `ChatPending` (`id`, `subject`, `known`, `quantity`, `price`, `order`, `lastChangedAt`, `sourceMessageId`, `requestId`), `chatPendingsSchema`, `pendingLife`, `attachOrderless`, `maxChatPendings` 10 | `orders/domain/chat-pendings.ts`, `pending-transitions.ts`; `ChatPendings` table (PK company, chat) | Reused. `ChatPending` gains doubt and point fields; the table gains `lastIncomingPhoto` and `lastRequestAt` (T0). |
| Outcomes union and `chatMessageOutcomesSchema` | `orders/domain/chat-message-outcome.ts`; `ChatMessageOutcome` table (PK company, message) | Extended (T0). |
| Notice choice `chooseSellerNotice` (21 kinds), texts, description | `orders/domain/seller-notice.ts`, `orders/presentation/seller-notice-texts.ts`, `application/describe-chat-message-notice.ts` | Extended (T6). |
| `OrderMessage` (PK company, message; `orderId`, `createdAt`; index `(companyId, orderId)`) | `schema.prisma` | Extended (T0). It remains the `already_processed` guard and its rows are kept. |
| Products `identifyProductsInImage`, `findProductsForReading`, `findMessageCandidates(text)` (8 candidates, 1 s timeout), `catalogSearchReadiness` | `products/composition.ts` | Reused; `findMentionCandidates` is added beside it for the stages (T10). Candidates gain the #313 unavailable twins; identification reports chooser usage (T10). |
| `ChatMessage` (`direction`, `type`, `text`, `caption`, `sentAt` nullable, `receivedAt`; index `(companyId, chatId, sentAt, id)`) | `schema.prisma` | Read for context (T18). |
| `chats` public entry | `chats/index.ts` (barrel; no `composition.ts`) | T18 adds `chats/composition.ts` for the new capability. The barrel is not extended. |
| `editOrder`: `findOrderForUpdate`, `findSellableVariants`, `saveItemChanges`, `publishStockEvent` (`order_edited` in transaction), `publishStockIncreased`, `describeOrderStockDue`/`findVariantStock`, part-applied drop, revisions (`orderRevisions`, sha256 of id, variant, quantity, unit price, mentioned price), `ORDER_CHANGED`, locks | `orders/application/edit-order.ts`, `domain/order-edit.ts`, `domain/order-revisions.ts` | Items plan, write and stock tail extracted to `planItemsEdit`, `writeItemsEdit` and `settleEditStock` (T1); the checks that span parts stay. Only the web route action calls `editOrder` today. |
| Completion and cancellation writers | `register-payment.ts` (`saveCompletion`); `fulfill-order.ts` `deliverOrder` (delivery of a paid order), used by `registerDelivery` and by `update-order-shipping.ts` with `status: "delivered"`; `cancel-order.ts` (`saveCancellation`); `void-payment.ts` clears completion; `register-immediate-sale.ts` creates completed orders without chat and does not use `deliverOrder` | `registerPayment`, `deliverOrder` and `cancelOrder` call `settleUnreviewedChanges` (T11). |
| Edit request schemas | `orders/presentation/order-edit-schemas.ts`, limits `shared/orders-edit.ts` (9999, 100 lines) | The items part moves to `shared/contracts/order-items-edit.ts` (T0). |
| Order JSON projections | `orders/presentation/order-json.ts` (aggregate and list) | `revisions` (T3) and `toReview` (T11) added in separate functions. |
| Checkout link `POST /api/orders/:orderId/checkout-link`, `checkoutLinkSchema` | `orders/presentation/api-routes.ts`, `shared/contracts/order-checkout.ts` | Reused unchanged; it stays a read. |
| Web order view, link card, products card, unsaved guard, list | `app/routes/order-detail.tsx`, `orders/presentation/order-view.tsx`, `app/components/order-link-card.tsx`, `order-products-card.tsx`, `use-unsaved-changes-guard.ts`, `app/routes/order-list.tsx` | Changed (T14). |
| Mobile order detail (inline link card), history, `QuantityStepper`, `show-confirmation`, `createOrderApi` | `apps/mobile/src/features/orders/presentation/order-detail-screen.tsx`, `order-history-screen.tsx`, `products/presentation/quantity-stepper.tsx`, `components/ui/show-confirmation.ts`, `orders/infrastructure/order-api.ts` | Changed (T3, T15). Mobile has no item editing today. |
| Mobile chat view; local `whatsapp_messages.core_message_id` | `apps/mobile/src/features/whatsapp/presentation/conversation-screen.tsx`, `infrastructure/local-database.ts` | Changed (T12). Core serves no outcomes to mobile today. |
| Retention pattern | `application/delete-expired-catalog-orders.ts`: a `SECURITY DEFINER` lookup lists companies, then each company is deleted in batches of 500 until a batch comes back short | Reused for traces (T2). |
| Evals | `apps/core/evals/`: suites, Zod case schema, splits, `EVAL_PRIVATE_DIR`, `EVAL_REPEATS` (1–5, default 3, only tagged cases, first run scored) with `EVAL_REPEAT_TAGS`, `lib/model-meter.ts` (prices, `installModelMeter`), `lib/prompt-overlap.test.ts`, reports in `eval-results/` | Extended (T7, T16). Holdouts v3/v4 are not in the repository; they are private. |
| Production cost tracking, prompt version ids, generic model port, photo memory, seller edit time | — | Do not exist. |
| Latest migration | `20261031180100_add_order_item_position` | T0 adds the next six. |

### 3.2 Pieces brought from PR #313

| Piece (branch path) | Brought by | How |
| --- | --- | --- |
| `orders/domain/photo-just-sent.ts` (`nextLastIncomingPhoto`, `photoJustSentOf`, `memoryAfterFailure`) and its test | T5 | Ported as is. Its input becomes the extraction's `photo_just_sent` target instead of a reader action. |
| `LastIncomingPhoto`, `PhotoLeft`, `lastIncomingPhotoSchema` in `chat-pendings.ts`; migration `20261030192634_add_chat_last_incoming_photo` | T0 | Types ported. The column is re-created in T0's DDL migration; the branch migration is not copied. |
| `changePendingQuantity`, `PendingQuantityChange` (`pending-transitions.ts`) | T5 | Ported as is. |
| `ResolvedChatAction` kinds `lower_quantity`, `change_pending_quantity`, `set_marked_item_quantity`, `change_unfound_item` (`chat-order.ts`) | T5 | Ported. `set_marked_item_quantity` is renamed `set_photo_item_quantity`. |
| `payment_requested` outcome, `PaymentOrder`; `invalid_action` reason `quantity_below_zero` | T0 | Ported into `chat-message-outcome.ts`. `malformed` and `context_too_large` are not brought: the product removes them as outcomes. |
| `fillPaymentRequests` (`chat-order.ts`) | T5 | Ported. |
| `payment_request` notice kind and `paymentRequest` bodies es/pt | T6 | Ported. |
| `products/domain/product-name-key.ts`; unavailable twins in `text-candidates.ts` (`TEXT_MATCH_UNAVAILABLE_CANDIDATES`) | T10 | Ported. |
| `application/record-failed-chat-message.ts` | T13 | Ported. |
| `src/shared/infrastructure/model-prices.ts` (`modelPrices`, `priceOf`) | T0 | Ported as is, so that T4 and T7 both import it without editing it. |
| Evals: `lib/report.ts` consistency and `tagMetrics`, `lib/diagnostics.ts`, `scripts/check-private.ts`, `lib/private-summary.ts`, `claudePrices` in `model-meter.ts`, `newDevInterpretationCases`, `newDevConversationCases`, `new-dev-cases.test.ts` | T7 | Ported. Expectations are relabelled to the new decisions. |
| Prompt sentences (payment request, photo just sent, decrease, closed-order line) | T8, T9 | Rewritten as rules of the stage that owns them. Examples never copy eval inputs. |
| Not brought | — | `chat-reader-budget.ts` and `gpt-tokenizer`: the budgets of section 6.8 are deterministic character budgets on a bounded rendering, with no tokenizer at runtime. `shippedReaderFeatures` and `shipped-expectations.ts`: no feature flags. `visual-stages-cost.ts`: identification reports its real usage instead. The single-call schema and prompt changes. |

## 4. Gaps this design closes

1. No reading in stages; one call decides everything (sections 5.1, 6.2).
2. No per-stage model configuration, and no way to replace one stage's model (6.1, 12.3).
3. The catalog is pasted and cut at 24 products (5.1 step 6, 6.8).
4. Data has no justifying words, so nothing stops a datum the buyer did not say (6.2).
5. No certainty, risk or explicit decision policy; no «Con duda» (6.3).
6. The reader sees no conversation and no photo memory (5.1 step 2).
7. Payment requests and «confirmo» are read as no intent (T5, T6, T8).
8. Nothing records what each message changed per item, and there is no undo (6.4, 7, 5.3).
9. Mobile cannot edit items (5.6).
10. No order review, no link-taken record and no «Pedido #N cambió» (5.4, 5.5, 11).
11. Pendings are invisible; there are no «Por resolver» points or suggested questions (5.4, 5.7).
12. No trace per message and stage, no masking and no retention (5.8).
13. Seller verdicts are not evaluation labels (5.10).
14. Evals run once and report no range; there are no per-stage metrics and no seed bank (T7, 14).
15. No shadow of the old reader (5.1).

## 5. Use cases

### 5.1 `applyChatMessage` (orders, modified)

The handler, queue, input (`{ companyId, chatId, messageId }`), retries, dead letter and `already_processed` semantics stay the same. Changes:

```ts
export type ApplyChatMessageDependencies = Readonly<{
  // unchanged: transaction, lockContact, findChatOrderTargetForUpdate, findChatPendingsForUpdate, saveItemChanges,
  // saveChatPendings, recordOutcome, recordOrderMessage, identifyProductsInImage, catalogSearchReadiness, clock, ids …
  loadReadingContext: (message: ChatSourceMessage, target: ChatOrderTarget, pendings: ChatPendings) => Promise<Result<ReadingContextData, ApplyChatMessageError>>;
  findMentionCandidates: (mentions: readonly string[]) => Promise<Result<MentionCandidates, ApplyChatMessageError>>;   // one statement per message
  findProductsForReading: (ids: readonly ProductId[]) => Promise<Result<readonly ProductForReading[], ApplyChatMessageError>>;
  stages: ReaderStages | null;                         // null without OPENAI_API_KEY and no fake configured
  findUnverdictedChanges: (orderId: OrderId, companyId: CompanyId) => Promise<Result<readonly OrderItemChange[], ApplyChatMessageError>>;
  findLinkNoticeArming: (orderId: OrderId, companyId: CompanyId) => Promise<Result<LinkNoticeArming, ApplyChatMessageError>>;
  saveMessageChanges: (changes: MessageChanges, companyId: CompanyId) => Promise<Result<null, ApplyChatMessageError>>;
  saveMessageTrace: (trace: MessageTrace, masks: readonly MaskedText[]) => Promise<Result<null, ApplyChatMessageError>>;   // after commit
  shadowReader: LegacyShadowReader | null;            // phase 5 only
  limits: ChatMessageLimits & ReadingBudgets;
}>;
```

Flow:

1. Load the message. Skip outgoing, empty and emoji-only texts as today. If `READER_SHADOW_LEGACY` is on and the message will be read, start the shadow reading with its own signal.
2. **Context (code, T18).** `loadReadingContext` makes three reads, all outside the transaction: one `findRecentChatMessages`, with the row comparison `("sentAt", id) < ($anchor, $messageId)` so the index serves it; one `MessageMaskedText` read with `messageId = ANY($ids)`; and one outcome primary-key read for the latest incoming photo in the window. It returns the chat order target, the pendings with `pendingLife`, the photo memory, the context messages and their stored masks, and the outcome of the latest incoming photo among them. It builds `ReadingInput` (section 6.2) with short references: `M1…` for context messages, `I1…` for items, `Q1…` for pendings, `P1…` for products. The context messages are the last `READER_CONTEXT_MESSAGES` messages of the chat with `sentAt` within `READER_CONTEXT_HOURS` before the anchor, where the anchor is the message's `sentAt`, or its `receivedAt` when that is null. They are ordered by `sentAt DESC, id DESC`, which the existing index serves. Messages with a null `sentAt` never appear as context.
3. A photo runs the cascade, which is unchanged. The intent stage of step 4 starts concurrently with it on a captioned photo, because intent reads only the message kind and the caption; the identified product is needed only from step 5 on. A product photo without a readable caption keeps `fixedShownAnswer` (no model call) and continues at step 7. With `stages: null`, texts are skipped as `reader_disabled` and photos follow the fixed answer, as today.
4. **Intent stage.** `stages.readIntent(input, "primary")`. `no_intent` gives a silent outcome and goes to step 9. `unsure` gives `reader_doubt` and goes to step 9. `requests` gives the request list, the buyer language and the address spans of the current message and of the context messages that have no stored mask.
5. **Extraction stage.** `stages.extractRequests(input, intents, "primary")` returns one `ExtractedRequest` per request (at most 10; the rest give `too_many_actions` as today). Quotes are verified by `verifyQuotes` (pure). A datum with an unverified quote is dropped, and its request continues without it.
6. **Resolution stage.** All the message's mentions are searched in one statement, `findMentionCandidates(mentions)` (products, section 9): one transaction, one connection, one active-product count and one catalog scan, with per-mention coverage through `unnest` and `LATERAL` and a per-mention `LIMIT`. - **Pair budget per statement.** The statement's cost is words × active products, and the trigram index cannot serve it. The bound is therefore per statement, never `searchedWordCap` per mention: `READER_MENTION_PAIR_BUDGET` 100,000 pairs (initial, adjustable). At the measured 4.5 µs per pair as `core_app` (memory 6ee53355) that is about 450 ms, inside the 1 s budget with margin. The total of searched words is `clamp(floor(100,000 / activeProducts), 3, 30 × mentions)`. The floor of 3 wins over the budget: above 33,333 active products, 3 words exceed 100,000 pairs, as today's `searchedWordCap` floor does, and only the `statement_timeout` bounds the statement (section 15).
- **How words are shared.** The pure `allocateMentionWords(mentions, activeProducts, limits)` (`products/domain/message-words.ts`) hands out the total round-robin over the mentions in request order. On each turn a mention gets its longest word not yet searched, and no mention gets more than `maxWords` 30. So every mention gets one word before any mention gets a second. At 10,000 products that gives 10 words, one per mention of a 10-mention message. At 2,500 products it gives 40.
- **A starved mention.** A mention left with no word, because there are more mentions than words, is not searched. It becomes `not_identified`, a permanent outcome that goes to the decision (urgent with the which-product question), never a retry.
- **Confirming search.** The confirming chain's extra statement, when it runs, has its own 100,000-pair cap and its own allocation over its new mentions.
- **Time budget.** The 1 s covers the wait for a pool connection and the statement. The transaction passes `maxWait` = 1 s; once inside, it sets the transaction-local `statement_timeout` to `max(1,000 ms − time waited, 200 ms)`. A `maxWait` timeout (P2028) and a statement timeout both give an empty, timed-out result for every mention (the mentions become `not_identified`), as a statement timeout does today, never `PERSISTENCE_UNAVAILABLE`. The worst case stays at about 1.2 s.
- **Pool accounting.** On the primary path a message holds one connection at a time: the context reads, then this search, then `findProductsForReading`, then its transaction. With `APPLY_CHAT_MESSAGE_CONCURRENCY` 16, the reader needs 16 of the worker's `DATABASE_POOL_MAX` 24, as today. Two paths can overlap it. The confirming search can run during `findProductsForReading`; that is safe, because its wait sits inside its own budget and a timeout is not an error. The phase-5 shadow is the bigger overlap: its legacy `findMessageCandidates` and `findProductsForReading` run beside the staged path. During phase 5, `APPLY_CHAT_MESSAGE_CONCURRENCY` is set to 8 on the founder's test build, which keeps demand at about 8 × 3 = 24, and T17 restores it. The candidates are the first `READER_CANDIDATES_PER_MENTION` of each mention plus the photo's, the items' and the pendings' products. `findProductsForReading` loads them, and `stages.chooseProducts(mentions, candidates, "primary")` chooses. A choice outside the candidates is retried once inside the stage, then the mention becomes `not_identified`. With no mentions (only item or pending references) there is no call. **Confirming reading:** when the intents contain a high-risk kind (`remove`, `change_quantity`, `change_variant`, or an `add` without a named target), the confirming chain starts together with the primary extraction of step 5, because it depends only on the input and the intents. This holds when extraction has a confirming configuration. A confirming stage without its own configuration reuses the primary result, so the chain awaits that primary result before its next stage. A second opinion on resolution only, for example, stays a configuration change (founder decision 5). That chain is `extractRequests(…, "confirming")`, then resolution on any new mention words (their search joins the message's one search statement when it has not run yet, otherwise one more statement). It is aborted as soon as step 7 shows that no action needs it.
7. **Checks (pure).** `checkRequests(readings, resolutions, snapshot)` produces `ResolvedChatAction[]` with `CertaintySignals` per action, or problem outcomes under the current check rules. `agreementOf(primary, confirming)` (pure) gives `agree`, `disagree` or `not_run` per action.
8. If no action is high-risk and high-certainty on the snapshot, the confirming chain is aborted and its partial cost is still recorded.
9. **Transaction** (section 11). Lock contact, order and pendings, and re-check. `decideChanges` (pure) re-evaluates certainty on the locked state and decides each action:
   - Urgent actions become problem outcomes with their `SuggestedQuestion`.
   - Applied and doubtful actions go through `applyChatActions`.
   - `diffMessageChanges` (pure) builds the `OrderItemChange` rows and supersedes earlier changes of the same items.

   Then the pendings get their doubts and points, the photo memory advances, `lastRequestAt` is set when the intent is `requests`, and «Pedido #N cambió» is decided from `findLinkNoticeArming`. Order, pendings, outcome, `OrderMessage` and change rows are saved.
10. **After commit.** Await the shadow for at most `min(READER_SHADOW_WAIT_MS, time left)`. The wait is recorded as `shadowWaitMs`; because it holds the chat's queue slot, it also shows in the next message's `queuedMs`, and E1/E2 report it apart. Then build the trace, save it and save the new masked texts. A failure logs `reader_trace_save_failed` and never fails the job. Publish `chat_message_processed` when a notice is due (unchanged).

Errors are the current `ApplyChatMessageError` codes. A stage answer that is still invalid after one in-stage retry is `INVALID_AI_RESPONSE` (permanent, `failed`). `malformed`, `unknown_reference` and `context_too_large` disappear as outcomes. No input exceeds its budget (section 6.8), so a size problem cannot become a retryable error.

### 5.2 Stage operations (orders application ports)

```ts
export type Reading = "primary" | "confirming";
export type ReaderStages = Readonly<{
  readIntent: (input: ReadingInput, reading: Reading, signal: AbortSignal) => Promise<Result<StageResult<IntentReading>, StageError>>;
  extractRequests: (input: ReadingInput, intents: readonly RequestIntent[], reading: Reading, signal: AbortSignal)
    => Promise<Result<StageResult<readonly ExtractedRequest[]>, StageError>>;
  chooseProducts: (mentions: readonly ProductMention[], candidates: readonly ProductForReading[], reading: Reading, signal: AbortSignal)
    => Promise<Result<StageResult<readonly ProductResolution[]>, StageError>>;
  confirms: Readonly<Record<"intent" | "extraction" | "resolution", boolean>>;   // which stages have a confirming configuration
}>;
export type StageResult<T> = Readonly<{ value: T; call: StageCall }>;
export type StageCall = Readonly<{ stage: ReaderStage; reading: Reading; provider: "openai" | "fake"; model: string; promptVersion: string;
  usage: ModelUsage | null; costUsd: number | null; durationMs: number; attempts: 1 | 2 }>;
export type StageError = Readonly<{ code: "AI_PROVIDER_UNAVAILABLE" | "DEADLINE_EXCEEDED" | "INVALID_AI_RESPONSE"; stage: ReaderStage; call: StageCall | null; message: string }>;
export type ReaderStage = "intent" | "extraction" | "resolution";
```

`StageCall` is what the trace stores for each stage. It never carries prompt text. When a stage has no confirming configuration, `reading: "confirming"` reuses the primary result. `orders/composition.ts` builds each port from its own `ReaderStageConfig` (section 12.3).

### 5.3 `undoMessageChanges` (orders, new)

- **Input:** `{ orderId: OrderId; messageId: ChatMessageId }`.
- **Access:** `{ companyId, userId }`, a seller session on web or mobile.
- **Dependencies:** `transaction`, `findOrderForUpdate`, `findChatPendingsForUpdate`, `findMessageChanges(orderId, messageId)` (its rows plus `OrderMessage.pendingsBefore`/`pendingsAfter`), `findLaterChanges(orderId, after)`, `findSellableVariants(variantIds)`, `saveItemChanges`, `saveChatPendings`, `markMessageUndone`, `setVerdicts`, `saveSellerActedAt`, `clock`.
- **Output:** the `OrderAggregate` plus the reloaded `OrderReviewProjection`.
- **Errors:**
  - `ORDER_NOT_FOUND`
  - `MESSAGE_CHANGES_NOT_FOUND`
  - `UNDO_REFUSED`, with `reason: "later_change" | "would_empty" | "not_sold" | "order_moved_on"` (and the variant for `not_sold`)
  - `PERSISTENCE_UNAVAILABLE`
  - `INVALID_STORED_DATA`

Flow:

1. Lock the order. Load its message changes. Lock the pendings of the order's chat.
2. If the message is already undone, return success with the current state. A repeat never undoes twice.
3. Run `undoability` (pure, section 6.4) on the locked lines and pendings. If it refuses, return the error and write nothing.
4. `undoPlan` (pure) builds the writes:
   - Lines: restore each touched line from its `before` snapshot (same copied name, attributes, SKU, unit price, mentioned price, position), and remove the lines the message added.
   - Pendings: for each pending the message touched (the ids that differ between `pendingsBefore` and `pendingsAfter`), restore it with its earlier `lastChangedAt` if it existed before; remove it if the message created it.
   - Then drop restored pendings whose life ended, and apply the 10-pending limit by ending the least recently changed other pending. Pendings the message did not touch are never written.
5. Write the lines and pendings, set `undoneAt`/`undoneById`, set verdict `undone` on each change of the message, and set `Order.sellerActedAt`.
6. Commit.

There is no stock event: an order open for messages has no deducted stock.

### 5.4 Order review (orders, new)

**`loadOrderReview`**

- **Input:** `{ orderId; allRows?: boolean }`. **Access:** seller.
- **Dependencies:** `findOrder`, `findOrderChanges(orderId)` (changes, latest review, message rows), `findChatPendings(chatId)`, `findLatestChatOrder(chatId)`, `findTraceQuotes(messageIds)` (selects only the `quotes` column), `findSellableVariants`.
- **Output:** an `OrderReviewProjection` (section 6.5), built by the pure `reviewProjection`. `messageRows` holds the 5 newest rows with their snapshots plus `moreRows: number`; `allRows: true` returns all of them.
- **Message rows read.** A row is an `OrderMessage` of the order that has change rows or a non-null pending diff. `findOrderChanges` reads the newest 5 such rows by `(companyId, orderId, createdAt)`, plus one `count` for `moreRows`. It reads the `pendingsBefore`/`pendingsAfter` JSON only for those 5 (or for all of them with `?rows=all`). For their undo availability it reads only the changes created after the oldest of the 5. The unreviewed changes and points of the review come from the partial index and the pendings, not from the rows.
- **Errors:** `ORDER_NOT_FOUND`, `PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA`. A missing or expired trace only removes the quotes.

**`confirmOrderReview`**

Input:

```ts
export type ConfirmOrderReviewInput = Readonly<{
  reviewId: OrderReviewId;                 // client UUID, idempotency key
  orderId: OrderId;
  origin: "link" | "detail";
  linkAction: Readonly<{ id: OrderLinkActionId; action: LinkActionKind }> | null;   // mobile records it here; web records on click (5.5)
  loaded: Readonly<{ changesThrough: ChangeSeq; changeIds: readonly OrderItemChangeId[]; points: readonly PointKey[]; itemsRevision: OrderRevision }>;
  corrections: readonly Readonly<{ itemId: OrderItemId; quantity: OrderLineQuantity | 0 }>[];   // 0 = Quitar
}>;
```

- **Dependencies:** `transaction`, `findOrderForUpdate`, `findChatPendingsForUpdate`, `findOrderChanges`, `findReview(reviewId)`, `planItemsEdit`, `writeItemsEdit` and `settleEditStock` (5.6), `setVerdicts`, `saveReview`, `saveLinkAction`, `saveChatPendings`, `saveSellerActedAt`, `clock`.
- **Errors:**
  - `ORDER_NOT_FOUND`
  - `REVIEW_OUTDATED` (`affectedItemIds`, `newPoints`)
  - `ORDER_CHANGED` (another seller saved an edit since loading)
  - `DELIVERY_LOCKED` / `ORDER_CANCELLED` (only when there are corrections)
  - `LAST_ITEM`
  - `VARIANT_NOT_FOUND`
  - `INVALID_INPUT`
  - `PERSISTENCE_UNAVAILABLE`
  - `INVALID_STORED_DATA`

Flow:

1. If a review with `reviewId` exists, rebuild its answer and return it: the review row, the current order, and `changedMeanwhile`, meaning the changes with `changesThrough < seq ≤ confirmedThrough`, read from the marks stored on the review. That is the same set the first answer gave.
2. Lock the order, then the pendings. Then check `findReview(reviewId)` again: a repeat that waited on the first request's lock finds the review now and returns the rebuilt answer as in step 1. A primary-key conflict on the review insert is handled the same way (the transaction rolls back, and the answer is rebuilt in a new read).
3. `reviewDelta` (pure) computes the new changes, those with `seq > loaded.changesThrough` (section 6.5), and the new unacknowledged points. It refuses with `INVALID_INPUT` a `loaded.changeIds` entry that is not a change of the order with `seq ≤ loaded.changesThrough`.
4. If a new change touches a corrected item, or a new change is doubtful, or a new point exists, return `REVIEW_OUTDATED` and write nothing.
5. `loadedItemsRevision(lockedLines, newChanges)` (pure, section 6.5) rebuilds the lines as they were when the review loaded. If their revision differs from `loaded.itemsRevision`, another seller edited the order: return `ORDER_CHANGED` and write nothing.
6. With corrections, check the items locks (`DELIVERY_LOCKED`, `ORDER_CANCELLED`), build the final lines from the locked lines plus the corrections, and, unless they equal the locked lines, call `planItemsEdit`, `writeItemsEdit` and then `settleEditStock` once (5.6). That publishes `order_edited` and `product_stock_increased` in the transaction and gives `stockDue`.
7. Set verdicts on the shown changes, which are exactly `loaded.changeIds` and never a change outside it: `kept`, or `quantity_changed` / `removed` for corrected items, on every unverdicted change of that item. Set `reviewId` on the shown changes. New sure changes (`seq > changesThrough`) are left unreviewed and come back as `changedMeanwhile`.
8. Acknowledge the shown points (`acknowledgedAt`).
9. Save the review (origin, shown points, corrections count, `changesThrough` from `loaded` and `confirmedThrough`, the order's highest `seq` at confirm) and the link action if one was given. Set `Order.sellerActedAt`.
10. Commit.

Output: `{ review, order, changedMeanwhile: readonly ChangeSummary[], total: Money, stockDue }`. `changedMeanwhile` lists the new sure changes, for the «Mientras revisabas…» line.

### 5.5 `recordLinkAction` (orders, new)

- **Input:** `{ id: OrderLinkActionId; orderId; action: "copy" | "share" | "open" }`. **Access:** seller.
- Inserts the row with the user and `takenAt`. A repeated id succeeds without writing. It takes no order lock (accepted window, section 11).
- **Errors:** `ORDER_NOT_FOUND`, `PERSISTENCE_UNAVAILABLE`.
- **Callers:** the web calls it on the click that copies or opens. Mobile calls it after a copy or open, and after a share the system did not report as dismissed; it can also pass the action inside `confirmOrderReview`.

### 5.6 The items step and `editOrder` (orders, modified)

T1 extracts three application functions from `editOrder` into `application/apply-items-edit.ts`. All of them run inside the caller's transaction, on the locked order. They split the code where `editOrder` already splits it today: every part is planned before any part is written, and the stock event comes once, after every part is saved.

**`planItemsEdit(order, lines, deps)`** only reads. It plans and applies the items with `orderEdit.planItems`, `findSellableVariants` and `applyItems`. It computes `returns`, the deducted units of the deleted lines, which must be read before the rows go. It returns `{ order, changes, returns }`.

**`writeItemsEdit(planned, deps)`** writes:

1. Save the lines with `saveItemChanges`.
2. Run `setVerdictsForEdit`. It gives `quantity_changed` or `removed` to every unverdicted change of each item whose quantity changed or that was removed. This clears the item's mark; kept items are untouched.
3. Write `Order.sellerActedAt`.

**`settleEditStock(before, after, { items: boolean; delivery: boolean }, returns, deps)`**: the single stock tail, run once by each caller after all its parts are saved.

1. Publish `order_edited` (`publishStockEvent`, with `returns`) when items changed, or when the delivery changed on an undeducted order.
2. Apply the deducted-order rule: on a deducted order, `failed` or `skipped_locked` rolls the whole edit back.
3. Publish `product_stock_increased` for the returned variants.
4. Describe `stockDue` with `orderWithStockDue`, or `describeOrderStockDue` when no event ran.

**`editOrder`** keeps everything that spans parts, unchanged:

- `pendingParts`, the drop of parts already applied;
- `checkLocks(order, parts)` and `checkCustomerRequired`;
- one revision comparison over every sent part, with `ORDER_CHANGED` listing every changed part;
- the order of the checks and their error payloads.

Its items branch calls `planItemsEdit` where it plans today, and `writeItemsEdit` where it saves today. Customer and delivery stay as they are. It calls `settleEditStock` once, at the end. The test `publishes order_edited once when items and delivery change` (`edit-order.test.ts`) and the rest of `editOrder`'s tests stay green unchanged; that is T1's acceptance criterion 5.

**`confirmOrderReview`** runs only the items part. It does its own checks: `checkLocks(order, {items})` when there are corrections, and the loaded-revision comparison of section 6.5. If the corrected lines equal the locked lines, it skips the write. Otherwise it calls `planItemsEdit`, `writeItemsEdit` and then `settleEditStock` with `{ items: true, delivery: false }`. Without corrections it calls neither, and describes `stockDue` only.

The new public route `PATCH /api/orders/:orderId/items` (mobile) builds `{ orderId, items: { base, lines } }` and calls `editOrder`.

### 5.7 `findOpenQuestions` (orders, new)

- **Input:** `{ messageIds: readonly ChatMessageId[] }`, 1 to 100. **Access:** seller.
- **Reads:** outcomes by primary key for the ids, `ChatMessage` by primary key (for `chatId`), `ChatPendings` by chat primary key (pendings and `lastRequestAt`), and the orders the outcomes name by id (state and `sellerActedAt`). That is four batched primary-key reads.
- **Output:** per message, its open points as `SuggestedQuestion` values. The route renders them in the buyer's language.
- **When a point is open:**
  - A point with a pending is open while the pending is alive.
  - A point without a pending is open while `lastRequestAt` is not after the message's read time, the order's `sellerActedAt` is not after it, and the order is still open for messages.
- **Errors:** `INVALID_INPUT`, `PERSISTENCE_UNAVAILABLE`. A message of another company is absent from the answer.

### 5.8 Traces and masked texts

- **`saveMessageTrace`** (orders infrastructure): upserts the trace by `(companyId, messageId)` and inserts the new `MessageMaskedText` rows (`ON CONFLICT DO NOTHING`), in one statement batch. A reprocess replaces the trace.
- **`deleteExpiredMessageTraces`** (scheduled `delete-expired-message-traces`, hourly at minute 15):
  - The `SECURITY DEFINER` function `companies_with_expired_message_traces(cutoff)` lists the companies that have an expired row in `MessageTrace` or in `MessageMaskedText`, so neither table depends on the other to be cleaned.
  - Each company deletes traces and masked texts with `expiresAt < now()` in batches of `MESSAGE_TRACE_DELETE_BATCH` (500, adjustable), each batch in its own transaction, until a batch comes back short.
  - A failed company is counted and retried on the next run.
  - It always catches up, because nothing caps the number of batches.
- **`readMessageTraces`** (CLI `trace:read --company <uuid> --message <uuid>[,…]`):
  - It reads the reader's token from standard input, without echo when it is a terminal. It resolves the name from `TRACE_READERS` by the token's SHA-256, compared with `timingSafeEqual`. A missing or unknown token is refused before any database read.
  - `trace:reader-token <name>` prints a new random token (32 bytes) and its `name:hash` line, and writes nothing. The founder gives the token to that person and adds the line to the env; removing the line revokes it.
  - In one tenant transaction it inserts `MessageTraceRead { readerName, osUser, messageIds, readAt }` (`osUser` is informative) and reads the traces with their masked texts and the verdicts of the messages' changes.
  - It prints JSON. If the audit insert fails it exits with an error and prints nothing.

### 5.9 Verdicts at completion and cancellation (orders, modified)

`settleUnreviewedChanges(orderId, at)` gives `not_reviewed` to unverdicted changes. These transactions call it:

- `registerPayment`, when `saveCompletion` runs (the payment completes a delivered order);
- `deliverOrder` (`fulfill-order.ts`), when delivering a paid order sets `completedAt`. Both delivery paths go through it: `registerDelivery` and `updateOrderShipping` with `status: "delivered"`. `FulfillOrderDependencies` gains `settleUnreviewedChanges`, and `UpdateOrderShippingDependencies` picks it up from there;
- `cancelOrder`, with `saveCancellation`.

`voidPayment` clears the completion and leaves the verdicts unchanged. `registerImmediateSale` creates orders without chat changes and does not call `deliverOrder`.

The write is one set-based statement: `UPDATE "OrderItemChange" SET verdict = 'not_reviewed', "verdictAt" = $at WHERE "orderId" = $o AND verdict IS NULL`. It also covers superseded rows, which the partial index does not serve, so it uses `(companyId, orderId, createdAt)`.

### 5.10 `reportVerdictLabels` (orders, new)

- **Input:** `{ since: Date; until: Date }`, with `since < until` and a window of at most 366 days (`INVALID_INPUT` otherwise). The function enforces the same bounds. The range filters on `OrderItemChange.createdAt`. **Access:** the CLI `verdicts:report`, with the same reader token as `trace:read`. The read is not audited because it holds no message data. It runs with its own statement timeout (`VERDICT_REPORT_TIMEOUT_MS`, 60 s), not the producers' 3 s, because it is a sequential scan of a table without retention.
- **Dependencies:** `countVerdicts(since, until)`, which reads through the `SECURITY DEFINER` function `message_change_verdict_counts(since, until)`. The function returns rows `(decision, doubt_kind, verdict, count)` over every company. It returns no company ids, order ids or texts.
- **Output:** for each decision, doubt kind and verdict, the count, the label strength and the `unverdicted` count. Strength: strong for `kept` on doubtful, and for `quantity_changed`, `removed` and `undone`; weak for `kept` on applied.
- The eval report embeds the latest output when `EVAL_VERDICTS_FROM` is given. It never turns verdicts into cases with text.

## 6. Domain and typing

### 6.1 Stage configuration (infrastructure)

```ts
export type ReaderStageConfig = Readonly<{
  stage: ReaderStage;
  reading: Reading;
  provider: "openai" | "fake";
  model: string;                // must have a price in modelPrices when provider is openai
  promptVersion: PromptVersion; // key of the stage's version file, e.g. "intent-v1"
  timeoutMs: number;            // READER_STAGE_TIMEOUT_MS, default 10000, adjustable; capped by the reading budget
}>;
export type PromptVersion = string & { readonly __brand: "PromptVersion" };   // parsePromptVersion(stage, value): Result
export type StructuredModel = (request: StructuredModelRequest, signal: AbortSignal) => Promise<Result<StructuredModelAnswer, StageError>>;
```

`StructuredModel` exists only in infrastructure. It has two implementations:

- the OpenAI Responses adapter: strict `json_schema`, `store: false`, `maxRetries: 0`, the caller's `AbortSignal`;
- the fake: `createFakeStructuredModel(answers)`, scripted per stage, refused when `NODE_ENV=production`.

A stage adapter is a prompt version, a JSON schema, a Zod parser and a `StructuredModel`. Each stage keeps its versions in `stages/<stage>/versions.ts`. Each version has a pinned `<stage>.<version>.model-text.json` (instructions, schema, settings, token counts of the reference contexts at their budget), checked by a unit test. Instructions come before the per-message input for prompt caching. Without `OPENAI_API_KEY` and without a fake configuration, `stages` is `null`.

### 6.2 Readings (orders domain, `domain/reader/readings.ts`)

```ts
export type Quote = Readonly<{ source: "current" } | { source: "context"; ref: ContextMessageRef }> & Readonly<{ text: string }>;
export type BuyerLanguage = "es" | "pt";
export type RequestKind = "add" | "remove" | "change_quantity" | "change_variant" | "complete_pending" | "decline"
  | "mention_price" | "ready" | "payment_request" | "not_allowed";
export type NoIntentReason = "greeting" | "thanks" | "question" | "payment_report" | "other";
export type IntentReading =
  | Readonly<{ kind: "requests"; requests: readonly RequestIntent[]; language: BuyerLanguage; addresses: readonly AddressSpan[] }>
  | Readonly<{ kind: "no_intent"; reason: NoIntentReason; language: BuyerLanguage; addresses: readonly AddressSpan[] }>
  | Readonly<{ kind: "unsure"; language: BuyerLanguage; addresses: readonly AddressSpan[] }>;
export type RequestIntent = Readonly<{ id: RequestRef; kind: RequestKind; quote: Quote }>;
export type AddressSpan = Readonly<{ message: "current" | ContextMessageRef; text: string }>;   // only messages marked unmasked

export type TargetReference =
  | Readonly<{ kind: "named"; words: Quote }>
  | Readonly<{ kind: "item"; ref: ItemRef; named: Quote | null }>    // named null = taken from context
  | Readonly<{ kind: "pending"; ref: PendingRef; named: Quote | null }>
  | Readonly<{ kind: "photo_same_message" }>
  | Readonly<{ kind: "photo_just_sent" }>
  | Readonly<{ kind: "context"; basis: "last_photo" | "mentioned_product" | "only_item"; ref: ContextMessageRef | ItemRef }>
  | Readonly<{ kind: "none" }>;
export type ExtractedRequest = Readonly<{
  request: RequestRef; kind: RequestKind; target: TargetReference;
  values: readonly Readonly<{ attributeWords: Quote | null; valueWords: Quote }>[];
  quantity: Readonly<{ value: number; mode: "add" | "set" | "decrease"; quote: Quote }> | null;
  price: Readonly<{ amount: number; currency: "order" | "other"; basis: "unit" | "lot" | "not_explicit"; quote: Quote }> | null;
  changeVerb: Quote | null;
}>;
export type ProductMention = Readonly<{ request: RequestRef; words: Quote; values: ExtractedRequest["values"] }>;
export type ProductResolution =
  | Readonly<{ request: RequestRef; kind: "chosen"; productId: ProductId; values: readonly Readonly<{ attribute: string; value: string; quote: Quote }>[] }>
  | Readonly<{ request: RequestRef; kind: "between"; productIds: readonly ProductId[] }>   // 2 to 4
  | Readonly<{ request: RequestRef; kind: "none" }>;
```

- `Quote` exists because a datum without verified words is dropped. `verifyQuotes(readings, input)` (pure) compares normalized text (case and whitespace) as a substring, with no word lists. A `context` quote is accepted only in targets.
- `TargetReference` replaces the single call's string references. Certainty signal 2 reads its `kind` and `named` directly.
- `ReadingInput` holds the current message (`text`, `kind`), the context messages (`ref`, `direction`, `kind`, `text` truncated to the context cap, `sentAt`, `masked: boolean`), the order lines (`ref`, product, values, quantity), the pendings (`ref`, product or candidates, known values, quantity, doubt), the photo memory, and the photo of this message with its product. It is the input of the three stages; infrastructure renders the prompts from it.

### 6.3 Certainty, risk, agreement and decision (`domain/reader/decision.ts`)

```ts
export type CertaintySignals = Readonly<{
  quotesComplete: boolean;                    // 1. every datum used has verified words
  targetNamed: "named" | "photo_same_message" | "photo_just_sent_set" | "context";   // 2.
  variantChangeVerb: "present" | "absent" | "not_applicable";                        // 3.
  candidates: "single" | "several";           // 4.
}>;
export type ChangeRisk = "low" | "high";
export type Agreement = "agree" | "disagree" | "not_run";
export type ChangeDecision =
  | Readonly<{ kind: "applied" }>
  | Readonly<{ kind: "doubtful"; reason: DoubtReason }>
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "urgent"; problem: ProblemKind; question: SuggestedQuestion | null }>
  | Readonly<{ kind: "silent" }>;
export type DoubtReason =
  | Readonly<{ kind: "variant_changed"; attribute: string; from: string; to: string }>
  | Readonly<{ kind: "quantity_set"; quantity: PositiveInteger }>
  | Readonly<{ kind: "added_by_reference"; quantity: PositiveInteger; quote: QuoteId | null }>
  | Readonly<{ kind: "removed"; product: string }>
  | Readonly<{ kind: "caption_unread" }>
  | Readonly<{ kind: "inherited"; from: DoubtReason }>;
```

- `isHighCertainty(signals)` holds when all four signals hold. `photo_just_sent_set` counts as named only for set wording on what the photo left, while that is unchanged (`photoJustSentOf`).
- `riskOf(action)`:
  - low: adding a named product, completing a pending, changing a pending's quantity or values, a mentioned price, «listo»;
  - high: removing, lowering or setting an item's quantity, changing a variant, adding by reference, any change on an unnamed item.
- `agreementOf(primary, confirming)`: `agree` when the confirming chain resolves to the same action kind, target, variant and quantity; `disagree` otherwise; `not_run` when no confirming chain ran. It does not know which stages had a confirming configuration.
- `decideChange(action, signals, risk, agreement, guards)` implements the product table:
  - high certainty and low risk → applied;
  - high certainty, high risk and `agree` → applied;
  - a single best reading otherwise → doubtful with its reason;
  - no single best reading → urgent, with the mapped problem and question;
  - pending outcomes → pending;
  - no intent → silent.

  The photo-then-variant guard (founder 22/10) is a precondition: a variant-only text never targets an item the last photo is not about.
- `pendingDoubt` rules:
  - A pending change that is not high certainty is applied with a `doubt` on the pending; its `pointSince` is set to the message time and `acknowledgedAt` is cleared.
  - Completing or splitting a doubtful, unacknowledged pending gives each created item an `inherited` mark.
  - Restating the doubted value gives no mark.
  - An acknowledged doubt gives no mark.
- All of these functions are pure and deterministic, and take the locked state as input.

### 6.4 Change records (`domain/message-changes.ts`)

```ts
export type LineSnapshot = Readonly<{ itemId: OrderItemId; variantId: VariantId; productName: string; variantAttributes: VariantAttributes;
  sku: string | null; quantity: PositiveInteger; unitPrice: Money; mentionedPrice: MentionedPrice | null; position: number }>;
export type ChangeSeq = number & { readonly __brand: "ChangeSeq" };   // per-order, assigned under the order lock (6.5)
export type OrderItemChangeKind = "added" | "removed" | "quantity_changed" | "variant_changed" | "mentioned_price_set";
export type ChangeVerdict = "kept" | "quantity_changed" | "removed" | "undone" | "not_reviewed";
export type OrderItemChange = Readonly<{
  id: OrderItemChangeId; orderId: OrderId; messageId: ChatMessageId; position: number; seq: ChangeSeq; kind: OrderItemChangeKind;
  before: LineSnapshot | null; after: LineSnapshot | null;            // null before = added, null after = removed
  decision: Readonly<{ kind: "applied" }> | Readonly<{ kind: "doubtful"; reason: DoubtReason }>;
  quoteId: QuoteId | null; supersededBy: OrderItemChangeId | null; reviewId: OrderReviewId | null;
  verdict: Readonly<{ kind: ChangeVerdict; at: Date }> | null; createdAt: Date;
}>;
export type MessageChanges = Readonly<{ orderId: OrderId; messageId: ChatMessageId; changes: readonly OrderItemChange[];
  pendingsBefore: readonly ChatPending[]; pendingsAfter: readonly ChatPending[]; supersedes: readonly OrderItemChangeId[] }>;
```

- `diffMessageChanges(before, after, decisions, ids, at, nextSeq)` produces one change per touched line, keyed by variant, with consecutive `seq` from `nextSeq` (read under the order lock with the unverdicted changes, as the top-1 of `(companyId, orderId, seq)`). `supersedes` lists the earlier unverdicted changes of the same item, read with `findUnverdictedChanges`. `pendingsBefore`/`pendingsAfter` hold only the pendings whose value differs, by id, between the state before and after the message.
- `isMarked(change, order)` holds when the change is doubtful, has no verdict, is not superseded and not reviewed, and the order is neither cancelled nor completed.
- `undoability(message, lockedLines, lockedPendings, laterChanges, sellable)` returns `available` or `refused` with a reason. Reasons are checked in the product's order:
  1. order moved on: the order is not open for messages;
  2. later change: a touched line differs from its `after` snapshot, a removed variant is back, a later change supersedes one of the message's changes, or a touched pending differs from its `pendingsAfter` value (or exists when the message ended it). The comparison ignores `acknowledgedAt`: acknowledging a point in a review does not change the pending, and the restored pending comes back with its earlier doubt, as the product states;
  3. would empty;
  4. not sold.
- `undoPlan(…)` produces the line and pending writes of 5.3. It only ever writes the pendings the message touched.
- Verdict rules: the first verdict stays, except `undone`, which replaces `kept`, `quantity_changed` and `removed` while the order is open for messages. `not_reviewed` is final.

### 6.5 Review (`domain/order-review.ts`)

```ts
export type PointKey = Readonly<{ pendingId: ChatPendingId; since: Date }>;
export type ReviewPoint = Readonly<{ key: PointKey; kind: "variant_missing" | "not_clear" | "variant_not_available"; product: string | null;
  quantity: PositiveInteger; missing: readonly string[]; doubt: DoubtReason | null; acknowledged: boolean; question: SuggestedQuestion }>;
export type ReviewStatus = Readonly<{ openForMessages: boolean; toReview: boolean; doubtfulCount: number; pointCount: number;
  entry: "link" | "detail" | "none"; hasPreviousReview: boolean }>;
export type OrderReviewProjection = Readonly<{
  status: ReviewStatus;
  doubtful: readonly Readonly<{ change: OrderItemChange; quote: string | null }>[];
  points: readonly ReviewPoint[];
  products: readonly Readonly<{ itemId: OrderItemId; changedSinceLastReview: boolean }>[];
  removedSinceLastReview: readonly LineSnapshot[];
  messageRows: readonly Readonly<{ messageId: ChatMessageId; at: Date; changes: readonly OrderItemChange[];
    undo: Readonly<{ kind: "available" } | { kind: "refused"; reason: UndoRefusal } | { kind: "undone" }> }>[];
  moreRows: number;
  loaded: Readonly<{ changesThrough: ChangeSeq; changeIds: readonly OrderItemChangeId[]; points: readonly PointKey[]; itemsRevision: OrderRevision }>;
}>;
```

- `pointsOfOrder(pendings, order, latestChatOrderId)`: the alive pendings attached to this order (`pending.order.orderId`), plus the orderless alive pendings when this order is the chat's latest order, it is open for messages, and it was created at or after the pending's `lastChangedAt`. This is the same derivation `pendingLife`/`attachOrderless` uses. An older order of the same chat never shows another order's pendings.
- `reviewStatus(order, changes, points)`:
  - Open for messages: `toReview` when there is an unreviewed, unverdicted change, a visible mark or an unacknowledged point; `entry: "link"` for WhatsApp orders.
  - Not open, and not cancelled or completed: `toReview` only with visible marks; `entry: "detail"`.
  - Cancelled or completed: nothing to review; `entry: "none"`.
  - Orders without a chat never review.
- Counts: `doubtfulCount` counts visible marks, removals included. `pointCount` counts unacknowledged points. A doubtful pending counts once, as a point.
- `reviewDelta(loaded, current)` gives the new unreviewed changes and the new unacknowledged points.
- **High-water mark.** Every `OrderItemChange` gets `seq`, a per-order integer assigned under the order lock as the order's previous highest `seq` plus one, in position order, with the unique index `(companyId, orderId, seq)`. All change rows are written under the order lock, so `seq` follows commit order within an order, and a review loaded from a committed snapshot sees exactly the changes with `seq ≤` the highest it read. `reviewProjection` puts that highest `seq` in `loaded.changesThrough` (0 for an order without changes). `loaded.changeIds` stays the shown set: the unreviewed, unverdicted changes the review lists.
- `loadedItemsRevision(lockedLines, newChanges)` rebuilds the lines as they were when the review loaded. `newChanges` is every `OrderItemChange` of the order with `seq > loaded.changesThrough`, whatever its verdict, supersession or undone state. Changes reviewed, verdicted, superseded or undone before the load have a lower `seq` and are never inverted. The new changes are inverted in descending `seq`, from the newest to the oldest:
  - an `added` change removes the line with its `after.itemId`;
  - a `removed` change re-inserts its `before` snapshot (same item id, variant, quantity, prices, position);
  - any other change replaces its `after` line with its `before` snapshot.

  The result's `orderRevisions(...).items` is compared with `loaded.itemsRevision`. Equal means the difference is fully explained by messages; different means a seller edit. A message undone between loading and confirming has restored the lines, so inverting its changes once more gives a difference and `ORDER_CHANGED`. That is safe (the seller reloads) and expected, and it has a test.
- `ChatPending` gains `doubt: { reason: DoubtReason } | null`, `pointSince: Date` (set at creation and whenever a doubt is set) and `acknowledgedAt: Date | null`. A point is acknowledged when `acknowledgedAt >= pointSince`.

### 6.6 Suggested questions and notices

```ts
export type SuggestedQuestion = Readonly<{ language: BuyerLanguage } & (
  | { kind: "which_variant"; product: string; attribute: string; values: readonly string[] }   // values empty when more than 3
  | { kind: "which_product"; products: readonly string[] }                                     // 2 to 4
  | { kind: "variant_unavailable"; product: string; asked: string; attribute: string; values: readonly string[] }
  | { kind: "variant_for_which"; value: string; products: readonly string[] }
  | { kind: "which_item_to_remove"; products: readonly string[] }
  | { kind: "which_product_for_value"; value: string; products: readonly string[] }
  | { kind: "another_of_which" }
  | { kind: "photo_product_name" }
  | { kind: "product_gone"; product: string })>;
```

`suggested-question-texts.ts` (presentation, es and pt) renders them from the product's patterns. It never claims stock.

Notice changes:

- New notice kinds: `payment_request` (bodies from #313) and `order_changed_after_link`.
- Every problem notice can carry `changedAfterLink: true` (body suffix) and its first question (body suffix).
- Precedence follows the product: problems → `order_changed_after_link` → `only_item_kept` → `ready` → `new_order`.
- `caption_not_applied` is no longer a notice; it becomes a doubtful mark.
- `OrderMessage.linkChangeNotice` is set whenever the message's notice is `order_changed_after_link` or carries `changedAfterLink`. Either one closes the cycle.

### 6.7 Trace (`domain/reader/trace.ts`)

```ts
export type MessageTrace = Readonly<{
  companyId: CompanyId; messageId: ChatMessageId; messageReceivedAt: Date; expiresAt: Date;
  startedAt: Date; decidedAt: Date | null; queuedMs: number; shadowWaitMs: number | null;
  textState: "masked" | "withheld";
  contextMessageIds: readonly ChatMessageId[];        // texts live once in MessageMaskedText
  photo: Readonly<{ method: "qr" | "visual" | "none"; result: "matched" | "several" | "not_found" | "not_product" | "failed"; productId: ProductId | null; confidence: number | null;
    usage: ModelUsage | null; costUsd: number | null; durationMs: number }> | null;
  stages: readonly Readonly<{ call: StageCall; input: StageInputSummary; output: unknown | null; errorCode: string | null }>[];
  quotes: readonly Readonly<{ id: QuoteId; text: string }>[];    // masked, at most 80 characters
  decisions: readonly Readonly<{ action: Readonly<{ kind: ResolvedChatAction["kind"]; request: RequestRef; item: ItemRef | null; pending: PendingRef | null; productId: ProductId | null; variantId: VariantId | null }>; signals: CertaintySignals; risk: ChangeRisk; agreement: Agreement; decision: ChangeDecision["kind"] }>[];
  shadow: Readonly<{ answer: "actions" | "no_intent" | "doubt" | "fixed"; actionKinds: readonly string[]; usage: ModelUsage | null; costUsd: number | null }> | null;
  costUsd: number | null;                             // photo + stages; shadow apart
}>;
export type MaskedText = Readonly<{ messageId: ChatMessageId; text: string; expiresAt: Date }>;
```

- `StageInputSummary` holds references and catalog data (refs, product ids and names, candidate ids), never prompt text.
- A stage's stored `output` is masked as a whole by `maskStageOutput` (pure, `masking.ts`). The intent output's `addresses` are replaced by their count per message (`addressSpans: { message, count }[]`), so no span text is stored. Every other string field (quotes, words, values) passes through `maskPersonalData` with every span reported for that message. The stored output therefore has its own type, `StoredStageOutput`, and is not the raw `IntentReading`.
- `shadow` holds only kinds and usage, never the legacy model's raw answer. `decisions[].action` and `photo.result` are closed types (kinds, refs and ids), so no buyer text reaches the trace outside `maskStageOutput`.
- `maskPersonalData(text, addressSpans)` (pure, `domain/reader/masking.ts`):
  - Digit runs of 7 or more digits, with spaces, dots, dashes, parentheses or a leading `+`, keep their first 3 and last 2 digits; the others become `•` («+51 9•• ••• •12»).
  - Each reported address span that is a substring of its message becomes «[dirección]». A span that is not a substring is ignored.
  - A message masked once is never re-masked. Later traces reference it by id, and the intent stage only receives `masked: false` for messages without a stored mask.
- Size: about 3–6 KB per trace on average (stages and quotes, without context texts), plus one `MessageMaskedText` row of 0.5–2 KB per message read or seen as context, in both directions. At 10k messages a day that is about 40–80 MB a day, and 4–7 GB at the 90-day steady state. `findTraceQuotes` selects only `quotes`. If delete bloat appears, a daily partitioned table is the fallback.
- A masked text expires 90 days after its own message. A later trace that references it as context can therefore outlive it by up to 48 hours (the context window). The trace reader then shows «texto vencido» for that context message. This is accepted: extending the mask's expiry would turn every context reference into an update.

| Layer | Types and authority |
| --- | --- |
| Infrastructure (stage adapters) | Model JSON → Zod → `IntentReading`, `ExtractedRequest`, `ProductResolution`. Nothing unvalidated leaves the adapter. |
| Domain | Quotes verified, checks, certainty, risk, agreement, decision, change diff, undo, review status and delta, masking, input budgets. Pure. |
| Application | Orchestration, transactions, after-commit effects. |
| Presentation | Review projection JSON, question and notice texts, routes, CLIs. |

### 6.8 Input budgets (`domain/reader/budgets.ts`)

These bounds are deterministic and apply before any stage call. The rendering is cut in a fixed order and the reading never fails because of size.

| Bound | Initial value (env, adjustable) |
| --- | --- |
| Current text | 2,000 characters (`READER_MAX_TEXT_CHARS`, unchanged; longer → `text_too_long`) |
| Context messages | 12 (`READER_CONTEXT_MESSAGES`), 48 h (`READER_CONTEXT_HOURS`), each cut to 500 characters (`READER_CONTEXT_MESSAGE_CHARS`) |
| Order lines listed | 40 (`READER_MAX_ITEMS`, unchanged; an unlisted item reference gives `unclear_item`) |
| Pendings | 10 (domain constant) |
| Requests per message | 10 (current `maxReaderActions`; the rest give `too_many_actions`) |
| Candidates per mention | 5 (`READER_CANDIDATES_PER_MENTION`) |
| Products rendered in resolution | Name, sellable flag, and per attribute either all its values (when the mention names words for it) or its name and value count. At most 30 values per attribute, then «y N más». |
| Stage input | `READER_STAGE_INPUT_MAX_CHARS` 24,000 characters per rendered input |

Cut order when a rendered input would exceed `READER_STAGE_INPUT_MAX_CHARS`:

1. Drop the oldest context messages.
2. Lower the candidates per mention to 1.
3. Drop the attribute values of products the mention does not name.
4. Fill what is left in a fixed priority (current message, requests and their mentions, order lines newest first, pendings, candidates by search rank) and omit what does not fit. An omitted order line behaves as an unlisted item (`unclear_item`), and a mention whose candidates were all omitted becomes `not_identified`.

The first three cuts are not enough at the domain limits: a product name has 200 characters and up to 3 attributes of 30 values of 30 characters (memory 688aa0fb), so 10 named mentions with one candidate each, plus 40 order lines, can still pass 24,000 characters. Cut 4 makes the bound hold by construction, and its outcomes are permanent decisions, never a retryable error. A character budget is deterministic without a tokenizer; at most about 2 tokens per character in non-Latin scripts (measured: 2,000 characters give 1,001 to 3,969 tokens), it keeps every stage input under about 48k tokens, inside the model window. The pinned `model-text.json` of each version records the token counts of a Latin and a worst-script reference input at the full budget.

### 6.9 Latency and cost budget

| Step | p95 budget | Cost per text message (US$, before caching) |
| --- | --- | --- |
| Context load (one read snapshot) | 0.2 s | — |
| Intent | 1.5 s | ~0.00034 (2.6k in / 150 out) |
| Extraction | 2.0 s | ~0.00047 (3.2k / 300) |
| Confirming extraction (with the primary extraction, high-risk intents only) | 0 s on the common path | ~0.0005 |
| Mention search (one statement) | 0.3 s | — |
| Resolution | 1.5 s | ~0.00035 (2.7k / 150) |
| Confirming resolution, only when the confirming chain finds new mention words | +1.8 s | ~0.00035 |
| Transaction | 0.3 s | — |
| **Total, text message** | **≈ 5.8 s** | **≈ 0.0012** |
| Photo cascade (QR, then visual identification with its chooser), concurrent with intent | +0–0.3 s on photo messages | ~0.001 (photo messages) |

- **Photo messages** have their own p95 row in E1/E2: about 6.1 s by these numbers, because the cascade runs beside the intent stage. The founder's p95 ≤ 6 s is measured over all messages, and E2 reports photo and text messages apart, so a slow photo path shows on its own.
- **Confirming cost** is paid on every message with a high-risk *intent*, including those whose checks then abort the chain, because its input is billed in full when it starts. E1/E2 report the share of messages with a high-risk intent, not of applied high-risk changes.
- **Cost levers**, in order: prompt caching of the fixed instructions (each stage's instructions come first and must reach the provider's 1,024-token cacheable prefix; the pinned `model-text.json` records the prefix size, and a stage under it is padded with its own rules and examples, never with eval inputs), then a cheaper model on resolution.
- **Latency levers**, in order: the intent stage concurrent with the photo cascade (built in), a smaller output limit or lower effort on the slowest stage, a cheaper and faster resolution model, and skipping the confirming resolution when the confirming extraction already disagrees (the action becomes doubtful without it).

## 7. Persistence

Six migrations in T0, generated and reviewed per `.agents/skills/database-migrations/SKILL.md`:

1. `clear_single_reader_chat_state` (SQL-only, `--create-only`). `DELETE FROM "ChatMessageOutcome"; DELETE FROM "ChatPendings";` in development, which has no customers. The rows of `OrderMessage` are kept: its new columns are nullable, and it remains the `already_processed` guard.
2. `add_staged_message_reader` (generated DDL, then edited). New tables and columns. Each new table is created with its RLS in one `BEGIN … COMMIT` with `SET LOCAL lock_timeout`. The column additions are nullable or use constant defaults, so they are metadata-only.
3. `add_order_chat_created_indexes` (SQL-only, as the precedent `20261030230316_add_order_dispatch_queue_index`). After `RESET lock_timeout` and `RESET statement_timeout`, it runs `CREATE INDEX CONCURRENTLY IF NOT EXISTS` for the two indexes on existing tables (`OrderMessage` and `Order`). The file can be re-run. It carries the precedent's recovery note for an `INVALID` build: drop it, `prisma migrate resolve --rolled-back`, deploy again. It has no function body, so `CONCURRENTLY` is allowed (memory c37d7bb2).
4. and 5. `drop_order_message_order_index` and `drop_order_chat_index` (SQL-only). Each file holds one statement only, `DROP INDEX CONCURRENTLY IF EXISTS` for one old index. Prisma wraps a multi-statement file with `DROP INDEX CONCURRENTLY` in a transaction, which fails, so each drop needs its own file (memory 619b9c8c).
6. `add_message_reader_functions` (SQL-only). The `SECURITY DEFINER` functions, `STABLE`, owned by the migration role, with `REVOKE EXECUTE … FROM PUBLIC` and `GRANT EXECUTE` to the app role only.

Every new table has:

- `companyId`, defaulting to `current_setting('app.company_id')`;
- `ENABLE` and `FORCE ROW LEVEL SECURITY`, with a `<table>_company_isolation` policy (USING and WITH CHECK);
- composite foreign keys that include `companyId`.

| Table / column | Definition |
| --- | --- |
| `OrderItemChange` | **Columns:** `id` uuid PK; `companyId`; `orderId` (FK `Order`, cascade); `messageId` (FK `ChatMessage`); `position` int; `kind` enum; `itemId` uuid null (no FK, because edits replace lines); `before` Json null; `after` Json null; `decision` enum (`applied`, `doubtful`); `doubt` Json null; `quoteId` int null; `supersededById` uuid null; `reviewId` uuid null (FK `OrderReview`); `verdict` enum null; `verdictAt` timestamptz null; `createdAt`.<br>**Checks:** `CHECK (before IS NOT NULL OR after IS NOT NULL)`, `CHECK ((decision = 'doubtful') = (doubt IS NOT NULL))`, `CHECK ((verdict IS NULL) = (verdictAt IS NULL))`.<br>**`seq`** int (per order, section 6.5).<br>**Indexes:** unique `(companyId, messageId, orderId, position)`; unique `(companyId, orderId, seq)`; `(companyId, orderId, createdAt)`; partial `(companyId, orderId) WHERE verdict IS NULL AND "supersededById" IS NULL`; `(companyId, reviewId)`. |
| `OrderReview` | `id` uuid PK (client); `companyId`; `orderId` (FK cascade); `reviewedById` (user); `origin` enum (`link`, `detail`); `shownPoints` Json; `correctedItems` int; `changesThrough` int; `confirmedThrough` int (the high-water marks at load and at confirm, so a repeat rebuilds the same `changedMeanwhile`); `confirmedAt`. Index `(companyId, orderId, confirmedAt)`. |
| `OrderLinkAction` | `id` uuid PK (client); `companyId`; `orderId` (FK cascade); `userId`; `action` enum (`copy`, `share`, `open`); `reviewId` uuid null; `takenAt`. Index `(companyId, orderId, takenAt)`. |
| `OrderMessage` (+) | `pendingsBefore` Json null; `pendingsAfter` Json null; `undoneAt` timestamptz null; `undoneById` text null; `linkChangeNotice` boolean default false. Index `(companyId, orderId, createdAt)` **replaces** `(companyId, orderId)`, which is its prefix. Partial index `(companyId, orderId, createdAt) WHERE "linkChangeNotice"` for the arming read. |
| `Order` (+) | `sellerActedAt` timestamptz null: the last items edit, undo or confirmed review. Index `(companyId, chatId, createdAt DESC)` **replaces** `(companyId, chatId)`, so the latest order of a chat is a top-1 read (lists, review, `pointsOfOrder`). |
| `ChatPendings` (+) | `lastIncomingPhoto` Json null (from #313); `lastRequestAt` timestamptz null. The `pendings` JSON gains `doubt`, `pointSince` and `acknowledgedAt` (schema only). |
| `ChatMessageOutcome` | The `outcomes` JSON gains `payment_requested`, `changed_after_link`, `quantity_below_zero`, decisions on problems and `questions: SuggestedQuestion[]` (schema only). |
| `MessageTrace` | PK `(companyId, messageId)` (FK `ChatMessage`, cascade); `messageReceivedAt`; `expiresAt` (index `(companyId, expiresAt)`); `startedAt`; `decidedAt` null; `queuedMs` int; `shadowWaitMs` int null; `textState` enum; `contextMessageIds` uuid[]; `photo` Json null; `stages` Json; `quotes` Json; `decisions` Json; `shadow` Json null; `costUsd` decimal(12,8) null; `createdAt`. |
| `MessageMaskedText` | PK `(companyId, messageId)` (FK `ChatMessage`, cascade); `text`; `expiresAt` (index `(companyId, expiresAt)`); `createdAt`. |
| `MessageTraceRead` | `id` uuid PK; `companyId`; `readerName`; `osUser`; `messageIds` uuid[]; `readAt`. Kept, since it holds no text. |
| Functions | `companies_with_expired_message_traces(p_cutoff timestamptz) RETURNS SETOF uuid`; `message_change_verdict_counts(p_since timestamptz, p_until timestamptz) RETURNS TABLE(decision text, doubt_kind text, verdict text, count bigint)` (counts only). |

- Every JSON column is written and read through a strict Zod schema in its repository. Invalid stored data is `INVALID_STORED_DATA`.
- No index enforces one review per state; the order lock serializes reviews.
- Isolation is verified by one representative integration test on `OrderItemChange`. All new tables follow the same generated pattern, so per-table tests are not written.

## 8. Contracts between applications

All contracts live in `shared/contracts/`, at version 1, and existing ones change in place (no customers). Core validates requests with them and checks its responses before sending. Mobile validates every response.

| File | Schemas | Use |
| --- | --- | --- |
| `order-review.ts` (new) | **`orderReviewResponseSchema`:** the projection of 6.5, with money as strings, ISO dates, `loaded.changesThrough` as a non-negative integer that the client sends back unchanged in `confirmOrderReviewRequestSchema`, change rows with line labels, reasons as structured kinds, quotes and `moreRows`.<br>**Also:** `confirmOrderReviewRequestSchema`, `confirmOrderReviewResponseSchema`.<br>**`orderReviewErrorSchema`:** `REVIEW_OUTDATED` with `affectedItemIds`, `ORDER_CHANGED`, `DELIVERY_LOCKED`, `ORDER_CANCELLED`, `LAST_ITEM`, `VARIANT_NOT_FOUND`. | **`GET /api/orders/:orderId/review[?rows=all]`:** 200, 404, 503.<br>**`POST /api/orders/:orderId/reviews`:** 200; 409 for outdated, changed, locked or cancelled; 422 for last item and variant; 400; 404; 503. |
| `order-message-undo.ts` (new) | `undoMessageResponseSchema` (order and projection), `undoMessageErrorSchema` (`UNDO_REFUSED` with reason) | `POST /api/orders/:orderId/messages/:messageId/undo` (200, 409 refused, 404, 503) |
| `order-link-actions.ts` (new) | `recordLinkActionRequestSchema` `{ version: 1, id, action }` | `POST /api/orders/:orderId/link-actions` (204, 400, 404, 503) |
| `order-items-edit.ts` (new; moved from `orders/presentation/order-edit-schemas.ts`) | `editOrderItemsRequestSchema` `{ version: 1, base, lines }`, `editOrderItemsResponseSchema` (order, revisions, applied, `stockDue`), errors (`ORDER_CHANGED`, `DELIVERY_LOCKED`, `ORDER_CANCELLED`, `VARIANT_NOT_FOUND`, `INVALID_INPUT`) | `PATCH /api/orders/:orderId/items` (200, 409, 422, 400, 404, 503). The web edit schema imports the line and revision schemas from here. |
| `message-questions.ts` (new) | `openQuestionsRequestSchema` `{ version: 1, messageIds }` (1–100), `openQuestionsResponseSchema` `{ version: 1, messages: [{ messageId, points: [{ id, text, about }] }] }` | `POST /api/messages/questions` (200, 400, 503) |
| `orders.ts` (changed) | `orderAggregateSchema` gains `revisions` (the items part) for mobile edits; `orderAggregateSummarySchema` gains `toReview: boolean` | Mobile detail and lists; web lists |
| `seller-notices.ts` (changed) | Notice kinds `payment_request` and `order_changed_after_link` | Payload unchanged: `{ v: 1, companyId, messageId, target }` |

Texts never travel as UI copy, except the suggested questions (text for the buyer, rendered by core in the buyer's language) and catalog names.

## 9. Events and cross-feature integration

- **Events:** none new. `message_created`, `chat_message_processed` and `order_edited` (in transaction) are reused. `settleEditStock` publishes `order_edited` and `product_stock_increased` once per edit or review, for both callers.
- **`chats`:** exposes `findRecentChatMessages(query)` through a new `chats/composition.ts`. The query takes the chat, the anchor time and message id, the limit and the window, and returns direction, type, text, caption, sent time and image id. It reads under the company's RLS on the index `(companyId, chatId, sentAt, id)`. `chats/index.ts` is not extended.
- **`products`:** new `findMentionCandidates(mentions: readonly string[])`, which runs every mention of a message in one transaction and one statement (`searchMentionsByCoverage` in `infrastructure/text-candidates.ts`, beside `coverageQuery`). It returns per mention the product ids, the match count and `unavailableProductIds` (#313), and one `timedOut` flag. The transaction passes `maxWait` so that waiting for a connection counts against the same 1 s budget. `findMessageCandidates(text)` stays for the shadow and photo captions until T17. `identifyProductsInImage` adds `usage` (chooser tokens) to its result, for the trace and the cost.
- **`notifications`:** unchanged. It calls orders' claim, describe and release; describe now renders the new kinds and suffixes.

| Failure window | What happens | Effect for the user |
| --- | --- | --- |
| A stage fails temporarily | The job retries (unchanged policy); every stage reruns | Nothing; later messages of the chat wait |
| Stage answer invalid twice | `failed` outcome and the notice «No pudimos revisar un mensaje» | The seller reads the chat |
| Reading budget exhausted | `DEADLINE_EXCEEDED`, retried | As a temporary failure |
| Crash after commit, before trace | The trace is missing; a re-run is `already_processed` and writes no trace | None; the gap shows as a read message without trace |
| Trace save fails | Logged; the job completes | None |
| Shadow fails, times out or is still running at the wait bound | `shadow: null` in the trace | None |
| Notice publication fails after commit | Unchanged: lost and logged; a re-run publishes an unsent due notice | — |
| Review confirm response lost | The client repeats with the same `reviewId`; the answer is rebuilt | «No sabemos si se guardó. Verificando…», then saved |
| Undo response lost | The client repeats; an already undone message returns success | «No sabemos si se deshizo…», then done |
| Link action not recorded | Retried once, then dropped | «Pedido #N cambió» is not armed for that cycle |

## 10. Mobile

| Layer | File | Change |
| --- | --- | --- |
| infrastructure | `features/orders/infrastructure/order-api.ts` | `editOrderItems` (T3); `loadOrderReview`, `confirmOrderReview`, `undoMessage`, `recordLinkAction` (T15). All validated with the shared schemas and their error codes. |
| infrastructure | `features/whatsapp/infrastructure/message-questions-api.ts` (new, T12) | `findOpenQuestions(messageIds)`. |
| application | `features/orders/application/order-operations.ts` | Operations for the above. Review confirm and undo keep the client UUID across an in-doubt retry. |
| presentation | `order-detail-screen.tsx` | Loads the aggregate and the review in parallel; either failing fails the detail. Edit mode (T3); marks, points, «Cambios por mensajes» (5 rows, **Ver más** loads all), link card variants and **Revisar pedido** (T15). |
| presentation | `order-items-editor.tsx` (new, T3) | Edit-mode rows with `QuantityStepper`, **Quitar**, and the bottom bar «Cambios sin guardar». |
| presentation | `order-review-modal.tsx`, `message-changes-block.tsx`, `review-points.tsx`, `doubt-badge.tsx` (new, T15) | The review modal and its blocks. |
| presentation | `order-history-screen.tsx` | «Por revisar» (T15). |
| presentation | `whatsapp/presentation/conversation-screen.tsx`, `question-box.tsx` (new, T12) | Question boxes under messages. They load for the shown messages' core ids when the chat opens, when a foreground notice for that chat arrives, and when the seller returns to the screen. |
| composition | `features/orders/composition.ts`, `features/whatsapp/composition.ts` | Wiring. |

| Situation | Decision |
| --- | --- |
| Review confirm or undo without an answer | Repeat with the same id until there is a definite answer; the screen shows the in-doubt text. |
| Edit save in doubt | Same as web: re-read the order and compare the items with the draft and the base. |
| Share sheet | A `Share.share` result of `dismissedAction` (iOS) records no link action; any other result is recorded. |
| Questions request fails | No box; retried on the next trigger. Nothing is stored on the phone. |

No local SQLite migration.

## 11. Transactions and concurrency

**Message apply.** The locks are unchanged; there are more reads and writes:

1. Company scope.
2. Lock `Contact`, then re-check the outcome.
3. Lock the open `Order`.
4. Lock `ChatPendings` and run `pendingLife`.
5. Read the order's unverdicted changes (partial index) and `findLinkNoticeArming`. These are plain reads without `FOR UPDATE`: the rows are written only under the order lock, which already serializes their writers.
6. Decide (pure, on the locked state) and apply.
7. Write the order lines; the pendings (with doubts, points, photo memory and `lastRequestAt`); the outcome; `OrderMessage` (with `pendingsBefore/After` and `linkChangeNotice`); the `OrderItemChange` rows; and `supersededById` on earlier changes. The change rows are one `createMany`, and the supersedes one `UPDATE … FROM (VALUES …)`.
8. Commit.

Model calls, searches, the shadow and the trace stay outside the transaction.

- **Arming.** `findLinkNoticeArming` is two indexed single-row reads under the order lock: the latest `OrderLinkAction.takenAt` by `(companyId, orderId, takenAt)` and the latest `OrderMessage.createdAt` with `linkChangeNotice` by the partial index `(companyId, orderId, createdAt) WHERE "linkChangeNotice"`. The order is armed when the first is later than the second. A link action inserted concurrently and committed after the message read it is seen by the next change. This race is accepted: the change still shows in the next review.
- **Undo and review confirm.** Both lock `Order`, then the chat's `ChatPendings`, then check, write and commit. The review confirm also publishes `order_edited` in the transaction through `settleEditStock`. Both take the order before the pendings, as the message apply does, so there is no lock cycle. A message waiting on the order lock applies after the undo or review and reads the new state.
- **`editOrder`** keeps its transaction and its single `order_edited`. The verdict write and `sellerActedAt` are two statements inside `writeItemsEdit`.
- **Order lists (read only).** For each page:
  1. `OrderItemChange` with `orderId = ANY($ids)` on the partial index;
  2. `ChatPendings` with `chatId = ANY($chatIds)`;
  3. the latest order per listed chat, a top-1 per chat on `(companyId, chatId, createdAt DESC)`;
  4. the pure `reviewStatus` per order.

  Lists never read traces or reviews.
- **Duplicates.**
  - Review and link action use client UUIDs; an automatic retry returns what exists.
  - Undo is idempotent through `undoneAt`.
  - A repeated message is `already_processed`.
  - A reprocess replaces the trace.
  - Masked texts insert with `ON CONFLICT DO NOTHING`.
- **Set-based writes under the order lock.** No write is one statement per row or per item:
  - verdicts from an edit or a review: one `UPDATE … WHERE "orderId" = $o AND "itemId" = ANY($ids) AND verdict IS NULL` per verdict kind;
  - `reviewId` on the shown changes: one `UPDATE … WHERE id = ANY($ids)`;
  - `settleUnreviewedChanges` and the undo's `undone`: one `UPDATE` each.

  Writes that include superseded rows are served by `(companyId, orderId, createdAt)`, not the partial index.
- **Timeouts.** Producers keep `lockTimeoutMs` 2000 and `statementTimeoutMs` 3000. The mention search keeps its 1 s budget, which includes the wait for a connection.

## 12. Code organization

### 12.1 Orders (core)

| Path | Content |
| --- | --- |
| `domain/reader/readings.ts`, `quotes.ts`, `budgets.ts` | Reading types, `verifyQuotes`, input budgets and the cut order. |
| `domain/reader/request-checks.ts` | `checkRequests`, producing `ResolvedChatAction[]` with signals. Reuses `resolveVariant`, the mentioned price and the pending transitions. |
| `domain/reader/decision.ts`, `risk.ts`, `agreement.ts`, `pending-doubt.ts` | Certainty, risk, agreement, decision, doubt inheritance. |
| `domain/photo-just-sent.ts` | From #313. |
| `domain/reader/masking.ts`, `trace.ts` | Masking and trace types. |
| `domain/message-changes.ts`, `order-review.ts` | Change records, undo, review status, delta and loaded revision. |
| `domain/seller-notice.ts` | New kinds and precedence. |
| `application/apply-chat-message.ts` | Orchestration (section 5.1). `application/reader/stages.ts` holds the stage ports; `application/reader/load-reading-context.ts` holds the context. |
| `application/apply-items-edit.ts` (`planItemsEdit`, `writeItemsEdit`, `settleEditStock`), `undo-message-changes.ts`, `load-order-review.ts`, `confirm-order-review.ts`, `record-link-action.ts`, `find-open-questions.ts`, `delete-expired-message-traces.ts`, `read-message-traces.ts`, `report-verdict-labels.ts`, `record-failed-chat-message.ts` | Use cases. |
| `infrastructure/reader/runtime/` | `stage-config-env.ts`, `openai-structured-model.ts`, `fake-structured-model.ts`, `prompt-registry.ts` (imports each stage's `versions.ts`), `stage-adapter.ts`. |
| `infrastructure/reader/stages/intent/`, `extraction/`, `resolution/` | `versions.ts`, `<stage>.v1.ts` (instructions, schema), `<stage>-parser.ts`, `<stage>.v1.model-text.json`, `render-<stage>-input.ts`. |
| `infrastructure/message-change-repository.ts`, `order-review-repository.ts`, `link-action-repository.ts`, `message-trace-repository.ts`, `verdict-counts.ts` | Persistence with strict JSON parsers. |
| `presentation/message-undo-routes.ts`, `order-review-routes.ts`, `order-items-routes.ts`, `message-question-routes.ts` | Express routers, mounted in `src/app.ts` with one line each. |
| `presentation/suggested-question-texts.ts`, `review-texts.ts`, `seller-notice-texts.ts` | es and pt texts. |
| `presentation/trace-cli.ts`, `verdicts-cli.ts` | `trace:read` and `verdicts:report` entry points. |
| `composition.ts` | Stage ports from config, the new use cases, and `orders.loadOrderReview` for the web loader. |

### 12.2 Other features and shared

- `chats`: `chats/composition.ts` (new) with `findRecentChatMessages` (query in `infrastructure/chat-repository.ts`).
- `products`: `domain/product-name-key.ts`, `findMentionCandidates` and the unavailable twins in `infrastructure/text-candidates.ts`, and `usage` in the identification result.
- `src/shared/infrastructure/model-prices.ts`.
- `src/composition/scheduled-jobs.ts`: `delete-expired-message-traces`.
- Web:
  - `app/routes/order-detail.tsx`: the loader adds the review projection; actions for undo and review confirm.
  - New: `orders/presentation/order-review-dialog.tsx`, `message-changes-block.tsx`, `review-points.tsx`, `doubt-badge.tsx`.
  - Changed: `order-view.tsx`, `app/components/order-link-card.tsx`, `app/routes/order-list.tsx`.

### 12.3 How a stage's model is replaced

`orders/composition.ts` builds each port with `createStage(readStageConfig(env, stage, reading), registry, clientsByProvider)`. The configuration of one stage changes only that stage's port; the policy, the checks and the other stages are not referenced by it. For example:

- `READER_EXTRACTION_PROVIDER=fake` (tests only);
- `READER_EXTRACTION_MODEL=<model with a price>`.

Adding a second opinion takes a confirming configuration plus the composition line that builds its port, on any stage:

- `READER_EXTRACTION_CONFIRM_MODEL` (exists);
- `READER_RESOLUTION_CONFIRM_MODEL` (a future one).

`agreementOf` and `decideChange` stay as they are.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `reader_stage_completed` | info | stage adapter | `["companyId","messageId","stage","reading","provider","model","promptVersion","inputTokens","cachedTokens","outputTokens","reasoningTokens","costUsd","durationMs","attempts"]` |
| `reader_stage_failed` | warn (retryable) / error | stage adapter | `["companyId","messageId","stage","reading","model","promptVersion","errorCode","durationMs","attempts"]` |
| `reader_stage_retried_invalid_answer` | warn | stage adapter | `["companyId","messageId","stage","reading","promptVersion"]` |
| `reader_input_cut` | debug | context and resolution rendering | `["companyId","messageId","stage","droppedContextMessages","candidatesPerMention","droppedValues"]` |
| `orders_chat_message_applied` (changed) | info | `applyChatMessage` after commit | existing fields minus `contextTruncated` and `readerCalls`, plus `["stageCalls","decisionKinds","doubtfulCount","urgentCount","confirmingRun","contextMessages","queuedMs","decidedMs","costUsd"]` |
| `reader_quote_dropped` | debug | `applyChatMessage` | `["companyId","messageId","requestKind","field"]` |
| `reader_trace_save_failed` | warn | after commit | `["companyId","messageId","errorCode"]` |
| `reader_shadow_failed` | warn | shadow reader | `["companyId","messageId","errorCode","durationMs"]` |
| `order_message_undone` | info | `undoMessageChanges` after commit | `["companyId","orderId","messageId","userId","changeCount","pendingsRestored","pendingsEnded"]` |
| `order_message_undo_refused` | info | route | `["companyId","orderId","messageId","reason"]` |
| `order_review_confirmed` | info | `confirmOrderReview` after commit | `["companyId","orderId","reviewId","userId","origin","shownChanges","doubtfulShown","pointsAcknowledged","correctedItems","changedMeanwhile","linkAction"]` |
| `order_review_outdated` | info | `confirmOrderReview` | `["companyId","orderId","reviewId","affectedItems","newPoints"]` |
| `order_review_conflict` | info | `confirmOrderReview` | `["companyId","orderId","reviewId"]` |
| `order_link_action_recorded` | info | `recordLinkAction` | `["companyId","orderId","userId","action"]` |
| `message_traces_deleted` | info | retention job | `["deletedTraces","deletedTexts","companies","failedCompanies","durationMs"]` |
| `message_trace_read` | info | trace CLI | `["companyId","readerName","osUser","messageCount"]` |
| `message_trace_read_refused` | warn | trace CLI | `["osUser","reason"]` (`missing_token`, `unknown_token`) |
| `verdict_labels_reported` | info | verdicts CLI | `["readerName","osUser","rows"]` |

Never logged: message or caption text, quotes, suggested question text, prompts, model output, buyer names, phones, addresses, WhatsApp IDs, order totals.

## 14. Tests

Section 16 gives the acceptance coverage per product criterion. Its titles are part of this list.

### 14.1 Core unit

Domain (readings, budgets, decision, masking):
- `test("drops an extracted quantity whose quote is not in the current message")`
- `test("accepts a quote that differs from the message only in case and spacing")`
- `test("refuses a context quote as justification for a variant value")`
- `test("cuts the oldest context messages first when a stage input exceeds its budget")`
- `test("renders only the named attributes' values of a resolution candidate")`
- `test("never exceeds the stage input budget at every fixed limit")`
- `test("shares the pair budget across a message's mentions and never exceeds it above the three-word floor")`
- `test("gives every mention one word before any mention gets a second")`
- `test("leaves a mention without words not identified when the catalog allows fewer words than mentions")`
- `test("rates a variant change high only with a change verb, a named item and a single candidate")`
- `test("never rates high a target taken from context, even with two agreeing readings")`
- `test("rates set wording on the photo just sent high while what the photo left is unchanged")`
- `test("rates add wording after the photo just sent at best doubtful")`
- `test("applies a high-certainty low-risk add without a mark")`
- `test("applies a high-certainty high-risk change only when the confirming reading agrees")`
- `test("computes agreement from resolved actions whichever stages had a confirming configuration")`
- `test("marks «la quiero en M» on the only fitting item as doubtful with the variant reason")`
- `test("keeps a variant-only text off an item the last photo is not about and makes it urgent with the which-product question")`
- `test("turns «otro igual» with one product in context into a doubtful add and with two into urgent")`
- `test("turns «quítalo» on the only item into a doubtful removal")`
- `test("decides a payment request as urgent with the open order")`
- `test("decides the same signals to the same decision")`
- `test("applies a doubtful pending quantity change to the pending with its reason")`
- `test("carries a pending's unacknowledged doubt to every item created from it, splits included")`
- `test("gives no inherited mark when the completing message restates the doubted value")`
- `test("gives no inherited mark when a confirmed review acknowledged the pending's doubt")`
- `test("marks the item added from a photo whose caption could not be read")`
- `test("masks a phone keeping its first three and last two digits")`
- `test("masks every reported address span of the current and unmasked context messages")`
- `test("ignores a reported address span that is not in its message")`
- `test("stores no reported address span in the trace's stage outputs, quotes or texts")`
- `test("withholds the current text when the intent stage fails")`

Domain (changes, undo, review):
- `test("records one change per line a message touched with the line before and after")`
- `test("records only the pendings whose value the message changed")`
- `test("supersedes the earlier unverdicted change of an item a later message changed")`
- `test("offers undo for a message whose lines and pendings are as it left them")`
- `test("refuses undo with later_change when the seller edited a line the message touched")`
- `test("refuses undo with later_change when a later message changed a pending the message touched")`
- `test("plans undo leaving untouched a pending a later message created")`
- `test("allows undo when a review only acknowledged a pending the message touched")`
- `test("refuses undo with would_empty when the message created the only item")`
- `test("refuses undo with not_sold when a removed variant was deactivated")`
- `test("refuses undo with order_moved_on once the order has a reported payment")`
- `test("plans undo restoring a removed line at its copied price and position")`
- `test("plans undo restoring a completed pending with its earlier last change and ending the least recently changed one past the limit")`
- `test("keeps the first verdict except undone while the order is open")`
- `test("reports to review on an open WhatsApp order with an unreviewed sure change")`
- `test("reports nothing to review on a paid order whose only unreviewed changes are sure")`
- `test("counts a doubtful pending once as a point until it becomes an item")`
- `test("shows an orderless pending only on the chat's latest open order created after it")`
- `test("never shows another order's pendings on an older order of the same chat")`
- `test("hides marks and review on cancelled and completed orders")`
- `test("finds a review outdated when a new change touches a corrected item")`
- `test("lets a review succeed when new sure changes touch only other items")`
- `test("rebuilds the loaded items revision by inverting added, removed and changed lines")`
- `test("detects a seller edit when the rebuilt revision differs from the loaded one")`
- `test("rebuilds the loaded revision ignoring changes reviewed or verdicted before the load")`
- `test("refuses a shown change id that is newer than the loaded high-water mark")`
- `test("answers a changed order when a message was undone between loading and confirming")`

Notices and questions:
- `test("chooses the payment request notice over «Pedido #N listo»")`
- `test("chooses «Pedido #N cambió» over «Revisa el pedido #N», «listo» and «Pedido nuevo» when armed")`
- `test("appends the changed-after-link sentence to an urgent problem when armed")`
- `test("closes the link cycle with an urgent notice carrying the changed-after-link sentence")`
- `test("appends the first problem's suggested question to the notice body")`
- `test("writes the which-variant question without values when the attribute has more than three")`
- `test("writes the question in Portuguese when the buyer wrote in Portuguese")`
- `test("never writes a question that claims stock")`

Stages and runtime:
- `test("configuring one stage's provider changes only that stage's port")` (T4)
- `test("refuses to start with an unknown prompt version")`
- `test("refuses to start with an OpenAI model that has no price")`
- `test("refuses the fake provider in production")`
- `test("caps a stage's timeout by what is left of the reading budget")`
- `test("does not start a stage with less than two seconds left")`
- `test("retries an invalid stage answer once and then fails with INVALID_AI_RESPONSE")`
- `test("retries a resolution choice outside the candidates once and then leaves the mention not identified")`
- `test("keeps every stage's pinned model text in sync with its prompt version")`
- `test("never copies an eval input into a stage prompt")` (the existing overlap guard, extended by T4 to every registered version)

Use cases with fakes:
- `test("configuring the extraction stage with the fake model leaves intent and resolution on their configured models and yields the same decisions")` (T13: real stage adapters, fake `StructuredModel` on one stage)
- `test("applies a message through the three stages and records its changes and trace")`
- `test("skips extraction and resolution when the intent is no intent")`
- `test("starts the intent stage concurrently with the photo cascade on a captioned photo")`
- `test("skips texts when no stages are configured")`
- `test("starts the confirming extraction together with the primary extraction and aborts it when no action needs it")`
- `test("applies the doubtful changes and notifies only the urgent ones of one message")`
- `test("saves the order even when the trace cannot be saved")`
- `test("stores masked texts once and references them from later traces")`
- `test("stores the shadow reader's kinds in the trace and never applies it")`
- `test("bounds the wait for the shadow after commit")`
- `test("sends «Pedido #N cambió» once per cycle after a recorded link action")`
- `test("sends no «Pedido #N cambió» before any recorded link action")`
- `test("undo writes nothing when refused")`
- `test("confirming a review twice with the same id returns the same answer and one review")`

### 14.2 Core integration (real database)

- `test("the message transaction writes order lines, pendings, outcome, order message and changes together or not at all")`
- `test("change rows of one company are invisible to another company")` (the one representative isolation test)
- `test("recent context messages include both directions within 48 hours, never another chat, and skip messages without sentAt")`
- `test("undo restores lines and the touched pendings and records the undone verdict in one transaction")`
- `test("a message waiting on the order lock applies after an undo and reads the undone order")`
- `test("PATCH items lowers a quantity and removes a line with the edit's revisions and locks")`
- `test("PATCH items answers ORDER_CHANGED when a message changed the items meanwhile")`
- `test("an edit sets the verdict of the edited items' changes, clears their marks and records sellerActedAt")`
- `test("confirming a review with corrections on a deducted order settles the stock difference and serves waiting orders")`
- `test("confirming a review answers REVIEW_OUTDATED and writes nothing when a message added a mark meanwhile")`
- `test("confirming a review answers ORDER_CHANGED when another seller saved an edit meanwhile")`
- `test("confirming a review succeeds when a sure message changed another item meanwhile")`
- `test("a second review succeeds after a first review confirmed earlier changes of the order")`
- `test("a repeated confirmation that waited on the first one's order lock returns the first answer")`
- `test("confirming a review on a shipped order without corrections clears the marks")`
- `test("a payment that completes a delivered order fixes not_reviewed on its unverdicted changes")`
- `test("delivering a paid order fixes not_reviewed on its unverdicted changes")`
- `test("marking a paid order delivered from the shipping update fixes not_reviewed on its unverdicted changes")`
- `test("cancelling an order fixes not_reviewed on its unverdicted changes")`
- `test("voiding the completing payment keeps the not_reviewed verdicts")`
- `test("link actions with a repeated id are stored once")`
- `test("the retention job deletes every expired trace and masked text of every company in one run and keeps younger ones")`
- `test("the trace CLI refuses a reader without a valid token and records every read with the token's reader name")`
- `test("the verdicts report returns counts by decision, doubt kind and verdict without ids or text")`
- `test("the verdicts report refuses a window over 366 days or with since after until")`
- `test("open questions disappear when the pending is completed by a later message")`
- `test("an open question without pending disappears after a later order message of the chat")`
- `test("an open question without pending disappears after an edit, an undo or a review of the order")`
- `test("open questions of another company's message are not returned")`
- `test("GET review returns quotes while the trace exists and only reasons after it is deleted")`
- `test("the order list marks «Por revisar» only on active WhatsApp orders with something to review in a fixed number of queries")`
- `test("candidates include the unavailable twin of an active product")`
- `test("searches every mention of a message in one statement on one connection")`
- `test("a mention search that runs out of budget after waiting for a connection returns a timed-out empty result")`
- `test("a mention search that cannot get a connection within its budget returns a timed-out empty result")`

### 14.3 Mobile

- `test("edit mode lowers a quantity and removes an item and saves them with the base revision")`
- `test("edit mode refuses removing the last item with its message")`
- `test("a shipped order offers no Editar productos")`
- `test("leaving edit mode with changes asks to discard them")`
- `test("link actions, Revisar pedido and Deshacer are disabled with their reason while editing")`
- `test("Copiar enlace on an order with something to review opens the review and copies after confirming")`
- `test("the first link action of an order with only sure changes opens a review with products and total only")`
- `test("the link card hides the URL and shows the count of doubtful changes and points")`
- `test("Deshacer mensaje is disabled while the review has corrections and enabled after Descartar correcciones")`
- `test("a confirmation answered REVIEW_OUTDATED reloads the review keeping corrections on untouched items")`
- `test("a confirmation after a sure message elsewhere copies the link and keeps the mientras revisabas line")`
- `test("a review confirmation without connection keeps corrections and does not copy")`
- `test("a review confirmation in doubt repeats with the same id and runs the link action once saved")`
- `test("a dismissed share is not recorded as a link action")`
- `test("Cambios por mensajes shows the refusal reason instead of Deshacer")`
- `test("Deshacer on a row asks its confirmation listing changes and pendings and marks the row Deshecho")`
- `test("a paid order with a doubtful item offers Revisar pedido with corrections and copies the link directly")`
- `test("a shipped order opens a read-only review with the lock text")`
- `test("a cancelled order shows no marks and no review")`
- `test("the chat view shows a question box with Copiar pregunta under a message with an open point")`
- `test("the chat view shows up to three boxes for a message with several points")`
- `test("the history list shows «Por revisar»")`
- `test("an order without a chat shows no review, marks or Cambios por mensajes")`

### 14.4 Web

Component tests (Vitest, React):
- `test("the review dialog shows doubtful changes, points, products and total in reading order")`
- `test("copy after confirming a review closes the dialog, shows the URL and focuses the copy icon without copying")`
- `test("open after confirming a review focuses the open icon without opening a tab")`
- `test("Cambios por mensajes rows show Deshacer or the refusal reason")`
- `test("undo, Revisar pedido and link icons are aria-disabled while product edits are unsaved")`
- `test("Deshacer mensaje is disabled while the dialog has corrections and enabled after Descartar correcciones")`
- `test("the link card hides the URL and opens the review first from the copy and open icons")`
- `test("a paid order with a doubtful item shows Revisar pedido and the URL")`
- `test("a shipped order's review is read-only with the lock text")`
- `test("a cancelled WhatsApp order shows no marks, no review and no «Por revisar»")`
- `test("a review confirmation without connection keeps corrections and takes no link")`
- `test("the order list shows «Por revisar» next to the checkout label")`
- `test("an order created on web never shows the review, marks or Cambios por mensajes")`
- `test("the review dialog moves focus to its title and announces the mark with its item")`

E2E (happy path): `test("a seller copies the link of a WhatsApp order through the review, corrects a doubtful item and undoes a message")` (`tests/e2e/order-review.spec.ts`).

### 14.5 Eval harness (unit, no model calls)

- `test("aggregates EVAL_REPEATS runs into mean and range per metric")`
- `test("calls a change better only when its range does not overlap the previous one")`
- `test("counts a silent wrong change as an applied change without mark or notice that differs from the expected order")`
- `test("counts an ignored request as a request with no change, mark, point or notice")`
- `test("computes urgent precision and recall and counts «Pedido #N cambió» apart")`
- `test("computes p95 from reading start to decision without queue wait")`
- `test("reports cost per stage and counts photo stages toward the average")`
- `test("runs the whole harness in fake mode with zero model calls")`
- `test("refuses a paid run without EVAL_PAID and prints the estimate")`
- `test("refuses a private folder inside the repository")`
- `test("writes private run summaries with ids and failure types only")`
- `test("every seed-bank id resolves to a committed or private case")`
- `test("embeds verdict label counts with weak labels apart")`

### 14.6 Pending manual checks

- Real WhatsApp on Android and iOS: «la quiero en M» is marked, «confirmo así nomás» gives «Pedido #N listo», «¿cómo te pago?» notifies, the question box copies, and the share sheet dismissal works on iOS.
- A screen reader on the review, on mobile and web: the title is read first, the mark is read with its item, and **Deshacer** names its row.
- The amber contrast of the badge in light and dark.

## 15. Limits and checks during implementation

- Verify that the OpenAI Responses API accepts the three stage schemas in strict mode (enum and union sizes) and the `none` effort for each. Pin the token counts per stage at the full budget.
- Verify that `findMentionCandidates` with short mention words (one or two words) still ranks the named product first. The word cap was tuned for whole messages.
- The confirming reading roughly doubles the extraction cost on messages with a high-risk intent; E1 and E2 measure its share. Starting it with the primary extraction spends that cost even when the checks abort it, and the partial usage is recorded.
- Verify with `EXPLAIN ANALYZE` on the benchmark catalog that `findMentionCandidates` at the full pair budget stays within about 450 ms, and that it ranks each mention's candidates as the single-text search ranks them today. If it does not, the fix is to lower `READER_MENTION_PAIR_BUDGET`; the allocation rule stays.
- Verify with `EXPLAIN` that `findChatOrderTargetForUpdate` (`ORDER BY "createdAt" DESC, number DESC LIMIT 1`) and `findLatestChatOrder` become top-1 reads on `(companyId, chatId, createdAt DESC)`; the `number` tiebreak sorts only rows with an equal `createdAt`.
- Phase 5 (shadow on) runs with `APPLY_CHAT_MESSAGE_CONCURRENCY` 8, because the shadow's legacy search and product load overlap the staged path's connection (section 5.1 step 6). T17 restores 16.
- `OrderItemChange.itemId` has no FK on purpose: `editOrder` keeps the rows of kept variants but deletes removed ones.
- Masked texts depend on the intent model finding addresses (gate answer Q1). A missed address stays readable to audited named readers for up to 90 days.
- A context message's masked text can expire up to 48 hours before a trace that references it; the trace then shows the text as expired (section 6.7).
- Cross-tenant reads: `message_change_verdict_counts` (counts by kind only, window bounded to 366 days) and the two company lookups of the retention jobs (`list_companies_with_expired_catalog_orders`, `companies_with_expired_message_traces`). No other function reads across companies. `core_app` can execute them, so any request path could call them; they return no company data beyond ids (lookups) or counts (verdicts).
- Verify how often mobile sends messages without a timestamp (`sentAt` null). Such messages never appear as context.
- The legacy reader and its env (`AI_READER_MODEL`, `READER_SHADOW_LEGACY`) stay until T17. `READER_MAX_ITEMS` and `READER_MAX_TEXT_CHARS` stay as budgets.
- Deferred with real risk (known limits, accepted by the review gate):
  - **The three-word floor above 33,333 active products.** The search then exceeds the 100,000-pair budget, as today's floor does. Only the 1 s budget bounds it, and a timeout leaves every mention of the message `not_identified` (urgent). Catalogs of that size are not realistic for these sellers today; if one appears, the floor is lowered by configuration.
  - **Confirming-path latency.** A high-risk message whose confirming chain finds new mention words adds about 1.8 s (confirming search and resolution), and no lever removes it. E1/E2 measure it, and the p95 ≤ 6 s gate is checked there.
  - **Missed addresses.** A missed address stays readable to audited named readers for up to 90 days (Q1).
  - **Accepted product risk:** an item removed by mistake whose undo is refused can be added back only from the web, at the current price.

## 16. Implementation plan

- Every task is one worktree and one pull request against `jorgeluis594/lector-de-pedidos-por-mensaje-nueva-arqu`, implemented with the Implementation skill. Task ids are stable names, not order; the waves give the order.
- Each task leaves green the tests it names and runs `scripts/ci.sh --fast jorgeluis594/lector-de-pedidos-por-mensaje-nueva-arqu`, or the full run when it touches persistence.
- Tasks never run paid evals.

### Order and parallelism

```text
Wave 0  T0 Foundation (migrations, types, contracts, model prices)
          │
Wave 1  ├─ T1  Change records, undo, items step (core)
        ├─ T2  Traces, masking, retention, trace CLI
        ├─ T3  Mobile item editing (core route + mobile)
        ├─ T4  Stage runtime (config, clients, registry, overlap guard)
        ├─ T5  Decision policy (pure) + #313 rules
        ├─ T6  Notices and suggested questions
        ├─ T7  Evaluation harness v2
        └─ T18 Reading context (chats composition, budgets, ReadingInput)
          │
Wave 2  ├─ T8  Intent stage            (after T4)
        ├─ T9  Extraction stage        (after T4)
        ├─ T10 Resolution stage        (after T4)
        ├─ T11 Review core, link actions, final verdicts, list status   (after T1)
        ├─ T12 Open questions + mobile question box                     (after T6)
        └─ T19 Verdict labels report                                    (after T1, T2)
          │
Wave 3  ├─ T13 Staged pipeline, shadow and switch-on   (after T1, T2, T5, T6, T8, T9, T10, T11, T18)
        ├─ T14 Web review UI                           (after T1, T11)
        └─ T15 Mobile review UI                        (after T3, T11)
          │
Wave 4  └─ T16 Evals on the staged path                (after T7, T13, T19)

Outside the repository, each paid step approved by the founder:
  H  Frozen holdout (Codex, sol 6.1)          after T7
  E1 Baseline paid run (legacy reader)        after T7
  E2 Phase gate runs (stages)                 after T16
  E3 Holdout close runs                       after T16 and H
  F  Founder's WhatsApp test                  after E3
  T17 Remove legacy reader and shadow         after F, on the integration branch
```

Files with an owner, so that parallel tasks do not collide:

| File | Owner | Others |
| --- | --- | --- |
| `prisma/schema.prisma`, migrations, `shared/contracts/*`, `src/shared/infrastructure/model-prices.ts` | T0 | None after T0 |
| `orders/application/edit-order.ts`, `apply-items-edit.ts` | T1 | T11 calls the three functions without editing them |
| `orders/application/apply-chat-message.ts` | T1 (transaction writes) | T13 in wave 3 |
| `orders/infrastructure/reader/runtime/prompt-registry.ts`, every `stages/<stage>/versions.ts` (created empty), `evals/lib/prompt-overlap.test.ts` | T4 | T8, T9 and T10 each fill only their own `versions.ts` and version files |
| `evals/lib/model-meter.ts`, every other `evals/**` file | T7 | T16 in wave 4 |
| `orders/presentation/order-json.ts` | T3 (`revisions` in the aggregate projection) | T11 (`toReview` in the list projection), in a separate function |
| `apps/mobile/.../order-api.ts`, `order-detail-screen.tsx` | T3 | T15 in wave 3 |
| `chats/composition.ts` (new), `chats/infrastructure/chat-repository.ts` | T18 | — |
| `orders/presentation/trace-reader-token.ts` (stdin read, `TRACE_READERS` parsing, constant-time check) | T2 | T19 imports it without editing it |

Shared files touched in separate hunks:

- `orders/composition.ts`: T1, T2, T3, T11, T12, T13, T18, T19.
- `src/app.ts`: T1, T3, T11, T12, one router line each.
- `apps/core/.env.example`: T2, T4, T10 (`READER_MENTION_PAIR_BUDGET`), T13, T18, T19 (`VERDICT_REPORT_TIMEOUT_MS`).
- `apps/core/package.json` scripts: T2 (`trace:read`, `trace:reader-token`), T19 (`verdicts:report`).
- `orders/application/fulfill-order.ts`, `update-order-shipping.ts`, `register-payment.ts`, `cancel-order.ts`: T11 (one dependency and one call each).
- `src/composition/scheduled-jobs.ts`: T2.

### Acceptance coverage

Every product acceptance criterion has its tasks and at least one test title. A criterion that can only be decided by the model's reading is proven by the decision tests with fake stages and measured by a seed-bank case in E2/E3.

| AC | Tasks | Test titles |
| --- | --- | --- |
| 1 | T5, T13, T14, T15 | «marks «la quiero en M» on the only fitting item…»; «configuring the extraction stage with the fake model…»; web «the review dialog shows doubtful changes…»; mobile «Copiar enlace on an order with something to review…» |
| 2 | T5, T13 | «keeps a variant-only text off an item the last photo is not about…» |
| 3 | T8, T6, E2 | seed-bank family «confirmations read as no intent» (3 of 3 runs); «chooses the payment request notice over «Pedido #N listo»» covers the notice choice |
| 4 | T5, T6, T13, E2 | «decides a payment request as urgent with the open order»; T6 AC 1; seed-bank family «payment questions» |
| 5, 5a, 5b | T5, T13 | «rates set wording on the photo just sent high…»; «rates add wording after the photo just sent…»; «carries a pending's unacknowledged doubt…»; «gives no inherited mark when…» (both) |
| 6 | T5, E2 | `test("keeps a mentioned price in the order's currency on the added item")` (T5); seed-bank family «mentioned prices» |
| 7 | T6, T12, T14, T15 | «appends the first problem's suggested question…»; «the chat view shows a question box…»; web «the review dialog shows doubtful changes, points…» |
| 8 | T6, T8 | «writes the question in Portuguese…» |
| 9 | T6, T12 | `test("one notice for two problems carries the first problem's question")` (T6); «the chat view shows up to three boxes…» |
| 10 | T11, T14, T15 | `test("a review that showed a point acknowledges it and the next link action runs directly")` (T11) |
| 11 | T11, T14, T15 | «the first link action of an order with only sure changes opens a review with products and total only» |
| 12–17 | T1, T14, T15 | the undo domain titles (later change, would empty, not sold, copied price, pending limit); mobile «Deshacer on a row asks its confirmation…»; web «Cambios por mensajes rows show Deshacer or the refusal reason» |
| 18 | T14, T15 | mobile «Deshacer mensaje is disabled while the review has corrections…»; web «Deshacer mensaje is disabled while the dialog has corrections…» |
| 19 | T11, T14, T15 | «a paid order with a doubtful item…» (web and mobile) |
| 20 | T11, T14, T15 | «confirming a review on a shipped order without corrections clears the marks»; «a shipped order opens a read-only review…» |
| 21 | T11, T14, T15 | «hides marks and review on cancelled and completed orders»; «a cancelled … order shows no marks…» |
| 22, 23 | T3 | the mobile edit-mode titles; «PATCH items answers ORDER_CHANGED…» |
| 24 | T3, T15, T14 | mobile «link actions, Revisar pedido and Deshacer are disabled…» (T3 for the link actions, T15 extends it to **Revisar pedido** and **Deshacer**); web «undo, Revisar pedido and link icons are aria-disabled…» |
| 25 | T11, T14, T15 | `test("removing a doubtful item in a review records removed and the next link action runs directly")` (T11) |
| 26 | T11, T15, T14 | «confirming a review answers REVIEW_OUTDATED…»; «a confirmation answered REVIEW_OUTDATED reloads…» |
| 27, 28 | T11, T15, T14 | «confirming a review succeeds when a sure message changed another item meanwhile»; «a confirmation after a sure message elsewhere…»; `test("a sure removal after the last review shows as removed since your last review")` (T11) |
| 29, 29b | T11, T14, T15 | mobile «the link card hides the URL…»; web «the link card hides the URL and opens the review first from the copy and open icons»; «reports nothing to review on a paid order whose only unreviewed changes are sure»; «the order list shows «Por revisar» next to the checkout label»; «the history list shows «Por revisar»» |
| 29a, 30 | T14 | «copy after confirming a review…»; «open after confirming a review…» |
| 29c | T15 | «a dismissed share is not recorded as a link action» |
| 31 | T6, T11, T13 | «sends «Pedido #N cambió» once per cycle…»; «appends the changed-after-link sentence…» |
| 32 | T13 | «sends no «Pedido #N cambió» before any recorded link action» |
| 33 | T14, T15 | «a review confirmation without connection keeps corrections…» (web and mobile) |
| 34 | T11, T14, T15 | web «an order created on web never shows the review…»; mobile «an order without a chat shows no review, marks or Cambios por mensajes» |
| 35 | T14, manual | «the review dialog moves focus to its title…»; 14.6 |
| 36 | T2, T11 | «the retention job deletes every expired trace…»; «GET review returns quotes while the trace exists…» |
| 37 | T2, T13 | «masks a phone…»; «masks every reported address span…»; «stores no reported address span in the trace's stage outputs…»; «the trace CLI refuses a reader without a valid token…» |
| 38 | T1, T3, T11, T19, T16 | the five `not_reviewed` integration titles; «an edit sets the verdict of the edited items' changes…» (the mobile `PATCH` calls the same `editOrder`); «the verdicts report returns counts…»; «embeds verdict label counts with weak labels apart» |
| 38a | T6, T13 | «closes the link cycle with an urgent notice carrying the changed-after-link sentence» |
| 39 | T7, T16, E3 | the harness titles of 14.5 |
| 40 | T4, T13 | «configuring one stage's provider changes only that stage's port»; «configuring the extraction stage with the fake model…» |
| 41 | T13 | «stores the shadow reader's kinds in the trace and never applies it» |
| 42 | T7, H | «writes private run summaries with ids and failure types only»; T7 AC 4 |

### T0. Foundation: schema, domain types, contracts and prices

**Scope:**
- The six migrations of section 7 and the Prisma schema.
- Domain types and strict Zod schemas for stored JSON: `domain/reader/readings.ts`, `domain/reader/trace.ts`, `domain/message-changes.ts` (types only), `domain/order-review.ts` (types only), `DoubtReason`, `ChangeDecision`, `SuggestedQuestion`.
- The `ChatPending` fields `doubt`, `pointSince` and `acknowledgedAt`; `LastIncomingPhoto` (#313).
- Outcome kinds `payment_requested`, `changed_after_link`, `quantity_below_zero`, and the outcome `questions`.
- Stage port types in `application/reader/stages.ts`.
- Every `shared/contracts` file of section 8 (schemas only), with the items edit schemas moved and their imports updated.
- `model-prices.ts`, ported.

**Out of scope:** any behavior, repository, route, prompt or UI.
**Acceptance criteria:**
1. `prisma migrate dev` from an empty database creates the tables with RLS forced, and `expired`/verdict functions not executable by `PUBLIC`.
2. `chatPendingsSchema` parses a pending with `doubt`, `pointSince` and `acknowledgedAt`, and rejects one with an unknown doubt kind.
3. Typecheck and lint pass in core, mobile and shared, and the web edit route still validates with the moved schemas.

**Tests:** schema round-trip unit tests for each stored JSON schema; «change rows of one company are invisible to another company».
**Depends on:** nothing.

### T1. Change records, undo and the items step

**Scope:**
- `diffMessageChanges`, `isMarked`, `undoability`, `undoPlan` and the verdict rules (`domain/message-changes.ts`).
- `message-change-repository.ts`.
- In the current `applyInTransaction`: write `OrderItemChange` rows (decision `applied`), supersedes, and the touched `pendingsBefore/After`.
- `undoMessageChanges` and `POST /api/orders/:orderId/messages/:messageId/undo` (`message-undo-routes.ts`).
- Extract `planItemsEdit`, `writeItemsEdit` (with `setVerdictsForEdit` and `sellerActedAt`) and `settleEditStock` from `editOrder`, keeping its checks that span parts (5.6).
- The `messageRows` part of the projection, as a pure function.

**Out of scope:** doubtful decisions (T13), the review (T11), UI.
**Acceptance criteria:**
1. Order with «Polo básico · M · ×2 · S/ 35.00». A message removes it, and the catalog price becomes S/ 39.00. Undo restores it at S/ 35.00 at its position, and the change verdict is `undone`.
2. A message added «Gorra trucker · Negro · ×2» and a later message set it to ×3. Undo of the first answers `UNDO_REFUSED` `later_change` and nothing changes.
3. A message completed the pending «Polo básico» while the chat held 10 other pendings. Undo removes the item, brings the pending back with its earlier last change and ends the least recently changed other pending.
4. Message A completed P1, then message B created P2. Undo of A restores P1 and leaves P2 as it is.
5. A web edit lowering an item gives that item's unverdicted changes `quantity_changed`. `editOrder`'s existing tests stay green unchanged, including «publishes order_edited once when items and delivery change».

**Tests:** the domain titles of 14.1 for changes and undo; the integration titles for the message transaction, undo, lock ordering and edit verdicts.
**Depends on:** T0.

### T2. Traces, masking, retention and trace reading

**Scope:**
- `maskPersonalData` and `maskStageOutput`.
- `message-trace-repository.ts`: trace upsert, masked texts, quotes-only read, strict JSON.
- The `delete-expired-message-traces` job (hourly; per company until a short batch) and its registration.
- The `trace:read` CLI, with the reader token checked against `TRACE_READERS` (`name:sha256` pairs), the audit row, and `trace:reader-token`. It shows the verdicts of the messages' changes.
- `MESSAGE_TRACE_RETENTION_DAYS`, `MESSAGE_TRACE_DELETE_BATCH` and `TRACE_READERS` in `.env.example`.

**Out of scope:** building a trace from a reading (T13).
**Acceptance criteria:**
1. «llámame al +51 987 654 312» is stored as «llámame al +51 9•• ••• •12».
2. Company A has 1,200 traces that expired yesterday and company B has one that expires tomorrow. One job run deletes all 1,200 and keeps B's.
3. With no token or an unknown token on standard input, `trace:read` prints nothing, reads nothing from the database and exits non-zero. With Ana's token, it prints the trace, and a `MessageTraceRead` row with `readerName` «Ana» exists, even though the OS user is `node` for every reader.

**Tests:** the masking unit titles; the retention and CLI integration titles.
**Depends on:** T0.

### T3. Mobile item editing

**Scope:**
- `PATCH /api/orders/:orderId/items` (`order-items-routes.ts`), calling `editOrder`.
- `revisions` in the aggregate projection.
- Mobile: `editOrderItems`, `order-items-editor.tsx`, and edit mode in `order-detail-screen.tsx`, with the web edit's texts and its conflict, lock and in-doubt behavior.
- The last-item guard, the discard confirmation, and link actions disabled while editing.

**Out of scope:** adding products or changing variants on mobile; the review and undo UI (T15).
**Acceptance criteria:**
1. Mobile lowers «Polo básico» from ×3 to ×2 and removes the gorra. **Guardar cambios** updates the totals.
2. A message changes the items meanwhile: «Este pedido cambió mientras lo editabas…» shows and the edits stay.
3. A shipped order offers no **Editar productos**. On the last item, **Quitar** is disabled with «El pedido necesita al menos un producto…».

**Tests:** the mobile edit-mode titles of 14.3; the two PATCH integration titles.
**Depends on:** T0.

### T4. Stage runtime

**Scope:**
- `ReaderStageConfig` from env, for the three stages and their confirming readings.
- `openai-structured-model.ts` and `fake-structured-model.ts`.
- `prompt-registry.ts`, plus an empty `versions.ts` per stage.
- `stage-adapter.ts`: in-stage retry, timeout capped by the reading budget, `StageCall` with cost from `priceOf`, logs.
- `createStage` in composition, not yet wired into `applyChatMessage`.
- The overlap guard extended to every registered version.

**Out of scope:** stage prompts (T8–T10).
**Acceptance criteria:**
1. With `READER_EXTRACTION_PROVIDER=fake` and a scripted answer, the extraction port returns it and the intent port still calls its OpenAI client (asserted with one fake client per provider).
2. `READER_INTENT_PROMPT=intent-v9` fails startup, naming the stage and the version.

**Tests:** the runtime titles of 14.1.
**Depends on:** T0.

### T5. Decision policy and #313 rules

**Scope:**
- `verifyQuotes`, `checkRequests`, certainty, `riskOf`, `agreementOf`, `decideChange`, `pending-doubt.ts` and the photo-then-variant guard.
- Ported: `photo-just-sent.ts`, `changePendingQuantity`, `fillPaymentRequests` and the new `ResolvedChatAction` kinds.
- The mapping of every current outcome to its decision (the product table «Every current outcome»).

**Out of scope:** I/O, prompts, notice texts.
**Acceptance criteria:**
1. Product acceptance criteria 1, 2, 4, 5, 5a, 5b and 6, built from hand-made readings, resolve to the decision and doubt reason the product states.
2. A table-driven test covers every row of «Every current outcome under the new decisions».

**Tests:** the decision and reading domain titles of 14.1, and «keeps a mentioned price in the order's currency on the added item».
**Depends on:** T0.

### T6. Notices and suggested questions

**Scope:**
- The kinds and precedence of `chooseSellerNotice`.
- `describe-chat-message-notice.ts`, with the question and changed-after-link suffixes.
- `seller-notice-texts.ts`: the payment request bodies from #313 and «Pedido #N cambió».
- `suggested-question-texts.ts`, es and pt.
- `caption_not_applied` stops being a notice.

**Out of scope:** deciding when a question applies (T5); the chat box (T12).
**Acceptance criteria:**
1. A payment request on open order #1023 renders «Revisa el chat» / «Un cliente quiere pagar el pedido #1023.», and in pt «Veja o chat» / «Um cliente quer pagar o pedido #1023.».
2. «quiero el polo básico» with sizes S, M and L renders a body ending in «¿En qué talla quieres el Polo básico: S, M o L?»; in pt, «Em qual tamanho você quer o Polo básico: S, M ou L?».
3. An armed «listo» with pendings renders the urgent body ending in «El pedido cambió después de enviar el enlace.».

**Tests:** the notices and questions titles of 14.1, and «one notice for two problems carries the first problem's question».
**Depends on:** T0.

### T7. Evaluation harness v2

**Scope:**
- **Case schema:** per-stage expectations (intent kind, extracted fields, chosen product) and decisions (applied, doubtful, pending, urgent, silent, notice). The current cases are relabelled.
- **`EVAL_REPEATS`, changed in place:** default 3. It runs the whole selected set N times, scores every run and reports mean, min and max per metric. `EVAL_REPEAT_TAGS` is removed, and flips are reported from the runs.
- **`eval:compare <a> <b>`.**
- **Metrics:**
  - intent, fields, resolution and decision;
  - silent wrong changes and ignored requests;
  - urgent share with precision and recall, with «Pedido #N cambió» counted apart;
  - cost mean per stage, photo included;
  - p95 without queue time.
- **Fake mode** (`EVAL_MODELS=fake`): scripted stage answers taken from the case expectations, at zero cost.
- **Paid gate:** `EVAL_PAID=1` in `run-evals.sh`, which first prints an estimate (cases × runs × reference cost, plus the judge).
- **Seed bank** (`cases/seed-bank.ts`): the ids from the PR #313 comment (11 frozen-test, 17 dev, and the 17 holdout v4 by id only), plus new dev cases for the 4 families.
- **Ported #313 pieces** (3.2); private summaries with ids and failure types only.
- **Verdict counts** embedded via `EVAL_VERDICTS_FROM`.

**Out of scope:** pointing the suites at the staged pipeline (T16); any paid run.
**Acceptance criteria:**
1. `EVAL_MODELS=fake pnpm --dir apps/core eval` completes with 0 model calls and a report with mean and range for every metric over 3 runs.
2. `pnpm --dir apps/core eval` without `EVAL_PAID=1` prints the estimate and exits without calling a model.
3. `eval:compare` on two reports whose silent-wrong-change ranges overlap prints «not distinguishable» for that metric.
4. No `hv4-*` text exists in the repository, and `seed-bank.test.ts` resolves every committed id.

**Tests:** the titles of 14.5.
**Depends on:** T0.

### T18. Reading context

**Scope:**
- `chats/composition.ts` with `findRecentChatMessages` (query on `(companyId, chatId, sentAt, id)`).
- The latest photo outcome within the window.
- The masked-text lookup by message ids.
- `loadReadingContext`.
- `ReadingInput` building with refs, and the budgets and cut order of section 6.8 (`domain/reader/budgets.ts`).
- The `READER_CONTEXT_*` and `READER_STAGE_INPUT_MAX_CHARS` env.

**Out of scope:** stage calls; candidate rendering for resolution (T10 uses the budgets).
**Acceptance criteria:**
1. A chat with 20 messages over 3 days gives, for a new message, the 12 newest within 48 h in both directions, each cut to 500 characters, and none from another chat.
2. A context whose rendering exceeds the budget drops its oldest messages first and stays under the budget.

**Tests:** «recent context messages include both directions…»; the budget unit titles of 14.1.
**Depends on:** T0.

### T8. Intent stage

**Scope:**
- `intent.v1`: instructions, JSON schema, the parser to `IntentReading`, and the input rendering (messages with direction, refs and `masked` flag; order; pendings; photo).
- Address spans for unmasked messages, the buyer language, and the pinned model text.
- Rules for «listo»; confirmations after the seller listed the order; payment request versus payment-method question; payment report; embedded instructions; unsure.

**Out of scope:** extracting data.
**Acceptance criteria:**
1. The pinned model text test passes, and the overlap guard finds no eval input in the prompt.
2. The parser rejects an answer with an unknown request kind and accepts every `RequestKind`.

**Tests:** the parser and snapshot unit tests; the overlap title.
**Depends on:** T4.

### T9. Extraction stage and confirming reading

**Scope:**
- `extraction.v1` and `extraction_confirm.v1`: different phrasing of the same rules, same schema.
- The parser to `ExtractedRequest[]`.
- Quotes for every datum; targets (named, item, pending, photo same message, photo just sent, context); add/set/decrease; price basis and currency; change verb.

**Out of scope:** catalog values.
**Acceptance criteria:**
1. Both versions have pinned model texts and pass the overlap guard.
2. The parser drops nothing itself (dropping is `verifyQuotes`' job) and rejects quantities that are not numbers.

**Tests:** parser and snapshot unit tests.
**Depends on:** T4.

### T10. Resolution stage, candidates and photo usage

**Scope:**
- `resolution.v1`: choose among labelled candidates rendered with the budgets of 6.8; map buyer words to catalog values with quotes; `between` for 2–4 candidates.
- The parser, with the retry on an outside-candidates choice.
- Ported `product-name-key.ts` and the unavailable twins in `text-candidates.ts`.
- `findMentionCandidates` (products): one transaction and one statement for all of a message's mentions, with the per-statement pair budget, `allocateMentionWords`, `maxWait` and the remaining `statement_timeout` inside the 1 s budget, and a timed-out empty result instead of an error.
- `READER_MENTION_PAIR_BUDGET` in `.env.example`.
- `assembleCandidates`: a pure merge of searched, photo, item and pending products, at most `READER_CANDIDATES_PER_MENTION` per mention.
- `usage` in `identifyProductsInImage`'s result.

**Out of scope:** the decision on `between` (T5).
**Acceptance criteria:**
1. A choice label not among the candidates triggers one retry and then `none`.
2. `findMentionCandidates(["casaca jean"])` returns the deactivated «Casaca jean» as unavailable when an active product has the same name key.
3. A visual identification reports the chooser's tokens.
4. Ten mentions are searched with one connection and one statement; when no connection frees within the budget the result is timed out and empty, not an error.
5. On a catalog of 10,000 active products, a 10-mention message searches 10 words in total, one per mention, and never more than 100,000 pairs.

**Tests:** the resolution titles of 14.1; «candidates include the unavailable twin of an active product»; the two mention-search integration titles.
**Depends on:** T4.

### T11. Review core, link actions, final verdicts and list status

**Scope:**
- `reviewStatus`, `pointsOfOrder`, `reviewDelta`, `loadedItemsRevision` and `reviewProjection`.
- The use cases `loadOrderReview`, `confirmOrderReview` (calling `planItemsEdit`, `writeItemsEdit` and `settleEditStock`) and `recordLinkAction`.
- `order-review-routes.ts`: GET review, POST reviews, POST link-actions.
- `toReview` in order lists through the batched read of section 11.
- `orders.loadOrderReview` for the web loader.
- `settleUnreviewedChanges` in `registerPayment`, `deliverOrder` (so `registerDelivery` and `updateOrderShipping`) and `cancelOrder`.
- The `findLinkNoticeArming` repository function.

**Out of scope:** UI; decisions in the reader.
**Acceptance criteria:**
1. Order #1023 has a doubtful item. GET review shows it under doubtful with its reason. A POST reviews that removes it succeeds: the item is gone and its verdict is `removed`. A second GET reports nothing to review.
2. A message adds a doubtful mark between GET and POST. POST answers `REVIEW_OUTDATED` and writes nothing.
3. Another seller saves an edit between GET and POST. POST answers `ORDER_CHANGED`. A sure message on another item instead lets POST succeed, with `changedMeanwhile`.
4. On a shipped order, POST without corrections clears the marks; with a correction it answers `DELIVERY_LOCKED`.
5. The same `reviewId` posted twice returns the same answer and leaves one review row.

**Tests:** the review domain and integration titles of 14.1 and 14.2, and the T11 titles of the acceptance coverage.
**Depends on:** T0, T1.

### T12. Open questions and the chat question box

**Scope:**
- `findOpenQuestions` (primary-key reads) and `POST /api/messages/questions`, which renders the questions.
- Mobile: `message-questions-api.ts`, `question-box.tsx`, the conversation screen loading, and «Pregunta copiada».

**Out of scope:** producing questions (T13 stores them).
**Acceptance criteria:**
1. A message with an open «Falta la variante» point shows «Pregúntale al cliente:» with the question and **Copiar pregunta**, also when the chat is opened later.
2. After a later message completes the pending, the box disappears on the next load.
3. After the seller edits the order, a pending-less question box disappears on the next load.

**Tests:** the open-question integration titles, which seed outcomes, pendings and `lastRequestAt` directly because T13 writes them later; the chat view mobile titles.
**Depends on:** T0, T6.

### T19. Verdict labels report

**Scope:** `reportVerdictLabels`, `verdict-counts.ts` (reads the `SECURITY DEFINER` aggregate), and the `verdicts:report` CLI with the reader token, the bounded window, its own statement timeout and strong/weak labels.
**Out of scope:** turning verdicts into eval cases.
**Acceptance criteria:**
1. With changes across two companies (doubtful kept, applied kept, removed, undone, not reviewed), the report prints per-kind counts. Applied kept is listed as weak; no id or text appears.

**Tests:** «the verdicts report returns counts by decision, doubt kind and verdict without ids or text».
**Depends on:** T0, T1, T2 (the reader-token check).

### T13. Staged pipeline, shadow and switch-on

**Scope:**
- The `applyChatMessage` orchestration of 5.1, with the real stages and `loadReadingContext`.
- The one-statement mention search, and the confirming chain started with the primary extraction.
- Decisions in the transaction; doubtful changes; pending doubts and points; `lastRequestAt`; questions in outcomes.
- «Pedido #N cambió» arming and `linkChangeNotice`.
- The photo memory and `record-failed-chat-message.ts`.
- Trace and masked-text building and saving; the shadow started in parallel and its bounded wait.
- Env (`READER_READING_BUDGET_MS`, `READER_SHADOW_*`, stage defaults); `stages: null` without a key.

**Out of scope:** removing the legacy reader (T17).
**Acceptance criteria:**
1. With fake stages scripted for «la quiero en M» on «Polera gris · L · ×1»: the order shows M with a doubtful change «talla de L a M», no notice is sent, and the trace has three stage calls.
2. With fake stages for «¿cómo te pago?» on #1023: no change, and a payment request notice is due.
3. With a recorded link action, a sure add sends `order_changed_after_link`, and a second message before a review sends nothing for that reason.
4. A trace save failure still commits the order.
5. The decision-5 test passes with real stage adapters and a fake model on the extraction stage only.

**Tests:** the use-case titles of 14.1 and the message-transaction integration titles.
**Depends on:** T1, T2, T5, T6, T8, T9, T10, T11 (link actions and `findLinkNoticeArming`), T18.

### T14. Web review UI

**Scope:**
- The loader with the projection, and the review dialog.
- Link card variants: hidden URL, counts, focus moved to the icon after confirming, link action recorded on click.
- Badges, reasons and quotes; «Por resolver» points; «Cambios por mensajes» with **Deshacer** and its confirmation (5 rows, **Ver más**); **Revisar pedido** on orders that are not open for messages.
- Disabled states while edits are unsaved; the offline and in-doubt states; the list label «Por revisar».
- es and pt texts; the E2E spec.

**Out of scope:** mobile.
**Acceptance criteria:** product acceptance criteria 1, 7, 10–21, 24–29, 29a, 29b, 30, 33, 34 and 35 on web, as mapped in «Acceptance coverage».
**Tests:** the web titles of 14.4 and the E2E title. Doubtful changes and points exist only once T13 lands, so these tests and the E2E seed `OrderItemChange` rows and `ChatPendings` directly, as T12 does. Wave 3 UI therefore does not wait on T13.
**Depends on:** T1, T11.

### T15. Mobile review UI

**Scope:**
- The review modal; link card variants and the «mientras revisabas» status line.
- Badges; points with **Copiar pregunta**; «Cambios por mensajes» with **Deshacer** (5 rows, **Ver más**).
- **Revisar pedido** on orders that are not open for messages; the list label.
- The share-dismissal rule; in-doubt repeats; the aggregate and review requests in parallel.

**Out of scope:** web.
**Acceptance criteria:** product acceptance criteria 1, 7, 10–21, 24 (for **Revisar pedido** and **Deshacer**), 25–29, 29b, 29c, 33 and 34 on mobile, as mapped in «Acceptance coverage».
**Tests:** the mobile titles of 14.3 for review, undo and lists, on API fakes that return doubtful rows and points.
**Depends on:** T3, T11.

### T16. Evals on the staged path

**Scope:**
- The `interpretation`, `end-to-end` and `conversation` suites run the staged `applyChatMessage`.
- Per-stage scoring reads the returned reading trace.
- The shadow is off in evals.
- A legacy baseline is selectable (`EVAL_READER=legacy|staged`) for E1 comparisons.
- Verdict counts are embedded from T19.

**Out of scope:** paid runs.
**Acceptance criteria:**
1. `EVAL_MODELS=fake EVAL_READER=staged pnpm --dir apps/core eval` reports every per-stage metric with zero model calls.
2. The same command with `EVAL_READER=legacy` runs the current reader path.

**Tests:** the harness titles of 14.5 stay green; a fake-mode run per suite.
**Depends on:** T7, T13, T19.

### T17. Remove the legacy reader and its shadow

**Scope:** delete `read-chat-message.ts`, `openai-chat-reader.ts`, `chat-reader-*.ts`, the single-call parts of `chat-reading.ts`, the shadow code and its env (`AI_READER_MODEL`, `READER_MAX_PRODUCTS`, `READER_SHADOW_LEGACY`, `READER_SHADOW_WAIT_MS`), the trace's `shadow` field, and `EVAL_READER=legacy`. This is done on the integration branch, before the final pull request.
**Out of scope:** behavior changes.
**Acceptance criteria:** no import of the removed files remains, and all suites are green.
**Depends on:** F (the founder's test passed).

### Coordinator and outside steps (no pull request, no repository change)

Each paid step needs a separate approval from the founder. Before asking, the coordinator states what will run and the estimate the harness printed. A re-run beyond what was approved needs a new approval.

- **H. Frozen holdout.** A Codex agent with sol 6.1, which never reads or edits prompts, writes `catalog.json` and `cases.json` in the committed schema into a private folder outside the repository (`EVAL_PRIVATE_DIR`). It is paid, so it needs the founder's approval. It runs only to close a phase. Its texts never reach the repository, pull requests, Todoist or reports.
- **E1. Baseline.** `EVAL_PAID=1 EVAL_READER=legacy` over the seed bank and the regression splits, 3 runs. Phase 1 measures cost and p95.
- **E2. Phase gates.** `EVAL_PAID=1 EVAL_READER=staged` over the seed bank, 3 runs:
  - phase 2: 0 «confirmo» or payment requests read as no intent, in 3 of 3 runs;
  - phase 3: resolution reported apart, cost ≤ US$0.0015 and p95 ≤ 6 s.
- **E3. Holdout close.** The frozen holdout, 3 runs: 0 silent wrong changes, and urgent ≤ 10 % with 100 % recall.

### Final verification

- **F.** The founder's real WhatsApp test on a build of the integration branch, with the shadow on. Pass: 0 silent wrong changes, 0 «confirmo» or payment requests ignored, urgent ≤ 10 %. The shadow's results are compared in the traces. T17 follows.
- The manual checks of 14.6.
- On merge to `main`, this draft and the product draft are promoted into `docs/message-to-order.md`, `docs/orders.md`, `docs/order-view.md`, `docs/checkout.md`, `docs/notifications.md` and `docs/image-product-search.md`, and then deleted (Documentation skill). Results go in the pull request description.

## 17. Questions decided by the review gate

| Question | Answer | Who decided | Reason | Discarded |
| --- | --- | --- | --- | --- |
| Q1. Masking addresses in traces | Model-reported address spans plus the digit rule for phones. A span that is not a substring of its message is ignored. Texts are withheld when the intent stage fails. Masked texts are stored once per message (`MessageMaskedText`), so the intent stage only reports spans for messages without a stored mask. | Both reviewers (design and performance) | Follows the "understanding is the model's" founder rule and keeps traces self-contained, as founder decision 3 requires. Storing masks once bounds output tokens, latency and trace size. | Storing no texts and showing unmasked addresses from `ChatMessage` (contradicts decision 3); context only as ids (loses the context the product asks for) |
| Q2. When a suggested question without a pending leaves the chat view | When a later message of the chat is read with order intent, or the seller edits, undoes or reviews the order, or the order stops being open for messages. Backed by the stored `ChatPendings.lastRequestAt` and `Order.sellerActedAt`. | Both reviewers | The buyer's next order message is the natural end and needs no model call; constant-time lookup | Only when the seller acts or the order closes (leaves answered questions on screen) |
| Q3. When the legacy reader is removed | T17, on the integration branch, after the founder's test on a build of it. `main` never ships two readers. | Both reviewers | Keeps the task within one integration branch and one final pull request. Avoids double model spend and two code paths in production. | Removing it after merging to `main`, with the shadow in production |
| Q4. Paid evaluation runs E1, E2, E3 and H | The founder approves each paid step separately, with the harness's printed estimate. A re-run beyond what was approved needs a new approval. | Coordinator (the design reviewer proposed per-step approval; the performance reviewer proposed one capped envelope) | More conservative, and matches the founder's standing rule to confirm before spending paid API credits | The coordinator running steps alone; one capped envelope for E1–E3 |

### Gate findings not applied as proposed

- **Design S6(c), no isolation test per table:** applied by keeping exactly one representative isolation test (on `OrderItemChange`). It is the only cross-company proof for the new tables, and they all share the generated pattern.
- **Design S7, `OrderReview.result`:** applied. The repeat answer is rebuilt, and the column is removed.
- **Design B5, verdicts read "under tenant isolation":** applied as one aggregate through a `SECURITY DEFINER` function instead of per-company RLS reads. The labels are only useful across companies, and the function returns counts by kind only, with no company id, order id or text. Its window is bounded, and section 15 lists it as a cross-tenant read. The retention company lookup follows the implemented catalog-retention precedent (`list_companies_with_expired_catalog_orders`, migration `20261017051040`), not a listing from the `user` table: expired traces are found by the table that holds them.
- **One pull request per phase (Todoist «Un PR por fase»):** replaced by one integration branch with one pull request per plan task and one final pull request to `main`. Founder decision of 31/10, recorded in the product draft («First-version scope»). The final pull request states it.
- **Performance B1(a), budget in tokens:** applied in characters. A character budget is deterministic without bringing `gpt-tokenizer` to runtime, and section 6.8 bounds its token equivalent with the measured worst script.
- **Performance S11, snapshots only for undoable or marked rows:** not applied. The 5-row limit with **Ver más** already bounds the payload, and the product's «Cambios por mensajes» rows need the snapshots to show what each message did even when its undo is refused.

## Decided unless objected

- The reader stays in `orders` under `reader/` subfolders. `chats` exposes the context capability through a new `chats/composition.ts`, without extending `index.ts`.
- Model stages:
  - Three model stages: intent, extraction and resolution.
  - A confirming chain runs only for high-risk intents, starts together with the primary extraction, and is aborted when not needed.
  - All mentions of a message are searched in one statement on one connection. The pair budget is per statement (`READER_MENTION_PAIR_BUDGET` 100,000) and is shared round-robin over the mentions, one word each first. A mention left without a word is `not_identified`. The 1 s budget includes the wait for a connection, and running out of it gives a timed-out, empty result, never a retryable error.
  - `gpt-6-luna` with effort `none` on all stages, adjustable per stage.
- Stage ports and configuration:
  - Stage ports are named by intention and take a `reading`.
  - One infrastructure `StructuredModel`, with OpenAI and fake implementations.
  - Per-stage env `READER_<STAGE>[_CONFIRM]_PROVIDER/_MODEL/_PROMPT`; startup fails on unknown versions and unpriced models.
  - `Agreement` is stage-independent, so a second opinion on any stage is configuration only.
- Time budget: each stage's timeout is capped by a 60 s reading budget under the 85 s deadline, and a stage does not start with less than 2 s left.
- Input bounds: products reach the reading only through searches on the extracted words, the photo, the items and the pendings. Deterministic input budgets apply (section 6.8), with a fixed cut order and no size failure. `READER_MAX_PRODUCTS` disappears; `READER_MAX_ITEMS` and `READER_MAX_TEXT_CHARS` stay as budgets.
- A datum whose quote is not a substring of the current message is dropped. Only targets may come from context.
- Context: 12 messages within 48 h by `sentAt`, in both directions, each cut to 500 characters, plus the latest photo outcome in that window.
- The decision policy is evaluated inside the transaction, on the locked state.
- Schema:
  - New tables: `OrderItemChange`, `OrderReview`, `OrderLinkAction`, `MessageTrace`, `MessageMaskedText`, `MessageTraceRead`.
  - New columns: `OrderMessage`, `ChatPendings` and `Order` (`sellerActedAt`).
  - Six migrations: the data delete, the DDL, the index builds on existing tables (`CONCURRENTLY`, re-runnable), one single-statement drop per replaced index, and the `SECURITY DEFINER` functions with `PUBLIC` revoked. The index migration replaces `OrderMessage (companyId, orderId)` and `Order (companyId, chatId)` with their `createdAt` extensions.
  - Writes under the order lock are set-based. Unverdicted changes are read without `FOR UPDATE`.
  - Only development outcomes and pendings are deleted.
- Reviews:
  - `planItemsEdit`/`writeItemsEdit` are the single items step and `settleEditStock` the single stock tail for `editOrder` and `confirmOrderReview`, run once per edit after all parts. The checks that span parts stay in `editOrder`.
  - A review confirms exactly the change ids and points it showed.
  - A new mark, a new point, or a change on a corrected item gives `REVIEW_OUTDATED`.
  - A seller edit is detected by rebuilding the loaded revision from the changes newer than the review's server-issued high-water mark (`loaded.changesThrough`, the per-order `seq`), and gives `ORDER_CHANGED`. Verdicts and `reviewId` go only to the shown `changeIds`.
  - Client UUIDs make reviews and link actions idempotent; repeat answers are rebuilt. The review's repeat check runs again under the order lock.
- «Pedido #N cambió»: armed by a link action newer than the last message that closed a cycle. «Pedido #N cambió» and an urgent notice with the changed-after-link suffix both close it. The race with a concurrent link action is accepted.
- Undo restores, one by one, the lines and the pendings the message touched. It is refused when any of them changed later (acknowledging a point in a review is not a change). It moves no stock.
- `not_reviewed` is written by `registerPayment`, `deliverOrder` (both delivery paths: `registerDelivery` and `updateOrderShipping`) and `cancelOrder`, and never changes after.
- Mobile edits through a new `PATCH /api/orders/:orderId/items` calling `editOrder`. The items edit contract moves to `shared/contracts`.
- Suggested questions are structured in the use case and rendered by core presentation in the buyer's language. The chat view asks core for the open questions of the messages it shows, with primary-key reads only.
- Order lists compute `toReview` with one batched read per page and never read traces or reviews.
- Traces:
  - Written after commit, best effort; masked texts stored once.
  - Deleted hourly past 90 days, per company, until caught up.
  - Read only through `trace:read`, inside the container, by a person holding a token whose hash is in `TRACE_READERS`. Every read is audited under the token's reader name.
  - Stored stage outputs are masked as a whole: address spans are kept only as counts.
- Seller verdicts are evaluation labels through `verdicts:report` (counts only, strong and weak apart), embedded in the eval report.
- Shadow: the legacy reader starts in parallel when the reading starts. Only its kinds and usage go to the trace, its cost is reported apart, and its wait after commit is bounded.
- Evals:
  - `EVAL_REPEATS` is changed in place: N full runs, mean and range.
  - Changes are compared by non-overlapping ranges.
  - Fake mode at zero cost.
  - `EVAL_PAID=1` with a printed estimate is required for any model call.
  - Private runs report only ids and failure types.
- #313 pieces are ported file by file, as listed in 3.2. Nothing is merged from the branch.
