# Image product search: technical design

**Status:** design closed, pending implementation. Based on: founder description (cascade search of a customer's image against the seller's products) and `docs/message-to-order.md`; there is no product document yet. Base: `jorgeluis594/add-ia-product-searching` at `df47ad02`. Tasks: `docs/image-product-search-tasks.md`.

## 1. Technical goal

When an incoming image message reaches `addMessageProductsToOrder`, core identifies which product it shows with a cascade that stops at the first step that answers: printed QR label first (deterministic, free), then visual search (image embeddings preselect the K closest products of the company, a vision model chooses one or none). The identified variant is added to the chat's open order exactly as a QR variant is today. Product images are embedded asynchronously when a product gets or changes its image.

```text
message_created ──→ orders.addMessageProductsToOrder
                        │ readImage (shared/images)
                        ▼
                    products.identifyProductsInImage           ← cascade, owned by products
                        ├─ 1. readQrCodes → selectProductCode → findSellableVariantsByQrCodes
                        │      found / unknown codes / unreadable → stop
                        └─ 2. no product QR → embedImage → findNearestProductImages (pgvector, top K)
                               → readImageBytes ×K → chooseProduct (vision model)
                               → acceptVisualMatch (domain) → findSellableVariantsOfProduct
                        ▼
                    found { method, items } | not_found { reason }
                        ▼
                    existing transaction: open order → appendItems | new order

product create/update with new image ──→ product_image_changed ──→ products.indexProductImage
                                                                     → embedImage → ProductImageEmbedding
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Scope | Core only. Images of incoming messages only. Text messages and captions are not searched. Mobile and contracts do not change. |
| Cascade order | QR → visual. Visual runs only when the image has no product QR (`no_qr_code`, `unrecognized_qr_code`). Unknown product QR codes and unreadable images stop the cascade without AI. |
| Owner of the cascade | `products` (`identifyProductsInImage`). `orders` only adds what products identifies. The QR reader and `selectProductCode` move from `orders` to `products`. |
| Products per image | QR keeps one item per distinct variant. Visual returns at most one product per image (a live screenshot shows the product being offered). |
| Variant of a visual match | Product images live at product level. Only products with exactly one sellable variant are added; otherwise `ambiguous_variant`. |
| Effect of a visual match | Added to the order like a QR variant when confidence ≥ threshold. No suggestion or confirmation step; the seller removes a wrong item as today. |
| Vector storage | pgvector in the same PostgreSQL, exact search (no ANN index) filtered by company and model. |
| Providers | The founder chooses the embedding model and the vision model before the real adapters are implemented. Vision candidates come from memory: Claude Haiku 5.5, Claude Sonnet 5.5, OpenAI GPT-6 Luna, OpenAI Decisions API. The design is provider-neutral: one adapter per provider behind `EmbedImage` and `ChooseProduct`, selected by env, all passing the same contract tests (§12). v1 implements only the chosen provider of each port. Accuracy evaluations (evals) are out of this design and will be added later. |
| Where AI code lives | `features/products/infrastructure/product-matching/`. SDK clients are created in `products/composition.ts` from env, like `createR2ImageStorage`. No `ai` feature and no shared AI client while there is one consumer. |
| Indexing | Event `product_image_changed { companyId, productId }` published after a create or update that sets a new image; handler `index-product-image` embeds it. Command `index-product-images` publishes the event for every product missing an embedding of the current model (recovery and model change). |
| Model change | Each embedding stores `model`; search only compares embeddings of the configured model. Changing the model = deploy + run the command. |
| Visual search not configured | If the provider keys are missing, composition wires a disabled matcher: visual step returns `not_found` `visual_search_disabled`. Dev and tests run without keys. |
| Customer text in prompts | Captions are not sent to the model (prompt injection surface, no measured gain). |
| Traceability | Match method and confidence go to logs only, consistent with message-to-order ("visibility of skips: logs only"). No new column on `OrderMessage`. |
| Initial values (adjustable, env) | `PRODUCT_MATCH_CANDIDATES=5`, `PRODUCT_MATCH_MIN_CONFIDENCE=0.8`, `PRODUCT_MATCH_TIMEOUT_MS=20000`, images resized to ≤1024 px before sending. |
| Retries | Handler policy unchanged (`concurrency: 2, retries: 8`). Provider unavailable and invalid model response are retryable. |
| Backward compatibility | Not in production (memory): migration without backfill; development products are indexed with the command. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Message to order | `features/orders/application/add-message-products-to-order.ts`, `orders/composition.ts` (`messageOrderDependencies`, `addMessageProductsHandler`) | Implemented. Reads image bytes and QR codes outside the transaction, then adds to the open order or creates one. Skip reasons `not_image`, `outgoing_message`, `no_qr_code`, `unreadable_image`, `unrecognized_qr_code`, `product_not_found`. |
| QR reader | `features/orders/infrastructure/qr-code-reader.ts` (`readQrCodes`, zxing-wasm + sharp) | Implemented in orders. |
| Code selection | `features/orders/domain/message-order.ts` (`selectProductCode`, `VariantQrCode`, `isOpenForMessageItems`) | Implemented in orders. |
| Variants by code | `features/products/infrastructure/order-stock.ts` `findSellableVariantsByQrCodes` → `CatalogItem & { qrCode }` | Exported from `products/index.ts`. |
| Handler | `composition/event-handlers.ts` `addMessageProductsToOrder`, policy `orders/application/message-order-policy.ts` | `concurrency: 2, retries: 8`. Retryable: `PERSISTENCE_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE`, `QR_READER_UNAVAILABLE`. |
| Product | `features/products/domain/product.ts` | One optional `imageId` per product; variants have no image. |
| Product writes | `products/application/create.ts`, `update.ts`; `products/composition.ts` | Validate `imageId` with `findImage`. Publish no events. |
| Images | `shared/images/application/images.ts` (`readImageBytes`, `ImageStorage.read`), `shared/images/index.ts` | Reads bytes of any company image (public or private) with RLS. |
| Events | `orders/application/events.ts` (`order_cancelled`), `chats/application/events.ts` (`message_created`), `composition/event-bus.ts` | Pattern: type + `AppEvents` declaration merging + strict parser + `applicationEventBus().publishEvent` after commit. |
| Persistence | `shared/infrastructure/persistance.ts` (`prisma`, `withTenantIsolation`, `getCompanyId`, `withinTransaction`, `systemPrisma`) | RLS by `app.company_id`. Only extension: `pg_trgm`. |
| Database image | `compose.yaml`, `compose.prod.yaml` | `postgres:18-alpine`, without pgvector. |
| AI SDKs | `apps/core/package.json` | None installed. |
| Env | inline `process.env.X ?? ""` per composition | No central env module. |

## 4. Gaps this design closes

1. Product identification lives in `orders` and only knows QR (§5.2, §12).
2. There is no visual search of a message image against product images (§5.2).
3. Product images have no embeddings and there is no vector storage (§7).
4. Products publish no event when their image changes (§9).
5. There is no way to read the sellable variants of a product by `productId` (§5.2).
6. There are no adapters for an embedding model or a vision model (§12).
7. `addMessageProductsToOrder` has no skip reasons or retryable errors for visual search (§5.3).

## 5. Use cases

### 5.1 `indexProductImage` (new, products)

`features/products/application/index-product-image.ts`. Runs from the `index-product-image` handler inside `withTenantIsolation`.

```ts
export type IndexProductImageInput = Readonly<{ productId: ProductId }>;
export type IndexProductImageOutcome =
  | Readonly<{ kind: "indexed"; imageId: ImageId }>
  | Readonly<{ kind: "skipped"; reason: "product_not_found" | "no_image" | "already_indexed" | "image_replaced" }>;
