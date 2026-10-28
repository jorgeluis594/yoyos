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
| Indexing | The handler (`concurrency: 1`) indexes every unindexed photo of the product sequentially, in position order; already indexed images are skipped, so a retried job only redoes the missing ones. |
| Search | Nearest query takes the closest photo per product (`DISTINCT ON` product), then the K nearest products. The chooser receives that photo. Exact scan, no ANN index. |
| Reindex | `products:index-images` publishes `product_photos_added` for every active product with at least one photo lacking an embedding of the configured model. |
| Weight vs dimensions (413) | No contract change. Web checks `file.size > imageUploadLimits.maxBytes` before uploading and shows the weight text without sending; any `413 IMAGE_TOO_LARGE` for a sent file is the dimensions text. Mobile re-encodes to fit the byte limit, so its 413 is always dimensions (the same reading `store-appearance` already applies). |
| Which photo failed on save | Core names it: the issue carries `index` into the sent `photoIds`. The field-level fallback text is used only for `TOO_MANY_PHOTOS` and unknown issues. |
| Shared photo field model | `shared/product-photos.ts`: pure state and rules of the «Fotos» field (order, primary, marks, free places, touched list, save blockers, failure reason), consumed by web and mobile so both apply the same rules. |
| Uploads | Each photo uploads on its own with `POST /api/images`; each client runs at most 2 uploads at a time (initial value, adjustable) and the rest wait as «Subiendo…». The 2-minute timeout (initial value, adjustable) counts from the start of that photo's request; cancel and timeout abort the request and ignore a late answer. |
| Public catalog read model | `CatalogProduct.photoUrls: string[]` (ordered, primary first, unresolvable photos dropped and reported) replaces `imageUrl`. `CatalogCard.imageUrl` stays and is the primary. |
| Part B platform | The public catalog is rendered only by the web app (`apps/core/app/routes/catalog-product.tsx`); `apps/mobile` has no storefront, only catalog settings. The buyer's «móvil» behavior (swipe, swipe down to close) is touch behavior of the web page in a phone browser. |
| Part B components | Gallery and lightbox live in `apps/core/app/components/catalog-gallery.tsx`, built on the existing `Dialog` (Radix: focus trap, Esc, click outside) mounted inside the catalog theme host (as the cart `Sheet` does with `container`). Swipe uses CSS scroll snap and pointer events; no new dependency. |
| Deferred | Photos per variant (Todoist 6hqMVjGfqcR7rF6V); deleting files of removed photos (future image cleanup); thumbnails or resized variants of photos; drag reordering. |

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
| E2E specs touching photos | `tests/e2e/products-photo.spec.ts`, `products-create.spec.ts`, `public-catalog.spec.ts`, `store-appearance-buyer.spec.ts`, `message-to-order.spec.ts` | Updated per task |

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
- `deps.findImages: (ids: readonly ImageId[]) => Promise<Result<ReadonlySet<ImageId>, ImageLookupError>>` replaces `findImage`; it returns the ids that exist for the company (RLS).
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
| `listProducts` (`repository.ts` `summarySql`) | `imageId` comes from `ProductPhoto` at position 0 (`LEFT JOIN`). The list contract keeps `image?`. |
| `listCatalogProducts` (catalog cards) | Same position 0 join in the card query. |
| `findCatalogProduct` | `StoredCatalogProduct.photoIds: readonly ImageId[]` (ordered) replaces `imageId`; `resolveImages` in one batch; `toCatalogProduct(product, photoUrls)` keeps the saved order and drops photos that do not resolve (decorative, reported with the existing `product_list_images_unavailable`). |
| `findVariantPhotos` (checkout) | `findVariantImages` reads the photo at position 0 of each variant's product, any status. |
| `findSellableVariants` (cart, catalog order) | Returns `primaryImageId: ImageId | null` (renamed from `imageId`, which no longer names a stored column). `features/catalog/cart-composition.ts` reads the new name. |
| Store appearance preview | Uses catalog cards; no own change. |

### 5.5 `indexProductPhotos` (replaces `indexProductImage`, `products/application/index-product-photos.ts`)

