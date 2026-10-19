# Image product search: implementation tasks

**Status:** implemented (T0–T3); manual checks with real providers pending (no keys connected). Design: `docs/image-product-search-technical.md`.

## Order and parallelism

```text
T0 schema + pgvector + event type ──┬──→ T1 indexing
                                    └──→ T2 cascade in products ──→ T3 orders uses the cascade
```

T1 and T2 run in parallel. Their use cases and tests use fake adapters; the real provider adapters need the providers chosen by the founder (technical design §2). T3 needs T2.

## T0. pgvector, embeddings table and `product_image_changed` type

**Scope:** database image `pgvector/pgvector:0.8.1-pg18` in `compose.yaml` and `compose.prod.yaml`; Prisma `extensions = [vector]`; model `ProductImageEmbedding` with RLS (since replaced by `ImageEmbedding`, keyed by company, image and model; see technical design §7); migration `add_product_image_embeddings` generated with the CLI (`.agents/skills/database-migrations/SKILL.md`); `features/products/application/events.ts` with `ProductImageChanged` and `parseProductImageChanged` in `products/infrastructure/event-payloads.ts`.
**Out of scope:** repository functions, use cases, providers.
**Acceptance criteria:**
1. `docker compose up --build` with the existing volume starts PostgreSQL with the previous data and `SELECT extname FROM pg_extension` lists `vector`.
2. As `core_app` with company A set, a row inserted for company B is invisible.
3. `parseProductImageChanged({ companyId, productId, extra: 1 })` fails with `INVALID_EVENT`.
4. Deleting a product deletes its embedding rows. (Superseded: embeddings belong to the image, so deleting the image deletes them; technical design §7.)
**Depends on:** nothing.

## T1. Product image indexing

**Scope:** `indexProductImage`; publication of `product_image_changed` in `createProduct` and `updateProduct`; `product-image-embeddings.ts`, now `image-embeddings.ts` (`findImageIndexState`, `saveEmbedding`, `listProductsMissingEmbedding`); `<provider>-image-embedder.ts` for the chosen provider, passing `image-embedder.contract.ts`; handler `index-product-image` in `composition/event-handlers.ts` and `products/composition.ts`; command `products:index-images`; logs from §13. Tests from §14: `index-product-image.test.ts`, create/update publication tests, the embedder contract tests, `event-payloads.test.ts`, embeddings integration tests on save and isolation, `index-product-image.integration.test.ts`, handler registration.
**Out of scope:** search.
**Acceptance criteria:**
1. Creating a product with an image leaves one `ImageEmbedding` row (originally `ProductImageEmbedding`) with the configured model after the worker runs.
2. Changing the image replaces the row; an event for the old image arriving late ends `image_replaced` and leaves the new embedding. (Superseded by `ImageEmbedding`: the new image gets its own row, the old image's row stays cached and search ignores it; there is no `image_replaced` outcome; technical design §5.1, §7.)
3. Updating name or price publishes nothing.
4. With the embedder returning 503, the job is retried and the product is saved anyway.
5. Running the command twice publishes events only for products without an embedding of the current model.
**Depends on:** T0; real embedder once the provider is chosen.

## T2. Identification cascade in products

**Scope:** move `qr-code-reader.ts` and `selectProductCode`/`VariantQrCode` to products; `domain/image-identification.ts` with the visual rules and parsers; `identifyProductsInImage`; `findNearestProductImages`, `findSellableVariantsOfProduct`; `product-chooser.ts` (provider-neutral prompt, labels and output schema) and `<provider>-product-chooser.ts` for the chosen provider, passing `product-chooser.contract.ts`; provider selection by env in `products/composition.ts`; env `PRODUCT_MATCH_*`; disabled visual search without keys; exported `identifyProductsInImage` from `products/composition.ts`. Tests from §14: domain, use case, chooser and its contract suite, composition provider selection, nearest-images and variants integration.
**Out of scope:** changes in orders other than the moved imports.
**Acceptance criteria:**
1. An image with a printed label returns `found qr` without calling the embedder.
2. A screenshot with no QR, with fake vectors putting product P first and a fake chooser answering P with 0.9, returns `found visual` with P's only variant.
3. The same with confidence 0.6 returns `low_confidence`; with P having two variants returns `ambiguous_variant`.
4. Without provider keys, a screenshot returns `visual_search_disabled` and the startup logs `product_visual_search_disabled`.
5. An embedding of another company, another model or a replaced image never appears among candidates.
**Depends on:** T0; real chooser once the provider is chosen.

## T3. Orders uses the cascade

**Scope:** `addMessageProductsToOrder` replaces `readQrCodes` + `findVariantsByCodes` with `identifyProducts`; new skip reasons, errors and `match` in outcomes; retryable codes in the handler adapter; log fields. Tests from §14 for orders and the two orders integration tests. Update `docs/message-to-order.md` to point identification to this document.
**Out of scope:** UI.
**Acceptance criteria:**
1. A screenshot without QR in a chat with an open order adds the visual variant and logs `matchMethod: "visual"` with its confidence.
2. A label photo behaves exactly as before (existing message-to-order tests green).
3. With the matcher returning 503 the job is retried; with `INVALID_EMBEDDING` it fails permanently.
4. A screenshot of a product not in the catalog creates no order and logs `orders_message_order_skipped` with `no_visual_match` or `low_confidence`.
**Depends on:** T2.

## T4. Log visual candidate distances (after launch)

**Scope:** no proximity threshold yet (founder, 2026-10-19: measure first). `identifyProductsInImage` returns `topDistance` (nearest candidate) and `chosenDistance` (chosen candidate) for visual outcomes; orders carries them to `orders_message_order_created` / `_items_added` / `_skipped` (technical design §2, §13).
**Out of scope:** any threshold or change to which candidates reach the chooser.
**Acceptance criteria:**
1. A visual match logs `topDistance` and `chosenDistance` next to `confidence`.
2. `no_visual_match` logs `topDistance` only; `low_confidence` and `ambiguous_variant` log both.
3. No image, vector or product name is logged.
**Depends on:** T3.

## Final verification

- Manual checks of §14 with real providers on the test phone.
- `pnpm --dir apps/core lint`, `typecheck`, `test:unit`, `sh scripts/run-tests.sh integration` and `e2e` green.