export type IndexProductImageError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_NOT_FOUND" | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING";
  message: string;
}>;
export type IndexProductImageDependencies = Readonly<{
  findImageIndexState: (productId: ProductId, model: EmbeddingModel) =>
    Promise<Result<Readonly<{ imageId: ImageId | null; indexedImageId: ImageId | null }> | null, PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<ImageBytes, ImageReadError>>;
  embedImage: EmbedImage;
  saveEmbedding: (embedding: ProductImageEmbedding) => Promise<Result<"saved" | "image_replaced", PersistenceError>>;
  model: EmbeddingModel;
}>;
export async function indexProductImage(input: IndexProductImageInput, deps: IndexProductImageDependencies):
  Promise<Result<IndexProductImageOutcome, IndexProductImageError>>;
```

Flow:

1. `findImageIndexState`. `null` → `product_not_found`; no `imageId` → `no_image`; `indexedImageId === imageId` → `already_indexed`.
2. `readImage(imageId)` → `embedImage` (adapter validates the vector length of the model).
3. `saveEmbedding({ productId, imageId, model, vector })`: conditional upsert that only writes if the product still has that `imageId` (§11). Otherwise `image_replaced` (the newer event indexes the new image).

Handler: `PERSISTENCE_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE`, `EMBEDDER_UNAVAILABLE` retryable; the rest permanent. Policy `{ concurrency: 2, retries: 8 }`.

### 5.2 `identifyProductsInImage` (new, products): the cascade

`features/products/application/identify-products-in-image.ts`. Pure coordination; no writes.

```ts
export type ImageIdentification =
  | Readonly<{ kind: "found"; method: "qr"; items: readonly CatalogItem[]; unknownCodes: readonly VariantQrCode[] }>
  | Readonly<{ kind: "found"; method: "visual"; items: readonly [CatalogItem]; confidence: MatchConfidence; candidates: number }>
  | Readonly<{ kind: "not_found"; reason: IdentificationMissReason }>;