```ts
export type IndexProductPhotosInput = Readonly<{ productId: ProductId }>;
export type IndexProductPhotosOutcome =
  | Readonly<{ kind: "indexed"; imageIds: readonly [ImageId, ...ImageId[]] }>
  | Readonly<{ kind: "skipped"; reason: "product_not_found" | "no_photos" | "already_indexed" }>;
export type IndexProductPhotosError = Readonly<{
  code: "PERSISTENCE_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_NOT_FOUND" | "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING";
  message: string; imageId?: ImageId;
}>;
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

Flow: load the state; `null` → `product_not_found`; empty → `no_photos`; every photo indexed → `already_indexed`. Otherwise, for each unindexed photo in position order: read, embed, save. The first failure returns its error with `imageId`; embeddings saved before it stay, so the retry skips them. A photo removed while the job runs still gets its embedding saved (harmless: search joins current photos only).

### 5.6 `identifyProductsInImage` (modified, visual step only)

- `findNearestProductImages(vector, model, limit)` returns at most one candidate per product: its closest photo (§7.4). `VisualCandidate` gains `position: number`.
- `hasIndexedProducts(model)` is true when any photo of an active product with an active variant has an embedding of the model.
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
- `parseProductPhotos` issues: more than 8 → one `{ scope: "product", field: "photoIds", reason: "TOO_MANY_PHOTOS", maximum: 8 }`; a repeated id → `{ scope: "photo", field: "photoIds", index, reason: "DUPLICATE_PHOTO" }` on each later occurrence.
- `ProductField` replaces `"imageId"` with `"photoIds"`; `validation.ts` reports a non-array or non-uuid element as `INVALID_TYPE` on `photoIds` (with `index` for an element).
- `ProductStructureChange.photos?: ProductPhotos` (replace the list) replaces `product.imageId`.
- `StoredCatalogProduct.photoIds: readonly ImageId[]`, `CatalogProduct.photoUrls: readonly string[]` replace `imageId` / `imageUrl`. `CatalogCard` keeps `imageUrl` (the primary): the card never needs the list.
- No new type for the primary: it is `photos[0]`.

### 6.2 Shared contract constants (`shared/contracts/products.ts`)

`productPhotoLimits = { maxPhotos: 8 } as const` next to `productOptionLimits`, read by core, web and mobile.

### 6.3 Shared photo field model (`shared/product-photos.ts`, new)

Pure, no React, no I/O; consumed by the web field and the mobile strip. Justification: both platforms must apply the same order, primary, mark, place and touched rules (product rule «Parity»); `shared/product-variants.ts` sets the precedent for shared editor rules.

```ts
export const photoUploadSettings = { concurrency: 2, timeoutMs: 120_000 } as const; // initial values, adjustable
export type PhotoFailure = "weight" | "dimensions" | "format" | "prepare" | "connection" | "file_gone" | "unusable";
export type FieldPhoto =
  | Readonly<{ key: string; kind: "saved"; imageId: ImageId; url: string; marked: boolean }>
  | Readonly<{ key: string; kind: "uploading"; previewUrl: string | null; startedAt: number | null }>          // startedAt null = queued
  | Readonly<{ key: string; kind: "uploaded"; imageId: ImageId; url: string; marked: boolean }>               // added in this session
  | Readonly<{ key: string; kind: "failed"; previewUrl: string | null; failure: PhotoFailure; retryable: boolean }>;
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
export type PhotosToSave = Readonly<{ kind: "untouched" }> | Readonly<{ kind: "set"; photoIds: readonly ImageId[] }>;
export function photosToSave(field: PhotoField): PhotosToSave;            // untouched when the list equals `loaded`
export function uploadFailure(error: Readonly<{ code: string }>, context: Readonly<{ sentBytes: number | null }>): Readonly<{ failure: PhotoFailure; retryable: boolean }>;
```

- `uploadFailure`: `IMAGE_TOO_LARGE` → `dimensions` (weight is detected before sending); `INVALID_IMAGE` / `UNSUPPORTED_MEDIA_TYPE` → `format`; `IMAGE_STORAGE_UNAVAILABLE`, `SERVICE_UNAVAILABLE`, network failure and timeout → `connection` (retryable). A web file over `imageUploadLimits.maxBytes` never starts an upload and becomes `weight`.
- `photosToSave` decides both what the save sends and whether photos count for «¿Descartar cambios?».
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
- `@@index([companyId, imageId])` serves the search join from `ImageEmbedding` to the photo.
- Own table, not an `imageIds uuid[]` column: an array has no per-element foreign key to the company's images and cannot be joined by index from embeddings.
- `onDelete: Restrict` on the image keeps a future image cleanup from deleting a photo in use.

### 7.2 Migration `add_product_photos`

Created with `prisma migrate dev --create-only` and completed by hand, following `.agents/skills/database-migrations/SKILL.md`, in one `BEGIN … COMMIT` with `SET LOCAL lock_timeout = '5s'` and `statement_timeout = '60s'`:

1. `CREATE TABLE "ProductPhoto"`, primary key, unique, index, `CHECK`, and the composite foreign keys (`Company` RESTRICT, `Product` CASCADE, `Image` RESTRICT).
2. `INSERT INTO "ProductPhoto" ("companyId", "productId", "imageId", "position") SELECT "companyId", "id", "imageId", 0 FROM "Product" WHERE "imageId" IS NOT NULL;`
3. `ALTER TABLE "Product" DROP COLUMN "imageId";` (drops its foreign key).
4. `ENABLE` and `FORCE ROW LEVEL SECURITY` on `ProductPhoto` and policy `product_photo_company_isolation` with the same `USING` / `WITH CHECK` as `ProductOption`.

No backfill guards or phased drops (no production data). The final state equals `schema.prisma`. Existing `ImageEmbedding` rows keep matching because they are keyed by `(companyId, imageId)`.

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
  SELECT DISTINCT ON (p.id) p.id AS "productId", e."imageId", pp.position,
         (e.embedding <=> $vector::vector)::float8 AS distance
  FROM "ImageEmbedding" e
  JOIN "ProductPhoto" pp ON pp."companyId" = e."companyId" AND pp."imageId" = e."imageId"
  JOIN "Product" p ON p."companyId" = pp."companyId" AND p.id = pp."productId"
  WHERE e.model = $model AND p.status = 'active'
    AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')
  ORDER BY p.id, distance, pp.position
) best
ORDER BY distance, "productId"
LIMIT $limit
```

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
| Embedding of photo 3 of 4 fails | Job fails with `imageId`; photos 1-2 kept; retried up to 8 times | Product recognizable by its other indexed photos meanwhile |
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
| `presentation/product-photos-strip.tsx` (replaces `product-photo.tsx`) | Fixed **Agregar fotos** tile, 64 px thumbnails scrolling to its right, line under the strip, source sheet (`Alert`/ActionSheet with at most two actions plus dismiss), per-thumbnail sheet, accessibility actions on each thumbnail; `expo-image-picker` with `allowsMultipleSelection`, `selectionLimit = freePlaces`, `orderedSelection`; `fitJpeg` per photo; upload queue with `photoUploadSettings`. |
| `presentation/create-product-screen.tsx`, `product-management-screen.tsx`, `product-form.tsx` | Hold `PhotoField`; **Guardar** and **X** stay enabled during uploads; save blocker message at the top, scroll to the strip and to the thumbnail. |
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
- The photo replacement is two statements under a lock already held for milliseconds; the statement-count test of products (2 vs 100 variants) is extended with 0 vs 8 photos.
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
| `composition.ts`, `product-editing.ts` | Wire `findImages`, `resolveImages`, `publishProductPhotosAdded`, the photos index handler |
| `src/composition/event-handlers.ts`, `scripts/index-product-images.ts` | Event and handler rename; per-product reindex over every photo |
| `features/catalog/cart-composition.ts` | Reads `primaryImageId` |
| `features/orders/composition.ts` | Logs `chosenPhotoPosition` with the visual outcome |

