# Multiple photos per product: technical design

**Status:** design closed, pending implementation. Based on `docs/drafts/varias-fotos-por-producto.md` (part A) and on «Alcance B» and the acceptance criteria of Todoist task 6hpQq4RvPqcW98CV (part B, no product document by founder decision). Base: `jorgeluis594/varias-fotos-por-producto-con-foto-princ` at `27ade077` (main at `b2ca1163`).

## 1. Technical goal

A product stores an ordered list of up to 8 images; position 0 is the primary photo. Core validates and stores the whole list in the product create and save, under the product row lock, and serves it ordered. Every surface that shows one photo reads position 0. Visual search embeds every photo and compares a customer image with all of them, one candidate per product. The public catalog product page receives every photo in saved order, and the web gallery with lightbox (part B) renders over that list.

```text
seller form (web / mobile)
  ├─ POST /api/images (one request per photo, ≤ 2 at a time) ──→ Image
  └─ POST|PUT /api/products { photoIds } ──→ Product ─┬─ ProductPhoto(position 0..7) ─→ Image ─→ ImageEmbedding(model)
                                                     │
                     after commit: product_photos_added { companyId, productId }
                                                     └─→ worker: index every unindexed photo of the product, one at a time

readers of position 0: product list, catalog card, cart, checkout (findVariantPhotos), store preview
readers of the whole list: product detail (seller), catalog product page (gallery + lightbox, part B)
visual search: nearest photo per product (DISTINCT ON product) → chooser sees that photo
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Data model | New table `ProductPhoto (companyId, productId, imageId, position)`; `Product.imageId` is dropped. The primary is `position = 0`; there is no primary flag. |
| Migration | One Prisma migration creates `ProductPhoto` with RLS, copies every non-null `Product.imageId` as position 0 and drops the column. Existing embeddings keep working because they are keyed by image. |
| Create contract | `photoIds: uuid[]` replaces `imageId` (empty list = no photo). |
| Save contract | `photoIds?: uuid[]` replaces `imageId`. Omitted = photos untouched; present = the whole new list, `[]` removes every photo. The client sends it only when the list to save differs from the loaded one. |
| Detail contract | `product.photos: { id, url }[]` (ordered, primary first) replaces `product.imageId` and the top-level `image`. List items keep `image?` and it means the primary. |
| Photo rules in core | At most 8 (`productPhotoLimits.maxPhotos`), no repeated id, every id an image of the company. Violations are `422 VALIDATION_ERROR` issues with `scope: "photo"` and the index of the offending photo, reported together with every other issue. `IMAGE_NOT_FOUND` stops being a write error. |
| Concurrency | Photo changes are written under the existing product row lock; they update `updatedAt` but not `structureVersion`. Between two saves that both send `photoIds`, the last one wins. |
| Indexing event | `product_photos_added { companyId, productId }` replaces `product_image_changed`; published after commit when the saved list has an image the product did not have. Removing photos publishes nothing. |
| Indexing | The handler (`concurrency: 1`) tries every unindexed photo of the product sequentially, in position order, and never stops at a failed photo: each photo has its own outcome. The job fails (and is retried) only when some photo failed with a retryable code; permanent failures (`INVALID_EMBEDDING`, `IMAGE_NOT_FOUND`) are logged per photo and the job succeeds, so one bad photo never keeps the others unindexed. Already indexed images are skipped, so a retry only redoes the missing ones. |
| Search | Nearest query is driven from the product's current photos (`ProductPhoto`) into `ImageEmbedding`, takes the closest photo per product (`DISTINCT ON` product), then the K nearest products. The chooser receives that photo. Exact scan, no ANN index. |
| Reindex | `products:index-images` publishes `product_photos_added` for every active product with at least one photo lacking an embedding of the configured model. |
| Weight vs dimensions (413) | No contract change. Web checks `file.size > imageUploadLimits.maxBytes` before uploading and shows the weight text without sending; any `413 IMAGE_TOO_LARGE` for a sent file is the dimensions text. Mobile re-encodes to fit the byte limit, so its 413 is always dimensions (the same reading `store-appearance` already applies). |
| Which photo failed on save | Core names it: the issue carries `index` into the sent `photoIds`. The field-level fallback text is used only for `TOO_MANY_PHOTOS` and unknown issues. |
| Shared photo field model | `shared/product-photos.ts`: pure state and rules of the «Fotos» field (order, primary, marks, free places, list to save, unsaved-photos predicate for «¿Descartar cambios?», save blockers, failure reason), consumed by web and mobile so both apply the same rules. T0 creates the file with only the `PhotosToSave` type; T1 adds everything else. |
| Uploads | Each photo uploads on its own with `POST /api/images`; each client runs at most 2 photo jobs at a time (initial value, adjustable) and the rest wait as «Subiendo…». On mobile a job is prepare (`fitJpeg`) plus upload, so at most 2 photos are decoded at once. The 2-minute timeout (initial value, adjustable) counts from the start of that photo's request; cancel and timeout abort the request and ignore a late answer. Both values are a shared client constant, not environment variables (exception to guide 6.8): they run inside the web bundle and the mobile build, which have no per-environment operational configuration, and one constant keeps both platforms identical; changing them needs a release. |
| Public catalog read model | `CatalogProduct.photoUrls: string[]` (ordered, primary first, unresolvable photos dropped and reported) replaces `imageUrl`. `CatalogCard.imageUrl` stays and is the primary. |
| Part B platform | The public catalog is rendered only by the web app (`apps/core/app/routes/catalog-product.tsx`); `apps/mobile` has no storefront, only catalog settings. The buyer's «móvil» behavior (swipe, swipe down to close) is touch behavior of the web page in a phone browser. |
| Part B interaction | Clicking or tapping any photo of the product page, the large one or a thumbnail, opens the lightbox on that photo (founder criterion «clic en cualquiera abre el lightbox en esa foto»). On the page, the large photo changes by swiping on touch; thumbnails open the lightbox. With two or more photos the thumbnail row shows every photo, the primary included, with `aria-current` on the one shown large: an interpretation of «foto principal grande y miniaturas de las demás», because the large photo changes when swiped and the row must show which one is large (recorded in §17). With exactly one photo the page looks as today: only the large photo, no thumbnail row and no swipe; clicking or tapping it opens the lightbox without navigation or indicator. Without photos the page keeps today's neutral block with the initial and nothing opens. |
| Part B lightbox | Full screen: the lightbox content covers the whole viewport (`100dvw × 100dvh`), the photo is scaled to fit inside it without cropping (`object-contain`), on a fixed dark scrim. A click on the scrim around the photo closes it through its own handler (the scrim is inside the dialog content, so Radix's outside-click does not apply). |
| Part B components | Gallery and lightbox live in `apps/core/app/components/catalog-gallery.tsx`, composed from the Radix `Dialog` primitives (focus trap, Esc, labelled title) with `Dialog.Portal container` = the catalog theme host, as `app/components/ui/sheet.tsx` does. The shared `app/components/ui/dialog.tsx` does not change. Swipe uses CSS scroll snap and pointer events; no new dependency. |
| Public page weight | Accepted for this version with mitigations: the primary loads eagerly with `fetchpriority="high"`, thumbnails use `decoding="async"` and are requested only after the primary has loaded or failed to load. These fix the order (the primary first), not the volume: thumbnails use the same original URLs as the slides, so once they are requested every original downloads. A product with 8 photos downloads 8 originals (up to 10 MB each) on a phone. Resized variants are deferred; the delivery proposes a Todoist follow-up for them (§15). |
| Deferred | Photos per variant (Todoist 6hqMVjGfqcR7rF6V); deleting files of removed photos (future image cleanup); thumbnails or resized variants of photos (proposed follow-up, §15); drag reordering. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `Product.imageId` + composite FK to `Image` (RESTRICT) | `apps/core/prisma/schema.prisma:347-348`, migration `20260924060712_add_products` | One optional photo; replaced by `ProductPhoto` |
| `ImageEmbedding (companyId, imageId, model)` | `schema.prisma:363-373` | Keyed by image; unchanged |
| RLS pattern for product child tables | `prisma/migrations/20261026212625_add_product_options/migration.sql` | `ENABLE` + `FORCE` + `<table>_company_isolation` policy over `app.company_id`, inside `BEGIN … COMMIT` with `lock_timeout` |
| `Product.imageId?` domain field, `SaveRequest.imageId`, `ProductStructureChange.product.imageId` | `features/products/domain/product.ts:30`, `domain/product-structure.ts:155,180,353` | Replaced by the photo list |
| `createProduct`, `saveProduct` with `findImage` and `publishProductImageChanged` | `features/products/application/create.ts`, `save-product.ts` | Check one image, publish when it changes; extended to the list |
| `getProduct` resolving one image | `application/get.ts:31-35` | Resolves the list in one batch |
| List, catalog card and catalog product SQL reading `p."imageId"` | `infrastructure/repository.ts:327-355`, `infrastructure/catalog-products-repository.ts:16-80` | Switch to position 0 / ordered list |
| `findVariantPhotos` → `findVariantImages` (`product.imageId`) | `application/variant-photos.ts`, `infrastructure/variant-photo-repository.ts:16` | Reads position 0; only caller `orders/composition.ts:161-166` (checkout) |
| `findSellableVariants` returning `imageId` | `infrastructure/order-stock.ts:23,40` | Used by the catalog cart (`features/catalog/cart-composition.ts`); becomes the primary |
| `product_image_changed`, handler `index-product-image` (`concurrency 1, retries 8`) | `application/events.ts`, `infrastructure/event-payloads.ts`, `products/composition.ts:130-156`, `src/composition/event-handlers.ts:56-59` | One image per product; replaced by `product_photos_added` and a list handler |
| Embedding queries joining `Product.imageId` | `infrastructure/image-embeddings.ts` (`findImageIndexState`, `listProductsMissingEmbedding`, `hasIndexedProducts`, `findNearestProductImages`) | Join `ProductPhoto` instead |
| Reindex script | `apps/core/scripts/index-product-images.ts` (`pnpm products:index-images`) | Per product; keeps its shape |
| Visual outcome logging | `products/application/identify-products-in-image.ts` (`VisualDistances`), `orders/composition.ts:473,486` | Gains the position of the chosen photo |
| Image upload and 413 | `apps/core/src/shared/images/presentation/routes.ts:9,47,50-52,66-68` | `413 IMAGE_TOO_LARGE` for weight, resolution and request size; no change |
| Upload clients | Web `src/shared/images/presentation/client.ts` (`uploadImageFile`); mobile `src/shared/infrastructure/image-api.ts` (`uploadImage`) | No abort signal today; gain one |
| Product contracts | `shared/contracts/products.ts` (`imageId` in create/save, `product.imageId` + `image` in detail with a matching refine) | Changed in place |
| Shared editor body builders | `shared/product-variants.ts:56,416,428` (`ProductMeta.imageId`, `buildCreateProductBody`, `buildSaveProductBody`) | Carry the photo list |
| Web form | `features/products/presentation/product-form.tsx:26-31,103-165` (`ProductImageSelection` keep/set/remove, one file input), routes `app/routes/product-new.tsx:66-69`, `app/routes/product-detail.tsx:30-36,98-121` | Replaced by the «Fotos» field |
| Mobile form | `apps/mobile/src/features/products/presentation/product-photo.tsx` (one photo, `fitJpeg`, `expo-image-picker`), `domain/product.ts` (`photo`, `PhotoSelection`), `domain/product-editor.ts:7`, `application/product-operations.ts:24-38`, `infrastructure/product-api.ts:123,153`, `create-product-screen.tsx`, `product-management-screen.tsx` | Replaced by the photo strip |
| Mobile list thumbnail | `apps/mobile/src/features/products/presentation/catalog-screen.tsx:201-203` | Reads list `image`; unchanged |
| Web seller product list | `app/routes/product-list.tsx:26` | Shows no thumbnails; unchanged |
| Public catalog product page | `app/routes/catalog-product.tsx:85,96`, `app/components/catalog-sections.tsx:55-72` (`CatalogProductImage`) | One photo, no lightbox |
| Catalog cart sheet in the theme host | `app/components/catalog-cart.tsx:187-190` (`SheetContent container={host}`) | Pattern reused by the lightbox |
| Store themes | `shared/store-themes.ts` (`classic`, `boutique`, `antojo`, `suave`, `noche`) | Unchanged |
| Mobile and the storefront | `apps/mobile/src/features/catalog/` (settings, publication, link only) | No storefront rendering, no WebView |
| E2E specs touching photos | `tests/e2e/products-photo.spec.ts`, `products-create.spec.ts`, `public-catalog.spec.ts`, `store-appearance-buyer.spec.ts`, `message-to-order.spec.ts`, `mobile-product-printing.spec.ts:31` (creates with `imageId: null`) | Updated per task |
| Other `imageId` fixtures and labels | `app/stories/page-patterns.stories.tsx:172`, `app/locales.ts:174-175,453-454` (field label and subject `imageId`) | Renamed to `photoIds` by T0 |
| Image batch lookup | `src/shared/images/infrastructure/image-repository.ts` `findMany(ids)` (RLS) | Exists; unlike `find`, it does not rethrow transaction failures inside an active transaction |
| Migration role | `compose.yaml` `migrate` service connects as `core`, the image's superuser; `core_app` is `NOBYPASSRLS` and never runs migrations | Earlier migrations (`separate_order_buyer`) already copy rows out of FORCE-RLS tables |
| Radix dialog with a container | `app/components/ui/sheet.tsx:12-25` composes `Dialog.Portal container`; `app/components/ui/dialog.tsx` has no `container` | Pattern reused by the lightbox |
| Event metadata | `src/shared/events/application/contracts.ts:7` `EventMetadata { eventId, occurredAt }` | Gives the queue latency of an indexing job |

## 4. Gaps this design closes

1. No storage for several ordered photos per product (§7).
2. Create and save accept one `imageId`; no limit, repeat or ownership check over a list, and no way to say "photos untouched" (§5, §8).
3. Readers take `Product.imageId`; they must take position 0 or the whole list (§5.4, §7.4).
4. Indexing and search consider one image per product (§5.5, §5.6).
5. A failed photo on save cannot be identified by the client (§8.3).
6. The client cannot tell weight from dimensions on `413` (§2, §8.4).
7. No shared field model for order, primary, marks and touched list (§6.3).
8. Web and mobile upload one photo, cannot cancel an upload and block saving while it runs (§10, §12).
9. The public product page receives one URL and has no gallery or lightbox (§5.4, §12.5).

## 5. Use cases

All core use cases keep the `input`, `access`, `deps` shape and `Result` returns of the products feature. `access` is the existing `ProductAccess { companyId, userId }` for seller operations and the storefront tenant scope for catalog reads.

### 5.1 `createProduct` (modified, `products/application/create.ts`)

- `input.photoIds: readonly ImageId[]` replaces `imageId?: ImageId | null`.
- `deps.findImages: (ids: readonly ImageId[]) => Promise<Result<ReadonlySet<ImageId>, ImageLookupError>>` replaces `findImage`; it returns the ids that exist for the company (RLS). It is wired in `products/composition.ts` over the existing `imageRepository.findMany` (one `id IN` query). `findMany` gains `find`'s rule: inside an active transaction a timeout, lock conflict or aborted transaction is rethrown so the transaction boundary reports it once, instead of returning `PERSISTENCE_UNAVAILABLE` over an aborted transaction.
- `deps.publishProductPhotosAdded: (productId: ProductId) => Promise<Result<void, EventBusError>>` replaces `publishProductImageChanged`.
- Errors: `IMAGE_NOT_FOUND` leaves the union; photo problems are `VALIDATION_ERROR` issues.

Flow:
1. Parse the photo list with `parseProductPhotos` (§6.1); its issues join the other validation issues.
2. When the list parses and is not empty, `findImages(photoIds)`; each missing id adds `{ scope: "photo", field: "photoIds", index, reason: "PHOTO_NOT_FOUND" }`.
3. Report every issue together as today; otherwise insert the product with its photo rows in the existing create transaction.
4. After commit, publish `product_photos_added` when the list is not empty. A failed publish is logged and does not fail the create.

### 5.2 `saveProduct` (modified, `products/application/save-product.ts`)

- `SaveRequest.photoIds?: readonly ImageId[]` replaces `imageId: ImageId | null`. `undefined` means "do not touch".
- Same `findImages` and `publishProductPhotosAdded` dependencies as create.

Flow inside the existing transaction, after `lockProduct` and the `structureVersion` check:
1. When `photoIds` is present, parse it (§6.1) and, if it parses, `findImages` over the ids that the product does not already have (the ones it has are guaranteed by the foreign key). Issues join the plan, SKU and foreign-id issues.
2. `planProductSave` puts `photos: ProductPhotos` in `ProductStructureChange` only when the parsed list differs from `current.photoIds` (same ids in the same order is no change). A photo change sets `updatedAt` and never `structureVersion`; `isEmptyChange` counts it.
3. `applyStructureChange` replaces the rows (§7.3) in the same transaction.
4. Return `{ detail, addedPhotos: boolean }`; `addedPhotos` is true when the new list holds an id not in `current.photoIds`. After commit, publish `product_photos_added` when it is true.

A stale form that omits `photoIds` changes nothing about photos even if another device changed them; a form that sends the list replaces it (last write wins under the row lock).

### 5.3 `getProduct` (modified, `products/application/get.ts`)

- `Detail.photos: readonly { id: ImageId; url: string }[]` replaces `image?`.
- `deps.resolveImages: (ids: readonly ImageId[]) => Promise<Result<ListImages, ProductReadError>>` (the existing batch resolver `listImages.resolve`) replaces `resolveImage`.
- A photo that the resolver omits or fails is `IMAGE_NOT_FOUND` for the whole read, as today with one image (the routes keep mapping it to 503). The seller detail never silently hides a photo, because a later save would send a list without it.

### 5.4 Readers of the primary or the list (modified)

| Reader | Change |
| --- | --- |
| `listProducts` (`repository.ts` `summarySql`) | `imageId` comes from `ProductPhoto` at position 0 (`LEFT JOIN` on the primary key); `pp."imageId"` is added to `GROUP BY p.id` because it is not functionally dependent on it. The query already runs over the ids of one page. The list contract keeps `image?`. |
| `listCatalogProducts` (catalog cards) | The position 0 join goes in the outer query, after the inner subquery that cuts the page, next to the lateral aggregates, so it runs for one page and not for every active product of the company. |
| `findCatalogProduct` | `StoredCatalogProduct.photoIds: readonly ImageId[]` (ordered) replaces `imageId`; `resolveImages` in one batch; `toCatalogProduct(product, photoUrls)` keeps the saved order and drops photos that do not resolve (decorative, reported with the existing `product_list_images_unavailable`). |
| `findVariantPhotos` (checkout) | `findVariantImages` reads the photo at position 0 of each variant's product, any status, selecting only that row through the relation (`photos: { where: { position: 0 }, select: { imageId: true } }`), never the whole `photos` relation. |
| `findSellableVariants` (cart, catalog order) | Returns `primaryImageId: ImageId | null` (renamed from `imageId`, which no longer names a stored column). `features/catalog/cart-composition.ts` reads the new name. Same selection as `findVariantImages`: only position 0, not the whole relation. |
| Store appearance preview | Uses catalog cards; no own change. |

### 5.5 `indexProductPhotos` (replaces `indexProductImage`, `products/application/index-product-photos.ts`)

```ts
export type IndexProductPhotosInput = Readonly<{ productId: ProductId }>;
export type PhotoIndexFailure = Readonly<{
  imageId: ImageId;
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_NOT_FOUND" | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING";
  message: string;
}>;
/** Every unindexed photo was tried; `failed` holds the photos that could not be indexed, retryable or not. */
export type IndexProductPhotosOutcome =
  | Readonly<{ kind: "processed"; indexed: readonly ImageId[]; failed: readonly PhotoIndexFailure[] }>
  | Readonly<{ kind: "skipped"; reason: "product_not_found" | "no_photos" | "already_indexed" }>;
