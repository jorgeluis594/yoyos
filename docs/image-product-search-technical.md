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
                        │      found / unknown codes / only non-product QR / unreadable → stop
                        └─ 2. no QR code at all → hasIndexedProducts (false → no_indexed_products, no embedder call)
                               → embedImage → findNearestProductImages (pgvector, top K)
                               → readImageBytes ×K → chooseProduct (vision model)
                               → acceptVisualMatch (domain) → findSellableVariantsOfProduct
                        ▼
                    found { method, items } | not_found { reason }
                        ▼
                    existing transaction: open order → appendItems | new order

product create/update with new image ──→ product_image_changed ──→ products.indexProductImage
                                                                     → embedImage → ImageEmbedding
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Scope | Core only. Images of incoming messages only. Text messages and captions are not searched. Mobile and contracts do not change. |
| Cascade order | QR → visual. Visual runs only when the image has no QR code at all (`no_qr_code`). Images whose QR codes are all non-product (Yape/Plin payment, URLs), unknown product QR codes and unreadable images stop the cascade without AI. |
| Owner of the cascade | `products` (`identifyProductsInImage`). `orders` only adds what products identifies. The QR reader and `selectProductCode` move from `orders` to `products`. |
| Products per image | QR keeps one item per distinct variant. Visual returns at most one product per image (a live screenshot shows the product being offered). |
| Variant of a visual match | Product images live at product level. Only products with exactly one sellable variant are added; otherwise `ambiguous_variant`. |
| Effect of a visual match | Added to the order like a QR variant when confidence ≥ threshold. No suggestion or confirmation step; the seller removes a wrong item as today. |
| Vector storage | pgvector in the same PostgreSQL, exact search (no ANN index) filtered by company and model. Embeddings belong to the image, not the product (founder, PR review 2026-10-17): table `ImageEmbedding` keyed by company, image and model, so it can later also cache embeddings of customer-uploaded images. |
| Image embedder (founder, 2026-10-17) | OpenAI is the only v1 provider and has no image embedding endpoint (`/v1/embeddings` is text only, checked 2026-10-17), so `openai-image-embedder.ts` implements `EmbedImage` as describe-then-embed: a vision model (`IMAGE_DESCRIBE_MODEL`, default `gpt-6-luna`, Responses API) writes a visual description of the product from the image resized to ≤1024 px JPEG, with a fixed prompt and no seller data or captions; a text embedding model (`IMAGE_EMBEDDER_MODEL`, default `text-embedding-3-small`, 1536 dimensions) embeds that description. `IMAGE_EMBEDDER_MODEL` always names the model that produces the embedding, for every provider (founder, 2026-10-18). `EmbeddingModel` is `openai/<describe-model>+<embedding-model>`, so changing either model requires `products:index-images`. Env: `IMAGE_EMBEDDER_PROVIDER=openai`, `IMAGE_DESCRIBE_MODEL`, `IMAGE_EMBEDDER_MODEL`, `OPENAI_API_KEY`; the client timeout is `PRODUCT_MATCH_TIMEOUT_MS` and SDK retries are off (the job retries). |
| Local image embedder (founder, 2026-10-18; ships after launch, stacked on #83) | Default `IMAGE_EMBEDDER_PROVIDER=local`: `local-image-embedder.ts` embeds the image directly with a CLIP-family vision encoder run in the worker by transformers.js on onnxruntime-node. One local inference instead of two paid calls, no visual detail lost to a text description, deterministic, and no image leaves the server. The vector only preselects the top K for the chooser, so preselection recall is what the model must maximize. Default model `onnx-community/siglip2-base-patch16-224-ONNX` (Google SigLIP 2 base, Apache-2.0 weights, fp32, 768 dimensions; `IMAGE_EMBEDDER_MODEL` takes any transformers.js CLIP or SigLIP repo id whose files are in `apps/core/models/`), chosen by the measurements below among commercially licensed models (founder, 2026-10-18: SigLIP 2, the largest variant within the worker's latency and RAM limits; MobileCLIP, the first choice, has research-only weights, §15). `EmbeddingModel` is `local/<model id>`, so switching models (or between `local` and `openai`) requires `products:index-images`. The OpenAI describe-then-embed adapter stays selectable with `IMAGE_EMBEDDER_PROVIDER=openai`. Visual search still needs `OPENAI_API_KEY` for the chooser, so without the key both stay disabled as before. |
| Local model measurement (2026-10-18, superseded: it chose MobileCLIP, whose weights are research-only; the choice is in the next row) | 57 CC0 objects from The Met Open Access (20 product-like categories with 3 objects each, so same-category hard negatives), two photos per object; query = second photo, gallery = first photos; cosine on L2-normalized vectors. Some second photos are archival or detail shots, so absolute recall is understated; the numbers compare models. Recall@1 / recall@5 / ONNX size / p50 per image (macOS arm64 host, shared and loaded): `mobileclip_s0` fp32 0.81 / **0.965** / **46 MB** / 115 ms; `mobileclip_s1` fp32 0.83 / 0.965 / 86 MB / 561 ms; `mobileclip_s2` fp32 0.83 / 0.965 / 143 MB / 1.5 s; `clip-vit-base-patch32` q8 0.70 / 0.91 / 89 MB, fp32 0.75 / 0.95 / 352 MB; `clip-vit-base-patch16` q8 0.75 / 0.965 / 87 MB / 242 ms; `siglip-base-patch16-224` q8 0.77 / 0.965 / 99 MB, fp32 0.86 / 0.98 / 372 MB; `siglip2-base-patch16-224` q8 0.72 / 0.95 / 95 MB, fp32 0.91 / 0.965 / 372 MB; `clip-vit-large-patch14` q8 0.81 / 0.93 / 307 MB / 3.5 s; quantized MobileCLIP (s0, s2) collapses (recall@5 ≤ 0.25). `mobileclip_s0` fp32 ties the best recall@5 with K = 5 at an eighth of the size of the SigLIP models and the lowest latency; SigLIP fp32 ranks better at recall@1, which the chooser makes irrelevant, for 8× the size and about 4× the RAM. In the production image (`node:24-slim`, arm64 Docker VM on a loaded host, `--network none`, 2 CPUs, 2 GB limit): load 0.5–1 s once per process, p50 ≈ 0.7 s and p95 1.3–2.2 s per image including decoding, ≈ 245 MB RSS in a bare Node process (+≈ 155 MB for the model); in the real worker (`pnpm worker` under tsx, idle ≈ 240 MB) the model and runtime add ≈ 305 MB (98 → 410 MB peak in a tsx process running 4 concurrent 1080×2400 embeddings over one shared model load), so the worker peaks near 550 MB (independent re-measurement, 2026-10-18); the image grows from 385 MB to 602 MB compressed (1.81 → 2.66 GB unpacked), mostly onnxruntime-node and the onnxruntime-web copy transformers.js depends on. Not yet measured on the x86_64 production server. |
| Commercial model measurement (2026-10-18, model replacement) | Same 57 Met objects plus four harder sets built from them: **shot-same** (query = the gallery photo inside a 1080×2400 phone screenshot of a social post: status bar, account header, caption, price and nav bar, the photo randomly cropped to 75–95 %, light or dark theme, JPEG q70 then re-compressed to 1600 px at q55 like a chat app), **shot-other** (the same frame around the second photo), **color-other** (gallery = every object in three hues, 0°/120°/240°, as separate products; query = the second photo in one hue, so the right color must win among near-duplicates) and **color-shot** (the screenshot frame around the gallery photo in one hue). Hues are synthetic and many Met objects have low saturation, so the color sets understate how distinct real color variants are. Recall@1/@5 per set (met, shot-same, shot-other, color-other, color-shot), host p50 per image (macOS arm64, loaded), RSS delta in a bare Node process: `siglip2-base-patch16-224` **fp32 .88/.96, .93/1.00, .82/.96, .68/.94, .84/.99**, 45 ms, 475 MB; q8 .74/.95, .63/.95, .35/.65, .61/.89, .55/.80 (quantization breaks SigLIP 2 on screenshots); `siglip2-base-patch16-384` fp32 .86/.98, .96/1.00, .86/.96, .68/.94, .80/.99, 134 ms, 525 MB; `siglip2-large-patch16-256` fp32 .88/.98, 1.00/1.00, .79/.98, .70/.93, .71/1.00, 179 ms, 1.34 GB, q8 .82/.98, .86/.98, .68/.88, .62/.88, .69/.93; `siglip2-large-patch16-384` fp32 .86/.98, .95/1.00, .77/.96, .69/.94, .73/.97, 452 ms, 1.41 GB; `siglip2-so400m-patch14-384` q8 .68/.74, .72/.88, .54/.82, .51/.70, .50/.74, 772 ms (fp32, 1.7 GB of weights, exceeds the RAM limit); `siglip-base-patch16-224` (SigLIP 1, baseline) fp32 .82/.96, .95/1.00, .77/.93, .63/.91, .75/.99, 46 ms, 474 MB, q8 .79/.98, .96/1.00, .75/.89, .61/.93, .77/.98; `siglip-large-patch16-384` fp32 .89/.98, .91/1.00, .74/.93, .67/.94, .63/.96, 454 ms, 1.40 GB; `Marqo/marqo-fashionSigLIP` (Apache-2.0) fp32 .86/.98, .98/1.00, .79/.95, .70/.92, .81/1.00, 45 ms, q8 (94 MB) .86/.98, .98/1.00, .77/.93, .71/.95, .79/1.00; OpenAI CLIP `clip-vit-base-patch32` fp32 .68/.95, .88/1.00, .63/.84, .57/.85, .70/.96, `clip-vit-base-patch16` fp32 .75/.93, .89/1.00, .70/.91, .60/.85, .71/.98, `clip-vit-large-patch14` fp32 .75/.95, .91/1.00, .63/.91, .56/.84, .71/.98 (1.30 GB), q8 .81/.96, .95/1.00, .65/.93, .56/.87, .70/.98; `mobileclip_s0` fp32 (reference, not shippable) .77/.96, .96/1.00, .74/.98, .67/.92, .88/.99, 27 ms, 151 MB. Choice: `siglip2-base-patch16-224` fp32 has the best or tied-best recall@5 on every set and the best recall@1 on the screenshot sets except shot-same, where it is within two queries; the larger SigLIP 2 models add no recall on these sets for 3–10× the latency and 3× the RAM, and large fp32 (≈1.35 GB of model on top of the ≈240 MB worker) breaks the 1.5 GB limit; `siglip2-base-patch16-384` ties it at 3× the latency. OpenAI CLIP is excluded on license and quality: its weights have no license on the Hugging Face model card and the card puts "any deployed use case" out of scope, and it ranks lowest here. Marqo FashionSigLIP is a close second (Apache-2.0, fashion-tuned, and its q8 file fits in git), worth re-measuring on real seller catalogs. DINOv2 (Apache-2.0, image-only) and nomic-embed-vision-v1.5 (Apache-2.0) were not measured: the founder stopped the sweep for SigLIP 2, citing published fine-grained retrieval results. In the production image (`node:24-slim` arm64 Docker VM, `--network none`, 2 pinned CPUs, 2 GB limit, host under load average 7–8), the real embedder (decode + model) on 1600 px screenshots: load + first image 6–11 s once per process; serial p50 0.85–1.8 s, p95 2.2–3.4 s; 4 concurrent jobs p50 3.4–5.2 s, p95 5.7–7.6 s; the model adds ≈ 830 MB at peak to a ≈ 105 MB tsx process, so the real worker (idle ≈ 240 MB) peaks near 1.1 GB. `siglip-base-patch16-224` fp32 measured alongside: serial p50 1.8 s, p95 3.1–3.9 s, +≈ 740 MB. `mobileclip_s0` in the same runs: serial p50 0.9 s, p95 1.4–1.7 s, +≈ 300 MB. The arm64 VM is 20–40× slower than the macOS host for every model (the host's onnxruntime likely uses matrix units the VM does not expose), so these p95 values, above the founder's ≈ 1.5 s target, come from a slow environment; latency on the x86_64 production server is still unmeasured and must be checked after deploy. Embedding runs in the background job (timeout `PRODUCT_MATCH_TIMEOUT_MS`), not in a request. Image: 3.29 GB unpacked (2.66 GB with MobileCLIP), the fp32 model is 372 MB. |
| Providers | The founder chooses the embedding model and the vision model before the real adapters are implemented. Vision candidates come from memory: Claude Haiku 5.5, Claude Sonnet 5.5, OpenAI GPT-6 Luna, OpenAI Decisions API. The design is provider-neutral: one adapter per provider behind `EmbedImage` and `ChooseProduct`, selected by env, all passing the same contract tests (§12). v1 implements only the chosen provider of each port. Accuracy evaluations (evals) are out of this design and will be added later. |
| Where AI code lives | `features/products/infrastructure/product-matching/`. SDK clients are created in `products/composition.ts` from env, like `createR2ImageStorage`. No `ai` feature and no shared AI client while there is one consumer. |
| Indexing | Event `product_image_changed { companyId, productId }` published after a create or update that sets a new image; handler `index-product-image` embeds it. Command `index-product-images` publishes the event for every product missing an embedding of the current model (recovery and model change). |
| Model change | Each embedding stores `model`; search only compares embeddings of the configured model. Changing the model = deploy + run the command. |
| Visual search not configured | If the provider keys are missing, composition wires a disabled matcher: visual step returns `not_found` `visual_search_disabled`. Dev and tests run without keys. |
| Customer text in prompts | Captions are not sent to the model (prompt injection surface, no measured gain). |
| Traceability | Match method and confidence go to logs only, consistent with message-to-order ("visibility of skips: logs only"). No new column on `OrderMessage`. |
| Proximity threshold (founder, 2026-10-19) | None yet: measure first, threshold later. `findNearestProductImages` always returns the K nearest products, so non-product images (selfies, memes, receipts) still reach the chooser. Visual outcomes log the cosine distance of the nearest candidate (`topDistance`) and of the chosen one (`chosenDistance`, when the chooser picks a candidate) so hits and non-product images can be compared before choosing a cutoff (§13). |
| Initial values (adjustable, env) | `PRODUCT_MATCH_CANDIDATES=5`, `PRODUCT_MATCH_MIN_CONFIDENCE=0.8`, `PRODUCT_MATCH_TIMEOUT_MS=20000`, images resized to ≤1024 px before sending. |
| Retries | Handler policy unchanged (`concurrency: 2, retries: 8`). Provider unavailable is retryable; invalid model response is permanent (§15). |
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
  | Readonly<{ kind: "skipped"; reason: "product_not_found" | "no_image" | "already_indexed" }>;
export type IndexProductImageError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_NOT_FOUND" | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING";
  message: string;
}>;
export type IndexProductImageDependencies = Readonly<{
  findImageIndexState: (productId: ProductId, model: EmbeddingModel) =>
    Promise<Result<Readonly<{ imageId: ImageId | null; indexed: boolean }> | null, PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<ImageBytes, ImageReadError>>;
  embedImage: EmbedImage;
  saveEmbedding: (embedding: ImageEmbedding) => Promise<Result<void, PersistenceError>>;
  model: EmbeddingModel;
}>;
export async function indexProductImage(input: IndexProductImageInput, deps: IndexProductImageDependencies):
  Promise<Result<IndexProductImageOutcome, IndexProductImageError>>;
```

Flow:

1. `findImageIndexState`: the product's current image and whether that image has an embedding of the model. `null` → `product_not_found`; no `imageId` → `no_image`; `indexed` → `already_indexed`.
2. `readImage(imageId)` → `embedImage` (adapter validates the vector length of the model).
3. `saveEmbedding({ imageId, model, vector })` → `indexed`. Idempotent insert keyed by image and model (§11). If the product replaced its image meanwhile, the row caches the old image's embedding, search ignores it (it joins the product's current image) and the newer event indexes the new image; there is no `image_replaced` outcome.

Handler: `PERSISTENCE_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE`, `EMBEDDER_UNAVAILABLE` retryable; the rest permanent. Policy `{ concurrency: 1, retries: 8 }` (founder, 2026-10-19): the local model saturates the worker's CPU, so indexing one image at a time keeps a catalog upload from slowing customer image searches and bounds RAM; at most three embeddings run at once (one indexing, two `message_created`).

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
  | "unrecognized_qr_code"      // only non-product QR codes (Yape/Plin, URLs); visual is not attempted
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
   - `skip unrecognized_qr_code` → `not_found unrecognized_qr_code` (a payment or URL QR says the image is not a product photo).
   - `skip no_qr_code` → step 2.
2. **Visual.** `visual === null` → `not_found visual_search_disabled`.
   0. `hasIndexedProducts(model)`: cheap `EXISTS` over `ImageEmbedding` of the model joined to the company's active products by their current image. False → `no_indexed_products` without calling the embedder (a provider call per customer image of a company with no indexed catalog is wasted).
   1. `embedImage(image)`.
   2. `findNearestProductImages(vector, model, candidates)`. Empty (no indexed product is sellable) → `no_indexed_products`.
   3. `readImage` of each candidate image, in parallel. `IMAGE_NOT_FOUND` drops that candidate; other errors propagate. All dropped → `no_indexed_products`.
   4. `chooseProduct({ query: image, candidates })` → `VisualChoice`.
   5. `acceptVisualMatch(choice, candidates, minConfidence)` (domain) → `productId` or miss reason.
   6. `findSellableVariantsOfProduct(productId)` → `selectVisualVariant(variants)` (domain): one → `found visual`; zero → `no_visual_match`; several → `ambiguous_variant`.

### 5.3 `addMessageProductsToOrder` (modified, orders)

Exact changes:

- Dependencies: `readQrCodes` and `findVariantsByCodes` are replaced by `identifyProducts: (image: ImageBytes) => Promise<Result<ImageIdentification, IdentifyProductsError>>`.
- Step 3 (outside the transaction): `readImage` → `identifyProducts`. `found` → `variants = items`; `not_found` → `skipped` with the mapped reason.
- `MessageOrderSkipReason` becomes exactly `not_image | outgoing_message | unreadable_image | unrecognized_qr_code | product_not_found | visual_search_disabled | no_indexed_products | no_visual_match | low_confidence | ambiguous_variant`. `unknown_qr_codes` maps to the existing `product_not_found`; the other miss reasons pass unchanged (`unrecognized_qr_code` keeps its existing meaning). `no_qr_code` stops being a final reason because it continues to visual search.
- Outcomes `order_created` and `items_added` add `match: Readonly<{ method: "qr"; unknownCodes } | { method: "visual"; confidence; candidates }>` (replaces the top-level `unknownCodes`).
- `AddMessageProductsError` adds `EMBEDDER_UNAVAILABLE`, `INVALID_EMBEDDING`, `PRODUCT_MATCHER_UNAVAILABLE`, `INVALID_MATCHER_RESPONSE`. Retryable in the handler adapter: the current three plus `EMBEDDER_UNAVAILABLE`, `PRODUCT_MATCHER_UNAVAILABLE`. `INVALID_EMBEDDING` (wrong model configuration) and `INVALID_MATCHER_RESPONSE` (§15) are permanent.
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
| `ImageEmbedding = { imageId; model; vector }` | Persisted entity, owned by the image (no product); no existing type covers it. |
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

model ImageEmbedding {
  companyId String                @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  imageId   String                @db.Uuid
  image     Image                 @relation(fields: [companyId, imageId], references: [companyId, id], onDelete: Cascade, onUpdate: NoAction)
  model     String
  embedding Unsupported("vector")
  createdAt DateTime

  @@id([companyId, imageId, model])
}
```

- One embedding per image and model, never overwritten; deleting the image deletes it. A product uses the embedding of its current image (`Product.imageId = ImageEmbedding.imageId`), so products sharing an image share its embedding, and an image change only needs the new image embedded. No product column: the table will later also cache embeddings of customer-uploaded images.
- `vector` without dimension: exact search only, and every query filters by `model`, so all compared vectors have the same length.
- No ANN index (HNSW) while catalogs have hundreds of products per company; exact scan is cheaper than maintaining the index. Revisit beyond ~10 000 embeddings per company.
- Migration `add_product_image_embeddings` created the `vector` extension and the first, product-keyed table. Migration `replace_product_image_embeddings_with_image_embeddings` (Prisma CLI, `--create-only`) drops `ProductImageEmbedding` (not in production, nothing to backfill; `products:index-images` rebuilds) and creates `ImageEmbedding` with its `companyId` default, `ENABLE`/`FORCE ROW LEVEL SECURITY` and policy `image_embedding_company_isolation` in the same transaction, `lock_timeout = '5s'`. New table: no lock on existing ones.
- `compose.yaml` and `compose.prod.yaml`: `postgres:18-alpine` → `pgvector/pgvector:0.8.1-pg18` (same data directory layout; verify the volume path, §15). `CREATE EXTENSION` runs as the migration owner `core`, not `core_app`.

Queries (raw SQL with parameters; Prisma does not type `vector`):

```sql
-- findNearestProductImages(vector, model, limit): company by RLS
SELECT p.id AS "productId", e."imageId", e.embedding <=> $1::vector AS distance
FROM "ImageEmbedding" e
JOIN "Product" p ON p."companyId" = e."companyId" AND p."imageId" = e."imageId"
WHERE e.model = $2 AND p.status = 'active'
  AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
ORDER BY distance, p.id
LIMIT $3;

-- hasIndexedProducts(model): checked before embedding the customer image
SELECT EXISTS (SELECT 1 FROM "ImageEmbedding" e
  JOIN "Product" p ON p."companyId" = e."companyId" AND p."imageId" = e."imageId"
  WHERE e.model = $1 AND p.status = 'active');

-- saveEmbedding: idempotent; a deleted image writes nothing
INSERT INTO "ImageEmbedding" ("imageId", model, embedding, "createdAt")
SELECT i.id, $model, $vector::vector, now() FROM "Image" i WHERE i.id = $imageId
ON CONFLICT ("companyId", "imageId", model) DO NOTHING;
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
- `eventId`: the bus's random UUID, like every event; the bus contract requires a UUID, and correctness does not depend on collapsing duplicate publications (the use case is idempotent; a duplicate ends as `already_indexed`).
- Strict parser `parseProductImageChanged` in `features/products/infrastructure/event-payloads.ts` (pattern `parseMessageCreated`).
- Subscription `index-product-image` in `composition/event-handlers.ts`, handler from `products/composition.ts`.

| Failure window | What happens | Effect for the seller |
| --- | --- | --- |
| Publication fails after saving the product | Log `product_image_changed_publish_failed`; product saved. | That product is not found visually until `index-product-images` runs. |
| Embedding provider down | Retried 8 times (~21 min), then failed job. | Same; reprocess with `boss.retry` or the command. |
| Image replaced while indexing | The old image's embedding is stored and ignored by search. | Nothing; the newer event indexes the new image. |
| Duplicate event | `already_indexed`. | Nothing. |

### 9.2 Orders → products

`orders/composition.ts` wires `identifyProducts` with `products.identifyProductsInImage` from `products/composition.ts`. Dependency direction stays `orders → products`; products never imports orders.

### 9.3 Command `index-product-images`

`apps/core/scripts/index-product-images.ts` (`pnpm --dir apps/core products:index-images`). Lists companies through their users with `systemPrisma` (Company has FORCE RLS for `core_app`; a company without users has no products), and per company inside `withTenantIsolation` lists active products with an image and without an embedding of the current model, and publishes `product_image_changed` for each. Indexing runs in the worker; the command does not call providers.

## 11. Transactions and concurrency

- Visual search is read-only and runs outside the order transaction, like QR reading today. Provider calls never hold a lock.
- `saveEmbedding` is one idempotent statement (`ON CONFLICT DO NOTHING`) keyed by image and model, so concurrent or duplicate indexing of the same image never conflicts and needs no product lock. An embedding is a fact about its image, so a product image change during indexing cannot store a wrong row.
- A product image change concurrent with a search: the query joins `p."imageId" = e."imageId"`, so the old image's embedding is ignored.
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
│   ├── image-embeddings.ts               # findImageIndexState, saveEmbedding, listProductsMissingEmbedding, hasIndexedProducts, findNearestProductImages
│   ├── qr-code-reader.ts                 # moved from orders
│   └── product-matching/
│       ├── product-chooser.ts            # provider-neutral: prompt, labels A/B/…, output Zod schema, label → productId, image resize
│       ├── product-chooser.contract.ts   # shared contract test suite every ChooseProduct adapter runs
│       ├── <provider>-product-chooser.ts # one ChooseProduct adapter per provider (only the chosen one in v1)
│       ├── image-embedder.contract.ts    # shared contract test suite every EmbedImage adapter runs (backend: HTTP transport or model loader)
│       ├── local-image-embedder.ts       # default EmbedImage: CLIP-family vision encoder in the worker (transformers.js + onnxruntime-node)
│       └── openai-image-embedder.ts      # EmbedImage via describe (vision model) + text-embedding-3-small
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
- **Embedder port location.** `EmbedImage` is declared in `application/index-product-image.ts` (its first consumer); `identify-products-in-image.ts` imports it from there.
- **Selection.** `products/composition.ts` reads `PRODUCT_MATCHER_PROVIDER` + `PRODUCT_MATCHER_MODEL` and `IMAGE_EMBEDDER_PROVIDER` + `IMAGE_EMBEDDER_MODEL` (+ `IMAGE_DESCRIBE_MODEL` for `openai`) and builds the adapter with an exhaustive `switch` over the provider names that exist. Unknown provider → startup error. Missing key → `visual: null` (`visual_search_disabled`).
- **Changing the vision provider** = set the two env variables and redeploy; no data changes.
- **Local embedder runtime.** The model loads lazily on the first embedding, once per process: concurrent first jobs share one load and a failed load is forgotten so the job retry loads again. Load or inference failure → `EMBEDDER_UNAVAILABLE` (retryable); undecodable image, wrong length or non-finite or zero vector → `INVALID_EMBEDDING`. The expected length comes from one probe inference at load, because model configs do not state it consistently. Images get the same sharp rules as the other adapters (EXIF rotation, ≤1024 px, 24 MP input limit), then the model's own processor resizes them; vectors are L2-normalized for pgvector's cosine `<=>`. transformers.js is imported lazily, so web and scripts never load the native runtime.
- **Model files offline (founder, 2026-10-18).** The model lives in `apps/core/models/<model id>/` (only `config.json`, `preprocessor_config.json` and `onnx/vision_model.onnx`, fp32 passed explicitly; source, revision, license and sha256 in `models/README.md`). Its 372 MB vision tower exceeds GitHub's 100 MB file limit and Git LFS would exhaust the free monthly bandwidth on Coolify deploys and CI runs, so `pnpm models:fetch` (`scripts/fetch-image-model.ts`) downloads it from a pinned Hugging Face revision and rejects any file whose sha256 differs; only the README and the license are committed. The Dockerfile runs it with plain `node` in its own cached layer before installing dependencies, so dependency and schema changes reuse the download (`.dockerignore` keeps local copies out of the context), CI runs it with `actions/cache`, and developers run it once. The loader sets transformers.js `env.allowRemoteModels = false` and `env.localModelPath` to `models/` (resolved from the working directory, `apps/core` in every script and in Docker, because the web build bundles the module), so the app and the tests never download. A model whose files are missing fails to load (`EMBEDDER_UNAVAILABLE`). The image is `node:24-slim` (Debian), not Alpine, because onnxruntime-node ships glibc binaries only (checked 2026-10-18: on `node:24-alpine` the binding fails to load, also with `gcompat`, and transformers.js has no WASM fallback in Node).
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
| `orders_message_order_created` / `_items_added` (existing) | info | orders handler adapter | add `["matchMethod", "confidence", "candidates"]` to the current fields; visual matches also `["topDistance", "chosenDistance"]` (cosine distances, §2 proximity threshold) |
| `orders_message_order_skipped` (existing) | info | orders handler adapter | `reason` takes the new values; `no_visual_match`, `low_confidence` and `ambiguous_variant` also log `topDistance` and, when the chooser picked a candidate, `chosenDistance` |
| `orders_message_order_failed` (existing) | warn/error | orders handler adapter | `code` takes the new values |
| `product_visual_match_completed` | info | `<provider>-product-chooser.ts` | `["companyId", "candidates", "choice", "confidence", "model", "durationMs", "inputTokens", "outputTokens"]` (`choice`: `"product"` or `"none"`, never the label content) |
| `product_matcher_request_failed` | warn | `<provider>-product-chooser.ts` | `["companyId", "model", "errorCode", "httpStatus", "durationMs", "err"]` |
| `product_matcher_invalid_response` | error | `<provider>-product-chooser.ts` | `["companyId", "model", "errorCode", "err"]` |
| `product_image_embedding_failed` | warn | `<provider>-image-embedder.ts` | `["companyId", "model", "errorCode", "httpStatus", "durationMs", "err"]` (`httpStatus` only for HTTP providers) |
| `product_image_indexed` | info | products handler adapter | `["companyId", "productId", "imageId", "model", "durationMs"]` |
| `product_image_index_skipped` | debug | products handler adapter | `["companyId", "productId", "reason"]` |
| `product_image_index_failed` | warn (retryable) / error (permanent or exhausted) | products handler adapter | `["companyId", "productId", "eventId", "errorCode", "retryable", "attempt", "err"]` |
| `product_image_changed_publish_failed` | error | products composition | `["companyId", "productId", "errorCode", "err"]` |
| `product_visual_search_disabled` | info | products composition, at startup | `["reason"]` |

Never logged: image bytes, base64, prompts, raw model responses, captions, product names, vectors, API keys. Distances are plain numbers and are allowed.

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
- `test("stops with unrecognized_qr_code without calling visual search when the image only has non-product QR codes")`
- `test("returns visual_search_disabled when visual search is not configured")`
- `test("returns no_indexed_products without embedding the image when the company has no indexed products")`
- `test("returns no_indexed_products when no sellable product is near")`
- `test("propagates a failure of the indexed products check without embedding")`
- `test("drops candidates whose image no longer exists and asks the model with the rest")`
- `test("returns the only variant of the chosen product with its confidence")`
- `test("returns low_confidence, no_visual_match or ambiguous_variant from the domain rules")`
- `test("propagates embedder, matcher, storage and persistence failures")`

`features/products/application/index-product-image.test.ts`

- `test("embeds the current product image and saves it under the image and model")`
- `test("skips a product without image, a missing product and an already indexed image")`
- `test("propagates image storage and embedder failures without saving")`
- `test("propagates a save failure")`

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
- `test("skips photos without QR codes as visual_search_disabled when visual search is off")`
- `test("skips photos with only non-product QR codes as unrecognized_qr_code")`
- `test("skips with the identification miss reason when no product is identified")`
- `test("identifies the products before opening the transaction")`
- `test("propagates embedder and matcher failures")`

`features/orders/composition.test.ts` (updated)

- `test("treats embedder and matcher unavailability as retryable")`
- `test("treats INVALID_EMBEDDING and INVALID_MATCHER_RESPONSE as permanent")`
- `test("logs the match method and confidence without images or product names")`

`composition/event-handlers.test.ts`

- `test("registers index-product-image for product_image_changed with concurrency 1 and 8 retries")`

### Integration (core, PostgreSQL)

`features/products/infrastructure/image-embeddings.integration.test.ts`

- `test("saveEmbedding keeps the first embedding of an image and model and the index state follows the product's current image")`
- `test("saveEmbedding writes nothing for a deleted image and deleting an image deletes its embeddings")`
- `test("listProductsMissingEmbedding lists only active products whose current image lacks an embedding of the model")`
- `test("tenant isolation hides embeddings of another company")`
- `test("hasIndexedProducts is true only when a product of the company has its current image embedded with the model")`
- `test("findNearestProductImages returns the closest products of the company ordered by distance")`
- `test("findNearestProductImages ignores embeddings of another model, of a replaced image and of another company")`

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
- Verify that `pgvector/pgvector:*-pg18` uses the same `PGDATA` path as `postgres:18-alpine` (`/var/lib/postgresql`), and that it is Debian-based (the volume starts with its data, but musl and glibc sort text differently, so text indexes are silently inconsistent until `REINDEX DATABASE core`; `REFRESH COLLATION VERSION` fails on these volumes; procedure in `README.md`).
- Verify the chosen providers' data terms: customer screenshots and product photos must not be retained for training. Choose zero-retention options where available.
  Checked 2026-10-17: the embedder's Responses call sends `store: false`; the Decisions API has no `store` or retention parameter and keeps no application state, only up to 30-day abuse-monitoring logs that Zero Data Retention (account-level, eligible customers) removes.
- `INVALID_MATCHER_RESPONSE` is permanent: its causes (provider 4xx, malformed output, undecodable catalog images, unsupported candidate count) repeat on every paid attempt, so retrying only multiplies cost.
- Cost per message is at most one embedding + one vision call with K+1 images; QR-labelled photos cost nothing. With the local embedder the embedding is free and only the vision call is paid.
- Local embedder (2026-10-18): the real-model test (`local-image-embedder.integration.test.ts`, integration suite) checks that two photos of one product are closer than a photo of another product of the same kind. It loads the model only from `apps/core/models/` with `fetch` stubbed to throw, so it runs offline; CI fetches the files first (`pnpm models:fetch`, cached), and only a local run without them skips. Accuracy on real seller catalogs and customer screenshots is still unmeasured (evals are out of scope); if preselection misses products, raise `PRODUCT_MATCH_CANDIDATES` or try a SigLIP fp32 model with a reindex.
- License (checked 2026-10-18): the default `onnx-community/siglip2-base-patch16-224-ONNX` is the transformers.js ONNX export of `google/siglip2-base-patch16-224`, whose model card licenses the weights under Apache-2.0 (commercial use and redistribution allowed with the license text, committed next to the model in `apps/core/models/`). `Xenova/mobileclip_s0`, the first default, converts `apple/ml-mobileclip`, whose code is MIT but whose weights are under the Apple ML Research Model Terms of Use (research only), so it was replaced before merge and must not ship. OpenAI CLIP weights have no license on their model card, which puts any deployed use out of scope, so they are not candidates. Check a candidate's weight license on the original model card, not only its code license.
- Base image change: `node:24-slim` ships `postgresql-client` 15 for the `migrate` service against PostgreSQL 18 (the scripts use only `\gexec` and `\ir`; CI already runs psql 16 against 18).