### 12.2 Shared

| File | Change |
| --- | --- |
| `shared/contracts/products.ts` | §8.1-8.3, `productPhotoLimits` |
| `shared/product-variants.ts` | `ProductMeta.photos`, body builders |
| `shared/product-photos.ts` (new) | §6.3 |

### 12.3 Web seller form

| File | Change |
| --- | --- |
| `features/products/presentation/product-photos-field.tsx` (new) | «Fotos» field: file picker with `multiple`, 112 px thumbnails, action bar, marks, live region, focus rules, upload queue with abort and timeout |
| `features/products/presentation/product-form.tsx` | Uses the field; `ProductFormSubmission.photos: PhotosToSave` replaces `image`; save blocker handling |
| `src/shared/images/presentation/client.ts` | `uploadImageFile(file, { signal })` |
| `app/routes/product-new.tsx`, `app/routes/product-detail.tsx` | Map `PhotosToSave` and photo issues; pass the loaded photos |
| `app/locales.ts` | es and pt texts of the product draft |

### 12.4 Public catalog (part A)

`app/routes/catalog-product.tsx` shows `photoUrls[0]` with the current `CatalogProductImage` and stores it as the cart line `imageUrl`.

### 12.5 Public catalog gallery (part B)

| File | Change |
| --- | --- |
| `app/components/catalog-gallery.tsx` (new) | `CatalogGallery { name, photoUrls }`: large photo track (CSS scroll snap, swipe on touch), thumbnails below (buttons «Ver foto 2 de 5», `aria-current` on the shown one), opens `CatalogLightbox` on the clicked or tapped photo |
| same file | `CatalogLightbox`: `Dialog` with `container` = the catalog theme host; title «Fotos de {name}» (visually hidden); photo track, **Foto anterior** / **Foto siguiente** buttons (hidden with one photo), «2 de 5» indicator in a polite live region (hidden with one photo), **Cerrar** button; ArrowLeft / ArrowRight change photo; Esc, click outside the photo and swipe down (pointer vertical drag over 80 px, initial value) close; focus returns to the photo or thumbnail that opened it |
| `app/routes/catalog-product.tsx` | Renders `CatalogGallery` instead of the single image when `photoUrls` is not empty; neutral block as today when empty |
| `app/components/catalog-sections.tsx` | `CatalogProductImage` gains the `catalog-gallery-thumbnail` and `catalog-lightbox-photo` parts if needed |