export type IndexProductPhotosError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>; // only the state read
export type IndexProductPhotosDependencies = Readonly<{
  /** Photos of the product in position order with whether each image has an embedding of the model; null when the product does not exist. */
  findPhotoIndexState: (productId: ProductId, model: EmbeddingModel) =>
    Promise<Result<readonly Readonly<{ imageId: ImageId; indexed: boolean }>[] | null, PersistenceError>>;
  readImage: (imageId: ImageId) => Promise<Result<ImageBytes, ImageReadError>>;
  embedImage: EmbedImage;
  saveEmbedding: (embedding: ImageEmbedding) => Promise<Result<void, PersistenceError>>;
  model: EmbeddingModel;
}>;
export const indexProductPhotosPolicy = { concurrency: 1, retries: 8 } as const;
```

Flow: load the state (a failed read is the only error); `null` → `product_not_found`; empty → `no_photos`; every photo indexed → `already_indexed`. Otherwise, for each unindexed photo in position order: read, embed, save; a failure is recorded in `failed` and the loop continues with the next photo. The use case returns `processed` with both lists; it decides nothing about retries.

The handler in `products/composition.ts` decides with the existing `retryableIndexCodes` (`PERSISTENCE_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE`, `EMBEDDER_UNAVAILABLE`):
- No failure: success.
- Only permanent failures (`INVALID_EMBEDDING`, `IMAGE_NOT_FOUND`): each logged as `product_photo_index_failed` at error level; the job succeeds, so the other photos are already indexed and nothing is retried.
- At least one retryable failure: the job returns a retryable error and is retried (up to 8 times); the retry skips every photo indexed meanwhile and tries the failed ones again, including permanent ones (bounded cost: at most 8 photos per retry).

A photo that always fails permanently stays without embedding; `products:index-images` republishes its product on every run and the job tries it once more without blocking the others (accepted: one embed attempt per bad photo per manual run). A photo removed while the job runs still gets its embedding saved (harmless: search joins current photos only). Photo bytes are read with the images module's `readImageBytes(imageId)`; the state query does not return storage keys, because storage keys are internal to the images module (one primary-key lookup per photo, at most 8).

### 5.6 `identifyProductsInImage` (modified, visual step only)

- `findNearestProductImages(vector, model, limit)` returns at most one candidate per product: its closest photo (§7.4). `VisualCandidate` gains `position: number`.
- `hasIndexedProducts(model)` is true when any photo of an active product with an active variant has an embedding of the model. It is written like the nearest query: an `EXISTS` from active products and their current photos into the `ImageEmbedding` primary key, so its cost follows current photos and never the embeddings left by removed photos.
- `VisualDistances` gains `chosenPhotoPosition?: number`, the position of the photo the chooser saw for the accepted product, so logs show whether a non-primary photo identified the product.
- QR step, chooser input (one image per candidate), confidence and single active variant rules are unchanged.

### 5.7 Clients (no core use case)

- Web: the «Fotos» field component drives `uploadImageFile(file, { signal })`, the shared field model and the route save. Web routes map the submission to `photoIds` (create) or to `photoIds` / omission (save).
- Mobile: `product-operations.ts` create and save receive the photo list or `untouched` from the shared model and build the bodies with `buildCreateProductBody` / `buildSaveProductBody`.

## 6. Domain and typing

### 6.1 Core domain (`products/domain/product.ts`, `domain/photos.ts`)

```ts
/** Ordered image ids of a product; position 0 is the primary. At most productPhotoLimits.maxPhotos, no repeats. */
export type ProductPhotos = readonly ImageId[] & { readonly __brand: "ProductPhotos" };
export function parseProductPhotos(ids: readonly ImageId[]): Result<ProductPhotos, readonly ValidationIssue[]>;
export const primaryPhoto = (photos: ProductPhotos): ImageId | null => photos[0] ?? null;
export const samePhotos = (a: ProductPhotos, b: ProductPhotos): boolean; // same ids, same order
```

- `Product.photoIds: ProductPhotos` replaces `imageId?`. Justification: the order and the two invariants are the rule; a plain array would let an unchecked list reach the repository.
- `parseProductPhotos` issues: more than 8 → one `{ scope: "product", field: "photoIds", reason: "TOO_MANY_PHOTOS", maximum: 8 }`, returned at once without scanning for repeats (the request schema has no `.max`, so a malformed list of thousands of ids costs one length check); otherwise a repeated id → `{ scope: "photo", field: "photoIds", index, reason: "DUPLICATE_PHOTO" }` on each later occurrence, found with a `Set` in one pass.
- `ProductField` replaces `"imageId"` with `"photoIds"`; `validation.ts` reports a non-array or non-uuid element as `INVALID_TYPE` on `photoIds` (with `index` for an element).
- `ProductStructureChange.photos?: ProductPhotos` (replace the list) replaces `product.imageId`.
- `StoredCatalogProduct.photoIds: readonly ImageId[]`, `CatalogProduct.photoUrls: readonly string[]` replace `imageId` / `imageUrl`. `CatalogCard` keeps `imageUrl` (the primary): the card never needs the list.
- No new type for the primary: it is `photos[0]`.

### 6.2 Shared contract constants (`shared/contracts/products.ts`)

`productPhotoLimits = { maxPhotos: 8 } as const` next to `productOptionLimits`, read by core, web and mobile.

### 6.3 Shared photo field model (`shared/product-photos.ts`, new)

Pure, no React, no I/O; consumed by the web field and the mobile strip. Justification: both platforms must apply the same order, primary, mark, place and touched rules (product rule «Parity»); `shared/product-variants.ts` sets the precedent for shared editor rules.

```ts
export const photoUploadSettings = { concurrency: 2, timeoutMs: 120_000 } as const; // initial values, adjustable (§2 «Uploads»)
export type PhotoFailure = "weight" | "dimensions" | "format" | "prepare" | "connection" | "file_gone";
export type FieldPhoto =
  | Readonly<{ key: string; kind: "saved"; imageId: ImageId; url: string; marked: boolean; rejected: boolean }>
  | Readonly<{ key: string; kind: "uploading"; previewUrl: string | null; startedAt: number | null }>          // startedAt null = queued
  | Readonly<{ key: string; kind: "uploaded"; imageId: ImageId; url: string; marked: boolean; rejected: boolean }> // added in this session
  | Readonly<{ key: string; kind: "failed"; previewUrl: string | null; failure: PhotoFailure; retryable: boolean }>;