export type IdentificationMissReason =
  | "unreadable_image"          // QR step could not decode the image; visual is not attempted
  | "unknown_qr_codes"          // product QR present but no sellable variant (other company, deleted)
  | "visual_search_disabled"
  | "no_indexed_products"
  | "no_visual_match"           // model answered none
  | "low_confidence"
  | "ambiguous_variant";        // product with several sellable variants

export type IdentifyProductsError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "QR_READER_UNAVAILABLE"
    | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING" | "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE";
  message: string;
}>;

export type IdentifyProductsDependencies = Readonly<{
  readQrCodes: ReadQrCodes;
  findVariantsByCodes: (codes: readonly VariantQrCode[]) => Promise<Result<readonly (CatalogItem & { qrCode: VariantQrCode })[], PersistenceError>>;
  visual: VisualSearch | null; // null = not configured
}>;

export type VisualSearch = Readonly<{
  model: EmbeddingModel;
  candidates: number;
  minConfidence: MatchConfidence;
  embedImage: EmbedImage;
  findNearestProductImages: (vector: EmbeddingVector, model: EmbeddingModel, limit: number) =>
    Promise<Result<readonly VisualCandidate[], PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<ImageBytes, ImageReadError>>;
  chooseProduct: ChooseProduct;
  findSellableVariantsOfProduct: (productId: ProductId) => Promise<Result<readonly CatalogItem[], PersistenceError>>;
}>;

export async function identifyProductsInImage(image: ImageBytes, deps: IdentifyProductsDependencies):
  Promise<Result<ImageIdentification, IdentifyProductsError>>;