Styling: the large photo keeps today's product page shape (theme card rounding and border, never a circle); thumbnails are square with the theme card rounding and border, the shown one with a 2 px border in the theme's focus color plus `aria-current`; no photo filter anywhere on the product page, gallery or lightbox. The lightbox draws a fixed dark scrim with light controls on a solid surface in every theme, so its contrast does not depend on the theme; the indicator uses the theme body font. Images other than the visible one load lazily.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `product_created` | info | `product-editing.ts` (existing) | existing + `["photoCount"]` |
| `product_saved` | info | `product-editing.ts` (existing) | existing + `["photoCount", "photosChanged"]` |
| `product_save_rejected` | info | existing | existing (`errorCode`, issue reasons include photo reasons) |
| `product_photos_added_publish_failed` | error | `products/composition.ts` | `["companyId", "productId", "errorCode"]` |
| `product_photos_indexed` | info | photos index handler | `["companyId", "productId", "imageIds", "indexedCount", "model", "durationMs"]` |
| `product_photos_index_skipped` | debug | photos index handler | `["companyId", "productId", "reason"]` |
| `product_photo_index_failed` | warn until the last attempt, then error | photos index handler | `["companyId", "productId", "imageId", "eventId", "errorCode", "retryable", "attempt"]` |
| `orders_message_order_*` visual outcomes | info | `orders/composition.ts` (existing) | existing + `["chosenPhotoPosition"]` |
| `product_list_images_unavailable` | error | existing | existing; also covers catalog product photos |

`durationMs / indexedCount` measures the per-photo indexing time the product draft assumes. Never logged: image bytes, URLs, vectors, product names, file names.