// `rejected` is set from a save rejection («No pudimos usar esta foto…») and cleared by the next save attempt.
export type PhotoField = Readonly<{ loaded: readonly ImageId[]; photos: readonly FieldPhoto[] }>;

export function loadPhotoField(saved: readonly Readonly<{ id: ImageId; url: string }>[]): PhotoField;
export function addSelection(field: PhotoField, keys: readonly string[]): Readonly<{ field: PhotoField; added: number; skipped: number }>;
export function startUpload / finishUpload / failUpload / cancelUpload / retryUpload(field, key, …): PhotoField;
export function makePrimary(field: PhotoField, key: string): PhotoField;   // kept photos only; others keep relative order
export function markForRemoval / undoRemoval(field: PhotoField, key: string): PhotoField;
export function primaryKey(field: PhotoField): string | null;             // first unmarked photo, any state
export function freePlaces(field: PhotoField): number;                    // maxPhotos − every photo in the field
export function counter(field: PhotoField): Readonly<{ count: number; marked: number; markedSaved: boolean }>;
export function saveBlocker(field: PhotoField): Readonly<{ kind: "uploading" | "failed"; key: string }> | null;
export type PhotosToSave = Readonly<{ kind: "untouched" }> | Readonly<{ kind: "set"; photoIds: readonly ImageId[] }>; // created by T0
export function photosToSave(field: PhotoField): PhotosToSave;            // untouched when the list equals `loaded`
export function hasUnsavedPhotos(field: PhotoField): boolean;             // photosToSave is "set", or any photo is uploading or failed
export function markRejected(field: PhotoField, sentIndexes: readonly number[]): PhotoField; // maps 422 photo issues to thumbnails
export function uploadFailure(error: Readonly<{ code: string }>): Readonly<{ failure: PhotoFailure; retryable: boolean }>;
```

- `uploadFailure`: `IMAGE_TOO_LARGE` → `dimensions`, not retryable (weight is detected before sending); `INVALID_IMAGE` (including «One file is required») and `UNSUPPORTED_MEDIA_TYPE` → `format`, not retryable; every other answer → `connection`, retryable: `IMAGE_STORAGE_UNAVAILABLE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, `401` (expired session; the retry works after signing in again), any unknown code, network failure, abort by timeout. So no failed thumbnail lacks a reason. A web file over `imageUploadLimits.maxBytes` never starts an upload and becomes `weight`; mobile `prepare` and `file_gone` come from the device, not from an answer.
- `photosToSave` decides what the save sends. `hasUnsavedPhotos` decides whether photos count for «¿Descartar cambios?» (web discard guard, mobile **Cancelar** and **X**): an upload in progress or a failed photo counts as a change even though neither is ever saved. Both are false when every action ended at the loaded list and nothing is uploading or failed.
- `markRejected` receives the `index` values of `PHOTO_NOT_FOUND` / `DUPLICATE_PHOTO` issues, which point into the `photoIds` the client sent, and marks the photos that produced them; the form keeps that sent list until the answer arrives.
- File ownership: T0 creates `shared/product-photos.ts` with `PhotosToSave` only, because `shared/product-variants.ts` (`ProductMeta.photos`) needs it; T1 adds every other export to the same file and does not redefine `PhotosToSave`.
- Texts stay in each app; the model returns states and codes only.

### 6.4 Types per layer

| Layer | Types and authority |
| --- | --- |
| Core domain | `ProductPhotos`, `parseProductPhotos`: authority on limit, repeats and order |
| Core application | `findImages` decides ownership and existence; `ProductAccess` scope |
| Shared contracts | `photoIds`, `photos`, issue scope `photo` and reasons; `productPhotoLimits` |
| Shared field model | Client-side order, primary, marks, places, touched list; never authoritative |
| Web / mobile | Render the model, upload, map issues to thumbnails; mobile keeps `Product.photos: { id, url }[]` with core names |

## 7. Persistence

### 7.1 Schema

```prisma
model ProductPhoto {
  companyId String  @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  company   Company @relation(fields: [companyId], references: [id])
  productId String  @db.Uuid
  product   Product @relation(fields: [companyId, productId], references: [companyId, id], onDelete: Cascade)
  imageId   String  @db.Uuid
  image     Image   @relation(fields: [companyId, imageId], references: [companyId, id], onDelete: Restrict)
  position  Int

  @@id([companyId, productId, position])
  @@unique([companyId, productId, imageId])
  @@index([companyId, imageId])
}
```

- `Product.imageId` and `Product.image` are removed; `Product.photos ProductPhoto[]`, `Image.productPhotos ProductPhoto[]` replace `Image.products`.
- `CHECK ("position" BETWEEN 0 AND 7)`. The contiguity of positions is guaranteed by the write (§7.3), not by a constraint.
- `@@index([companyId, imageId])` serves the `Image` RESTRICT foreign-key check (a future image cleanup deleting an image) and any query from an image to the products that use it. The search queries go the other way (`ProductPhoto` → `ImageEmbedding` primary key) and do not need it; it is not unused.
- Own table, not an `imageIds uuid[]` column: an array has no per-element foreign key to the company's images and cannot be joined by index from embeddings.
- `onDelete: Restrict` on the image keeps a future image cleanup from deleting a photo in use.

### 7.2 Migration `add_product_photos`

Created with `prisma migrate dev --create-only` and completed by hand, following `.agents/skills/database-migrations/SKILL.md`, in one transaction: `BEGIN;` then `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '60s'` inside it, then, in this order:

1. `CREATE TABLE "ProductPhoto"`, primary key, unique, index, `CHECK`, and the composite foreign keys (`Company` RESTRICT, `Product` CASCADE, `Image` RESTRICT).
2. `ENABLE` and `FORCE ROW LEVEL SECURITY` on `ProductPhoto` and policy `product_photo_company_isolation` with the same `USING` / `WITH CHECK` as `ProductOption`.
3. `INSERT INTO "ProductPhoto" ("companyId", "productId", "imageId", "position") SELECT "companyId", "id", "imageId", 0 FROM "Product" WHERE "imageId" IS NOT NULL;`
4. `ALTER TABLE "Product" DROP COLUMN "imageId";` (drops its foreign key), last, after the copy.
5. `COMMIT;`

The copy reads `Product` (FORCE RLS) correctly because migrations run as `core`, the superuser of the `migrate` service, as earlier copies out of FORCE-RLS tables already do; `core_app` never runs migrations. No backfill guards or phased drops (no production data). The final state equals `schema.prisma`. Existing `ImageEmbedding` rows keep matching because they are keyed by `(companyId, imageId)`. Locks (`SHARE ROW EXCLUSIVE` from the foreign keys, `ACCESS EXCLUSIVE` from the drop) are held for a copy of a few development rows.