```

Flow:

1. **QR.** `readQrCodes(image)`. `UNREADABLE_IMAGE` → `not_found unreadable_image`. `selectProductCode`:
   - `codes` → `findVariantsByCodes`. At least one → `found qr` (with `unknownCodes`). None → `not_found unknown_qr_codes`.
   - `skip` (`no_qr_code`, `unrecognized_qr_code`) → step 2.
2. **Visual.** `visual === null` → `not_found visual_search_disabled`.
   1. `embedImage(image)`.
   2. `findNearestProductImages(vector, model, candidates)`. Empty → `no_indexed_products`.
   3. `readImage` of each candidate image, in parallel. `IMAGE_NOT_FOUND` drops that candidate; other errors propagate. All dropped → `no_indexed_products`.
   4. `chooseProduct({ query: image, candidates })` → `VisualChoice`.
   5. `acceptVisualMatch(choice, candidates, minConfidence)` (domain) → `productId` or miss reason.
   6. `findSellableVariantsOfProduct(productId)` → `selectVisualVariant(variants)` (domain): one → `found visual`; zero → `no_visual_match`; several → `ambiguous_variant`.

### 5.3 `addMessageProductsToOrder` (modified, orders)

Exact changes:

- Dependencies: `readQrCodes` and `findVariantsByCodes` are replaced by `identifyProducts: (image: ImageBytes) => Promise<Result<ImageIdentification, IdentifyProductsError>>`.
- Step 3 (outside the transaction): `readImage` → `identifyProducts`. `found` → `variants = items`; `not_found` → `skipped` with the mapped reason.
- `MessageOrderSkipReason` becomes exactly `not_image | outgoing_message | unreadable_image | product_not_found | visual_search_disabled | no_indexed_products | no_visual_match | low_confidence | ambiguous_variant`. `unknown_qr_codes` maps to the existing `product_not_found`; the other miss reasons pass unchanged. `no_qr_code` and `unrecognized_qr_code` stop being final reasons because they continue to visual search.
- Outcomes `order_created` and `items_added` add `match: Readonly<{ method: "qr"; unknownCodes } | { method: "visual"; confidence; candidates }>` (replaces the top-level `unknownCodes`).
- `AddMessageProductsError` adds `EMBEDDER_UNAVAILABLE`, `INVALID_EMBEDDING`, `PRODUCT_MATCHER_UNAVAILABLE`, `INVALID_MATCHER_RESPONSE`. Retryable in the handler adapter: the current three plus `EMBEDDER_UNAVAILABLE`, `PRODUCT_MATCHER_UNAVAILABLE`, `INVALID_MATCHER_RESPONSE`. `INVALID_EMBEDDING` is permanent (wrong model configuration).
- Transaction, locks, idempotency through `OrderMessage` and `appendItems` do not change.

### 5.4 Products create and update (modified)

- `createProduct`: after a successful save with `imageId`, publishes `product_image_changed`.
- `updateProduct`: publishes only when the plan changes `imageId` to a non-null value. Removing the image does not publish: the search filters by the current `imageId` (§7), so the old embedding is ignored and deleted by FK cascade only when the product is deleted.
- Dependency added: `publishProductImageChanged: (payload: ProductImageChanged) => Promise<Result<void, EventBusError>>`. A publication failure does not fail the operation: the product is saved; the adapter logs `product_image_changed_publish_failed` and the command `index-product-images` recovers it.

## 6. Domain and typing

`features/products/domain/image-identification.ts` (new). The QR types move here from `orders/domain/message-order.ts`.

| Type | Why it exists |
| --- | --- |
| `VariantQrCode`, `ScanSelection`, `selectProductCode` | Moved from orders unchanged: the code identifies a product, not an order. |
| `ImageBytes = Readonly<{ bytes: Uint8Array; contentType: string }>` | Named once; today repeated inline in several deps. |
| `EmbeddingModel` (brand, `parseEmbeddingModel`: non-empty, ≤100 chars) | Prevents comparing vectors of different models. |
| `EmbeddingVector` (brand over `readonly number[]`, `parseEmbeddingVector(values, dimensions)`: exact length, finite numbers) | Rejects truncated or NaN vectors before persisting. |
| `ProductImageEmbedding = { productId; imageId; model; vector }` | Persisted entity; no existing type covers it. |
| `MatchConfidence` (brand, `parseMatchConfidence`: number in [0, 1]) | Threshold comparison over a validated value. |
| `VisualCandidate = { productId; imageId; distance: number }` | Result of the vector query. |
| `VisualChoice = { kind: "product"; productId; confidence: MatchConfidence } \| { kind: "none" }` | The model can and must be able to say "none". |
| `ImageIdentification`, `IdentificationMissReason` | Cascade output (§5.2). |

Pure rules:

```ts
// Rejects a choice outside the candidates (the adapter already maps labels; this is the invariant).
export function acceptVisualMatch(choice: VisualChoice, candidates: readonly VisualCandidate[], minConfidence: MatchConfidence):
  Readonly<{ kind: "accepted"; productId: ProductId; confidence: MatchConfidence }> | Readonly<{ kind: "rejected"; reason: "no_visual_match" | "low_confidence" }>;

export function selectVisualVariant(variants: readonly CatalogItem[]):
  Readonly<{ kind: "selected"; item: CatalogItem }> | Readonly<{ kind: "rejected"; reason: "no_visual_match" | "ambiguous_variant" }>;
```

Ports declared next to the use cases (`application/identify-products-in-image.ts`):

```ts
export type EmbedImage = (image: ImageBytes) => Promise<Result<EmbeddingVector, Readonly<{ code: "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING"; message: string }>>>;
export type ChooseProduct = (input: Readonly<{ query: ImageBytes; candidates: readonly Readonly<{ productId: ProductId; image: ImageBytes }>[] }>) =>
  Promise<Result<VisualChoice, Readonly<{ code: "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE"; message: string }>>>;
```

| Layer | Types and authority |
| --- | --- |
| Domain (products) | Cascade rules, threshold, variant selection, parsers. |
| Application (products) | Cascade order and step coordination; ports. |
| Infrastructure (products) | Prompt, provider requests, label ↔ `productId` mapping, Zod parsing of model output, vector SQL. |
| Application (orders) | Uses `ImageIdentification`; decides nothing about matching. |

## 7. Persistence

```prisma
datasource db {
  provider   = "postgresql"
  extensions = [vector] // requires previewFeatures "postgresqlExtensions" if Prisma 7.10 still gates it: verify (§15)
}