## 14. Tests

### Core unit

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
- `test("indexes every unindexed photo of the product in position order")`
- `test("skips photos already indexed with the model")`
- `test("a failure on the third photo keeps the first two embeddings and reports the failed image")`
- `test("skips a product without photos")`
- `test("visual search offers each product once with its closest photo")`
- `test("logs the position of the photo that identified the product")`

### Shared unit (`shared/product-photos.test.ts`)

- `test("keeps the picker order even when a later photo finishes uploading first")`
- `test("makePrimary moves a photo first and keeps the others' relative order")`
- `test("makePrimary is not available on uploading, failed or marked photos")`
- `test("marking the primary passes primary to the next unmarked photo")`
- `test("undoing a mark on the first photo makes it primary again")`
- `test("every photo in the field takes a place until it leaves or the product is saved")`
- `test("a selection over the free places adds only the first ones and reports the rest")`
- `test("photosToSave is untouched when the actions end at the loaded list")`
- `test("photosToSave lists kept and uploaded photos in field order without marked ones")`
- `test("saveBlocker points at the first uploading photo, then at the first failed one")`
- `test("uploadFailure reads 413 as dimensions and storage or network failures as retryable connection")`
- `test("a primary that fails keeps primary until it is retried or removed")`

### Core integration

- `test("migration copies each product image as its only photo at position 0 and drops the column")`
- `test("migration leaves products without image without photos")`
- `test("photo rows of one company are invisible to another company")`
- `test("PUT /api/products/:id stores the photo list and answers it in the detail in order")`
- `test("PUT /api/products/:id without photoIds keeps photos added by another save")`
- `test("PUT /api/products/:id with a repeated photo answers 422 DUPLICATE_PHOTO with its index")`
- `test("POST /api/products with nine photos answers 422 TOO_MANY_PHOTOS and creates nothing")`
- `test("two saves with different photo lists leave the last one")`
- `test("a save with 8 photos uses the same number of statements as one with none")`
- `test("product list, catalog cards and checkout thumbnails show the photo at position 0")`
- `test("catalog cart lines show the primary photo")`
- `test("the catalog product page data lists every photo in saved order")`
- `test("findNearestProductImages returns the closest photo of each product once")`
- `test("hasIndexedProducts sees a product indexed only through a non-primary photo")`
- `test("a removed photo no longer makes its product a candidate")`
- `test("listProductsMissingEmbedding includes a product whose second photo lacks an embedding")`
- `test("a product created with two photos is indexed by the worker for both photos and retried while the embedder is down")`
- `test("message-to-order adds the product when the customer image matches its second photo")`

### Web component (Vitest + Testing Library)

- `test("selecting three files shows three uploading thumbnails in order with the first as primary")`
- `test("a file over 10 MB fails at once with the weight text and is never uploaded")`
- `test("a 413 for a file under 10 MB shows the dimensions text")`
- `test("make primary moves focus to the remove button of the moved photo and announces it")`
- `test("removing a saved photo marks it Se eliminará with Deshacer and moves primary")`
- `test("save with an upload running sends nothing, shows the wait text and focuses that thumbnail")`
- `test("an upload without answer for two minutes becomes a retryable failure")`
- `test("cancel upload removes the thumbnail and ignores the late answer")`
- `test("a save rejected with PHOTO_NOT_FOUND at index 1 marks the second sent photo")`
- `test("filling the last place replaces Agregar fotos with the limit text and moves focus to it")`
- `test("the form counts photos as changed only when the list to save differs from the loaded one")`
- `test("shows the Portuguese texts and singular counts")`
- `test("the gallery shows every photo with thumbnails and opens the lightbox on the clicked one")`
- `test("the lightbox moves with arrow keys and buttons and announces 2 de 5")`
- `test("the lightbox traps focus, closes with Esc and returns focus to the opener")`
- `test("a product with one photo opens the lightbox without navigation or indicator")`
- `test("a product without photos shows the neutral block and no lightbox")`
- `test("the gallery and lightbox apply no photo filter in any of the five themes")`