### 7.3 Writes

- **Create:** the existing insert writes the photo rows with `position` = index, in the create transaction.
- **Save with a photo change:** inside the transaction that holds the product row lock, `DELETE FROM "ProductPhoto" WHERE "companyId" = $c AND "productId" = $p` and one `INSERT … SELECT … FROM unnest($ids) WITH ORDINALITY` (position = ordinality − 1). Two statements whatever the count, positions contiguous by construction. A unique or foreign-key violation (only reachable by a race the lock prevents or a deleted image) is translated to `PERSISTENCE_UNAVAILABLE`, never a success.
- The repository receives `ProductPhotos`, never decides the order.

### 7.4 Reads

- Detail / lock: `photos` ordered by `position`, mapped to `ProductPhotos` (a stored list that breaks the parser is `INVALID_STORED_DATA`).
- Primary: `LEFT JOIN "ProductPhoto" pp ON pp."companyId" = p."companyId" AND pp."productId" = p.id AND pp.position = 0`.
- Nearest photos per product:

```sql
SELECT "productId", "imageId", position, distance FROM (
  SELECT DISTINCT ON (p.id) p.id AS "productId", pp."imageId", pp.position,
         (e.embedding <=> $vector::vector)::float8 AS distance
  FROM "Product" p
  JOIN "ProductPhoto" pp ON pp."companyId" = p."companyId" AND pp."productId" = p.id
  JOIN "ImageEmbedding" e ON e."companyId" = pp."companyId" AND e."imageId" = pp."imageId" AND e.model = $model
  WHERE p.status = 'active'
    AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
  ORDER BY p.id, distance, pp.position
) best
ORDER BY distance, "productId"
LIMIT $limit
```

- The query starts from the company's active products and their current photos and reaches `ImageEmbedding` by its primary key `(companyId, imageId, model)`, so its cost follows the current photos, not the embeddings left behind by removed photos (never deleted). The integration test asserts that the embedding of a removed photo yields no candidate.
- `findPhotoIndexState`: photos of the product in position order with `EXISTS` over `ImageEmbedding` per image and model; `null` when the product row is absent.
- `listProductsMissingEmbedding`: active products with `EXISTS` a photo whose image lacks an embedding of the model.
- Rows from raw SQL are validated with Zod as today (`candidateSchema` gains `position`).

## 8. Contracts between applications

All in `shared/contracts/products.ts`, changed in place (no `/v2`: no production clients).

### 8.1 Requests

```ts
export const createProductRequestSchema = z.strictObject({
  id: productIdSchema, name: z.string(), description: z.string().nullable(),
  photoIds: z.array(uuidSchema),                  // replaces imageId; [] = no photo
  currency: z.enum(currencies), options: z.array(optionRequestSchema), variants: z.array(newVariantSchema).min(1),
}).readonly();

export const saveProductRequestSchema = z.strictObject({
  structureVersion: z.number().int().nonnegative(), name: z.string(), description: z.string().nullable(),
  photoIds: z.array(uuidSchema).optional(),       // replaces imageId; omitted = untouched
  options: …, variants: …, newVariants: …, deletedVariantIds: …,
}).readonly();
```

The limit and repeats are checked by core's domain (typed issues), not by the schema, so the client gets the index and reason. `shared/product-variants.ts` `ProductMeta.imageId` becomes `photos: PhotosToSave`; `buildCreateProductBody` sends `photoIds` (`[]` when untouched on create) and `buildSaveProductBody` omits `photoIds` when untouched.

### 8.2 Responses

```ts
productDetailResponseSchema = z.object({
  product: z.object({ …, photos: z.array(productImageSchema).max(productPhotoLimits.maxPhotos), … }), // replaces imageId; top-level image removed
}).superRefine(/* photo ids unique; existing option/variant checks */);
```

`productListResponseSchema.items[].image` is unchanged and is the primary. Every write keeps answering the full detail.

### 8.3 Errors

- `productApiIssueSchema.scope` gains `"photo"`; `productIssueReasonSchema` gains `TOO_MANY_PHOTOS`, `DUPLICATE_PHOTO`, `PHOTO_NOT_FOUND`.
- `422 VALIDATION_ERROR` with issues: `{ scope: "product", field: "photoIds", reason: "TOO_MANY_PHOTOS", maximum: 8 }`, `{ scope: "photo", field: "photoIds", index, reason: "DUPLICATE_PHOTO" | "PHOTO_NOT_FOUND" }`.
- `IMAGE_NOT_FOUND` stays in `productApiErrorCodeSchema` only for the detail read (503), as today.
- Clients map `PHOTO_NOT_FOUND` / `DUPLICATE_PHOTO` at `index` to the thumbnail at that position of the sent list («No pudimos usar esta foto…»), `TOO_MANY_PHOTOS` to the field («Un producto puede tener hasta 8 fotos…»), and an issue without a usable index to the field fallback.

### 8.4 Images

`shared/contracts/images.ts` and `POST /api/images` do not change. The weight / dimensions split is a client rule (§2, §6.3).

### 8.5 Public catalog

The catalog product page is a React Router loader, not a JSON contract: `CatalogProduct.photoUrls` is a server type consumed by `catalog-product.tsx`. `shared/contracts/catalog.ts` has no photo fields and does not change.

## 9. Events and cross-feature integration

- **Event:** `product_photos_added { companyId, productId }` (`products/application/events.ts`), strict parser `parseProductPhotosAdded` (`infrastructure/event-payloads.ts`). It replaces `product_image_changed`; no queued jobs exist in production.
- **Publisher:** `createProduct` and `saveProduct`, after commit, through `publishProductPhotosAdded` in `products/composition.ts`.
- **Consumer:** `index-product-photos` handler registered in `src/composition/event-handlers.ts`, policy `indexProductPhotosPolicy`.
- **Cross-feature capabilities, unchanged in signature:** `products.findVariantPhotos` (orders checkout), `products.findSellableVariants` (catalog cart and orders; field renamed `primaryImageId`), `products.identifyProductsInImage` (orders message-to-order; `VisualDistances` gains `chosenPhotoPosition`).

| Failure window | What happens | Effect for the seller |
| --- | --- | --- |
| Publish fails after commit | `product_photos_added_publish_failed` logged; product saved | New photos not recognizable until `products:index-images` runs |
| Embedding of photo 3 of 4 fails with a retryable code | Photo 4 is still tried; the job fails as retryable and is retried up to 8 times; the retry tries only photo 3 | Product recognizable by photos 1, 2 and 4 meanwhile |
| Photo 3 of 4 fails permanently (`INVALID_EMBEDDING`, `IMAGE_NOT_FOUND`) | Photo 4 is still tried and indexed; `product_photo_index_failed` at error level; job succeeds | Product recognizable by photos 1, 2 and 4; photo 3 never identifies it |
| Photo removed while its job runs | Embedding saved for an image no product uses | None; search joins current photos |
| Two saves add photos in quick succession | Two jobs; the second finds earlier photos indexed | None |
| Worker down | Jobs wait in the queue | Recognition delayed |

## 10. Mobile

| File | Change |
| --- | --- |
| `domain/product.ts` | `Product.photos: readonly { id: ImageId; url: string }[]` replaces `photo?`; `PhotoSelection` removed. `ProductListItem.photo?` unchanged (primary). |
| `domain/product-editor.ts` | Builds `ProductMeta.photos` from `PhotosToSave`. |
| `application/product-operations.ts` | Create and save take `PhotosToSave`; `imageIdOf` removed. |
| `infrastructure/product-api.ts` | Maps detail `product.photos`; maps `422` issues with `scope: "photo"`. |
| `src/shared/infrastructure/image-api.ts` | `uploadImage(request, uri, mimeType, { signal })`; an aborted request resolves as `ABORTED`, which the caller ignores. |
| `presentation/product-photos-strip.tsx` (replaces `product-photo.tsx`) | Fixed **Agregar fotos** tile, 64 px thumbnails scrolling to its right, line under the strip, source sheet (`Alert`/ActionSheet with at most two actions plus dismiss), per-thumbnail sheet, accessibility actions on each thumbnail; `expo-image-picker` with `allowsMultipleSelection`, `selectionLimit = freePlaces`, `orderedSelection`; photo job queue with `photoUploadSettings`: a job is `fitJpeg` then upload, so preparing runs inside the same 2 slots and selected photos wait as «Subiendo…» without being decoded; the job's timeout covers only the upload request. |
| `presentation/create-product-screen.tsx`, `product-management-screen.tsx`, `product-form.tsx` | Hold `PhotoField`; **Guardar** and **X** stay enabled during uploads; save blocker message at the top, scroll to the strip and to the thumbnail; **Cancelar** / **X** ask «¿Descartar cambios?» when `hasUnsavedPhotos` or any other field changed; save rejections go through `markRejected` or the form-level message. |
| `presentation/translations.ts` | New es and pt texts of the product draft. |

No local SQLite change. Mobile writes stay online only and never retried automatically.

| Situation | Decision |
| --- | --- |
| Gallery returns more than the free places (Android ignoring the cap) | Take the first ones up to the free places; show the over-limit line |
| Retry of a photo whose local uri is gone | `file_gone`, not retryable |
| Late answer after cancel or timeout | Ignored; the orphaned image is harmless |
| Save rejected with `PHOTO_NOT_FOUND` at index i | Mark the thumbnail that produced index i in the sent list |

## 11. Transactions and concurrency

Save with a photo change:
1. `transaction(companyId)` sets the tenant scope (RLS).
2. `lockProduct`: `SELECT … FOR UPDATE` on the product row, then the aggregate with `photoIds`.
3. `structureVersion` check (unchanged; photos never raise it).
4. Validation, including `parseProductPhotos` and `findImages`.
5. `applyStructureChange`: product fields, structure diff and photo replacement (§7.3).
6. `reload` in the same transaction; commit; publish `product_photos_added` if needed.

- Two saves on one product run one after the other under the row lock; a save without `photoIds` never touches the rows written by the other.
- The photo replacement is `findImages` plus two statements under a lock already held for milliseconds; the statement-count test of products (2 vs 100 variants) gains a case comparing a save that changes the list to 1 photo with one that changes it to 8 photos: both issue the same number of statements.
- A repeated create keeps returning `409 PRODUCT_ID_CONFLICT`; photo rows are inserted only by the winning create.
- Indexing jobs read outside the editing transaction and write only `ImageEmbedding` with `ON CONFLICT DO NOTHING`.

## 12. Code organization

### 12.1 Core products feature

