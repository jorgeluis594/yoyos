# AI evals

Evals measure how well orders from chat messages end right (order and seller notice) with the real models
(docs/message-to-order.md, docs/image-product-search.md). They use
[vitest-evals](https://github.com/getsentry/vitest-evals) on top of Vitest and run fully local: each run writes one JSON report
to `apps/core/eval-results/` (gitignored) and nothing is sent to an eval service.

## Run

```sh
pnpm --dir apps/core eval                          # every suite
pnpm --dir apps/core eval evals/interpretation.eval.ts
EVAL_MAX_CASES=10 pnpm --dir apps/core eval        # a cheap debug run spread over every pass
```

`pnpm eval` runs `scripts/run-evals.sh`: with both keys it starts the `db_test` database, migrates it like the integration
tests and points `DATABASE_URL` at it (`CORE_TEST_PORT` picks the port). Without a key the model suites skip with a message
and only `smoke.eval.ts` runs. It refuses to run when `CI` is set, and it is not part of `test:unit`, integration or e2e.
`VITEST_EVALS_REPORT_LEVEL=info` adds tool calls and timings per case; `pnpm exec vitest-evals serve` browses runs locally.

## Settings (`apps/core/.env`, see `.env.example`)

| Variable | Use |
| --- | --- |
| `OPENAI_API_KEY` | The system under test: the message reading and the vision chooser. Plus the `AI_*`, `PRODUCT_MATCH*`, `TEXT_MATCH_*` and `*_MIN_CONFIDENCE` settings the app reads. |
| `CLAUDE_API_KEY` | Claude as judge and error classifier (and paraphrase generator, offline). Passed explicitly to the client; never logged. |
| `EVAL_CLAUDE_MODEL` | Claude model, default `claude-sonnet-5-5`. |
| `EVAL_MAX_CASES` | Hard cap of cases per run, taken round-robin over the passes; unset runs all. |
| `EVAL_CASES` | Comma-separated case ids; a base id also selects its paraphrases. |
| `EVAL_REPEATS` | Runs of each repeated case (default 3; 1 turns the repeats off). |
| `EVAL_REPEAT_TAGS` | Comma-separated tags whose cases are repeated (default `consistency`; `consistency,pinned-miss` also repeats the pinned misses; `all` repeats every case). The first run is the one every gate counts; flips are reported apart. |
| `EVAL_PRIVATE_DIR` | Absolute path of a folder outside the repository with a private `catalog.json` and `cases.json` (see «Private files format»). Set it in the shell. |
| `EVAL_SKIP_PARAPHRASES` | `1` runs base cases only. |
| `EVAL_SPLIT` | `dev`, `test` or `all` (default): the split of the cases to run (see «Dev and test splits»). With `dev` and no `EVAL_PRIVATE_DIR`, records also keep the reader's raw answer and the invalid action reasons (see «Report»). |
| `EVAL_IMAGES_DIR` | Photo folder with its `manifest.json`, relative to `apps/core` (default `evals/fixtures/images`). |
| `EVAL_LOCAL_IMAGES_DIR` | Local, gitignored folder of real captures with its own manifest, merged at run time (default `evals/fixtures/images-local`). Never commit real captures. |

The local image embedder needs its model files: `pnpm --dir apps/core models:fetch`.

## Cost

Every model eval calls OpenAI and, for judged cases and the failure grouping, Anthropic; both are billed to the keys' accounts.
The run summary prints the number of model calls by the system and to Claude, tokens and an estimated cost per model. Prices
of the system's models come from `src/shared/infrastructure/model-prices.ts`, the one table production reads too, and Claude's are constants
in `lib/model-meter.ts` with the date they were checked; a model without a price is reported as unknown, never as free. Run evals on purpose, never in a loop.

## What runs and what is faked

All data is synthetic: a Peruvian fashion catalog (`fixtures/catalog.ts`: polos, gorras, poleras, near-duplicate names, two
products without photos, PEN prices, Talla/Color variants), Peruvian-Spanish chat texts in the cases, and generated phone-style
photos listed in `fixtures/images/manifest.json` (fields and sources in `fixtures/images/README.md`), plus any real captures in the
gitignored `fixtures/images-local/`. Each suite seeds that catalog
into the test database; the photo suites also index its catalog photos with the real embedder. Without a manifest the image
suite skips with a message and the end-to-end suite runs only its text cases.

| Suite | Pass | Production path |
| --- | --- | --- |
| `interpretation.eval.ts` | Interpretation and arguments (criteria 1, 4) | `applyChatMessage` with the real reader (one model call per message), candidate search, checks and order transaction. The photo's identification is given by the case (visual match 0.95, QR label or «not a product») so only the reading is measured. |
| `identification-image.eval.ts` | Non-product photos and visual identification (criteria 2, 5) | `identifyProductsInImage`: real QR reader, local embedding search and vision chooser. |
| `end-to-end.eval.ts` | The whole message | `applyChatMessage` with the real photo cascade, reader and order transaction. |
| `conversation.eval.ts` | Conversations | One chat with 2 to 4 messages applied in order, with events between them, on a simulated clock. |

Faked: image storage (fixture files instead of R2). Nothing publishes events, so no notice reaches WhatsApp or push. An open
order is seeded by sending QR label photos through `applyChatMessage` (deterministic, no model call). A case or conversation may
also start with chat pendings (saved through the real repository) and with the order closed (paid in full, as `confirm_payment`);
a seeded line of an inactive product or variant is seeded while active, then deactivated. `evals/lib/production-seeding.integration.test.ts`
seeds each start and checks what the reader would see, with no model call (`sh scripts/run-tests.sh integration evals`). Retryable failures are
retried up to three attempts, like the queue would.

## Cases

`cases/*.ts` are TypeScript tables validated with Zod (`cases/schema.ts`) when loaded. Image cases are not written by hand: each
manifest photo outside `catalog/` is one case, expected to be found (`match`; `label` also by the color of the QR variant), not
identified (`no_match`) or not a product (`not_product`), with its `scenario` as kind. `catalog/` photos are what the seller
uploads: they are indexed and never used as queries, since they would match their own embedding; the first photo of each answer and the first worn photo are tagged `consistency`. End-to-end cases pick
their photo from the manifest by product, folder and a hint (`photo({ folder: "customer", productKey: "polo-basico", hint: "worn" })`)
and are left out when no photo matches. A case has an id, pass, criterion
(1 reading, 2 non-product photos, 4 arguments, 5 visual identification), kind, tags, the
input (text, or photo plus caption, and the open order) and one or more acceptable expectations. Tags: `consistency` and `pinned-miss` (run
`EVAL_REPEATS` times when `EVAL_REPEAT_TAGS` names them; the report lists cases whose result flipped), `injection` (prompt injection attempts), `paraphrase`, and
`known-limitation` (beyond the documented design, such as a synonym that shares no letters with the product name: reported apart
and left out of every score).

To add a case, append it to the table of its pass and run `pnpm --dir apps/core test:unit` (the case tables are parsed there).
State only what must happen: an omitted `order` means the open order stays as it was; an omitted `outcomes` or `notice` leaves
that field unscored (conversation steps always state the notice; `null` means silent). Mark a case `ambiguous` with the reason when a reasonable reader could accept another answer.

`cases/paraphrases.ts` holds Peruvian-chat rewrites of the message cases, generated once by
`pnpm exec tsx evals/scripts/generate-paraphrases.ts` with Claude, reviewed by hand and committed. Evals never regenerate them,
so runs stay comparable. Conversations are not paraphrased. Prompt injection cases are not paraphrased.

## Dev and test splits

Every case belongs to the `dev` or the frozen `test` split (`cases/split.ts`): a stable SHA-256 hash of its base id puts about 30%
of the base cases in `test`, and a paraphrase follows its base case. Adding or removing a case never moves another one. Tune
prompts and rules on `EVAL_SPLIT=dev` (with `EVAL_CASES` and tags for subsets) and read `test` only after tuning, case by case
never while tuning. A full run (`all`) is read per split with `EVAL_SPLIT=dev pnpm exec tsx evals/scripts/rebuild-report.ts
eval-results/<run>.json`, which writes `<run>.dev.json` and leaves the run as it is (the classifier's cost stays in the run).
`cases/holdout-v1.ts` is the first holdout, used once to judge T16: it is now an ordinary table, split like the others; its
`probe` rows target risks beyond the design and are reported under `tag:probe`.

## Pinned misses

`cases/pinned-misses.ts` lists the 28 suite misses of the Todoist task (19 in dev, 9 in test) and `casesOf` tags them `pinned-miss`
(paraphrases by their own id). `txt-gorra-two-candidates` and `txt-polera-two-candidates` are **not applicable**: they were text-identification
cases of the text pass, which no longer exists, so they have no message, order or notice and carry no case. Cases relabeled from the
rules sheet cite their rule in the `ambiguous` note or in a comment above the case.

## Conversation cases

A conversation case is `{ id, pass: "conversation", kind, tags, steps }` with 2 to 4 message steps and any number of event steps.
A message step is `{ input, expected, expectsRepeatNotice? }`: `input` is a text, or a photo identified by the case (`shows`) plus
a caption, with no seeded order, because the earlier messages of the conversation are the order: they are applied for real and each
message is scored against the order they left. `expected` is `{ notice, order?, outcomes? }`; `notice` is the kind of the one notice
the message sends (`chooseSellerNotice(outcomes)?.kind`) or `null` when the message must be silent. `expectsRepeatNotice: true`
marks a step the rules sheet expects to repeat the notice of an earlier step for the same product.

`cases/conversations.ts` is written from the rules sheet by someone who does not tune. Its `kind` is the family: `photo-then-size`,
`text-then-size`, `partial-completion`, `replacement`, `decline`, `two-pendings`, `doubtful-then-choice`, `caption-completes-pending`,
`caption-repeat-notice`, `pending-after-payment`, `orderless-pending-after-payment`, `ready-with-pending`, `pending-expiry` and
`product-unavailable`; each required family has a conversation in dev and one in test (`cases/conversations.test.ts`).

Event steps act on the chat's latest order through the production use cases, at the conversation's simulated time:
`advance_days` (moves the clock; nothing else happens), `cancel_order`, `report_payment`, `confirm_payment`, `void_payment` and
`deactivate_product` (deactivates every variant of a catalog product, photos or no attributes included).

- `report_payment` is the buyer's flow. A report requires a confirmed checkout, so it saves the buyer's data and confirms the checkout
  first. A confirmed checkout closes the order for messages for good, so use it for cases where the order must stay closed.
- `confirm_payment` confirms the payment the last `report_payment` made. With no report it registers a payment the seller received by
  hand, which needs no checkout. `confirm_payment` with `partial: true` registers half the order total: the order is not paid and no
  stock is deducted, which is what lets a later `void_payment` **reopen the order** for messages (product criterion 41: a message,
  `confirm_payment` partial, `void_payment`, `advance_days`, a message). A full payment, or any stock deduction, closes it for good.
- `void_payment` voids the confirmed payment. After a `report_payment` alone it confirms that payment first, at the same instant,
  then voids it (a reported payment cannot be voided directly).

Every step happens a minute after the previous one, so messages keep their order. Nothing publishes events, so a cancellation does
not restore stock. A conversation's split is the hash of its id. Each message leaves one record, `<conversation id>#<number>`, with the conversation id.

## Scoring

Notice kind, outcomes (as a multiset), product, variant, quantity and mentioned price are exact matches; every message also checks
that unit prices are the catalog prices. A case passes when it matches one acceptable expectation. A doubt is always a notice, so no
outcome stands in for `no_intent` when the reader is unsure. Claude judges only message cases with several acceptable expectations or marked `ambiguous`, with a `{pass, score,
reason}` verdict; for an `ambiguous` case the judge's pass also counts. Price integrity can never be overruled by the judge.
The cases state the shipped design (`payment_request`, `order_closed`); the fallback that may ship instead never decides a gate by case
alternatives but by a scoring rule (`lib/shipped-expectations.ts`), which reads `shippedReaderFeatures` of
`src/features/orders/infrastructure/shipped-reader-features.ts` and rewrites what every message case and conversation step expects before
matching, repository tables and private folders alike. With `paymentRequest` off, an expected notice `payment_request` becomes `not_applied`
and an expected outcome `payment_requested` becomes `request_not_allowed`. With `closedOrderLine` off, an expectation whose notice is
`order_closed` also accepts notice `not_applied` with the same order and its outcomes unstated. The alternative lives inside the exact matcher
only: whether the judge looks at a case is decided from the case as written, so the rule adds no judge call. The report header says which
variant was scored.
Besides pass or fail, each message is counted for the acceptance gate of the product draft:

- **Ignored action**: something the buyer asked for (a change, «listo» or a pending) that produced neither its effect nor any notice
  for the message, counted per action. A removal applied with «listo» lost and no notice is one. With outcomes stated, each asked
  outcome the message lacks counts; without, each expected order line the order lacks, and an expected notice that never came.
- **Wrong silent change**: the order is wrong and the message sent no notice.
- **Extra notice**: a notice on a message expected silent (`notice: null`); the gate is its share of the silent messages.
- **Two notices for one product**: in a conversation, the same product named by the notices of two messages, unless the later one has
  `expectsRepeatNotice`.

## Report

`eval-results/<run>.json` holds `report` and every case `record` (input, expected, actual, fields, judge verdict, the visual-search
certainties with their gate, the counts above, latency, retries, model calls with cached and reasoning tokens). Every record says whether it
is a photo case (a run from before this field rebuilds with an empty photo partition: all its messages count as without photo). In a dev-split run that is not private (diagnostics on), a record also keeps `readerAnswer`, the reader's raw answer
before validation, and `invalidReasons`, the reasons of the `invalid_action` outcomes; in a test-split, all-split or private run both are `null`. The report has:

- **The gate**, over the first run of each scored message, whole, without photo cases (`gate.withoutPhoto`), for photo cases only
  (`gate.photo`) and per family (`kind`): right count and percentage, ignored actions, conversations with two notices for one product,
  wrong silent changes, extra notices as a share of the messages expected silent. A photo case is a message with a photo; a conversation
  with a photo in any step counts all its records as photo case (`photoCase` of the record);
  Repeated runs (see `EVAL_REPEAT_TAGS`) never count toward it; cases whose repeats gave another result are listed as flips apart;
- **consistency**: of the repeated cases, how many gave one result (one signature) in every run, whole and per family;
- **tag metrics** (`tagMetrics`), counts without case ids: silent adds on messages tagged `question-caption`, payment requests that ended
  inside a several-problems count, and the notices by kind (`noticesByKind`, `none` for a silent message); the header carries the
  `shippedReaderFeatures` scored;
- the cost per scored message against the US$0.003 target (a reported target, not a gate) with input, cached, output and reasoning
  tokens, the p95 latency per message, and the model calls per message kind (text, photo, photo with caption) against what the
  design allows (the reader and the vision chooser are not told apart);
- a `pinned-miss` section: for each case tagged `pinned-miss`, the ignored actions of each repetition;
- accuracy overall and per pass, criterion, kind, tag and scored field; the end-to-end pass split into photo and text messages;
  known limitations listed apart;
- calibration of the visual search at its production gate (`visual`, `visual_none`, `shows_product`), graded by the model's own pick
  (`lib/picks.ts`). Reading a message has no certainty gate, so there is nothing else to calibrate;
- prompt injection outcomes, judge rescues and disagreements;
- p50/p95 latency of the scored model step only (no chat creation or retried attempts; retries are counted apart), model calls,
  tokens and estimated cost per model and role;
- Claude's grouping of the failed cases by cause, from the records: hypotheses, not verified causes.

`pnpm --dir apps/core eval:report eval-results/<run>.json [...]` rebuilds a saved run's report from its records with no model call
(`lib/rebuild.ts`): messages are rescored under the current rules, the visual calibration regraded and current `known-limitation`
tags applied; Claude's error groups and cost are kept. The first rebuild keeps the original file as `<run>.orig.json`.

## Private runs

With `EVAL_PRIVATE_DIR` set, only the private cases of each pass run, against a second eval company seeded with the private catalog
(its ids are separate from the committed company's). Its catalog counts as searchable once it has active products. Records, the
judge's and the classifier's output and the report go under `<dir>/runs/` and nowhere else. The test names are «case N», the
vitest-evals report carries scores only, and stdout prints the aggregate gate lines (whole run, without photo cases, photo cases and per
family), consistency, silent adds on question captions, payment requests inside a count, notices by kind, cost and latency: no case id, case
text, product or judge reason. Photos described in text run and are reported apart as photo cases; photo files are not available in a private
run. Before a run, `pnpm exec tsx evals/scripts/check-private.ts <dir>` validates the two files with the loader and prints counts (cases per
pass, photo cases): no model call and no case text.

## Private files format

This section is the only part of the README meant for whoever writes private files. It lists field names, types and allowed
values; the files are validated with the same schemas as the committed tables.

`catalog.json` is an object with one field, `products`: a non-empty list of products. A product has
`key` (string of lowercase letters, digits and hyphens, unique in the file), `name` (non-empty string), `active` (boolean, default
true) and `variants` (non-empty list). A variant has `attributes` (an object whose names and values are strings; it may be empty),
`price` (positive number, in soles) and `active` (boolean, default true). Inactive products and variants exist but cannot be sold.

`cases.json` is a list of cases with unique `id`s (lowercase letters, digits and hyphens). Every case has `id`, `pass`, `kind`
(non-empty string naming the family the gate reports) and `tags` (list of strings, default empty). `pass` is `interpretation`,
`end_to_end` or `conversation`.

- A message case (`interpretation`, `end_to_end`) has `criterion` (integer 1 to 5), `input` and `expected` (a non-empty list of
  acceptable expectations), and optionally `ambiguous` (a string). `input` has either `text` or `photo`, plus `caption` only with a
  photo, and the chat's starting state before the message, all optional: `order` (the open order: a list of order lines, default
  empty), `pendings` (a list of pendings, default empty) and `orderState` (only `"closed"`). A `photo` is `{ shows }` with a product
  `key` of the catalog, `not_product` or `not_found` (the photo is described as matched to nothing; no label), plus optional `label` with a
  product `key` (an attributes object: the photo is a printed label of that variant).
- A conversation has `steps`: a list with 2 to 4 message steps and any number of event steps. Next to `steps` it may have the same
  starting state, applied before the first step: `order`, `pendings` and `orderState` (same fields and values as in a message
  case's `input`). A message step has `input` (as above, with no `order`, `pendings` or `orderState`), `expected` and optionally
  `expectsRepeatNotice` (only `true`). An event step has `event`, one of `advance_days` (with
  `days`, integer 1 to 60), `cancel_order`, `report_payment`, `confirm_payment` (optionally with `partial`, only `true`), `void_payment` and `deactivate_product` (with
  `product`, a product `key`).
- An order line has `product` (a product `key`), `variant` (an attributes object that matches exactly one variant of that product, in
  any attribute order; `{}` for a product whose variant has no attributes), and `quantity` (integer 1 to 99). A seeded order line
  may name an inactive product or variant of `catalog.json`: the line is seeded as if it were active and then the product or variant
  is inactive again, so the chat starts with an order holding an item that is no longer sold. A catalog variant that is `active`
  but whose product is `active: false` counts as inactive too. An expected order line adds `mentionedPrice`: `null`, or `{ amount, units }` (positive number, integer of at least 1).
- A pending (an item of `pendings`, at most 10) is one of two shapes, with no other field. A product pending is `{ product, known,
  quantity }`: a product the buyer named without its full variant; `product` is a product `key`, `known` an attributes object with
  the values the buyer already gave (default `{}`; every name and value must belong to one variant of the product, and that variant
  must have at least one attribute that `known` leaves out, which is what is still missing) and `quantity` an integer 1 to 99
  (default 1). A doubtful pending is `{ candidates, known, quantity }`: `candidates` is a list of 2 to 4 different product `key`s the
  buyer's words could mean; `known` (default `{}`) holds only values that every candidate has (each pair must exist on every candidate, as the reader keeps only what all candidates offer); `quantity` as above.
  Pendings are seeded through the chat's pendings repository, attached to the seeded order when there is one (as if created while it
  was open) and not attached when there is none.
- `orderState` is only `"closed"` (absent means the order is open). It needs a non-empty `order`. The seeded order is then paid in
  full by hand, the same path as the `confirm_payment` event without a previous `report_payment`, so the chat's last order exists
  but is closed for messages (a pending attached to it ends as «order closed» at the next message). A cancelled order cannot be
  seeded as a start; use the `cancel_order` event after a first message. After a closed start, an expected `order` that is absent means unchanged: the run compares with the chat's latest order, the closed one, when the message opens no new order.
- An expectation has `notice` (a seller notice kind or `null` for silent), and optionally `order` (the open order after the message;
  absent means unchanged) and `outcomes` (a list of outcome kinds, as a multiset). A message case needs `notice` or `outcomes`; a
  conversation step always has `notice`.
- Seller notice kinds: `not_identified`, `not_clear`, `variant_missing`, `variant_not_available`, `quantity_above_limit`, `unclear_item`, `unnamed_add`, `variant_only`, `image_with_request`, `no_open_order`, `failed`, `order_closed`, `several_problems`, `only_item_kept`, `ready`, `new_order`, `not_applied`, `caption_not_applied`, `product_not_available`, `variant_for_several_pendings`, `ready_with_pendings`, `payment_request`.
- Outcome kinds: `added`, `removed`, `quantity_lowered`, `quantity_changed`, `variant_changed`, `mentioned_price_set`, `ready`, `only_item_kept`, `order_closed`, `no_intent`, `variant_only`, `unnamed_add`, `image_with_request`, `no_open_order`, `not_identified`, `not_clear`, `variant_missing`, `variant_not_available`, `quantity_above_limit`, `unclear_item`, `new_order_after_closed`, `failed`, `pending_created`, `pending_updated`, `pending_completed`, `pending_split`, `pending_ended`, `reader_doubt`, `request_not_allowed`, `invalid_action`, `product_not_available`, `variant_for_several_pendings`, `ready_with_pendings`, `caption_not_applied`, `payment_requested`.

Every product named by a case must exist in `catalog.json`. A file inside the repository, or reached through a link into it, is refused.