### Mobile (Jest + React Native Testing Library)

- `test("choosing three gallery photos and one camera photo adds four thumbnails in that order")`
- `test("the gallery picker is capped at the free places")`
- `test("tapping a failed thumbnail opens Foto 2 de 3 with the reason, Reintentar, Quitar and Cancelar")`
- `test("the line under the strip counts failed photos and takes precedence over the counter")`
- `test("Guardar with a failed photo shows the message at the top and focuses that thumbnail")`
- `test("the add tile disappears at eight photos and the counter shows the limit")`
- `test("make primary from the sheet returns accessibility focus to the moved thumbnail")`
- `test("a 413 answer shows the dimensions text")`
- `test("saving without touching photos omits photoIds")`
- `test("the product api maps the detail photos and photo issues")`
- `test("an aborted upload resolves as ABORTED and changes nothing")`

### Web E2E (happy path)

- `test("a seller creates a product with three photos, makes the third primary and the catalog shows it")` (replaces `products-photo.spec.ts`)
- `test("a buyer opens a product with three photos, browses them in the lightbox and closes it with Esc")` (in `public-catalog.spec.ts`; first click retried until hydration)

### Pending manual checks

- On a phone browser: swipe between photos on the product page and in the lightbox, swipe down closes, in the five themes.
- On Android and iOS devices: gallery multi-selection with the cap, camera shot, TalkBack and VoiceOver announcements and actions on thumbnails.
- Load 13 products with 4 photos each and read `product_photos_indexed` `durationMs / indexedCount` to confirm recognition within minutes.
- Eight parallel selections of 24 MP photos on a slow connection: queue of two, timeouts and retries.

## 15. Limits and checks during implementation

- **Migration role and RLS:** the copy in §7.2 reads `Product`, which has `FORCE ROW LEVEL SECURITY`. Verify that the migration role bypasses RLS (superuser or `BYPASSRLS`); otherwise the copy reads zero rows silently. The migration integration test asserts the copied row count.
- **Exact search size:** a company now has up to 8 embeddings per product; the documented ANN threshold (about 10,000 embeddings per company) is reached at about 1,250 products with 8 photos. Not addressed in this version.
- **Server memory on parallel uploads:** each upload decodes the whole image (up to 24 MP); the client cap of 2 bounds one seller. No server-side slot is added; check memory in the manual parallel-upload check.
- **Public product page weight:** original bytes are served (no thumbnails, out of scope); thumbnails and hidden photos load lazily.
- **Radix Dialog inside the theme host:** verify that the portal container keeps the theme's CSS variables and fonts, as the cart sheet does.
- **`expo-image-picker` options:** verify `selectionLimit` and `orderedSelection` behavior on the installed version and on Android galleries that ignore the cap.
- **Removed photo files:** stay in R2 and keep their public URL; any computed embedding stays. A future image cleanup must check `ProductPhoto` (RESTRICT) and other references.
- **Permanent docs:** on merge, the drafts are promoted into `docs/products.md`, `docs/images.md`, `docs/public-catalog.md`, `docs/checkout.md` and `docs/image-product-search.md` following the Documentation skill.

## 16. Implementation plan

### Order and parallelism

```text
Wave 0:  T0  Core: ordered photos, migration and seller API
              │
Wave 1:  ├── T1  Shared photo field model        (shared/product-photos.ts)
         ├── T2  Visual search over every photo   (indexing, search, reindex)
         └── T5  Public catalog gallery and lightbox (part B, web)
              │
Wave 2:  ├── T3  Web «Fotos» field                (after T0, T1)
         └── T4  Mobile photo strip               (after T0, T1)

Final verification after T2, T3, T4 and T5.
```

T1, T2 and T5 edit disjoint files; T3 (`apps/core` products presentation, web routes, `locales.ts`, web image client) and T4 (`apps/mobile`) edit disjoint files. `shared/product-variants.ts` and `shared/contracts/products.ts` are edited only by T0.

### T0. Core: ordered photos, migration and seller API