model ProductImageEmbedding {
  companyId String                 @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  productId String                 @db.Uuid
  product   Product                @relation(fields: [companyId, productId], references: [companyId, id], onDelete: Cascade, onUpdate: NoAction)
  imageId   String                 @db.Uuid
  image     Image                  @relation(fields: [companyId, imageId], references: [companyId, id], onDelete: Cascade, onUpdate: NoAction)
  model     String
  embedding Unsupported("vector")
  createdAt DateTime

  @@id([companyId, productId, model])
}
```

- One embedding per product and model; the row is overwritten when the image changes.
- `vector` without dimension: exact search only, and every query filters by `model`, so all compared vectors have the same length.
- No ANN index (HNSW) while catalogs have hundreds of products per company; exact scan is cheaper than maintaining the index. Revisit beyond ~10 000 embeddings per company.
- Migration `add_product_image_embeddings` (Prisma CLI, `--create-only`): `CREATE EXTENSION IF NOT EXISTS vector;`, table, `companyId` default, `ENABLE`/`FORCE ROW LEVEL SECURITY` and policy `ProductImageEmbedding_company_isolation` in the same transaction, `lock_timeout = '5s'`. New table: no lock on existing ones.
- `compose.yaml` and `compose.prod.yaml`: `postgres:18-alpine` → `pgvector/pgvector:0.8.1-pg18` (same data directory layout; verify the volume path, §15). `CREATE EXTENSION` runs as the migration owner `core`, not `core_app`.

Queries (raw SQL with parameters; Prisma does not type `vector`):

```sql
-- findNearestProductImages(vector, model, limit)
SELECT e."productId", e."imageId", e.embedding <=> $1::vector AS distance
FROM "ProductImageEmbedding" e
JOIN "Product" p ON p."companyId" = e."companyId" AND p.id = e."productId"
WHERE e."companyId" = $companyId AND e.model = $2 AND p."imageId" = e."imageId" AND p.status = 'active'
  AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
ORDER BY distance, e."productId"
LIMIT $3;

-- saveEmbedding: writes only if the product still has that image
INSERT INTO "ProductImageEmbedding" ("productId", "imageId", model, embedding, "createdAt")
SELECT p.id, $imageId, $model, $vector::vector, now() FROM "Product" p WHERE p.id = $productId AND p."imageId" = $imageId
ON CONFLICT ("companyId", "productId", model) DO UPDATE SET "imageId" = EXCLUDED."imageId", embedding = EXCLUDED.embedding, "createdAt" = EXCLUDED."createdAt";
-- 0 rows → "image_replaced"
```

Rows read are validated with Zod (`distance: z.number().finite()`, ids `z.uuid()`); invalid stored data → `PERSISTENCE_UNAVAILABLE` with log `INVALID_STORED_DATA` in the adapter.

`findSellableVariantsOfProduct(productId)`: in `order-stock.ts`, same filters and `toCatalogItem` mapper as `findSellableVariantsByQrCodes`.

## 8. Contracts between applications

No change. Mobile keeps sending `imageId` in `POST /api/messages`; nothing new is exposed over HTTP.

## 9. Events and cross-feature integration

### 9.1 `product_image_changed`

```ts
// features/products/application/events.ts
export type ProductImageChanged = Readonly<{ companyId: CompanyId; productId: ProductId }>;
declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents { product_image_changed: ProductImageChanged }
}
```

- Carries ids, not the `imageId`: the handler reads the current image (an old event never indexes a replaced image).
- `eventId`: `${productId}:${imageId}` so duplicate publications of the same image collapse to one fact in logs; correctness does not depend on it (the use case is idempotent).
- Strict parser `parseProductImageChanged` in `features/products/infrastructure/event-payloads.ts` (pattern `parseMessageCreated`).
- Subscription `index-product-image` in `composition/event-handlers.ts`, handler from `products/composition.ts`.

| Failure window | What happens | Effect for the seller |
| --- | --- | --- |
| Publication fails after saving the product | Log `product_image_changed_publish_failed`; product saved. | That product is not found visually until `index-product-images` runs. |
| Embedding provider down | Retried 8 times (~21 min), then failed job. | Same; reprocess with `boss.retry` or the command. |
| Image replaced while indexing | Conditional write returns `image_replaced`. | Nothing; the newer event indexes it. |
| Duplicate event | `already_indexed`. | Nothing. |

### 9.2 Orders → products

`orders/composition.ts` wires `identifyProducts` with `products.identifyProductsInImage` from `products/composition.ts`. Dependency direction stays `orders → products`; products never imports orders.

### 9.3 Command `index-product-images`

`apps/core/scripts/index-product-images.ts` (`pnpm --dir apps/core products:index-images`). Lists companies with `systemPrisma`, and per company inside `withTenantIsolation` lists active products with an image and without an embedding of the current model, and publishes `product_image_changed` for each. Indexing runs in the worker; the command does not call providers.

## 11. Transactions and concurrency

- Visual search is read-only and runs outside the order transaction, like QR reading today. Provider calls never hold a lock.
- `saveEmbedding` is one statement: the `INSERT … SELECT … WHERE p."imageId" = $imageId` guarantees an embedding never belongs to an image the product no longer has, without locking the product row.
- A product image change concurrent with a search: the query filters `p."imageId" = e."imageId"`, so a stale embedding is ignored.
- A retry of `add-message-products-to-order` after a visual match but before commit repeats the provider calls and may choose differently; nothing was committed, so there is no inconsistency. Committed results are idempotent through `OrderMessage`.

## 12. Code organization

```text
features/products/
├── domain/
│   └── image-identification.ts          # moved QR selection + visual types and rules
├── application/
│   ├── events.ts                         # ProductImageChanged
│   ├── identify-products-in-image.ts     # cascade + ports EmbedImage, ChooseProduct
│   └── index-product-image.ts
├── infrastructure/
│   ├── event-payloads.ts                 # parseProductImageChanged
│   ├── order-stock.ts                    # + findSellableVariantsOfProduct
│   ├── product-image-embeddings.ts       # findImageIndexState, saveEmbedding, findNearestProductImages, listProductsMissingEmbedding
│   ├── qr-code-reader.ts                 # moved from orders
│   └── product-matching/
│       ├── product-chooser.ts            # provider-neutral: prompt, labels A/B/…, output Zod schema, label → productId, image resize
│       ├── product-chooser.contract.ts   # shared contract test suite every ChooseProduct adapter runs
│       ├── <provider>-product-chooser.ts # one ChooseProduct adapter per provider (only the chosen one in v1)
│       ├── image-embedder.contract.ts    # shared contract test suite every EmbedImage adapter runs
│       └── <provider>-image-embedder.ts  # one EmbedImage adapter per provider (only the chosen one in v1)
└── composition.ts                        # + provider selection from env, identifyProductsInImage, indexProductImageHandler, publish wiring
```

### Providers behind the ports

Each provider is one adapter file that satisfies the port; nothing outside `product-matching/` and `composition.ts` knows which provider runs.

```ts
// application/identify-products-in-image.ts: the port every vision provider implements
export type ChooseProduct = (input: Readonly<{
  query: ImageBytes;                                                        // customer's image
  candidates: readonly Readonly<{ productId: ProductId; image: ImageBytes }>[]; // top K from pgvector, ≥ 1
}>) => Promise<Result<VisualChoice, Readonly<{ code: "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE"; message: string }>>>;