| File | Change |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_add_product_photos/` | §7 |
| `features/products/domain/product.ts`, `domain/photos.ts` (new), `domain/errors.ts`, `domain/validation.ts`, `domain/product-structure.ts`, `domain/catalog-product.ts` | §6.1 |
| `application/create.ts`, `save-product.ts`, `get.ts`, `catalog-products.ts`, `variant-photos.ts`, `events.ts` | §5.1-5.4, §9 |
| `application/index-product-photos.ts` (replaces `index-product-image.ts`), `identify-products-in-image.ts`, `domain/image-identification.ts` | §5.5-5.6 |
| `infrastructure/repository.ts`, `catalog-products-repository.ts`, `variant-photo-repository.ts`, `order-stock.ts`, `product-seed.ts`, `image-embeddings.ts`, `event-payloads.ts` | §7.3-7.4 |
| `presentation/request-input.ts`, `product-presenter.ts`, `api-errors.ts`, `messages.ts` | §8 |
| `composition.ts`, `product-editing.ts` | Wire `findImages`, `resolveImages`, `publishProductPhotosAdded`, the photos index handler (per-photo outcomes, retry decision of §5.5) |
| `src/shared/images/infrastructure/image-repository.ts` | `findMany` rethrows transaction failures inside an active transaction, like `find` (T0) |
| `app/locales.ts` (T0 part) | Field label and subject `imageId` → `photoIds` (lines 174-175, 453-454) |
| `app/stories/page-patterns.stories.tsx`, `tests/e2e/mobile-product-printing.spec.ts` | Fixtures with `photos: []` / `photoIds: []` |
| `src/composition/event-handlers.ts`, `scripts/index-product-images.ts` | Event and handler rename; per-product reindex over every photo |
| `features/catalog/cart-composition.ts` | Reads `primaryImageId` |
| `features/orders/composition.ts` | Logs `chosenPhotoPosition` with the visual outcome |

### 12.2 Shared

| File | Change |
| --- | --- |
| `shared/contracts/products.ts` | §8.1-8.3, `productPhotoLimits` |
| `shared/product-variants.ts` | `ProductMeta.photos`, body builders |
| `shared/product-photos.ts` (new) | §6.3; T0 creates it with `PhotosToSave`, T1 adds the rest |

### 12.3 Web seller form

| File | Change |
| --- | --- |
| `features/products/presentation/product-photos-field.tsx` (new) | «Fotos» field: file picker with `multiple`, 112 px thumbnails (`decoding="async"`), action bar, marks, live region, focus rules, upload queue with abort and timeout |
| `features/products/presentation/product-form.tsx` | Uses the field; `ProductFormSubmission.photos: PhotosToSave` replaces `image`; save blocker handling; the discard guard (`use-discard-guard.tsx` caller) counts `hasUnsavedPhotos` |
| `src/shared/images/presentation/client.ts` | `uploadImageFile(file, { signal })` |
| `app/routes/product-new.tsx`, `app/routes/product-detail.tsx` | Map `PhotosToSave` and photo issues; pass the loaded photos |
| `app/locales.ts` | es and pt texts of the product draft |

### 12.4 Public catalog (part A)

`app/routes/catalog-product.tsx` shows `photoUrls[0]` with the current `CatalogProductImage` and stores it as the cart line `imageUrl`.

### 12.5 Public catalog gallery (part B)

| File | Change |
| --- | --- |
| `app/components/catalog-gallery.tsx` (new) | `CatalogGallery { name, photoUrls }` with at least one photo. Two or more: large photo track (CSS scroll snap; swipe on touch changes the large photo), thumbnails below in saved order, primary included (buttons «Ver foto 2 de 5», `aria-current` on the photo shown large). Exactly one: today's single large photo (same element, size and shape as `CatalogProductImage` with `catalog-product-photo`), no track, no thumbnail row. Clicking or tapping the large photo or any thumbnail opens `CatalogLightbox` on that photo |
| same file | `CatalogLightbox`: composed from the Radix `Dialog` primitives (`Root`, `Portal container` = the catalog theme host, `Content`, `Title`), as `app/components/ui/sheet.tsx` does; the shared `dialog.tsx` does not change. Full screen: `Content` covers `100dvw × 100dvh` with the photo fitted inside (`object-contain`, never cropped). Visually hidden title «Fotos de {name}»; photo track; **Foto anterior** / **Foto siguiente** buttons (hidden with one photo); «2 de 5» indicator in a polite live region (hidden with one photo); **Cerrar** button. ArrowLeft / ArrowRight change photo; Swiping the lightbox track horizontally on touch moves to the previous or next photo (native scroll snap). Esc (Radix), **Cerrar**, a click on the scrim around the photo (own handler on the scrim element: `Content` fills the viewport, so Radix's outside-click never fires) and swipe down (pointer vertical drag over 80 px, initial value) close. Gesture mechanics: the track has `touch-action: pan-x`, so the browser keeps horizontal panning for scroll snap and hands vertical moves to the pointer handlers; the content has `overscroll-behavior: contain`, so a vertical drag never starts pull-to-refresh or scrolls the page behind; `pointercancel` resets the drag without closing. With one photo the track has no horizontal pan and only swipe down applies. Focus is trapped (Radix) and returns to the photo or thumbnail that opened it |
| `app/routes/catalog-product.tsx` | Renders `CatalogGallery` instead of the single image when `photoUrls` is not empty (one photo looks as today, §2 «Part B interaction»); today's neutral block when empty |
| `app/components/catalog-sections.tsx` | `CatalogProductImage` gains the `catalog-gallery-thumbnail` and `catalog-lightbox-photo` parts if needed |

Styling: the large photo keeps today's product page shape (theme card rounding and border, never a circle); thumbnails are square with the theme card rounding and border, the shown one with a 2 px border in the theme's focus color plus `aria-current`; no photo filter anywhere on the product page, gallery or lightbox. The lightbox draws a fixed dark scrim with light controls on a solid surface in every theme, so its contrast does not depend on the theme; the indicator uses the theme body font. The scrim and control colors are constants of the component, checked against the catalog contrast floor by a unit test.

Loading: the primary photo loads eagerly with `fetchpriority="high"`; thumbnails use `decoding="async"` and their `src` is set once the primary has loaded or failed to load (`onLoad` or `onError`), so a broken primary never hides the other photos; slides of the page track and of the lightbox other than the visible one are `loading="lazy"`. This orders the downloads (primary first) but does not reduce them: thumbnails share the originals' URLs and browsers load nearby slides of a horizontal track early, so opening a product with 8 photos downloads all 8 originals (§15).

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `product_created` | info | `product-editing.ts` (existing) | existing + `["photoCount"]` |
| `product_saved` | info | `product-editing.ts` (existing) | existing + `["photoCount", "photosChanged"]` |
| `product_save_rejected` | info | existing | existing (`errorCode`, issue reasons include photo reasons) |
| `product_photos_added_publish_failed` | error | `products/composition.ts` | `["companyId", "productId", "errorCode"]` |
| `product_photos_indexed` | info | photos index handler, when at least one photo was indexed | `["companyId", "productId", "imageIds", "indexedCount", "failedCount", "model", "durationMs", "queueLatencyMs"]` |
| `product_photos_index_skipped` | debug | photos index handler | `["companyId", "productId", "reason"]` |
| `product_photo_index_failed` | warn for a retryable failure until the last attempt; error for a permanent failure or the last attempt | photos index handler, once per failed photo | `["companyId", "productId", "imageId", "eventId", "errorCode", "retryable", "attempt"]` |
| `orders_message_order_*` visual outcomes | info | `orders/composition.ts` (existing) | existing + `["chosenPhotoPosition"]` |
| `product_list_images_unavailable` | error | existing | existing; also covers catalog product photos |

`durationMs / indexedCount` measures the per-photo indexing time the product draft assumes; `queueLatencyMs` (handler start − event `occurredAt`) measures the wait in the shared `concurrency: 1` queue, so «recognizable within minutes» is read end to end (a large upload by one company delays every other company's indexing). Never logged: image bytes, URLs, vectors, product names, file names.

## 14. Tests

Titles are grouped by level and by the task that leaves them green (§16). Product acceptance criteria (AC) are mapped to these titles in §16 «Acceptance criteria coverage».

### Core unit

T0:
- `test("parseProductPhotos accepts up to 8 distinct photos in order")`
- `test("parseProductPhotos rejects a ninth photo with TOO_MANY_PHOTOS and the maximum")`
- `test("parseProductPhotos reports each repeated photo with its index")`
- `test("creates a product with three photos in the given order")`
- `test("rejects creating with a photo of another company, naming its index, together with other field issues")`
- `test("publishes product_photos_added after creating a product with photos and not without photos")`
- `test("a save without photoIds leaves the stored photos untouched")`
- `test("a save with the same photos in the same order is not a photo change")`
- `test("a save that moves the third photo first stores it as primary without raising the structure version")`
- `test("a save that only removes photos publishes nothing")`
- `test("a save that adds a photo publishes product_photos_added after commit")`
- `test("a save with nine photos is rejected and writes nothing")`
- `test("the product detail resolves every photo in order and fails when one cannot be resolved")`
- `test("the catalog product keeps photo order and drops a photo whose URL cannot be resolved")`

T2:
- `test("indexes every unindexed photo of the product in position order")`
- `test("skips photos already indexed with the model")`
- `test("a permanent failure on the second photo still indexes the later photos and the job succeeds")`
- `test("a retryable failure on one photo still tries the later photos and the job asks for a retry")`
- `test("a retried job tries only the photos still without embedding")`
- `test("each failed photo is logged once with its image and code")`
- `test("skips a product without photos")`
- `test("visual search offers each product once with its closest photo")`
- `test("logs the position of the photo that identified the product")`

### Shared unit (`shared/product-photos.test.ts`, T1)

- `test("keeps the picker order even when a later photo finishes uploading first")`
- `test("makePrimary moves a photo first and keeps the others' relative order")`
- `test("makePrimary is not available on uploading, failed or marked photos")`
- `test("marking the primary passes primary to the next unmarked photo")`
- `test("undoing a mark on the first photo makes it primary again")`
- `test("a photo added in this session is marked to be removed and a saved one to be deleted")`
- `test("every photo in the field takes a place until it leaves or the product is saved")`
- `test("a marked photo frees its place only after the save")`
- `test("a selection over the free places adds only the first ones and reports the rest")`
- `test("photosToSave is untouched when the actions end at the loaded list")`
- `test("photosToSave lists kept and uploaded photos in field order without marked ones")`
- `test("hasUnsavedPhotos is true when the only change is an upload in progress")`
- `test("hasUnsavedPhotos is true when the only change is a failed photo")`
- `test("hasUnsavedPhotos is false when the actions end at the loaded list and nothing uploads")`
- `test("saveBlocker points at the first uploading photo, then at the first failed one")`
- `test("markRejected marks the photo that produced the sent index")`
- `test("uploadFailure reads 413 as dimensions and invalid files as format, neither retryable")`
- `test("uploadFailure reads storage, server, session, unknown and network failures as retryable connection")`
- `test("a primary that fails keeps primary until it is retried or removed")`

### Core integration

T0:
- `test("migration copies each product image as its only photo at position 0 and drops the column")` (same harness as `product-options-migration.integration.test.ts`: apply migrations up to the previous one on a scratch database, insert legacy rows, apply the rest, assert the copied row count)
- `test("migration leaves products without image without photos")`
- `test("a migrated product with one image answers the detail with that image as its only photo")`
- `test("PUT /api/products/:id stores the photo list and answers it in the detail in order")`
- `test("PUT /api/products/:id without photoIds keeps photos added by another save")`
- `test("PUT /api/products/:id with a repeated photo answers 422 DUPLICATE_PHOTO with its index")`
- `test("POST /api/products with nine photos answers 422 TOO_MANY_PHOTOS and creates nothing")`
- `test("two saves with different photo lists leave the last one")`
- `test("a save that sets 8 photos uses the same number of statements as one that sets 1")`
- `test("a lock timeout during the photo lookup is reported once by the save transaction")`
- `test("after a save that moves C first, catalog cards, cart lines and the checkout of an open order show C")`
- `test("product list, catalog cards and checkout thumbnails show no photo for a product without photos")`
- `test("the store appearance preview cards show each product's primary photo")`
- `test("the catalog product page data lists every photo in saved order")`

T2:
- `test("findNearestProductImages returns the closest photo of each product once")`
- `test("hasIndexedProducts sees a product indexed only through a non-primary photo")`
- `test("a removed photo no longer makes its product a candidate even though its embedding stays")`
- `test("listProductsMissingEmbedding includes a product whose second photo lacks an embedding")`
- `test("a product created with two photos is indexed by the worker for both photos and retried while the embedder is down")`
- `test("after a failed indexing of one photo, products:index-images indexes it and the product is identified by it")`
- `test("message-to-order adds the product when the customer image matches its second photo")`

The shared RLS mechanism is already tested; `ProductPhoto` gets no table-specific isolation test (database-migrations skill), only its composite foreign keys and policy.

### Web component (Vitest + Testing Library)

T0:
- `test("the catalog card, cart line and checkout thumbnail keep the neutral block with the initial when a product has no photos")`
- `test("the catalog product page shows the primary of a product with three photos")`

T3:
- `test("selecting three files shows three uploading thumbnails in order with the first as primary")`
- `test("a product created before the change opens with its photo as 1 de 8 fotos and Principal")`
- `test("a file over 10 MB fails at once with the weight text and is never uploaded")`
- `test("a 413 for a file under 10 MB shows the dimensions text")`
- `test("Guardar with a failed photo shows the retry-or-remove message, focuses it, and after Quitar saves the others")`
- `test("a connection failure keeps the photo in its place and Reintentar uploads it in the same position")`
- `test("make primary moves focus to the remove button of the moved photo and announces it")`
- `test("removing a saved photo marks it Se eliminará with Deshacer and moves primary")`
- `test("removing a photo added in this session shows Se quitará and announces it")`
- `test("Deshacer returns a marked first photo to primary and keeps the other edits")`
- `test("marking one of 8 saved photos does not bring back Agregar fotos until the save")`
- `test("selecting four files with two free places adds two and shows the notice before any upload ends")`
- `test("with seven photos and three selected the notice uses the singular")`
- `test("filling the last place replaces Agregar fotos with the limit text and moves focus to it")`
- `test("while an upload runs, Agregar fotos stays available and Guardar explains and sends nothing")`
- `test("primary stays on an uploading first photo and passes to the next after Quitar on its failure")`
- `test("an upload without answer for two minutes becomes a retryable failure")`
- `test("cancel upload removes the thumbnail, ignores the late answer, and Guardar saves the other photos")`
- `test("leaving with an upload in progress asks ¿Descartar cambios?")`
- `test("leaving with only a failed photo asks ¿Descartar cambios?")`
- `test("Cancelar after adding a photo asks to discard and Descartar leaves the saved product unchanged")`
- `test("a save that only changes the price omits photoIds")`
- `test("a save rejected with PHOTO_NOT_FOUND or DUPLICATE_PHOTO at index 1 marks the second sent photo")`
- `test("a save rejected with TOO_MANY_PHOTOS shows the field message with the form intact")`
- `test("with the keyboard only, make primary, remove and save leave A, B, D, E and no action needs hover")`
- `test("shows the Portuguese texts and singular counts")`

T5:
- `test("with two or more photos the gallery shows the primary large and every photo, primary included, as a thumbnail in saved order")`
- `test("clicking a thumbnail opens the full-screen lightbox on that photo")`
- `test("clicking the large photo opens the lightbox on it")`
- `test("the lightbox content covers the whole viewport and fits the photo without cropping")`
- `test("the lightbox moves with arrow keys and buttons and announces 2 de 5")`
- `test("the lightbox traps focus, closes with Esc and with Cerrar, and returns focus to the opener")`
- `test("a click on the scrim around the photo closes the lightbox and a click on the photo does not")`
- `test("a pointer drag down over the threshold closes the lightbox")`
- `test("a product with one photo shows only the large photo as today, without a thumbnail row or swipe")`
- `test("a product with one photo opens the lightbox without navigation or indicator")`
- `test("a product without photos shows the neutral block and no lightbox")`
- `test("the gallery and lightbox apply no photo filter in any of the five themes")`
- `test("lightbox scrim and controls meet the catalog contrast floor")`
- `test("thumbnails are requested only after the primary photo has loaded or failed to load")`
- `test("the lightbox track pans horizontally only and a cancelled pointer drag does not close it")`

### Mobile (Jest + React Native Testing Library, T4)

- `test("choosing three gallery photos and one camera photo adds four thumbnails in that order")`
- `test("a product created before the change shows its photo as 1 de 8 fotos and Principal")`
- `test("the seller product list shows the dashed placeholder for a product without photos")`
- `test("the gallery picker is capped at the free places")`
- `test("a gallery that ignores the cap adds only the free places and shows the notice line")`
- `test("make primary from the sheet moves the photo first, keeps the others' order and returns focus to it")`
- `test("Quitar foto on the primary marks it Se eliminará and moves Principal to the next without a dialog")`
- `test("removing a photo added in this session shows Se quitará")`
- `test("Deshacer on a marked photo restores it in place and as primary when first")`
- `test("a marked photo keeps its place until saving")`
- `test("tapping a failed thumbnail opens Foto 2 de 3 with the reason, Reintentar, Quitar and Cancelar")`
- `test("the line under the strip counts failed photos and takes precedence over the counter")`
- `test("a 413 answer shows the dimensions text")`
- `test("a connection failure keeps the photo in place and Reintentar keeps the order")`
- `test("an upload without answer for two minutes becomes a retryable failure")`
- `test("Cancelar subida removes the photo and Guardar saves the others")`
- `test("while an upload runs, the add tile stays, Guardar explains and sends nothing, and X stays enabled")`
- `test("Principal stays on an uploading first photo and passes to the next after Quitar on its failure")`
- `test("Guardar with a failed photo shows the message at the top and focuses that thumbnail")`
- `test("Cancelar or X with an upload in progress asks ¿Descartar cambios? and Descartar leaves the product as saved")`
- `test("the add tile disappears at eight photos and the counter shows the limit, also with a marked photo")`
- `test("each thumbnail is announced with position, state and the actions hint")`
- `test("saving without touching photos omits photoIds")`
- `test("a save rejected with PHOTO_NOT_FOUND at index 1 marks the second sent photo with its reason")`
- `test("a save rejected with TOO_MANY_PHOTOS shows the form-level message and keeps the form")`
- `test("at most two photos are prepared or uploading at once")`
- `test("the product api maps the detail photos and photo issues")`
- `test("an aborted upload resolves as ABORTED and changes nothing")`
- `test("shows the Portuguese texts and singular counts")`

### Web E2E (happy path)

- T3: `test("a seller creates a product with three photos and the catalog grid and the cart show the first one")` (replaces `products-photo.spec.ts`)
- T5: `test("a buyer opens a product with three photos, opens the lightbox from a thumbnail, browses it and closes it with Esc")` (in `public-catalog.spec.ts`; first click retried until hydration)

### Pending manual checks

- On a phone browser: swipe between photos on the product page and in the lightbox, swipe down closes, full screen in portrait and landscape, in the five themes.
- On Android and iOS devices: gallery multi-selection with the cap, camera shot, TalkBack and VoiceOver announcements and actions on thumbnails (AC 27).
- Load 13 products with 4 photos each and read `product_photos_indexed` `durationMs / indexedCount` and `queueLatencyMs` to confirm recognition within minutes.
- Eight selections of 24 MP photos on a slow connection, web and a low-end Android: queue of two, timeouts, retries, no memory crash.
- Open a product with 8 phone-camera photos on a throttled mobile connection and note the transferred bytes (input for the resized-variants follow-up).

## 15. Limits and checks during implementation

- **Public product page weight (deferred risk, follow-up proposed):** original bytes are served; a buyer opening a product with 8 photos can download 8 originals of up to 10 MB each on mobile data, where today the page loads one. The mitigations of §12.5 (eager primary, deferred thumbnails, lazy hidden slides) reduce but do not remove it. The same applies to the seller web field (8 originals shown at 112 px) and the mobile strip (64 px). Resized variants are not built in this version; the delivery proposes a Todoist task for them.
- **Exact search size and ANN:** a company now has up to 8 embeddings per current product (plus embeddings of removed photos, which the query does not scan); the documented threshold (about 10,000 embeddings per company) is reached at about 1,250 products with 8 photos. Adding an ANN (HNSW) index later is not a drop-in: it only serves `ORDER BY distance LIMIT k` over `ImageEmbedding`, not `DISTINCT ON` product, so it needs an over-fetch (about k × 8 nearest photos, then one per product) and a filter to current photos.
- **Indexing queue:** `concurrency: 1` is shared by every company; a product with 8 photos holds the slot for up to 8 reads and embeds. Accepted by the product draft; measured with `queueLatencyMs`. A manual `products:index-images` run after many permanent failures puts those products back in the queue ahead of fresh jobs from other companies, so `queueLatencyMs` rises during the run; run it off-peak in production.
- **Server memory on parallel uploads:** each upload decodes the whole image (up to 24 MP); the client cap of 2 photo jobs bounds one seller. No server-side slot is added; checked in the manual parallel-upload check.
- **Radix Dialog inside the theme host:** verify that the portal container keeps the theme's CSS variables and fonts, as the cart sheet does.
- **`expo-image-picker` options:** verify `selectionLimit` and `orderedSelection` behavior on the installed version and on Android galleries that ignore the cap.
- **Removed photo files:** stay in R2 and keep their public URL; any computed embedding stays. A future image cleanup must check `ProductPhoto` (RESTRICT) and other references.
- **Permanent docs:** on merge, the drafts are promoted into `docs/products.md`, `docs/images.md`, `docs/public-catalog.md`, `docs/checkout.md` and `docs/image-product-search.md` following the Documentation skill. `docs/products.md` records the discard rule as `hasUnsavedPhotos` defines it (a changed list, an upload in progress or a failed photo), not the narrower product-draft sentence that ties it to the touched list only.

## 16. Implementation plan

### Order and parallelism

```text
Wave 0:  T0  Core: ordered photos, migration and seller API
              │