**Scope:** `ProductPhoto` schema and migration with carry-over (§7); domain `ProductPhotos` and parser; create, save and detail with `photoIds` / `photos` and photo issues (§5.1-5.3, §8); `findImages`; every reader switched to position 0 or the list (§5.4) including `CatalogProduct.photoUrls`, `findVariantPhotos`, `findSellableVariants.primaryImageId`, cart composition, seed; embedding queries switched to join `ProductPhoto` at position 0 so search keeps today's behavior; event renamed to `product_photos_added` with the existing single-image handler reading the primary; `shared/contracts/products.ts`, `productPhotoLimits`, `shared/product-variants.ts`; minimal client adaptation so everything compiles and keeps today's single-photo UI: web routes and mobile adapter send `[id]`, `[]` or omit `photoIds`, and read `photos[0]`; `catalog-product.tsx` reads `photoUrls[0]`. Logs of §13 for create and save.
**Out of scope:** indexing more than the primary (T2), the field model (T1), new form UIs (T3, T4), gallery (T5).
**Acceptance criteria:**
1. After migrating a database with product P (image I) and product Q (no image), P has one photo I at position 0, Q has none, `Product.imageId` no longer exists and P keeps being found by visual search through I's existing embedding.
2. `PUT /api/products/P` with `photoIds: [B, A]` answers the detail with `photos` `[B, A]`; the catalog card, the checkout thumbnail and the cart line show B.
3. `PUT` without `photoIds` after another save stored `[A, B, C]` leaves `[A, B, C]` and applies the price change.
4. `POST` with 9 photos answers `422` with `TOO_MANY_PHOTOS` and `maximum: 8`; `PUT` with `[A, A]` answers `DUPLICATE_PHOTO` at index 1; a photo of another company answers `PHOTO_NOT_FOUND` at its index; nothing is written.
5. A photo change does not raise `structureVersion`; adding a photo publishes `product_photos_added` once after commit; removing publishes nothing.
6. Company B cannot read or write company A's `ProductPhoto` rows.
7. The existing web and mobile single-photo flows and `products-photo.spec.ts` keep passing.
**Tests:** core unit and integration titles of §14 about parsing, create, save, detail, readers, migration, isolation and statement count.
**Depends on:** nothing.

### T1. Shared photo field model

**Scope:** `shared/product-photos.ts` and its tests (§6.3): field state, order, primary, marks, places, counter, `photosToSave`, `saveBlocker`, `uploadFailure`, `photoUploadSettings`.
**Out of scope:** UI, texts, upload transport.
**Acceptance criteria:**
1. `[A, B, C, D]` with `makePrimary(C)` gives `[C, A, B, D]`; doing `makePrimary(B)` then `makePrimary(A)` on loaded `[A, B, C]` gives `photosToSave` untouched.
2. With 6 photos, adding 4 keys adds 2 and reports 2 skipped; `freePlaces` is 0.
3. Marking the primary of `[A, B, C]` makes B the `primaryKey`; undoing makes A primary again.
4. With photo 1 uploading and photo 2 failed, `saveBlocker` is `uploading` on photo 1.
5. `uploadFailure({ code: "IMAGE_TOO_LARGE" })` is `dimensions`, not retryable; a network error is `connection`, retryable.
**Tests:** shared unit titles of §14.
**Depends on:** T0 (`productPhotoLimits`).

### T2. Visual search over every photo

**Scope:** `indexProductPhotos` and handler (§5.5) replacing `indexProductImage`; `findPhotoIndexState`, `listProductsMissingEmbedding`, `hasIndexedProducts`, `findNearestProductImages` over every photo with `DISTINCT ON` (§7.4); `VisualCandidate.position` and `chosenPhotoPosition` in `identify-products-in-image.ts` and the `orders/composition.ts` outcome logs; reindex script; logs of §13.
**Out of scope:** chooser prompt, candidate count, confidence, embedder changes.
**Acceptance criteria:**
1. A product saved with photos [frente, puesto] gets both embeddings from one job; `product_photos_indexed` logs `indexedCount: 2` and `durationMs`.
2. A customer image closest to «puesto» yields one candidate for that product carrying «puesto»; the product is added and the log shows `chosenPhotoPosition: 1`.
3. When embedding «puesto» fails, the job keeps «frente», retries, and `products:index-images` republishes the product until «puesto» is indexed.
4. After saving without «puesto», a customer image similar only to «puesto» no longer lists the product as a candidate.
5. Two products whose photos are all close to the customer image appear once each among the K candidates.
**Tests:** core unit and integration titles of §14 about indexing, nearest photos, missing embeddings and message-to-order with a second photo.
**Depends on:** T0.