export type VisualChoice =
  | Readonly<{ kind: "product"; productId: ProductId; confidence: MatchConfidence }> // productId ∈ candidates
  | Readonly<{ kind: "none" }>;

// application/identify-products-in-image.ts: the port every embedding provider implements
export type EmbedImage = (image: ImageBytes) =>
  Promise<Result<EmbeddingVector, Readonly<{ code: "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING"; message: string }>>>;
```

- **What is shared and what is per provider.** `product-chooser.ts` owns everything that must be identical across providers so results are comparable: the prompt text, labelling candidates `A`, `B`, …, the output schema `z.strictObject({ choice: z.union([z.enum(labels), z.literal("none")]), confidence: z.number().min(0).max(1) })`, mapping the label back to `productId`, and resizing images. A provider adapter only builds the request in its SDK's format, asks for structured output, extracts the JSON and translates transport errors.
- **Selection.** `products/composition.ts` reads `PRODUCT_MATCHER_PROVIDER` + `PRODUCT_MATCHER_MODEL` and `IMAGE_EMBEDDER_PROVIDER` + `IMAGE_EMBEDDER_MODEL` and builds the adapter with an exhaustive `switch` over the provider names that exist. Unknown provider → startup error. Missing key → `visual: null` (`visual_search_disabled`).
- **Changing the vision provider** = set the two env variables and redeploy; no data changes.
- **Changing the embedding provider or model** = set the env variables, redeploy and run `products:index-images`. `EmbeddingModel` is `"<provider>/<model>"`, so searches ignore vectors of the previous model until reindexing finishes.
- **Adding a provider** = a new `<provider>-product-chooser.ts` (or embedder), a `case` in the composition switch, and its test file running the contract suite.
- **Comparing providers.** Every adapter has the same input and output, so a future eval can run any of them over the same images and compare choices and confidence. The logs already carry `model` on every call (§13), so production behaviour can also be compared per provider.

`orders`: `domain/message-order.ts` keeps `isOpenForMessageItems` and imports `VariantQrCode` from products; `infrastructure/qr-code-reader.ts` is deleted; `application/add-message-products-to-order.ts` and `composition.ts` change per §5.3.

Vision adapter rules:

- Candidates are sent as labels `A`, `B`, … with their images; the model answers `{ "choice": "A" | … | "none", "confidence": number }` validated with `z.strictObject`. A label outside the list → `INVALID_MATCHER_RESPONSE`. Product names are not sent (they bias towards text and are seller data the model does not need).
- Images are resized with `sharp` (≤1024 px, JPEG) before sending.
- Timeout `PRODUCT_MATCH_TIMEOUT_MS`; 429, 5xx, timeout and network → `PRODUCT_MATCHER_UNAVAILABLE`; 4xx otherwise → `INVALID_MATCHER_RESPONSE` with log.
- The SDK client is created once in `products/composition.ts`.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `orders_message_order_created` / `_items_added` (existing) | info | orders handler adapter | add `["matchMethod", "confidence", "candidates"]` to the current fields |
| `orders_message_order_skipped` (existing) | info | orders handler adapter | `reason` takes the new values |
| `orders_message_order_failed` (existing) | warn/error | orders handler adapter | `code` takes the new values |
| `product_visual_match_completed` | info | `<provider>-product-chooser.ts` | `["companyId", "candidates", "choice", "confidence", "model", "durationMs", "inputTokens", "outputTokens"]` (`choice`: `"product"` or `"none"`, never the label content) |
| `product_matcher_request_failed` | warn | `<provider>-product-chooser.ts` | `["companyId", "model", "errorCode", "httpStatus", "durationMs", "err"]` |
| `product_matcher_invalid_response` | error | `<provider>-product-chooser.ts` | `["companyId", "model", "errorCode", "err"]` |
| `product_image_embedding_failed` | warn | `<provider>-image-embedder.ts` | `["companyId", "model", "errorCode", "httpStatus", "durationMs", "err"]` |
| `product_image_indexed` | info | products handler adapter | `["companyId", "productId", "imageId", "model", "durationMs"]` |
| `product_image_index_skipped` | debug | products handler adapter | `["companyId", "productId", "reason"]` |
| `product_image_index_failed` | warn (retryable) / error (permanent or exhausted) | products handler adapter | `["companyId", "productId", "eventId", "errorCode", "retryable", "attempt", "err"]` |
| `product_image_changed_publish_failed` | error | products composition | `["companyId", "productId", "errorCode", "err"]` |
| `product_visual_search_disabled` | info | products composition, at startup | `["reason"]` |

Never logged: image bytes, base64, prompts, raw model responses, captions, product names, vectors, API keys.

## 14. Tests

### Unit (core, Vitest)

`features/products/domain/image-identification.test.ts`

- `test("selectProductCode keeps only UUID codes without duplicates in reading order")` (moved)
- `test("acceptVisualMatch accepts a chosen candidate at or above the minimum confidence")`
- `test("acceptVisualMatch rejects a choice below the minimum confidence as low_confidence")`
- `test("acceptVisualMatch rejects none as no_visual_match")`
- `test("acceptVisualMatch rejects a product that is not among the candidates")`
- `test("selectVisualVariant selects the only sellable variant")`
- `test("selectVisualVariant rejects a product with several variants as ambiguous_variant")`
- `test("selectVisualVariant rejects a product without sellable variants as no_visual_match")`
- `test("parseEmbeddingVector rejects a vector with the wrong length or non-finite values")`
- `test("parseMatchConfidence rejects values outside 0 to 1")`

`features/products/application/identify-products-in-image.test.ts`

- `test("returns the QR variants without calling visual search")`
- `test("stops with unknown_qr_codes when product codes match no sellable variant")`
- `test("stops with unreadable_image without calling visual search")`
- `test("runs visual search when the image has no QR code")`
- `test("runs visual search when the image only has non-product QR codes")`
- `test("returns visual_search_disabled when visual search is not configured")`
- `test("returns no_indexed_products when the company has no embeddings of the model")`
- `test("drops candidates whose image no longer exists and asks the model with the rest")`
- `test("returns the only variant of the chosen product with its confidence")`
- `test("returns low_confidence, no_visual_match or ambiguous_variant from the domain rules")`
- `test("propagates embedder, matcher, storage and persistence failures")`

`features/products/application/index-product-image.test.ts`

- `test("embeds the current product image and saves it with the model")`
- `test("skips a product without image, a missing product and an already indexed image")`
- `test("reports image_replaced when the product changed its image before saving")`
- `test("propagates image storage and embedder failures without saving")`

`features/products/application/create.test.ts`, `update.test.ts`

- `test("publishes product_image_changed after creating a product with an image")`
- `test("publishes product_image_changed when an update sets a different image")`
- `test("does not publish when an update keeps or removes the image")`
- `test("returns the saved product when publishing the event fails")`

`features/products/infrastructure/event-payloads.test.ts`

- `test("parses product_image_changed and rejects extra fields or non-UUID ids")`

`features/products/infrastructure/product-matching/product-chooser.test.ts` (provider-neutral part)

- `test("labels candidates A, B, … in order and builds the prompt without product names")`
- `test("maps the chosen label back to its product id")`
- `test("maps none to a none choice")`
- `test("rejects an unknown label, a confidence outside 0 to 1, a missing field or extra fields as INVALID_MATCHER_RESPONSE")`
- `test("resizes images larger than 1024 px before sending")`

`product-chooser.contract.ts`: suite every `<provider>-product-chooser.test.ts` runs against its adapter with the provider's HTTP boundary controlled

- `test("sends the query image and every candidate image once")`
- `test("returns the candidate chosen in the provider's structured output")`
- `test("returns none when the provider answers none")`
- `test("returns INVALID_MATCHER_RESPONSE when the provider output is not the expected JSON")`
- `test("returns PRODUCT_MATCHER_UNAVAILABLE on timeout, 429, 5xx and network errors")`

`image-embedder.contract.ts`: suite every `<provider>-image-embedder.test.ts` runs

- `test("returns a vector of the configured model dimension")`
- `test("returns INVALID_EMBEDDING for a vector of another length or with non-finite values")`
- `test("returns EMBEDDER_UNAVAILABLE on timeout, 429, 5xx and network errors")`

`features/products/composition.test.ts`

- `test("builds the adapter of the configured provider and disables visual search without its key")`
- `test("fails at startup for an unknown provider name")`

`features/orders/application/add-message-products-to-order.test.ts` (updated)

- `test("adds the variant identified visually to the chat's open order")`
- `test("creates an order from a visual match when the chat has no open order")`
- `test("skips with the identification miss reason when no product is identified")`
- `test("identifies the products before opening the transaction")`
- `test("propagates embedder and matcher failures")`

`features/orders/composition.test.ts` (updated)

- `test("treats embedder and matcher unavailability and invalid matcher responses as retryable")`
- `test("treats INVALID_EMBEDDING as permanent")`
- `test("logs the match method and confidence without images or product names")`

`composition/event-handlers.test.ts`

- `test("registers index-product-image for product_image_changed with concurrency 2 and 8 retries")`

### Integration (core, PostgreSQL)

`features/products/infrastructure/product-image-embeddings.integration.test.ts`

- `test("findNearestProductImages returns the closest products of the company ordered by distance")`
- `test("findNearestProductImages ignores embeddings of another model, of a replaced image and of another company")`
- `test("saveEmbedding overwrites the embedding of the same product and model")`
- `test("saveEmbedding writes nothing when the product no longer has that image")`
- `test("deleting a product deletes its embeddings")`
- `test("tenant isolation hides embeddings of another company")`

`features/products/infrastructure/repository.integration.test.ts`

- `test("findSellableVariantsOfProduct returns the active variants of the product with price and currency")`

`features/products/application/index-product-image.integration.test.ts`

- `test("a product created with an image is indexed by the worker and found by visual search")` (fake embedder with fixed vectors)

`features/orders/application/add-message-products-to-order.integration.test.ts`

- `test("a screenshot without QR adds the visually identified variant to the chat order")` (fake embedder and chooser)
- `test("a label photo still adds by QR without calling the visual adapters")`

### Pending manual checks

- With the chosen providers and real keys: send a live screenshot over WhatsApp to the test phone and see the variant added to the chat order with `matchMethod: "visual"` in the log.
- Same with a screenshot of a product that is not in the catalog: no item added, `no_visual_match` or `low_confidence`.
- Production migration on the pgvector image keeps the existing data volume.

## 15. Limits and checks during implementation

- Out of scope: text messages and captions; several products in one visual image; suggestions for the seller to confirm; variant detection by attributes or per-variant images; ANN index; accuracy evaluations (evals); showing the match method in UI; seller feedback to measure accuracy in production.
- Verify that Prisma 7.10 supports `extensions = [vector]` and `Unsupported("vector")` in `migrate dev` without a preview flag; if not, enable `postgresqlExtensions` or create the extension in the SQL migration only.
- Verify that `pgvector/pgvector:*-pg18` uses the same `PGDATA` path as `postgres:18-alpine` (`/var/lib/postgresql`), and that it is Debian-based (the volume is compatible; collation versions may warn: run `ALTER DATABASE … REFRESH COLLATION VERSION` if so).
- Verify the chosen providers' data terms: customer screenshots and product photos must not be retained for training. Choose zero-retention options where available.
- `INVALID_MATCHER_RESPONSE` is retryable because model output is not deterministic; 8 retries bound the cost of a misbehaving model per message.
- Cost per message is at most one embedding + one vision call with K+1 images; QR-labelled photos cost nothing.
