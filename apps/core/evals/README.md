# AI evals

Evals measure how well orders from chat messages pick the tool, product, variant, quantity and mentioned price with the real
models (docs/message-to-order.md, docs/ai-tools.md, docs/image-product-search.md). They use
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
| `OPENAI_API_KEY` | The system under test: interpretation, text and variant choosers, vision chooser. Plus the `AI_*`, `PRODUCT_MATCH*`, `TEXT_MATCH_*` and `*_MIN_CONFIDENCE` settings the app reads. |
| `CLAUDE_API_KEY` | Claude as judge and error classifier (and paraphrase generator, offline). Passed explicitly to the client; never logged. |
| `EVAL_CLAUDE_MODEL` | Claude model, default `claude-sonnet-5-5`. |
| `EVAL_MAX_CASES` | Hard cap of cases per run, taken round-robin over the passes; unset runs all. |
| `EVAL_CASES` | Comma-separated case ids; a base id also selects its paraphrases. |
| `EVAL_REPEATS` | Runs of each `consistency` case (default 3; 1 turns the check off). |
| `EVAL_SKIP_PARAPHRASES` | `1` runs base cases only. |
| `EVAL_IMAGES_DIR` | Photo folder with its `manifest.json`, relative to `apps/core` (default `evals/fixtures/images`). |
| `EVAL_LOCAL_IMAGES_DIR` | Local, gitignored folder of real captures with its own manifest, merged at run time (default `evals/fixtures/images-local`). Never commit real captures. |

The local image embedder needs its model files: `pnpm --dir apps/core models:fetch`.

## Cost

Every model eval calls OpenAI and, for judged cases and the failure grouping, Anthropic; both are billed to the keys' accounts.
The run summary prints the number of model calls by the system and to Claude, tokens and an estimated cost per model. Prices
are constants in `lib/model-meter.ts` with the date they were checked; a model without a price is reported as unknown, never
as free. Run evals on purpose, never in a loop.

## What runs and what is faked

All data is synthetic: a Peruvian fashion catalog (`fixtures/catalog.ts`: polos, gorras, poleras, near-duplicate names, two
products without photos, PEN prices, Talla/Color variants), Peruvian-Spanish chat texts in the cases, and generated phone-style
photos listed in `fixtures/images/manifest.json` (fields and sources in `fixtures/images/README.md`), plus any real captures in the
gitignored `fixtures/images-local/`. Each suite seeds that catalog
into the test database; the photo suites also index its catalog photos with the real embedder. Without a manifest the image
suite skips with a message and the end-to-end suite runs only its text cases.

| Suite | Pass | Production path |
| --- | --- | --- |
| `interpretation.eval.ts` | Tool choice and arguments (criteria 1, 4) | `applyChatMessage` with the real interpreter, text identification and variant resolution. The photo's identification is given by the case (visual match 0.95, QR label or «not a product») so only interpretation is measured. |
| `identification-text.eval.ts` | Text identification (criterion 3) | `identifyProductsInText` with the real SQL candidates and chooser. |
| `identification-image.eval.ts` | Non-product photos and visual identification (criteria 2, 5) | `identifyProductsInImage`: real QR reader, local embedding search and vision chooser. |
| `end-to-end.eval.ts` | The whole message | `applyChatMessage` with the real photo cascade, interpretation and order transaction. |

Faked: image storage (fixture files instead of R2). Nothing publishes events, so no notice reaches WhatsApp or push. An open
order is seeded by sending QR label photos through `applyChatMessage` (deterministic, no model call). Retryable failures are
retried up to three attempts, like the queue would.

## Cases

`cases/*.ts` are TypeScript tables validated with Zod (`cases/schema.ts`) when loaded. Image cases are not written by hand: each
manifest photo outside `catalog/` is one case, expected to be found (`match`; `label` also by the color of the QR variant), not
identified (`no_match`) or not a product (`not_product`), with its `scenario` as kind. `catalog/` photos are what the seller
uploads: they are indexed and never used as queries, since they would match their own embedding; the first photo of each answer and the first worn photo are tagged `consistency`. End-to-end cases pick
their photo from the manifest by product, folder and a hint (`photo({ folder: "customer", productKey: "polo-basico", hint: "worn" })`)
and are left out when no photo matches. A case has an id, pass, criterion
(1 interpretation, 2 non-product photos, 3 text identification, 4 arguments, 5 visual identification), kind, tags, the
input (text, or photo plus caption, and the open order) and one or more acceptable expectations. Tags: `consistency` (run
`EVAL_REPEATS` times; the report lists cases whose result flipped), `injection` (prompt injection attempts), `paraphrase`, and
`known-limitation` (beyond the documented design, such as a synonym that shares no letters with the product name: reported apart
and left out of every score).

