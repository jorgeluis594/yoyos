# Hide a product: technical design

**Status:** draft, round 2 of the architecture review gate; no open questions. Based on `docs/drafts/ocultar-producto.md` (definition ready to implement). Base: `jorgeluis594/ocultar-producto-del-catalogo-y-de-la-ge` at `a802779e` (code identical to `main` at `e89d9bce`). The staged message reader (Todoist 6hv99FVqgMmmJJR3, `origin/jorgeluis594/lector-de-pedidos-por-mensaje-nueva-arqu`, its T0 merged at `2f6af5ca`) is being implemented in parallel; section 9.2 is the meeting contract.

## 1. Technical goal

`Product` gains a stored `hidden` flag, written by the product form on web and mobile. Core splits "sellable" into two readings and names them apart: **sellable** (the seller can sell it: active product, active variant) stays the rule of «Nueva venta», the point of sale, the order editor and every QR lookup; **offered** (sellable and not hidden) becomes the rule of every buyer-facing read: the public catalog, its cart and **Continuar**, the store appearance preview, the text candidates and the visual search of message reading, the catalog-search readiness and the assistants' «en el catálogo». Message reading still loads a hidden product it already knows (QR label, order item, pending), marks it hidden, and the reader turns any add or raise of it into `product_not_available` with reason `hidden`.