### T3. Web «Fotos» field

**Scope:** `product-photos-field.tsx`, `product-form.tsx`, `product-new.tsx`, `product-detail.tsx`, `uploadImageFile` with `signal`, `locales.ts` es/pt; thumbnails, action bar, marks, focus and announcements, queue of 2 uploads, 2-minute timeout, weight check before upload, save blockers, mapping photo issues to thumbnails, discard guard by `photosToSave`; replace `products-photo.spec.ts` with the new E2E.
**Out of scope:** mobile, catalog pages, changing the upload component library (Todoist 6hpQpwMxPvgVJFq3).
**Acceptance criteria:** product draft acceptance criteria 1, 3-11, 14-17, 20, 21, 25, 26, 29, 31 on web; for example, selecting «frente.jpg», «grande.jpg» (12 MB) and «puesto.jpg» keeps «grande.jpg» second with «Pesa más de 10 MB.» without any request for it, and **Guardar producto** focuses it with «Reintenta o quita las fotos que no se subieron.».
**Tests:** web component titles of §14 for the field and the seller E2E.
**Depends on:** T0, T1.

### T4. Mobile photo strip

**Scope:** files of §10: domain, operations, product API mapping, `uploadImage` with `signal`, `product-photos-strip.tsx`, screens, translations; picker with multiple selection capped at free places, camera one per shot, per-photo `fitJpeg`, queue and timeout, sheets, accessibility actions and focus, line under the strip, save blockers.
**Out of scope:** web, catalog, label printing, offline writes.
**Acceptance criteria:** product draft acceptance criteria 2, 12, 13, 18, 19, 20, 27, 28, 31 on mobile; for example, 3 gallery photos and 1 camera photo save as 4 photos in that order and the first gallery photo is the thumbnail in the seller product list.
**Tests:** mobile titles of §14.
**Depends on:** T0, T1.

### T5. Public catalog gallery and lightbox (part B)

**Scope:** `catalog-gallery.tsx` and its use in `catalog-product.tsx` (§12.5); keyboard, buttons, swipe, swipe-down close, «2 de 5», focus trap and return, one-photo and no-photo cases, five themes, no photo filter; E2E in `public-catalog.spec.ts`.
**Out of scope:** catalog grid card (no carousel), cart, checkout, seller screens, pinch zoom.
**Acceptance criteria:**
1. A product with 3 photos shows the primary large and 3 thumbnails in saved order; clicking the second thumbnail shows it large; clicking the large photo opens the lightbox on it with «2 de 3».
2. ArrowRight shows «3 de 3»; **Foto anterior** returns to «2 de 3»; Esc, **Cerrar** and a click outside the photo close it and focus returns to the opener; Tab never leaves the open lightbox.
3. A product with one photo opens the lightbox without arrows or indicator; a product without photos shows the neutral block with its initial and nothing opens.
4. In Clásico, Boutique, Antojo, Suave and Noche the gallery keeps the product page photo shape, no photo filter applies, and lightbox controls meet the catalog contrast floor.
5. On a touch viewport, swiping the large photo changes it and swiping down closes the lightbox.
**Tests:** web component titles of §14 for gallery and lightbox and the buyer E2E.
**Depends on:** T0 (`photoUrls`).

### Final verification

`scripts/ci.sh` on the integration branch; the pending manual checks of §14 (phone browser swipe in five themes, Android and iOS pickers and screen readers, indexing time of 13 products with 4 photos, parallel uploads on a slow connection). Results go in the pull request description.