To add a case, append it to the table of its pass and run `pnpm --dir apps/core test:unit` (the case tables are parsed there).
State only what must happen: an omitted `order` means the open order stays as it was; an omitted `tools` leaves the tool
unscored. Mark a case `ambiguous` with the reason when a reasonable reader could accept another answer.

`cases/paraphrases.ts` holds Peruvian-chat rewrites of the message cases, generated once by
`pnpm exec tsx evals/scripts/generate-paraphrases.ts` with Claude, reviewed by hand and committed. Evals never regenerate them,
so runs stay comparable. Prompt injection cases are not paraphrased.

## Scoring

Tool (as a set), outcomes (as a multiset), product, variant, quantity and mentioned price are exact matches against the final
order; every message also checks that unit prices are the catalog prices. A case passes when it matches one acceptable
expectation. `ambiguous_intent` satisfies an expectation of `no_intent`, tool included: both change nothing and send no notice. Claude judges only cases with several acceptable expectations or marked `ambiguous`, with a `{pass, score,
reason}` verdict; for an `ambiguous` case the judge's pass also counts. Price integrity can never be overruled by the judge.

## Report

`eval-results/<run>.json` holds `report` and every case `record` (input, expected, actual, fields, judge verdict, observed
certainties with their gates, the `trace` of what the models decided, latency, retries, model calls). The trace keeps the Decision
answers (chosen action, the three highest tool predicates as runner-ups, item and amount choices), the arguments the extraction
model returned (mentions, variant words, quantity, price) and each text choice. The report has:

- accuracy overall and per pass, criterion, kind, expected tool, tag, and per scored field; known limitations listed apart;
- how failed messages misled the seller: false notices (a problem notice where a change was expected), wrong notices (another
  problem notice than the expected one), silent errors (a change without the expected notice), missed notices (a problem, «ready»,
  «only item kept» or new-order notice was due and none was sent, even beside a right change), wrong silent changes, and dropped
  requests (a change was expected; nothing changed and no notice);
- the end-to-end pass split into photo and text messages;
- calibration per pass and certainty source at the production gate of that source (`gates`: action `MESSAGE_ACTION_MIN_CONFIDENCE`,
  text and variant and visual `PRODUCT_MATCH_MIN_CONFIDENCE`, item `ITEM_CHOICE_MIN_CONFIDENCE`). Each certainty records the model's
  own `pick` and is graded by it (`lib/picks.ts`), not by the outcome, which below a gate the gate itself decides: the Decision's
  action is right when it is the expected tool (`several` for several tools); a text, visual or variant pick when an acceptable final
  order (or the text or image expectation) has that product or variant. Item choices and picks a case cannot grade are counted as
  ungraded. «none» answers of the text, variant and vision choosers are their own sources (`text_none`, `variant_none`,
  `visual_none`). `shows_product` is the vision chooser's probability that the photo shows a product, at its 0.5 gate, with pick
  `product` or `not_product`; it is graded in the image pass only (a message expectation does not say whether its photo is a product);
- consistency flips, prompt injection outcomes, judge rescues and disagreements;
- p50/p95 latency of the scored model step only (no chat creation, order seeding or retried attempts; retries are counted apart),
  model calls, tokens and estimated cost per model and role;
- Claude's grouping of the failed cases by cause, from the records and certainties: hypotheses, not verified causes.

`pnpm --dir apps/core eval:report eval-results/<run>.json [...]` rebuilds a saved run's report from its records with no model call
(`lib/rebuild.ts`): notices are rescored under the current rules, the calibration regraded and current `known-limitation` tags applied; Claude's error groups and cost are
kept. The first rebuild keeps the original file as `<run>.orig.json`. Records from before visual picks were kept get one only when
the photo was found above the gate; the others stay ungraded.