```text
product form (web, mobile) ──hidden?──▶ PUT/POST product ──▶ Product.hidden
                                                         └─▶ hidLastOffered ─┐ + catalog published ─▶ last-visible notice
Product.hidden ─┬─ offered reads (hidden = false): catalog list/page, cart refresh, Continuar, preview,
                │                                 text candidates, nearest images, readiness, assistant en_catalogo
                └─ sellable reads (no filter):    Nueva venta, POS, order editor, searchSaleCatalog, QR lookup,
                                                  findProductsForReading (adds `hidden`, sellable = false)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Stored shape | `Product.hidden Boolean NOT NULL DEFAULT false`. Not a value of `Product.status`: `status` means "exists for the seller" and every sellable read keys on it, so a third status would have to be excluded again from every manual path. Not a separate table: it is a product attribute with no identity or history (guide 7.5, product «only the current value»). |
| Vocabulary in code | **Sellable** = seller can sell (unchanged meaning of `findSellableVariants`, `findSellableVariantsByQrCodes`, `searchSaleCatalog`, `findSellableVariantStock`). **Offered** = sellable and not hidden; new names use `offered` (`findOfferedVariants`, `isOffered`, `hasOtherOfferedProduct`). No existing function changes meaning. |
| Manual paths | Untouched. `findSellableVariants`, `searchSaleCatalog`, `findSellableVariantStock` and `findSellableVariantsByQrCodes` get no visibility filter. The staged reader's undo (`findSellableVariants`) therefore restores hidden items, as its obligation 6 requires. |
| Buyer cart | The cart refresh and **Continuar** switch from `findSellableVariants` to the new `findOfferedVariants`. `createCatalogOrder` already returns an existing order before checking availability, so a pending catalog order with a hidden line is still returned (product rule). |
| QR in message reading | No new QR lookup. `findSellableVariantsByQrCodes` keeps finding a hidden product's label; `findProductsForReading` marks that product `hidden` and not sellable, so the existing "add shown product" path (`fixedShownAnswer` → `add` → `resolveAdd` → `freshAdd`, also without a reader call) yields `product_not_available` with reason `hidden`. This closes the product draft's note «needs a QR lookup that recognizes a hidden product's code». |
| Reader's product | `ProductForReading` gains `hidden: boolean`; a hidden product has `sellable: false`, no variants and no attributes, exactly like a product without active variants, so no reader rule offers its variants. |
| Notice reason | The outcome `product_not_available` gains `reason: "not_sold" \| "hidden"`, decided at reading time and required in the domain type. The stored schema defaults a missing `reason` to `"not_sold"`: every outcome stored before this feature is a not-sold case, so the default is the true value, development outcomes need no cleanup and the staged branch's stored fixtures keep parsing. The notice text is chosen from the stored reason, not from the product's state when the push is sent, so showing the product again a second later never changes what the seller reads. |
| Raising a hidden item | Decided by the pure `refusesRaise` in the new `orders/domain/product-availability.ts` and called from `changeQuantity` in `orders/domain/chat-reading.ts`: `increase` on an item whose product is hidden, or `set` above the item's quantity, resolves to `product_not_available` (`hidden`). Variant changes already require `sellable`. The rule lives outside `chat-reading.ts` because the staged reader deletes that file's single-call parts (its T17) and calls the same helper from `domain/reader/request-checks.ts`. |
| Readiness | `CatalogSearchReadiness` gains `all_products_hidden` (products with an active variant exist, none offered). Shared contract `catalog-search-readiness` gains the value in place (version stays `1`, no customers yet, memory 6ba8e5e6). Text misses stay silent for it as for `no_active_products`. Presence is read with two short-circuit `EXISTS` in one statement, never an aggregate over every product. |
| Save rule | `hidden` is optional in the save request: omitted = untouched, like `photoIds`. The shared body builder sends it only when the form value differs from the loaded value, so toggling back counts as unchanged. Create always sends it (`false` by default). Writing `hidden` never raises `structureVersion` and never triggers `PRODUCT_CHANGED`. |
| Last-visible notice | Only when the save turned «Ocultar producto» on (question decided by the review gate, section 17). Products computes `hidLastOffered` inside the save transaction (this save sets `hidden` to true, the product was offered before, and no other offered product of the same currency remains). The presentation layer turns it into `catalogEmptied` only when the storefront is published and the product's currency is the store currency. The product route receives the storefront read as a capability from `src/app.ts` so products does not depend on catalog (catalog already depends on products). |
| Indexes | None added; reason in section 7. |
| Migration | One Prisma-generated migration `add_product_hidden` (column with default, no backfill, no index), wrapped in `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'; … COMMIT;` as the recent DDL migrations are; RLS policy on `Product` unchanged. |
| Assistants | `inCatalog` becomes "offered"; `FoundProduct` and `SearchedProduct` gain `hidden`; the `VARIANT_FILTER_OUTSIDE_CATALOG` refusal is deleted. |
| Staged reader | No code inside the staged reader. Section 9.2 gives the meeting contract (`ProductForReading.hidden`, outcome `reason`, readiness value, the helpers of `product-availability.ts`) and the merge-second list. |
| Scope | One slice, web and mobile, six implementation tasks in two waves (section 16). Every task leaves core and mobile lint, typecheck and tests green on its own. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `Product` model | `apps/core/prisma/schema.prisma:369-388` | `status String` with `CHECK (status = 'active')` (`20260924060712_add_products`); `structureVersion`; indexes `@@unique([companyId,id])`, `@@index([companyId])`, GIN trigram on `name`. RLS `product_company_isolation` (ENABLE + FORCE). Gains `hidden`. |
| Latest migration | `apps/core/prisma/migrations/20261031180100_add_order_item_position` | Naming `YYYYMMDDHHMMSS_snake_name`. |
| Domain `Product` | `apps/core/src/features/products/domain/product.ts:29` | No visibility. Gains `hidden`. |
| Sellable reads | `apps/core/src/features/products/infrastructure/order-stock.ts` | `findSellableVariants` (l.29) serves Nueva venta and POS (`findSellableOrderVariants`, `orders/composition.ts:277`), the order editor (`orders/composition.ts:559`), **and** the cart refresh (`catalog/cart-composition.ts:17`) and **Continuar** (`orders/composition.ts:500`). `findSellableVariantsByQrCodes` (l.53) serves only `identifyProductsInImage` and evals. `searchSaleCatalog` (l.154) serves `GET /api/orders/catalog` (web picker, mobile Nueva venta/POS). `findSellableVariantStock` (l.118) serves the order detail stock warnings. Re-exported by `products/index.ts:1`. |
| Catalog reads | `products/infrastructure/catalog-products-repository.ts` | `list` (l.51, raw SQL, also serves search) and `find` (l.78, product page). Both filter `status='active'`, currency and an active variant. Consumed by `catalog/browse-composition.ts` (`browse`, `getProduct`, `previewCards`). |
| Catalog order | `orders/application/create-catalog-order.ts:41-44` | Returns an existing order before reading variants; `checkCartAvailability` marks a missing variant `unavailable`. |
| Text candidates | `products/application/find-message-candidates.ts`, `products/infrastructure/text-candidates.ts` | `searchProductsByCoverage` counts active products for the word cap (l.30) and runs `coverageQuery` (l.57-70) with `status='active'` and an active variant. Returns sellable ids only (no unavailable twins on `main`; memory fbd69462 describes the staged reader's port). |
| Reading products | `products/infrastructure/reading-products.ts:22`, `products/application/find-products-for-reading.ts:45-60`, `products/domain/reading-product.ts` | Loads products without a status filter; `sellable = items.length > 0`. |
| Visual search | `products/infrastructure/image-embeddings.ts` | `hasIndexedProducts` (l.71) and `findNearestProductImages` (l.84) scan exactly (`<=>`, no ANN index) over active products with an active variant. `listProductsMissingEmbedding` (l.58) indexes every active product. |
| Readiness | `products/infrastructure/catalog-search-readiness.ts:7`, `products/application/catalog-search-readiness.ts:16`, `GET /api/products/search-readiness`, `shared/contracts/catalog-search-readiness.ts` | `no_active_products \| no_searchable_photos \| ready`. Consumed by `apply-chat-message.ts` (`silenceTextMisses` l.266, `reportMiss` l.309) and the mobile hint. |
| Reader rules | `orders/domain/chat-reading.ts` (`changeQuantity` l.238, `changeVariant` l.251, `freshAdd` l.262, `completePending` l.307), `orders/domain/pending-transitions.ts:147-153` | `product_not_available` when `!sellable`; quantity changes never check sellability. |
| Outcome and notice | `orders/domain/chat-message-outcome.ts:30,70`, `orders/domain/seller-notice.ts:27,62`, `orders/presentation/seller-notice-texts.ts:65,151` | `product_not_available { productId }`, strict stored schema; one body «…que ya no está a la venta…». |
| Variant status | `products/presentation/variant-api-routes.ts:58` `PUT /api/products/:productId/variants/:variantId/status` | The only way to deactivate a variant. The product save cannot: `saveProductRequestSchema` has no variant status, only `deletedVariantIds` and option rekeys. Not touched by this design. |
| Product save | `shared/contracts/products.ts` (create l.27, save l.38, list l.75, detail l.108), `shared/product-variants.ts` (`buildCreateProductBody` l.413, `buildSaveProductBody` l.426), `shared/product-photos.ts` (`PhotosToSave`) | `photoIds` omitted = untouched. |
| Save use cases | `products/application/create.ts:121,128,136`, `products/application/save-product.ts:95-140`, `products/domain/product-structure.ts:368` (`planProductSave`), `products/infrastructure/repository.ts` (`lockProduct` l.223, `applyStructureChange` l.246), `products/product-editing.ts` | Save locks the product row, checks `structureVersion`, plans one `ProductStructureChange`; photos never raise `structureVersion`. Returns `Detail`. |
| Save callers | Web route actions `apps/core/app/routes/product-new.tsx`, `product-detail.tsx` (call `productEditing` directly); API `products/presentation/api-routes.ts` `POST /` (l.58), `PUT /:productId` (l.71), registered in `src/app.ts:118` | Mobile uses the API. |
| Web form and list | `products/presentation/product-form.tsx`, `apps/core/app/routes/product-list.tsx`, `apps/core/app/locales.ts`, `app/components/ui/switch.tsx`, `app/components/ui/badge.tsx` | No visibility. |
| Mobile products | `apps/mobile/src/features/products/` (`domain/product.ts`, `application/product-operations.ts`, `infrastructure/product-api.ts`, `presentation/product-form.tsx`, `create-product-screen.tsx`, `product-management-screen.tsx`, `catalog-screen.tsx`, `translations.ts`) | Uses the shared body builders. |
| Mobile hint | `apps/mobile/src/features/whatsapp/presentation/catalog-readiness-hint.tsx` (local `Hint` type of two values), `features/whatsapp/infrastructure/catalog-readiness-api.ts` (returns the contract's `state`), `features/notifications/presentation/notices-provider.tsx:9` (`CatalogReadinessLoader` hard-codes the three current values), `features/notifications/presentation/translations.ts:8-10` | Two texts. Adding a contract value breaks mobile typecheck unless the loader and hint types follow. |
| Body builder callers | `apps/mobile/src/features/products/application/product-operations.ts:30,34`, `apps/core/app/routes/product-new.tsx:67`, `product-detail.tsx:98` | Call `buildCreateProductBody` / `buildSaveProductBody`; a new required `meta` field breaks them. |
| Assistants | `products/infrastructure/product-search-repository.ts:110-112`, `products/application/search-for-assistant.ts`, `find-for-assistant.ts`, `assistants/domain/product-projection.ts:93`, `assistants/presentation/tools/products-tools.ts:69,82`, `products-texts.ts:4`, `src/composition/assistant-product-capabilities.ts:98,157` | `inCatalog` = active variant exists; refusal `VARIANT_FILTER_OUTSIDE_CATALOG`. |
| Storefront state | `catalog/infrastructure/catalog-settings-repository.ts:40` `readStorefrontState`, exposed by `catalogStorefront` in `catalog/composition.ts:45` | `{ currency, catalog: published \| hidden }`. |

## 4. Gaps this design closes

1. No stored visibility per product (section 7).
2. The save contract, use cases and body builders cannot write or return visibility, nor tell whether a save emptied the published catalog (sections 5.1-5.3, 8).
3. Buyer reads (catalog, cart, **Continuar**, preview) cannot tell offered from sellable (section 5.4).
4. Message reading candidates (text, visual) include hidden products; a known hidden product reads as sellable (section 5.5).
5. The reader cannot refuse raising a hidden item nor say «producto oculto» (section 5.6).
6. Readiness cannot express "all hidden" (section 5.7).
7. Web and mobile forms, lists and the mobile hint lack the switch, mark, notice and new hint text (sections 10, 16).
8. Assistants equate «en el catálogo» with "has an active variant" (section 5.8).

## 5. Use cases

### 5.1 `createProduct` (products, modified)

- **Change:** `CreateInput` gains `hidden: boolean`; the inserted row stores it. Nothing else changes. Create never reports `catalogEmptied` (it never withdraws a product).

### 5.2 `saveProduct` (products, modified)

- **Input:** `SaveProductInput` gains `hidden?: boolean` (`undefined` = do not touch).
- **Access, deps:** unchanged plus one dependency:

```ts
/** Whether another product of the company (RLS) is offered in this currency: active, not hidden, with an active variant. */
hasOtherOfferedProduct: (productId: ProductId, currency: Currency) => Promise<Result<boolean, ProductReadError>>;
```

- **Output:** `Result<SavedProduct, SaveProductError>`:

```ts
/** The saved product and whether this save hid the company's last offered product of its currency. */
export type SavedProduct = Readonly<{ detail: Detail; hidLastOffered: boolean }>;
```

  Justification: `Detail` is the product read; `hidLastOffered` is a fact of this save only and does not belong in the product.
- **Errors:** unchanged.
- **Flow (inside the existing transaction):**
  1. `lockProduct` (row lock, as today); `PRODUCT_CHANGED` check on `structureVersion` as today.
  2. `planProductSave(current, input, …)` puts `hidden` in `change.product.hidden` only when `input.hidden !== undefined && input.hidden !== current.hidden`. A visibility-only change is not empty, does not raise `structureVersion`.
  3. Validation as today; then `applyStructureChange(change)` writes `hidden` with the product update.
  4. If `change.product.hidden === true && isOffered(current)` (pure, over the aggregate `lockProduct` already loaded; no after-state is built), call `hasOtherOfferedProduct(productId, current.currency)`; `hidLastOffered = !other`. Otherwise `false` without a query.
  5. `reload`, observe, return `{ detail, hidLastOffered }`.

  The query stays inside the transaction for simplicity: it is a short-circuit `EXISTS` (0.02 ms when another product is offered, 2-7 ms at 10k products when 90-100% of the others are hidden, measured by the performance gate), it runs only on the hiding save, and the row lock it extends covers only the saved product. Running it after commit would give no consistency gain, since section 11.4 accepts the race either way.

  A save that deletes the product's last active variants in the form, or a variant deactivated through the status route, never sets `hidLastOffered`: emptying the catalog without hiding keeps today's behavior (no notice).

### 5.3 Last-visible notice (presentation, web route and API route)

Not a use case: a presentation rule over two facts.

```ts
/** apps/core/src/features/products/presentation/catalog-emptied.ts */
export function catalogEmptied(saved: SavedProduct, storefront: Readonly<{ published: boolean; currency: Currency }>): boolean
// = saved.hidLastOffered && storefront.published && saved.detail.product.currency === storefront.currency
```

- The API route `PUT /api/products/:productId` reads the storefront through a capability `describeStorefront(companyId)` that `src/app.ts` passes to `createProductRoutes({ describeStorefront })` (built from `catalogStorefront.describe`). The web action in `app/routes/product-detail.tsx` calls `catalogStorefront` directly (routes may compose features).
- The storefront is read only when `hidLastOffered` is true, after the save committed. A failed read gives `catalogEmptied: false` and logs `product_catalog_emptied_check_failed`; the save stays a success. Reason: the notice informs, it never decides the save. When `catalogEmptied` is true the caller logs `product_catalog_emptied`.

### 5.4 Buyer reads (products, modified)

- `catalog-products-repository.ts` `list` and `find`: add `p.hidden = false` (`hidden: false` in the Prisma `sellable` filter of `find`). List, search, product page and preview inherit it. A hidden product's page is `null` → the existing «Este producto ya no está disponible» 404.
- New `findOfferedVariants(ids)` in `order-stock.ts`: the same select and shape as `findSellableVariants` with `product: { status: "active", hidden: false }`. Exported from `products/index.ts`. Wired into `catalog/cart-composition.ts` (refresh) and `orders/composition.ts:500` (`createConfiguredCatalogOrder`). `findSellableVariants` stays for every other caller.

### 5.5 Message reading reads (products, modified)

- `coverageQuery` and its count: add `p.hidden = false` / `AND NOT hidden`. The word cap counts what the statement scans.
- `hasIndexedProducts`, `findNearestProductImages`: add `p.hidden = false`. `listProductsMissingEmbedding` is unchanged: hidden products keep being indexed so a shown-again product is recognized at once (product rule «Photos»).
- `readProductRowsForReading` selects `hidden` in its products query and passes only the visible product ids to the variant query (and so to the option query), keeping three queries whatever the count while not loading rows that are thrown away. `buildProductsForReading` sets `hidden`, and for a hidden product `variants: []`, `attributes: []`, `sellable: false`.
- `findSellableVariantsByQrCodes`: unchanged (see Decisions).

### 5.6 Reader rules (orders, modified, pure)

The rules live in a new file, `orders/domain/product-availability.ts`, so the staged reader calls them instead of re-implementing them:

```ts
/** Why a product the reader knows cannot be added; null (deleted) reads as not sold. */
export function notAvailableReason(product: Pick<ProductForReading, "hidden"> | null): "hidden" | "not_sold";
/** Whether a message's quantity change on an item of this product is refused: a hidden product's item can be lowered, removed or set at or below its quantity, never raised. */
export function refusesRaise(product: Pick<ProductForReading, "hidden"> | null, item: Readonly<{ quantity: number }>, change: Readonly<{ mode: "increase" | "set"; quantity: number }>): boolean;
```

`chat-reading.ts` and `pending-transitions.ts` only gain call-site lines:

- `freshAdd`, `changeVariant`: `product_not_available` with `reason: notAvailableReason(product)`.
- `advancePending` (`pending-transitions.ts:150-152`): same reason; `pending_ended.reason` stays `product_not_available`.
- `changeQuantity`: with `item = readingItem(action.item, world)` and `product = item?.productId ? world.byProductId.get(item.productId) ?? null : null`, when `item && refusesRaise(product, item, action)`, resolve to `report({ kind: "product_not_available", productId, reason: "hidden" })`. An item whose product is not loaded (context ceiling reached) is not refused (section 15).
- `problemOf` and `ProblemNotice` carry the reason; `seller-notice-texts.ts` gains `productHidden(name)` (es and pt-BR from the product draft) used when `reason === "hidden"`.
- `silenceTextMisses` (`apply-chat-message.ts`): silences when readiness is `no_active_products` or `all_products_hidden`.

### 5.7 `catalogSearchReadiness` (products, modified)

- **Deps:** `hasActiveProducts` is replaced by

```ts
/** Products with an active variant (RLS): none, only hidden ones, or at least one offered. */
productPresence: () => Promise<Result<"none" | "hidden_only" | "offered", PersistenceError>>;
```

  One statement with two short-circuit `EXISTS` (any active product with an active variant; any such product with `NOT p.hidden`), so a store with visible products answers at the first row (0.04 ms at 10k) as today's `hasActiveProducts` does; only a mostly-hidden store scans further (3-14 ms at 10k, measured by the performance gate). An aggregate (`bool_or`) is not used: it reads every product (8-9 ms at 10k) on every miss and every focus of the mobile WhatsApp screen.
- **Flow:** `none` → `no_active_products`; `hidden_only` → `all_products_hidden`; visual model disabled → `no_searchable_photos`; `hasIndexedProducts` (offered only) → `ready` or `no_searchable_photos`.

### 5.8 Assistant reads (products and assistants, modified)

- `product-search-repository.ts` `inCatalog`: `(p.hidden = false AND EXISTS active variant)` and its negation `NOT (…)`.
- `searchForAssistant` drops `VARIANT_FILTER_OUTSIDE_CATALOG` from its errors and checks; `assistant-product-capabilities.ts:157` loses that case; `products-texts.ts:4` loses the refusal text.
- `SearchedProduct` and `FoundProduct` gain `hidden: boolean`; `ProjectableProductSummary`/`ProjectableProduct` gain it. `inCatalogLine(product)`:
  - offered → «En el catálogo»;
  - hidden with active variants → «No está en el catálogo: producto oculto»;
  - hidden without → «No está en el catálogo: producto oculto y sin variantes activas»;
  - visible without → «No está en el catálogo: sin variantes activas».
- `customerLink(..., inCatalog)` receives `!hidden && active.kind === "some"`.
- Tool description: «un producto está en el catálogo si es visible y tiene al menos una variante activa»; the sentence «Los filtros de variante … no se combinan con en_catalogo «no»» is removed.

## 6. Domain and typing

| Type | Change | Justification |
| --- | --- | --- |
| `Product` (`products/domain/product.ts`) | `hidden: boolean` | The product's stored visibility; a boolean because there are exactly two states with no lifecycle. |
| `isOffered(product: Pick<Product, "status" \| "hidden" \| "variants">): boolean` (`products/domain/product-visibility.ts`) | new pure function | The single definition of "offered" in TypeScript; SQL repeats it as `status='active' AND NOT hidden AND EXISTS active variant`. |
| `ProductStructureChange.product.hidden?: boolean` | new optional field | The write stays bounded to the change (guide 3.6); `undefined` = untouched. |
| `SavedProduct` | new (`{ detail, hidLastOffered }`) | See 5.2. |
| `ProductForReading.hidden: boolean` | new field; `sellable` doc becomes «active, not hidden, with an active variant» | The reader must tell hidden from not sold to pick the reason and refuse raises. |
| `ChatMessageOutcome` `product_not_available` | `reason: "not_sold" \| "hidden"`, required in the type; the strict stored schema has `reason: z.enum(["not_sold", "hidden"]).default("not_sold")` | The notice text and the staged reader's buyer reply depend on it; read at reading time. The default is the true value of every outcome stored before. |
| `notAvailableReason`, `refusesRaise` (`orders/domain/product-availability.ts`) | new pure functions | One definition of the hidden-product reader rules, shared by `main`'s reader and the staged reader. |
| `ProblemNotice` `product_not_available` | same `reason` | Carries it to the text. |
| `CatalogSearchReadiness` (`products/domain/text-identification.ts`) | adds `"all_products_hidden"` | Mobile state 2 and silent text misses. |
| `VisibilityToSave` (`shared/product-visibility.ts`) | `{ kind: "unchanged" } \| { kind: "set"; hidden: boolean }` and `visibilityToSave(loaded: boolean, current: boolean): VisibilityToSave` | Same shape as `PhotosToSave`; both apps build the save body with it. |

No branded type: a boolean has no rule to parse.

| Layer | Types and authority |
| --- | --- |
| Database | `Product.hidden`, default `false`. |
| Products domain | `Product.hidden`, `isOffered`, `ProductForReading.hidden`. Core decides offered/sellable. |
| Orders domain | `product_not_available.reason`, raise refusal. |
| Shared contracts | `hidden` in create/save/detail/list; `catalogEmptied` in the save response; readiness value. |
| Web and mobile | Form value, loaded value, `visibilityToSave`; display only. |

## 7. Persistence

- **Migration** `YYYYMMDDHHMMSS_add_product_hidden`, generated with `prisma migrate dev --create-only` after adding `hidden Boolean @default(false)` to `Product` (database-migrations skill):

```sql
-- A constant default is metadata-only: no rewrite, no backfill; the lock wait is bounded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Product" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
COMMIT;
```

  `ADD COLUMN` still takes `ACCESS EXCLUSIVE` on `Product`, the most-read table (catalog, message reading, «Nueva venta», point of sale). Without the bound, the statement would queue behind any open reader and every later read would queue behind it. The wrapper follows the database-migrations skill (step 3) and the precedent `20261029014204_add_order_terminal_times`. A lock timeout fails the deploy cleanly, and it is retried. No backfill (existing products are visible). The RLS policy `product_company_isolation` covers the new column unchanged; no grant changes (the restricted app role already has column access to `Product`). No development data is deleted.
- **Index: none.** Every read that gains the filter already scans the company's products and evaluates a per-row predicate (`status`, `currency`, an `EXISTS` on variants): the catalog list by `companyId` (`@@index([companyId])`), the text coverage by a per-company scan the trigram index cannot serve (memory 6ee53355), the nearest-image query by an exact scan joined from `Product`. `hidden = false` is one more column test on rows already read, and it only removes rows (it cuts the coverage and vector work for hidden products). A partial index `WHERE hidden = false` would not change these plans because the planner still needs `companyId`, and the selectivity is low (most products visible). The performance gate measured it on PostgreSQL 18 under forced RLS, 10k products: identical plans with and without the filter, `NOT hidden` applied on the `Product` scan below `word_similarity` and `<=>`. `booleq` is leakproof, so RLS does not reorder it. Revisit only if `EXPLAIN ANALYZE` on the benchmark catalog shows otherwise (section 15).
- **Rows read:** `readProductRowsForReading`'s `productRowSchema` adds `hidden: z.boolean()`; the catalog, search and assistant row schemas add it where they select it.
- **Writes:** `insertProduct` stores `hidden`; `applyStructureChange` updates `hidden` with the product row when `change.product.hidden !== undefined`.

## 8. Contracts between applications

`shared/contracts/products.ts` (changed in place, no version field today):

```ts
createProductRequestSchema   // + hidden: z.boolean()
saveProductRequestSchema     // + hidden: z.boolean().optional()   (omitted = visibility untouched)
productDetailResponseSchema  // + hidden: z.boolean()
productListResponseSchema    // items + hidden: z.boolean()
saveProductResponseSchema = productDetailResponseSchema.extend({ catalogEmptied: z.boolean() })   // new, PUT response
```

`shared/contracts/catalog-search-readiness.ts`: `state` adds `"all_products_hidden"` (stays `version: 1`).

`shared/product-variants.ts`: `buildCreateProductBody(draft, meta)` sends `meta.hidden`; `buildSaveProductBody(draft, meta)` sends `hidden` only when `meta.visibility.kind === "set"`. `shared/product-visibility.ts` holds `VisibilityToSave` and `visibilityToSave`.

Core validates every request with these schemas (unchanged routes and statuses: 400 malformed, 422 business rejection, 409 `PRODUCT_CHANGED`). Mobile parses the PUT response with `saveProductResponseSchema`, the list and detail with theirs. No new error codes.

## 9. Events and cross-feature integration

### 9.1 Capabilities

- No new event. Hiding does not publish `product_photos_added` nor any other event; embeddings stay.
- products → catalog: `findOfferedVariants` (public export), `listForCatalog`/`findForCatalog` (unchanged signatures).
- products → orders: `findOfferedVariants` for **Continuar**; `ProductForReading.hidden`; readiness value.
- catalog → products route: `describeStorefront` injected by `src/app.ts` into `createProductRoutes`. Products never imports catalog.
- products → assistants: `hidden` in `SearchedProduct`/`FoundProduct`.

### 9.2 Meeting contract with the staged message reader

The staged reader reads products only through `products/composition.ts` (`findMentionCandidates`, `identifyProductsInImage`, `findProductsForReading`, `catalogSearchReadiness`, `findSellableVariants`). This task defines, on `main`, the pieces it will consume, so the staged reader only adds:

| Piece | Defined here |
| --- | --- |
| `ProductForReading.hidden` | `true` for a hidden product, which then has `sellable: false` and no variants. |
| `product_not_available.reason` | `"hidden"` or `"not_sold"`; stored default `"not_sold"`. |
| `notAvailableReason`, `refusesRaise` | `orders/domain/product-availability.ts`, outside the parts of `chat-reading.ts` the staged reader deletes. |
| `CatalogSearchReadiness` | gains `all_products_hidden`. |
| `findSellableVariants` | ignores visibility (undo restores hidden items). |
| Candidate reads | `coverageQuery`, `findNearestProductImages`, `hasIndexedProducts` exclude hidden. |

**Merge-second obligations** (whichever of the two tasks merges second does them; recorded so the staged reader's side sees them; they implement the product draft's «Obligations for the staged reader» 1-7):

1. `findMentionCandidates` / `searchMentionsByCoverage`: the sellable side keeps `NOT hidden`; the unavailable-twin side counts a hidden product with active variants as a twin (`hidden OR NOT EXISTS active variant`), with the same name-key rule (a visible same-key product wins). Its active-product count and pair budget count hidden products, since the statement scans them.
2. The twin guard («the company has a product with an active variant») counts hidden products.
3. The buyer reply for `product_not_available` with `reason: "hidden"` uses the «no está disponible por ahora» texts.
4. The staged reader's `domain/reader/request-checks.ts` calls `refusesRaise` on its increase and set paths and `notAvailableReason` wherever it builds `product_not_available`.
5. «Por resolver» and pendings: no extra code; a hidden pending ends on its next completion attempt with `reason: "hidden"`.
6. Undo of a removed hidden item uses `findSellableVariants` (visibility ignored); the «ya no se vende» refusal stays for `not_sold` only.
7. Undo of an ended hidden pending restores it like any pending.
8. Every switch on `CatalogSearchReadiness` handles `all_products_hidden` like `no_active_products` for text misses.
9. Textual conflicts expected: the staged branch already edited `chat-message-outcome.ts` (its T0) and will extend `seller-notice.ts` (its T6). Whoever merges second adds `reason` to every `product_not_available` the other side builds (staged `request-checks.ts`, its fixtures and evals), keeps the stored default and keeps both sides' new outcome fields.

If this task merges second, the same list applies to the staged reader's code on `main` at that time.

## 10. Mobile

| Layer | File | Change |
| --- | --- | --- |
| Domain | `apps/mobile/src/features/products/domain/product.ts` | `Product.hidden`, `ProductListItem.hidden`. |
| Application | `application/product-operations.ts` | Create passes the form's `hidden`; save passes `visibility: visibilityToSave(loaded.hidden, draft.hidden)`; save result carries `catalogEmptied`. (T0 first passes `hidden: false` and `visibility: { kind: "unchanged" }` to keep it compiling; T4 replaces them.) |
| Infrastructure | `infrastructure/product-api.ts` | Parses `hidden` and `saveProductResponseSchema`. |
| Presentation | `presentation/product-form.tsx`, `product-form-state.ts` | The «Ocultar producto» row with the native switch of `catalog-publication-card`, after the photo strip, before «Variantes»; part of the draft and of the discard guard; disabled while saving. |
| Presentation | `presentation/product-management-screen.tsx` | «Cambios guardados» alert adds the last-visible paragraph when `catalogEmptied`. |
| Presentation | `presentation/catalog-screen.tsx` | «Oculto» mark with eye-off icon under the stock line. |
| Presentation | `presentation/translations.ts` | Label, hint, mark, notice (es, pt-BR). |
| WhatsApp hint (in T0) | `features/whatsapp/presentation/catalog-readiness-hint.tsx`, `features/notifications/presentation/notices-provider.tsx` (`CatalogReadinessLoader` typed from the contract state), `features/notifications/presentation/translations.ts` | State `all_products_hidden` with its text and **Ir a Productos**. Done in T0 with the contract value, so mobile typecheck stays green. |

No local SQLite change: products are not stored offline. Retries are those of the product save today (no automatic retry; **Reintentar** resends the same body, so an unchanged visibility stays omitted).

## 11. Transactions and concurrency

1. `productTransaction(companyId)` opens the company-scoped write transaction (unchanged timeouts).
2. `lockProduct` takes the product row lock; two saves of the same product serialize. Last save that writes `hidden` wins (product rule «Two devices both change the switch»).
3. A save without `hidden` never writes it, so a stale form cannot show a hidden product again (product rule «Device B»). No version check on visibility: `structureVersion` is not raised and not compared for it.
4. `hasOtherOfferedProduct` runs inside the same transaction under READ COMMITTED. Two simultaneous saves that hide the company's last two offered products can both see the other still offered and neither shows the notice. Accepted: the notice informs, and the outcome (catalog empty) is still visible in the catalog and list.
5. Readers (catalog, reader, assistants) read committed data; a read started before the commit may still show the product (product rule «When it takes effect»).

## 12. Code organization

| Feature | Layer | Files |
| --- | --- | --- |
| products | domain | `product.ts` (`hidden`), `product-visibility.ts` (new, `isOffered`), `product-structure.ts` (`planProductSave` plans `hidden`), `reading-product.ts`, `text-identification.ts` (readiness value) |
| products | application | `create.ts`, `save-product.ts` (`SavedProduct`, `hasOtherOfferedProduct`), `find-products-for-reading.ts`, `catalog-search-readiness.ts`, `search-for-assistant.ts`, `find-for-assistant.ts` |
| products | infrastructure | `repository.ts` (insert, update, `hasOtherOfferedProduct`), `order-stock.ts` (`findOfferedVariants`), `catalog-products-repository.ts`, `text-candidates.ts`, `image-embeddings.ts`, `catalog-search-readiness.ts` (`productPresence`), `reading-products.ts`, `product-search-repository.ts`, product list query |
| products | presentation | `api-routes.ts` (`createProductRoutes`), `catalog-emptied.ts` (new), `product-presenter.ts`, `request-input.ts`, `product-form.tsx` |
| products | composition | `product-editing.ts` (wires `hasOtherOfferedProduct`), `composition.ts` (readiness deps), `index.ts` (export `findOfferedVariants`) |
| catalog | composition | `cart-composition.ts` (`findOfferedVariants`) |
| orders | domain | `product-availability.ts` (new: `notAvailableReason`, `refusesRaise`), call sites in `chat-reading.ts` and `pending-transitions.ts`, `chat-message-outcome.ts`, `seller-notice.ts` |
| orders | application | `apply-chat-message.ts` (`silenceTextMisses`) |
| orders | presentation | `seller-notice-texts.ts` |
| orders | composition | `composition.ts:500` (one line) |
| assistants | domain, presentation | `product-projection.ts`, `tools/products-tools.ts`, `tools/products-texts.ts` |
| app | composition | `src/app.ts` (`createProductRoutes({ describeStorefront })`), `src/composition/assistant-product-capabilities.ts` |
| web | routes | `app/routes/product-new.tsx`, `product-detail.tsx`, `product-list.tsx`, `app/locales.ts` |
| mobile | whatsapp, notifications, products | section 10 |
| shared | contracts | `contracts/products.ts`, `contracts/catalog-search-readiness.ts`, `product-variants.ts`, `product-visibility.ts` (new) |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `product_created` (existing) | info | `product-editing.ts` | adds `["hidden"]` |
| `product_saved` (existing summary, after commit) | info | `product-editing.ts` | adds `["hiddenChanged", "hidden", "hidLastOffered"]` |
| `product_catalog_emptied` | info | API route and web action, when `catalogEmptied` is true | `["companyId", "productId"]` |
| `product_catalog_emptied_check_failed` | warn | `catalog-emptied` callers (API route, web action) | `["companyId", "productId", "errorCode"]` |
| `message_candidates_found` (existing) | info | `text-candidates.ts` | unchanged; `wordCount` now reflects the visible count |
| `chat_message_processed` / outcome logs (existing) | info | orders | outcome kinds already logged; `product_not_available` adds `["reason"]` where outcomes are summarized |

Never logged: product names, prices, message text, the buyer's phone, store URLs.

## 14. Tests

### Unit, core

- products domain: `test("a visible active product with an active variant is offered")`, `test("a hidden product is not offered even with active variants")`, `test("a product without active variants is not offered whether hidden or not")`.
- `planProductSave`: `test("plans the visibility only when the request sends a different value")`, `test("a visibility-only change does not raise the structure version")`, `test("an omitted visibility keeps the stored one")`.
- `saveProduct` with fakes: `test("hiding the last offered product reports that it withdrew the last offered product")`, `test("hiding a product while another is offered does not report it")`, `test("hiding a product without active variants does not report it")`, `test("deleting the last active variants of the last offered product does not report it")`, `test("saving an already hidden product does not report it")`, `test("a save that does not send visibility keeps a product hidden by another device")`.
- `catalogEmptied`: `test("is true only when the catalog is published and the product is in the store currency")`.
- `buildProductsForReading`: `test("a hidden product reads as not sellable, hidden and without variants")`.
- `catalogSearchReadiness`: `test("reports all products hidden when every product with an active variant is hidden")`, `test("reports no searchable photos when only hidden products have indexed photos")`, `test("reports no active products when the company has none with an active variant")`.
- `product-availability`: `test("a hidden product's reason is hidden and a missing product's is not sold")`, `test("raising or setting above the quantity is refused only for a hidden product")`.
- stored outcome schema: `test("a stored product not available without reason reads as not sold")`.
- reader (`chat-reading`): `test("adding a hidden product gives product not available with reason hidden")`, `test("a QR label of a hidden product gives product not available with reason hidden")`, `test("one more of a hidden item changes nothing and gives product not available")`, `test("setting a hidden item above its quantity is refused")`, `test("setting a hidden item at or below its quantity applies")`, `test("removing a hidden item applies")`, `test("changing the variant of a hidden item is refused")`, `test("raising an item of a deactivated variant still applies")`.
- `advancePending`: `test("completing a pending of a hidden product ends it with reason hidden")`.
- `seller-notice-texts`: `test("the hidden reason uses the producto oculto body in Spanish and Portuguese")`, `test("the not sold reason keeps the ya no está a la venta body")`.
- `silenceTextMisses`: `test("text misses stay silent when all products are hidden")`.
- shared: `test("visibility toggled and toggled back is unchanged")`, `test("the save body omits hidden when unchanged and sends it when set")`, `test("the create body always sends hidden")`.
- assistants projection: `test("a hidden product reads No está en el catálogo: producto oculto and has no customer link")`, `test("a hidden product without active variants reads producto oculto y sin variantes activas")`.

### Integration, core (real database)

- `test("the migration adds hidden false to existing products")` (migration check through `migrate deploy` in the test database).
- product API and web action: `test("creating a hidden product stores it hidden")`, `test("saving with hidden true hides the product and returns it hidden")`, `test("saving without hidden keeps the stored visibility")`, `test("hiding the last offered product of a published catalog returns catalogEmptied true")`, `test("hiding the last offered product of an unpublished catalog returns catalogEmptied false")`, `test("product list returns hidden for each product")`, `test("another company cannot read or change a product's visibility")`.
- catalog: `test("a hidden product is not listed, not found by search and its page is not found")`, `test("a store whose products are all hidden lists no products")`, `test("the appearance preview leaves hidden products out")`, `test("the appearance preview of a store with every product hidden gets no cards and falls back to the sample products")`, `test("showing a hidden product again lists it and opens its page")`, `test("cart refresh marks a hidden line unavailable")`, `test("Continuar with a hidden line creates no order")`, `test("Continuar on an unchanged cart returns the pending catalog order holding a hidden line")`.
- manual paths: `test("Nueva venta sells a hidden product and deducts its stock")`, `test("the sale catalog search offers hidden products")`, `test("the order editor adds a hidden product")`, `test("the point of sale finds a hidden product by its QR code")`.
- reading: `test("text candidates exclude hidden products")`, `test("nearest images exclude hidden products")`, `test("products for reading mark a hidden product and load no variants for it")`, `test("showing a hidden product again makes it a text candidate")`, `test("readiness reports all products hidden")`, `test("a photo of a hidden product's QR label gives the hidden notice and adds nothing")`, `test("a buyer cannot raise a hidden item by message")`.
- assistants: `test("en_catalogo no lists hidden products with a matching active variant")`, `test("en_catalogo sí excludes hidden products")`.

### Mobile (Jest, RNTL)

- `test("the product form saves the hidden switch and omits it when toggled back")`, `test("a changed switch triggers the discard guard")`, `test("the list shows Oculto under the stock line for a hidden product")`, `test("the saved alert adds the last-visible paragraph when the catalog was emptied")`, `test("the switch is disabled while saving")`.

- T0: `test("the WhatsApp hint shows the all hidden text with Ir a Productos")`.

### Web E2E (happy path)

- `test("the seller hides a product and the buyer no longer sees it in the catalog")` (`apps/core/tests/e2e/hide-product.spec.ts`).

### Manual checks (pull request)

- Mobile on a device: switch accessibility (name, hint, state announced), «Oculto» mark contrast in light and dark, alert with two paragraphs.
- WhatsApp hint states 1-3 on a device with real readiness.
- A real chat: QR label of a hidden product gives «Producto no disponible» with the hidden body.

## 15. Limits and checks during implementation

- Verify with `EXPLAIN ANALYZE` on the benchmark catalog (10,000 products) that `coverageQuery`, `findNearestProductImages`, the catalog `list` and `productPresence` keep their plans and timing with `hidden = false`, in two shapes: all visible (today's fixtures) and 90% hidden (added to `message-candidates-fixtures.ts`). The second shape measures the changed word cap: the cap now counts offered products, so 9k hidden of 10k gives about 25 words × 1k offered ≈ 25k pairs, inside `TEXT_MATCH_PAIR_BUDGET`. Invariant: coverage cost = searched words × offered products; hidden rows are scanned but never compared. Add no index unless a plan regresses.
- Verify that `prisma migrate dev --create-only` produces only the `ADD COLUMN … DEFAULT false` statement, then wrap it in the `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'; … COMMIT;` of section 7.
- Known limit for a future approximate (HNSW) image index: memory 83a45100 already requires an over-fetch of about k × 8 photos because of `DISTINCT ON`; `NOT hidden` is a second filter applied after the ANN scan, so that over-fetch must also grow with the company's hidden share, or a mostly-hidden store gets too few candidates. Today's exact scan has no such issue.
- Raising an item whose product did not fit the reader's product ceiling is not refused; items rank before text candidates in `selectReadingProducts`, so this needs more than `maxReaderProducts` shown and pending products. Accepted.
- `hidLastOffered` compares by the saved product's currency; a product in a currency other than the store's is never offered in the catalog, and `catalogEmptied` requires the store currency.
- Photo-twin risk for hidden products (product draft, real risk) stays out; no code here.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T0 Visibility stored, saved and returned (core + shared contract)
Wave 2:  T1 Buyer catalog │ T2 Message reading │ T3 Web form and list │ T4 Mobile │ T5 Assistants   (parallel, disjoint files)
```

Every wave-2 task depends only on T0. The shared files each task touches are listed in its scope; no two wave-2 tasks touch the same file. Every task, T0 included, leaves `pnpm --dir apps/core lint`, `typecheck` and `test:unit`, `pnpm --dir apps/mobile lint`, `typecheck` and `test`, and `scripts/ci.sh --fast` green on its own; a contract change is never left for a later task to compile.

### T0. Visibility stored, saved and returned

**Scope:**
- Core: migration `add_product_hidden` (with the section 7 wrapper) and `schema.prisma`; `Product.hidden`, `isOffered`; `planProductSave`, `createProduct`, `saveProduct` (`SavedProduct`, `hasOtherOfferedProduct`), repository insert/update/list/detail reads; `catalog-emptied.ts`; `createProductRoutes({ describeStorefront })` and its registration in `src/app.ts`; server side of `app/routes/product-new.tsx` and `product-detail.tsx` actions (return `hidden` and `catalogEmptied`); presenters and request mappers; products observability of section 13.
- Shared: `shared/contracts/products.ts`, `shared/product-variants.ts`, `shared/product-visibility.ts`, `shared/contracts/catalog-search-readiness.ts` (value `all_products_hidden`).
- Compile-only caller fixes, so both apps stay green: the client calls of `buildCreateProductBody`/`buildSaveProductBody` in `app/routes/product-new.tsx:67`, `product-detail.tsx:98` and `apps/mobile/src/features/products/application/product-operations.ts:30,34` pass `hidden: false` and `visibility: { kind: "unchanged" }` (T3 and T4 replace them with the form value); tests that assert those bodies.
- The complete mobile WhatsApp hint change (section 10 «WhatsApp hint»): `notices-provider.tsx` types `CatalogReadinessLoader` from the contract state, `catalog-readiness-hint.tsx` shows state 2, `notifications/presentation/translations.ts` gets its es/pt-BR text. It is small and is the only way the contract value compiles without a stub.
**Out of scope:** any read filter, the form switch and list mark (T3, T4), readiness computation (T2), reader, assistants.
**Acceptance criteria:**
1. `PUT /api/products/<id>` with `hidden: true` returns the product with `hidden: true`; a following `PUT` without `hidden` (description typo) keeps it hidden.
2. A published store whose only offered product is «Casaca jean»: hiding it returns `catalogEmptied: true`; with the catalog hidden, `false`; hiding a product without active variants, `false`.
3. `POST /api/products` with `hidden: true` creates it hidden; `structureVersion` is unchanged by a visibility-only save.
4. Existing products read `hidden: false` after the migration; RLS still isolates another company.
5. Saving with `hidden: true` a product that was already hidden returns `catalogEmptied: false`; deleting the last active variants of the last offered product in the form returns `catalogEmptied: false`.
6. On mobile, a mocked readiness of `all_products_hidden` shows «Tus productos a la venta están ocultos…» with **Ir a Productos** (product criterion 18, first part).
**Tests:** section 14 products domain, `planProductSave`, `saveProduct`, `catalogEmptied`, shared, the T0 mobile title; integration «product API and web action» and migration.
**Depends on:** nothing.

### T1. Buyer catalog and cart

**Scope:** `catalog-products-repository.ts` (`list`, `find`); `findOfferedVariants` in `order-stock.ts` and `products/index.ts`; `catalog/cart-composition.ts`; `orders/composition.ts:500` (one line, `createConfiguredCatalogOrder`); E2E `tests/e2e/hide-product.spec.ts` (seller hides via the API or a seeded hidden product; buyer view).
**Out of scope:** product form UI (T3), `findSellableVariants` and its other callers.
**Acceptance criteria:** product criteria 1, 2, 3, 4, 9, 10, 11, 17 (buyer part), 21.
**Tests:** integration «catalog» and «manual paths»; E2E.
**Depends on:** T0.

### T2. Message reading, visual search and readiness

**Scope:** `text-candidates.ts` (and the 90%-hidden shape in `message-candidates-fixtures.ts`); `image-embeddings.ts` (`hasIndexedProducts`, `findNearestProductImages`); `catalog-search-readiness.ts` (infrastructure `productPresence`, application, domain value) and `products/composition.ts` readiness wiring; `reading-products.ts`, `find-products-for-reading.ts`, `reading-product.ts`; new `orders/domain/product-availability.ts`; call sites in `orders/domain/chat-reading.ts` and `pending-transitions.ts`; `chat-message-outcome.ts` (with the stored default), `seller-notice.ts`; `orders/application/apply-chat-message.ts` (`silenceTextMisses` only); `orders/presentation/seller-notice-texts.ts`; evals expectations that name `product_not_available`.
**Out of scope:** the staged reader (section 9.2 is its list); unavailable twins on `main`; QR lookup changes.
**Acceptance criteria:** product criteria 5 (`main` part), 6, 7, 8, 9 (message part), 11 (message part), 22 (`main` part); `GET /api/products/search-readiness` answers `all_products_hidden` for a store whose products with active variants are all hidden.
**Tests:** unit `product-availability`, stored outcome schema, reader, `advancePending`, readiness, `buildProductsForReading`, notice texts, `silenceTextMisses`; integration «reading»; the section 15 `EXPLAIN ANALYZE` in both shapes, reported in the pull request.
**Depends on:** T0.

### T3. Web form, list and notice

**Scope:** `products/presentation/product-form.tsx` (switch row, hint, accessibility, draft and discard guard), the client part of `app/routes/product-new.tsx` and `product-detail.tsx` (send `hidden`/`visibility`, show the last-visible notice after «Producto guardado correctamente.»), `app/routes/product-list.tsx` («Oculto» badge with eye-off icon), `app/locales.ts` (es, pt-BR).
**Out of scope:** server behavior (T0), catalog reads (T1).
**Acceptance criteria:** product criteria 1 (seller part), 12, 13, 15, 16 (web side), 17 (web notice). Criterion 15 (in doubt) is covered by the existing save-failure tests: the switch adds no failure path.
**Tests:** component tests in `product-form.test.tsx` and the list route mirroring the mobile titles; manual accessibility check.
**Depends on:** T0.

### T4. Mobile form, list, notice and WhatsApp hint

**Scope:** section 10 files except the WhatsApp hint row (done in T0): `domain/product.ts`, `application/product-operations.ts` (replaces T0's placeholders), `infrastructure/product-api.ts`, `presentation/product-form.tsx`, `product-form-state.ts`, `product-management-screen.tsx`, `catalog-screen.tsx`, `presentation/translations.ts`.
**Out of scope:** core changes; the WhatsApp hint (T0); readiness computation (T2).
**Acceptance criteria:** product criteria 12 (mobile, no alert), 13, 14, 16 (phone side), 17 (mobile alert), 19. Criteria 14 (offline) and 15 (in doubt) are covered by the existing save-failure tests: the switch adds no failure path, and **Reintentar** resends the same body.
**Tests:** section 14 mobile.
**Depends on:** T0.

### T5. Assistants

**Scope:** `product-search-repository.ts`, `search-for-assistant.ts`, `find-for-assistant.ts`, `assistants/domain/product-projection.ts`, `assistants/presentation/tools/products-tools.ts`, `products-texts.ts`, `src/composition/assistant-product-capabilities.ts`, assistant docs strings in the tool description.
**Out of scope:** any write tool.
**Acceptance criteria:** product criterion 20; `en_catalogo: "sí"` with a hidden «Casaca jean» does not list it.
**Tests:** unit projection; integration «assistants»; existing `assistant-product-capabilities.test.ts` updated for the removed refusal.
**Depends on:** T0.

### Final verification

On the integration branch after all tasks: `scripts/ci.sh`, the web E2E, the manual checks of section 14, and product criteria 1-22 walked once end to end (web and a mobile device). The coordinator records the section 9.2 list on Todoist 6hv99FVqgMmmJJR3. On merge, the permanent docs listed in the product draft's «Information that is kept» are updated and both drafts deleted.

## 17. Questions decided by the review gate

1. **Does the last-visible notice also appear when a save empties the published catalog without hiding?**
   - **Answer:** option (2). The notice appears only when the save turned «Ocultar producto» on and left the published catalog with no offered product (`hidLastOffered`, section 5.2). Emptying the catalog by deleting variants in the form or by deactivating them through the variant status route keeps today's behavior: no notice.
   - **Decided by:** the coordinator, on disagreement between the reviewers (design reviewer: option 2; performance reviewer: option 1).
   - **Reason:** the design reviewer verified that the product save cannot deactivate variants (variant status goes through `PUT /api/products/:productId/variants/:variantId/status`), so option 1's case does not exist in the save path. Covering deletion in the form but not deactivation one click away would be inconsistent, and full coverage would mean returning `catalogEmptied` from the variant routes and dialogs, which is beyond this product definition. The product text frames the notice around hiding («the saved product was the last visible product with an active variant»; not shown «when the hidden product had no active variant»).
   - **Discarded:** option (1), any save that leaves the catalog with no offered product. Its performance argument (no measurable cost) holds, but it covers only form deletion, an inconsistent partial case.