Wave 1:  ├── T1  Shared photo field model        (shared/product-photos.ts, after T0)
         ├── T2  Visual search over every photo   (indexing, search, reindex)
         └── T5  Public catalog gallery and lightbox (part B, web)
              │
Wave 2:  ├── T3  Web «Fotos» field                (after T0, T1)
         └── T4  Mobile photo strip               (after T0, T1)

Final verification after T2, T3, T4 and T5.
```

File ownership: only T0 edits `shared/contracts/products.ts`, `shared/product-variants.ts`, `src/shared/images/infrastructure/image-repository.ts` and the `imageId` label of `app/locales.ts`. T0 creates `shared/product-photos.ts` with `PhotosToSave`; T1 is the only later editor of that file. T1, T2 and T5 edit disjoint files. T3 (`apps/core` products presentation, web routes, the photo texts of `app/locales.ts`, web image client) and T4 (`apps/mobile`) edit disjoint files. T5 does not edit `app/components/ui/dialog.tsx`.

### T0. Core: ordered photos, migration and seller API

**Scope:** `ProductPhoto` schema and migration with carry-over in the order of §7.2; domain `ProductPhotos` and parser; create, save and detail with `photoIds` / `photos` and photo issues (§5.1-5.3, §8); `findImages` over `imageRepository.findMany`, which gains the transaction rethrow; every reader switched to position 0 or the list (§5.4) with the join placement of §5.4, including `CatalogProduct.photoUrls`, `findVariantPhotos`, `findSellableVariants.primaryImageId`, cart composition, seed; embedding queries switched to join `ProductPhoto` at position 0 so search keeps today's behavior; event renamed to `product_photos_added` with the existing single-image handler reading the primary; `shared/contracts/products.ts`, `productPhotoLimits`, `shared/product-variants.ts`, `shared/product-photos.ts` with `PhotosToSave` only; `app/locales.ts` field label, `page-patterns.stories.tsx`, `mobile-product-printing.spec.ts` fixtures; minimal client adaptation so everything compiles and keeps today's single-photo UI: web routes and mobile adapter send `[id]`, `[]` or omit `photoIds`, and read `photos[0]`; `catalog-product.tsx` reads `photoUrls[0]`. Logs of §13 for create and save.
**Out of scope:** indexing more than the primary (T2), the rest of the field model (T1), new form UIs (T3, T4), gallery (T5), a table-specific isolation test.
**Acceptance criteria:**
1. After migrating a database with product P (image I) and product Q (no image), P has one photo I at position 0, Q has none, `Product.imageId` no longer exists, the copied row count equals the products with image, and P keeps being found by visual search through I's existing embedding.
2. `PUT /api/products/P` with `photoIds: [B, A]` answers the detail with `photos` `[B, A]`; the catalog card, the store appearance preview card, the checkout thumbnail of an open order and the cart line show B.
3. `PUT` without `photoIds` after another save stored `[A, B, C]` leaves `[A, B, C]` and applies the price change.
4. `POST` with 9 photos answers `422` with `TOO_MANY_PHOTOS` and `maximum: 8`; `PUT` with `[A, A]` answers `DUPLICATE_PHOTO` at index 1; a photo of another company answers `PHOTO_NOT_FOUND` at its index; nothing is written.
5. A photo change does not raise `structureVersion`; adding a photo publishes `product_photos_added` once after commit; removing publishes nothing.
6. A save that sets 8 photos issues the same number of statements as one that sets 1; a lock timeout during `findImages` is reported once as the save's `503`.
7. A product without photos shows the neutral block with its initial in the catalog card, the cart and the checkout.
8. The existing web and mobile single-photo flows and `products-photo.spec.ts` keep passing.
**Tests:** T0 titles of §14 (core unit, core integration, web component).
**Depends on:** nothing.

### T1. Shared photo field model

**Scope:** every export of §6.3 except `PhotosToSave` (already created by T0) and its tests: field state, order, primary, marks, places, counter, `photosToSave`, `hasUnsavedPhotos`, `markRejected`, `saveBlocker`, `uploadFailure`, `photoUploadSettings`.
**Out of scope:** UI, texts, upload transport.
**Acceptance criteria:**
1. `[A, B, C, D]` with `makePrimary(C)` gives `[C, A, B, D]`; doing `makePrimary(B)` then `makePrimary(A)` on loaded `[A, B, C]` gives `photosToSave` untouched and `hasUnsavedPhotos` false.
2. With 6 photos, adding 4 keys adds 2 and reports 2 skipped; `freePlaces` is 0; with 7 saved photos and one marked, `freePlaces` is still 1 until the field is reloaded after the save.
3. Marking the primary of `[A, B, C]` makes B the `primaryKey`; undoing makes A primary again.
4. A loaded field plus one uploading photo gives `photosToSave` untouched and `hasUnsavedPhotos` true; the same with one failed photo.
5. With photo 1 uploading and photo 2 failed, `saveBlocker` is `uploading` on photo 1.
6. `uploadFailure({ code: "IMAGE_TOO_LARGE" })` is `dimensions`, not retryable; `{ code: "INTERNAL_ERROR" }`, a `401` and an unknown code are `connection`, retryable.
7. `markRejected(field, [1])` after sending `[A, C]` marks C.
**Tests:** shared unit titles of §14.
**Depends on:** T0 (`productPhotoLimits`, `PhotosToSave`).

### T2. Visual search over every photo

**Scope:** `indexProductPhotos` with per-photo outcomes and the handler retry decision (§5.5) replacing `indexProductImage`; `findPhotoIndexState`, `listProductsMissingEmbedding`, `hasIndexedProducts`, `findNearestProductImages` over every current photo, driven from `ProductPhoto`, with `DISTINCT ON` (§7.4); `VisualCandidate.position` and `chosenPhotoPosition` in `identify-products-in-image.ts` and the `orders/composition.ts` outcome logs; reindex script; logs of §13 including `queueLatencyMs`.
**Out of scope:** chooser prompt, candidate count, confidence, embedder changes, an ANN index.
**Acceptance criteria:**
1. A product saved with photos [frente, puesto] gets both embeddings from one job; `product_photos_indexed` logs `indexedCount: 2`, `durationMs` and `queueLatencyMs`.
2. A customer image closest to «puesto» yields one candidate for that product carrying «puesto»; the product is added and the log shows `chosenPhotoPosition: 1`.
3. With photos [A, B, C] where B always fails with `INVALID_EMBEDDING`, one job indexes A and C, logs B once at error level and succeeds; running `products:index-images` again tries only B and still leaves A and C indexed.
4. When embedding «puesto» fails with `EMBEDDER_UNAVAILABLE`, the job still indexes the photos after it, is retried, and the retry indexes «puesto» (AC 23 also through `products:index-images`).
5. After saving without «puesto», a customer image similar only to «puesto» no longer lists the product as a candidate, although «puesto»'s embedding still exists.
6. Two products whose photos are all close to the customer image appear once each among the K candidates.
**Tests:** T2 titles of §14 (core unit and integration).
**Depends on:** T0.

### T3. Web «Fotos» field

**Scope:** `product-photos-field.tsx`, `product-form.tsx`, `product-new.tsx`, `product-detail.tsx`, `uploadImageFile` with `signal`, photo texts in `locales.ts` es/pt; thumbnails, action bar, marks, focus and announcements, queue of 2 uploads, 2-minute timeout, weight check before upload, save blockers, mapping photo issues to thumbnails with `markRejected`, discard guard with `hasUnsavedPhotos`; replace `products-photo.spec.ts` with the new E2E.
**Out of scope:** mobile, catalog pages, changing the upload component library (Todoist 6hpQpwMxPvgVJFq3).
**Acceptance criteria:** the web side of product AC 1, 3-11, 14-18, 20, 21, 25, 26, 29 and 31, as mapped below; for example, selecting «frente.jpg», «grande.jpg» (12 MB) and «puesto.jpg» keeps «grande.jpg» second with «Pesa más de 10 MB.» without any request for it, **Guardar producto** focuses it with «Reintenta o quita las fotos que no se subieron.», and leaving while «puesto.jpg» still uploads asks «¿Descartar cambios?».
**Tests:** T3 titles of §14 (web component and E2E).
**Depends on:** T0, T1.

### T4. Mobile photo strip

**Scope:** files of §10: domain, operations, product API mapping, `uploadImage` with `signal`, `product-photos-strip.tsx`, screens, translations; picker with multiple selection capped at free places, camera one per shot, `fitJpeg` inside the 2 job slots, timeout, sheets, accessibility actions and focus, line under the strip, save blockers, `markRejected`, discard prompt with `hasUnsavedPhotos` on **Cancelar** and **X**.
**Out of scope:** web, catalog, label printing, offline writes.
**Acceptance criteria:** the mobile side of product AC 2-8, 10-21, 26-28 and 31, as mapped below; for example, 3 gallery photos and 1 camera photo save as 4 photos in that order and the first gallery photo is the thumbnail in the seller product list; with an upload running, **X** asks «¿Descartar cambios?» and **Descartar** leaves the product as saved.
**Tests:** T4 titles of §14.
**Depends on:** T0, T1.

### T5. Public catalog gallery and lightbox (part B)

**Scope:** `catalog-gallery.tsx` composed from Radix `Dialog` primitives and its use in `catalog-product.tsx` (§12.5); the one-photo page as today; thumbnail and large-photo click opening the full-screen lightbox on that photo, keyboard, buttons, swipe, scrim click and swipe-down close, «2 de 5», focus trap and return, one-photo and no-photo cases, five themes, no photo filter, contrast of scrim and controls, loading order; E2E in `public-catalog.spec.ts`.
**Out of scope:** catalog grid card (no carousel), cart, checkout, seller screens, pinch zoom, resized photo variants, `app/components/ui/dialog.tsx`.
**Acceptance criteria:**
1. A product with 3 photos shows the primary large and 3 thumbnails in saved order; clicking or tapping the second thumbnail opens the lightbox on it with «2 de 3»; clicking the large photo opens it on the photo shown large.
2. The lightbox fills the whole viewport, with the photo fitted inside it without cropping, on a phone and on a desktop.
3. ArrowRight shows «3 de 3»; **Foto anterior** returns to «2 de 3»; Esc, **Cerrar**, a click on the scrim around the photo and a swipe down close it and focus returns to the opener; a click on the photo itself does not close it; Tab never leaves the open lightbox.
4. A product with one photo (every product right after the migration) looks as today: the same single large photo, with no thumbnail row and no swipe; clicking or tapping it opens the full-screen lightbox without arrows or indicator, and Esc, **Cerrar**, the scrim and a swipe down close it.
5. A product without photos shows today's neutral block with its initial; nothing is clickable and no lightbox opens.
6. In Clásico, Boutique, Antojo, Suave and Noche the gallery keeps the product page photo shape, no photo filter applies, and the lightbox scrim and controls meet the catalog contrast floor (unit test over their colors).
7. On a touch viewport, swiping the large photo changes it, and inside the lightbox swiping left or right moves to the next or previous photo while a vertical drag over the threshold closes it; the track has `touch-action: pan-x` and the content `overscroll-behavior: contain` (§12.5).
8. Thumbnails are requested only after the primary has loaded or failed to load.
**Tests:** T5 titles of §14 (web component and E2E).
**Depends on:** T0 (`photoUrls`).

### Acceptance criteria coverage

Every acceptance criterion of `docs/drafts/varias-fotos-por-producto.md` and of «Alcance B» maps to the task that delivers it and to the §14 titles that verify it.

| AC | Task | Test titles (§14) |
| --- | --- | --- |
| 1 Web create with 3 photos; grid, cart, preview show the first | T3, T0 | «a seller creates a product with three photos and the catalog grid and the cart show the first one»; «selecting three files shows three uploading thumbnails…»; «the store appearance preview cards show each product's primary photo» |
| 2 Mobile 3 gallery + 1 camera | T4 | «choosing three gallery photos and one camera photo adds four thumbnails in that order» |
| 3 Hacer principal → [C, A, B]; grid, cart, open checkout show C | T0, T1, T3, T4 | «after a save that moves C first, catalog cards, cart lines and the checkout of an open order show C»; «makePrimary moves a photo first…»; «make primary moves focus…» (web); «make primary from the sheet moves the photo first…» (mobile) |
| 4 Quitar A → «Se eliminará», «Principal» to B, no dialog | T1, T3, T4 | «marking the primary passes primary…»; «removing a saved photo marks it Se eliminará…»; «Quitar foto on the primary marks it Se eliminará…» |
| 5 Quitar then Deshacer restores A, other edits kept | T1, T3, T4 | «undoing a mark on the first photo makes it primary again»; «Deshacer returns a marked first photo to primary and keeps the other edits»; «Deshacer on a marked photo restores it…» |
| 6 Over the free places notice, singular | T1, T3, T4 | «a selection over the free places adds only the first ones…»; «selecting four files with two free places…»; «with seven photos and three selected…»; «the gallery picker is capped at the free places»; «a gallery that ignores the cap…» |
| 7 Marked photo frees its place only after saving | T1, T3, T4 | «a marked photo frees its place only after the save»; «marking one of 8 saved photos does not bring back Agregar fotos…»; «a marked photo keeps its place until saving» |
| 8 Save with 9 photos rejected, form intact | T0, T3, T4 | «POST /api/products with nine photos answers 422 TOO_MANY_PHOTOS…»; «a save with nine photos is rejected and writes nothing»; «a save rejected with TOO_MANY_PHOTOS shows the field message…» (web); «…shows the form-level message…» (mobile) |
| 9 Web 12 MB file fails in place, save focuses it, Quitar then save | T3 | «a file over 10 MB fails at once…»; «Guardar with a failed photo shows the retry-or-remove message…» |
| 10 48 MP photo shows the dimensions text | T1, T3, T4 | «uploadFailure reads 413 as dimensions…»; «a 413 for a file under 10 MB shows the dimensions text»; «a 413 answer shows the dimensions text» |
| 11 Connection drop, Reintentar keeps the order | T1, T3, T4 | «keeps the picker order…»; «a connection failure keeps the photo in its place and Reintentar…» (web, mobile) |
| 12 Mobile failed sheet | T4 | «tapping a failed thumbnail opens Foto 2 de 3…»; «the line under the strip counts failed photos…» |
| 13 Mobile save with a failed photo out of view | T4 | «Guardar with a failed photo shows the message at the top and focuses that thumbnail» |
| 14 Two-minute timeout; Cancelar subida then Guardar | T3, T4 | «an upload without answer for two minutes…» (web, mobile); «cancel upload removes the thumbnail… Guardar saves the other photos»; «Cancelar subida removes the photo and Guardar saves the others» |
| 15 Add stays available, Guardar explains during upload | T1, T3, T4 | «saveBlocker points at the first uploading photo…»; «while an upload runs, Agregar fotos stays available…»; «while an upload runs, the add tile stays…» |
| 16 «Principal» stays on uploading or failed first photo | T1, T3, T4 | «a primary that fails keeps primary…»; «primary stays on an uploading first photo…»; «Principal stays on an uploading first photo…» |
| 17 Added photo + Cancelar asks to discard | T1, T3, T4 | «hasUnsavedPhotos is true when the only change is an upload in progress»; «…a failed photo»; «leaving with an upload in progress asks…»; «leaving with only a failed photo asks…»; «Cancelar after adding a photo asks to discard…»; «Cancelar or X with an upload in progress asks…» |
| 18 Pre-change product opens as «1 de 8 fotos», «Principal» | T0, T3, T4 | «migration copies each product image…»; «a migrated product with one image answers the detail…»; «a product created before the change opens with its photo as 1 de 8 fotos and Principal» (web); «…shows its photo as 1 de 8 fotos and Principal» (mobile) |
| 19 No-photo product keeps neutral block / dashed placeholder | T0, T4, T5 | «migration leaves products without image without photos»; «product list, catalog cards and checkout thumbnails show no photo…»; «the catalog card, cart line and checkout thumbnail keep the neutral block…»; «the seller product list shows the dashed placeholder…»; «a product without photos shows the neutral block and no lightbox» |
| 20 Stale device saving a price keeps other photos | T0, T1, T3, T4 | «PUT /api/products/:id without photoIds keeps photos added by another save»; «photosToSave is untouched when the actions end at the loaded list»; «a save that only changes the price omits photoIds»; «saving without touching photos omits photoIds» |
| 21 Repeated photo rejected | T0, T1, T3, T4 | «PUT … with a repeated photo answers 422 DUPLICATE_PHOTO…»; «markRejected marks the photo…»; «a save rejected with PHOTO_NOT_FOUND or DUPLICATE_PHOTO at index 1…» (web); «a save rejected with PHOTO_NOT_FOUND at index 1…» (mobile) |
| 22 Customer photo like «puesto» adds the product | T2 | «message-to-order adds the product when the customer image matches its second photo»; «visual search offers each product once with its closest photo» |
| 23 Failed indexing recovered by reindex | T2 | «after a failed indexing of one photo, products:index-images indexes it…»; «a permanent failure on the second photo still indexes the later photos…»; «a retried job tries only the photos still without embedding» |
| 24 Removed «puesto» no longer identifies | T2 | «a removed photo no longer makes its product a candidate…» |
| 25 Web keyboard flow | T3 | «with the keyboard only, make primary, remove and save leave A, B, D, E…» |
| 26 «Se quitará» on a photo added in this session | T1, T3, T4 | «a photo added in this session is marked to be removed…»; «removing a photo added in this session shows Se quitará…» (web, mobile) |
| 27 Mobile screen reader | T4 | «each thumbnail is announced with position, state and the actions hint»; «make primary from the sheet… returns focus to it»; manual check |
| 28 Mobile at 8 photos | T4 | «the add tile disappears at eight photos…» |
| 29 Web focus at the limit | T3 | «filling the last place replaces Agregar fotos with the limit text and moves focus to it» |
| 30 Product page receives 3 photos, shows the primary | T0 | «the catalog product page data lists every photo in saved order»; «the catalog product page shows the primary of a product with three photos» |
| 31 Portuguese texts | T3, T4 | «shows the Portuguese texts and singular counts» (web, mobile) |
| B: 3 photos on the page; click any opens the lightbox on it with previous, next, close | T5 | «the gallery shows the primary large…»; «clicking a thumbnail opens the full-screen lightbox on that photo»; «clicking the large photo opens the lightbox on it»; «the lightbox moves with arrow keys and buttons…»; buyer E2E |
| B: previous and next by swiping in the lightbox on touch | T5 | «the lightbox track pans horizontally only and a cancelled pointer drag does not close it»; manual phone check |
| B: full screen; close with X, Esc, click outside, swipe down | T5 | «the lightbox content covers the whole viewport…»; «the lightbox traps focus, closes with Esc and with Cerrar…»; «a click on the scrim around the photo closes…»; «a pointer drag down over the threshold closes…»; manual phone check |
| B: accessible lightbox, contrast in 5 themes, no photo filter | T5 | «the lightbox traps focus…»; «lightbox scrim and controls meet the catalog contrast floor»; «the gallery and lightbox apply no photo filter…» |
| B: one photo or no photo as today | T5 | «a product with one photo shows only the large photo as today, without a thumbnail row or swipe»; «a product with one photo opens the lightbox without navigation or indicator»; «a product without photos shows the neutral block and no lightbox» |

### Final verification

`scripts/ci.sh` on the integration branch; the pending manual checks of §14 (phone browser swipe and full screen in five themes, Android and iOS pickers and screen readers, indexing time and queue latency of 13 products with 4 photos, parallel uploads on a slow connection, page weight of a product with 8 photos). Results go in the pull request description.

## 17. Questions decided by the review gate

These answers come from the architecture review gate of the implement-task skill (rounds 1 and 2, 27/10/2026), not from the founder, and are kept here so the founder can confirm them in the final pull request.

1. **What does a click on a gallery thumbnail do, and how large is the lightbox?**
   - Answer: clicking or tapping any photo of the product page, the large one or a thumbnail, opens the lightbox on that photo, and the lightbox is full screen (covers the viewport, photo fitted without cropping).
   - Decided by: the design reviewer (blocker 4), applied by the coordinator.
   - Reason: the closed founder criteria say «clic en cualquiera abre el lightbox en esa foto», «Lightbox al hacer clic o tocar una foto» and «lightbox a pantalla completa».
   - Discarded: a thumbnail that only changes the large photo, with the lightbox opened from the large photo only; a centered dialog box.
2. **Does a photo that always fails to index block the product's other photos?**
   - Answer: no. Indexing tries every photo, records an outcome per photo, retries only for retryable failures, and logs permanent failures without failing the job.
   - Decided by: the design reviewer (blocker 1).
   - Reason: the product requires every photo to be indexed and the reindex command to cover every photo; head-of-line blocking would leave later photos unindexed forever.
   - Discarded: stopping the job at the first failure.
3. **Does an upload in progress or a failed photo count for «¿Descartar cambios?»?**
   - Answer: yes, through `hasUnsavedPhotos`, separate from `photosToSave`, on web and mobile.
   - Decided by: the design reviewer (blocker 2).
   - Reason: the product asks to confirm when leaving with uploads running (AC 17, «Leaving mid-upload»).
   - Discarded: deciding the discard prompt with the list to save only.
4. **Does the gallery's thumbnail row include the primary, and what does a product with one photo show?**
   - Answer: with two or more photos the row shows every photo, the primary included, with `aria-current` on the one shown large. With exactly one photo the page looks as today: only the large photo, no thumbnail row, and clicking it opens the lightbox without navigation. Without photos, today's neutral block.
   - Decided by: the design reviewer (round 2, blocker 1 and suggestion 5).
   - Reason: the large photo changes when swiped, so the row must show which photo is large. The founder's criteria say «Productos con una sola foto o sin foto se ven como hoy» and «Con una sola foto el lightbox abre sin navegación», and every product has at most one photo right after the migration.
   - Discarded: a row with only the other photos («miniaturas de las demás» read literally), which leaves the primary without a thumbnail once the buyer has swiped away from it; a single-thumbnail row for one photo.
