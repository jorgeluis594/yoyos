# AI evals

Evals measure how well orders from chat messages pick the tool, product and variant with real models
(docs/message-to-order.md, docs/ai-tools.md, docs/image-product-search.md). They use
[vitest-evals](https://github.com/getsentry/vitest-evals) on top of Vitest and run fully local: results stay
in the terminal and nothing is sent to an eval service.

- Run: `pnpm --dir apps/core eval` (one file: `pnpm --dir apps/core eval evals/smoke.eval.ts`).
  `VITEST_EVALS_REPORT_LEVEL=info` adds tool calls and timings per case.
- Layout: `*.eval.ts` suites here, case tables in `cases/`, catalogs and chat texts in `fixtures/`.
- Env: read from `apps/core/.env` (copy `.env.example`). Model evals need `OPENAI_API_KEY`, plus the
  `AI_*`, `PRODUCT_MATCH*`, `TEXT_MATCH_*` and `*_MIN_CONFIDENCE` settings listed there. Never commit real
  keys, and keep customer catalogs or chats out of fixtures unless anonymized.
- Cost: every model eval calls OpenAI and is billed to the key's account. Evals are not part of
  `test:unit`, integration, e2e or CI; run them on purpose.
- `smoke.eval.ts` calls no model; it only proves the wiring runs.
