# Products with variants: technical design

**Status:** design closed, pending implementation. The review gate approved it in round 4; every question is recorded in §17 for the founder to confirm in the final pull request. Based on `docs/drafts/product-variants.md` (definition ready to implement, 2026-10-26). Base: `jorgeluis594/crear-y-editar-productos-con-variantes-o` at `4e4f8d53` (`main` at `b4125b41`).

## 1. Technical goal

Core stores each product's ordered options and values as their own rows, links every variant to one value per option, and lets a variant be `inactive`.

The products API (`/api/products`) changes in place. It:
- creates products with options;
- saves the whole editor state in one short transaction with a bounded number of statements;
- rejects stale editor forms;
- runs the per-variant actions: edit, change combination, deactivate, activate, delete.

Every reader that already works per variant (sale, catalog, checkout, message-to-order, printing) receives the combination in the saved order and keeps excluding variants that are not `active`. Web and mobile editors share one pure module of editor rules.

There are no customers yet, so contracts change directly: no versioned API and no compatibility with installed app builds. Response schemas stay tolerant to new fields so the next builds can evolve.

```text
                      ProductOption ──< ProductOptionValue
                           │  (position)        │ (position)
Product ──< ProductVariant ─┴──< ProductVariantOptionValue (one per option)
  │ structureVersion │ status: active | inactive
                     │ combinationKey (unique per product)
                     ├── ProductStock
                     └──< OrderItem (variantAttributes: json, keys in option order at sale time)

mobile ──── /api/products ──┐
web loaders ────────────────┼─ src/composition/product-editing.ts ─ products use cases ─ Prisma (RLS)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Contract evolution | `/api/products` and `shared/contracts/products.ts` change in place, without a versioned API or a legacy mapping. There are no customers (founder, see §17). Web and mobile switch to the new shapes in the same branch. |
| Response tolerance | Response schemas are `z.object` (non-strict) with their own option, value and variant objects. They never reuse the strict request objects. A later optional field (for example the photo per value of `6hqMVjGfqcR7rF6V`) does not break a shipped build. |
| Variant status in responses | Responses carry `status: z.string()`. Clients treat every value other than `"active"` as not on sale and show it as «Desactivada». A future status therefore does not break shipped builds. Requests accept only `"active" \| "inactive"`. |
| Options storage | Three tenant tables: `ProductOption` (name, position), `ProductOptionValue` (name, position) and `ProductVariantOptionValue` (variant × option → value). Renaming a value renames it for all its variants with one row update. |
| Combination uniqueness | `ProductVariant.combinationKey` is the product's value ids as lowercase text, sorted by code unit (`COLLATE "C"` in SQL, the default `Array.prototype.sort` in TypeScript) and joined by `,`. It is `''` for a product without options. It has a unique index on `(companyId, productId, combinationKey)`. The key does not change on rename or reorder. |
| `ProductVariant.attributes` | Dropped by the migration of T0. There is no production data and every instance stops during the deploy, so no transition period is kept (founder, §17). |
| Variant status | `ProductVariant.status` admits `active` and `inactive` (CHECK). `Product.status` does not change. |
| Ordered snapshot in orders | `OrderItem.variantAttributes` changes from `jsonb` to `json` and keeps the record shape. Keys are inserted in option order (gate decision, §17). It is a plain `ALTER COLUMN … TYPE json` in the T0 migration (§7.2). |
| Product create | `POST /api/products` takes ordered `options` (client UUIDs) and variants that reference value ids. A product without options sends `options: []` and one variant with `values: []`. |
| Editor save | `PUT /api/products/:productId` takes `structureVersion`, the full ordered options, the price and SKU of listed saved variants, the new variants and explicit deleted variant ids. See §5.2 for the exact semantics. |
| Stale forms | `Product.structureVersion` increments on every structural write: create, save with an option, value or variant change, change combination, delete variant. A save whose `structureVersion` is not the current one is rejected with `409 PRODUCT_CHANGED` and writes nothing. Prices, SKUs and status do not bump it, so they stay last-write-wins, as today. |
| Write plan | Writes are a diff against the loaded aggregate and go out in bulk, a fixed number of statements per table. The statement count of a create or save does not grow with the variant count; the per-phase ceilings are in §11. Editing transactions run with an explicit timeout (§11). |
| Values without variants | On create and on every save, core drops from the final state any value left without a variant, and then any option left without values. That is the product rule «Valor sin variantes». The value is dropped, not rejected, and the response shows the stored result. |
| Multi-query reads | Each read that issues several queries runs in one `RepeatableRead` read transaction, so it sees one snapshot (§7.4). |
| Per-variant actions | Separate endpoints under `/api/products/:productId/variants/:variantId` that save at once: edit price and SKU, change combination, set status, delete. Each returns the product detail, built by `getProduct` with `hasOrders`. |
| Identifiers | The client generates the product UUID (as today) and the UUIDs of new options and values. Core generates variant ids and QR codes. Id problems the domain detects (an id used outside the product, repeated in the request or moved to another option) are `422 VALIDATION_ERROR` issues with reason `ID_CONFLICT`, reported together with the other issues. The top-level `409 ID_CONFLICT` is only the race fallback when a primary key rejects an insert. |
| "Has orders" | Orders exposes `findOrderedVariantIds(variantIds)` as a semi-join. It counts any order, including unconfirmed catalog orders. It is injected into products from `src/composition/`, because a products → orders dependency would create a feature cycle. The final guard on delete is the `OrderItem → ProductVariant` `RESTRICT` FK. |
| Limits | 3 options, 30 values per option, 100 variants per product, and 1–30 characters per name after trimming. They are constants in `shared/contracts/products.ts` (`productOptionLimits`; initial values, adjustable by a code change), because the editors need them synchronously on the device. This is an exception to guide 6.8; the guide update is proposed in §17. |
| Error codes | Typed enums shared by web and mobile: `productApiErrorCodeSchema` and `productIssueReasonSchema`. New top-level codes are added to `apiErrorCodeSchema` (`shared/contracts/registration.ts`). |
| Selling a deactivated variant | No new code. The sellable lookups already filter `status = 'active'`, so core answers `404 VARIANT_NOT_FOUND` with `variantId`. Web and mobile mark the item «L / Azul ya no está disponible.». |
| Deactivation versus a concurrent order | No lock between them. An order created in the same instant as the deactivation is equivalent to one created just before it, which the product definition allows. |
| Shared editor rules | `shared/product-variants.ts` holds the editor rules and the only `combinationLabel` (`L / Azul`). Core imports it, so web, mobile, labels and the PR #150 notices use one text. |
| Existing data | Not converted. There is no production data, and today's forms only create one variant per product, so every existing product becomes a product without options (founder, §17). |
| Web label printing | The detail page renders the label (name, combination, SKU, QR) and opens the browser print dialog, reusing the approach of `dispatch-label-print-dialog.tsx`. The QR is drawn with the `qrcode` library, at the version mobile already uses. |
| Deferred | Editing the stock of saved variants (`6hj7HpVmhfCCHrC3`, the fields stay read-only), photo per color (`6hqMVjGfqcR7rF6V`), PR #150 `resolveVariant` (§9.3) |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Product tables | `apps/core/prisma/schema.prisma` (`Product` 338, `ProductVariant` 370, `ProductStock` 390) | `attributes Json` (jsonb, NOT NULL), `status String` with CHECK `ProductVariant_status_active` and `ProductVariant_attributes_object` (`20260924060712_add_products/migration.sql:91-95`). Tenant RLS and composite FKs per company. SKU unique on `("companyId", lower(btrim(sku))) WHERE sku IS NOT NULL` (`:88`). `@@index([companyId, productId])` on `ProductVariant`. |
| Order snapshot | `OrderItem` (schema 526) | `variantAttributes JSONB` with CHECK `OrderItem_attributes_object` (`20260928041822_add_manual_orders/migration.sql:75`). FK to the variant with `onDelete: Restrict`. Index `(companyId, variantId)`. |
| Transactions | `apps/core/src/shared/infrastructure/persistance.ts` (`withinTransaction`, `withLockedForUpdate`) | `$transaction(cb)` without options, so Prisma's interactive default applies (5 s timeout). |
| Migration runner | `apps/core/scripts/migrate.ts` | Withholds raw Prisma output. Maps known markers in `_prisma_migrations.logs` to an `errorCode` in `migration_attempt_completed`. README: on failure, inspect `_prisma_migrations` through administrative access. Order writes are stopped during migration and deploy. |
| CONCURRENTLY precedent | `20261010115424_add_product_search_trigram_indexes` | `SET lock_timeout` plus `CREATE INDEX CONCURRENTLY`, in a file without function bodies. |
| Domain | `products/domain/product.ts`, `errors.ts`, `validation.ts`, `rules.ts` | `ProductVariant.status: "active"`, free `attributes`. Typed `ProductValidationReason`. |
| Use cases | `products/application/create.ts`, `update.ts`, `get.ts`, `list.ts` | Implicit tenant (`getCompanyId`). |
| Repository | `products/infrastructure/repository.ts` | Create writes 2 statements per variant in a loop; update writes one statement per variant. `list` loads every variant and stock row of the page and maps them. |
| HTTP | `products/presentation/api-routes.ts` at `/api/products` (`src/app.ts:104`) | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`. |
| Contract | `shared/contracts/products.ts` | `status: z.literal("active")` (70, 81). `productApiErrorSchema.code` is an untyped string. |
| Sellable reads | `products/infrastructure/order-stock.ts` | Every sellable read filters `status: "active"`. `deductProductStock` and `restoreProductStock` do not filter by status. |
| Order creation | `orders/application/create-order.ts:45-48` | Calls `findSellableVariant` once per item inside the order transaction. `VARIANT_NOT_FOUND` carries `variantId`. |
| Public catalog | `products/infrastructure/catalog-products-repository.ts`, `domain/catalog-product.ts`, `catalog/presentation/variant-selection.ts`, `catalog/cart-composition.ts`, `app/components/catalog-cart.tsx`, `app/lib/catalog-cart-storage.ts` | `list` and `find` share one `include`. Selectors are derived from variant keys. Cart lines store `attributes`. |
| Message to order | `products/application/identify-products-in-image.ts`, `infrastructure/image-embeddings.ts` | QR and visual search use the sellable reads. `hasIndexedProducts` checks only `Product.status`. |
| `resolveVariant` | not in `main` | It lives in PR #150. |
| Fixtures that write `ProductVariant.attributes` | 23 core test files, 25 e2e specs and `tests/e2e/fixtures.ts`, `scripts/seed.ts`, `store-appearance/presentation/preview-fixtures.ts` | Direct Prisma writes. Some seed multi-option products, and the catalog integration test asserts selector order. |
| Mobile | `apps/mobile/src/features/products/`, `features/orders/` | Parses the shared contracts. The sale queue treats `VARIANT_NOT_FOUND` as definitive. |
| Customers | — | None yet. |

## 4. Gaps this design closes

1. There is no storage for ordered options and values, and no way to rename a value across its variants (§7).
2. A variant cannot be inactive (§7, §8).
3. Products cannot be created with options, and options, values, order and variants cannot be edited (§5.1, §5.2).
4. The per-variant actions do not exist (§5.3–§5.6).
5. Readers return combinations in arbitrary order, and order snapshots lose the order (§7, §9).
6. The public catalog builds its selectors from variant keys (§9.2).
7. Summaries count inactive variants and load whole aggregates (§5.7).
8. There are no shared typed error codes or limits for the editor (§8).
9. Stale editor forms are not detected (§5.2, §11).
10. Product writes issue one statement per row (§11).
11. Web and mobile lack the editor, the variant detail, the combination label and, on web, the discard confirmation (§10, §16).
12. The schema needs one migration for the new tables, `combinationKey`, the status CHECK and the `json` snapshot column (§7.2).

## 5. Use cases

All new use cases take `(input, access, deps)`, with `access: ProductAccess = Readonly<{ companyId: CompanyId }>` taken from the session. They run inside `deps.transaction(companyId, work)`, which is `withTenantIsolation` plus `withinTransaction` with the editing timeout (§11). Before reading the aggregate they lock the product row with `withLockedForUpdate`. Each returns `Result<Product, E>`; create returns `ProductId`, as today.

```ts
type ProductWriteError =
  | ValidationError                                             // 422, issues by scope
  | Readonly<{ code: "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "IMAGE_NOT_FOUND"; message: string }>
  | Readonly<{ code: "PRODUCT_CHANGED"; message: string }>     // stale structureVersion
  | Readonly<{ code: "DUPLICATE_SKU" | "DUPLICATE_COMBINATION" | "ID_CONFLICT"; message: string }>     // race fallback after domain checks
  | Readonly<{ code: "VARIANT_HAS_ORDERS" | "VARIANT_HAS_STOCK" | "LAST_VARIANT" | "PRODUCT_WITHOUT_OPTIONS"; message: string }>
  | ProductReadError;                                           // PERSISTENCE_UNAVAILABLE | INVALID_STORED_DATA
```

### 5.1 `createProduct` (modified, products)

- **Input:** `{ id: ProductId; name; description?; imageId?; currency; options: readonly OptionInput[]; variants: readonly NewVariantInput[] }`.
  - `OptionInput = { id: OptionId; name: string; values: readonly { id: OptionValueId; name: string }[] }`
  - `NewVariantInput = { values: readonly OptionValueId[]; sku?; salePrice; purchasePrice?; initialStock? }`
- **Deps:** `transaction`, `productExists`, `findImage`, `newId`, `clock`, `publishProductImageChanged`, plus:
  - `findSkuOwners(normalizedSkus): Result<ReadonlyMap<string, VariantId>>`: raw SQL on the expression index, `WHERE "companyId" = $c AND sku IS NOT NULL AND lower(btrim(sku)) = ANY($normalized)`.
  - `findForeignOptionIds(ids): Result<ReadonlySet<string>>`.
  - `insertProduct(product): Result<ProductId>`: the bulk writes of §11.
- **Flow:**
  1. If the id exists: `PRODUCT_ID_CONFLICT`.
  2. `parseProductStructure` (domain) returns every issue together. The structural id rules of §5.2 rule 2 apply. It then drops values that no variant uses, and options left without values (§2 «Values without variants»). The variants list does not need to cover every combination.
  3. SKUs used by another variant become a `DUPLICATE_SKU` issue on that variant.
  4. Option or value ids used outside the product: an `ID_CONFLICT` issue on that option or value (422).
  5. Check the image.
  6. Build the `Product`: variant ids, QR codes, `status: "active"`, `combinationKey`, `structureVersion: 1`.
  7. Write in bulk.
  8. Log `product_created` after the commit and publish the image event, as today.

### 5.2 `saveProduct` (new, products): the editor's **Guardar cambios**

- **Input:**

```ts
export type SaveProductInput = Readonly<{
  productId: ProductId;
  structureVersion: number;                              // version the form was loaded with
  name: string; description: string | null; imageId: ImageId | null;
  options: readonly Readonly<{ id: OptionId; name: string; values: readonly { id: OptionValueId; name: string }[];
    valueForExistingVariants?: OptionValueId }>[];       // complete and ordered
  variants: readonly Readonly<{ id: VariantId; sku: string | null; salePrice: number; purchasePrice: number | null }>[];  // saved variants whose price or SKU the form edits
  newVariants: readonly NewVariantInput[];
  deletedVariantIds: readonly VariantId[];
}>;
```

- **Semantics.** The domain enforces all of these, on the final state:
  1. **Staleness.** If `structureVersion` differs from the stored one, the result is `PRODUCT_CHANGED` and nothing is written. The version therefore guarantees the form knew every saved option, value and variant. Every omission is a deliberate edit, never a missed concurrent addition.
  2. **Options and values.**
     - `options` is the complete ordered list.
     - An option or value id unknown to the product is new.
     - A saved option or value missing from the list is a deletion.
     - Renames and positions come from the list.
     - **Structural id rules.** Each of these is a `VALIDATION_ERROR` issue (422), reported together with the other issues, before any write:
       - an option or value id repeated within the request: `ID_CONFLICT` issue;
       - a saved value id listed under a different option than its stored one: `ID_CONFLICT` issue, because a value never moves between options;
       - `valueForExistingVariants` on a saved option, or pointing to a value outside its own option: `INVALID_COMBINATION` on that option;
       - a new variant that references a value missing from the final options, including a deleted one: `VALUE_NOT_FOUND` on that row.
  3. **Saved variants change combination only in two ways, both derived by the domain for every saved variant, listed or not:**
     - **Option added:** it must carry `valueForExistingVariants` when the product has saved variants. Every saved variant gains that value, including the only variant of a product without options.
     - **Option deleted:** only allowed when it has a single value in the final state, after the request's value deletions and `deletedVariantIds`. The seller can therefore mark «Azul» with its variants and remove «Color» in the same save. Every remaining saved variant loses that value. The rekey stays injective, because deleted variants go first and every remaining key holds the single value. If it was the last option, the product must keep exactly one variant, and that variant must be active (`LAST_OPTION_VARIANT_INACTIVE`).

     Any other combination change goes through `changeVariantCombination` (§5.4). The save request has no field for it.
  4. **Deleted values.** A saved value can only be deleted when every saved variant that has it is listed in `deletedVariantIds`. Otherwise the issue is `VALUE_IN_USE`.
  5. **Deleted variants** must have no orders and stock 0, and must not leave the product without variants.
  6. **Listed saved variants** carry their full price and SKU state. Only fields that differ from the loaded aggregate are written. They cannot change stock.
  7. **New variants** must have exactly one value per final option. Their combinations must be distinct from each other and from the remaining saved variants.
  8. **Limits** apply to the final state: options, values, variants and names.
  9. **Empty values and options.** Every value without a variant in the final state is dropped, and then every option left without values. This covers saved values whose variants were deleted and new values whose generated rows were all removed before saving. It follows the product rule «Valor sin variantes», and create applies it too (§5.1).
- **Deps:**

```ts
export type SaveProductDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, SaveProductError>>) => Promise<Result<T, SaveProductError>>;
  lockProduct: (id: ProductId) => Promise<Result<Product | null, ProductReadError>>;          // FOR UPDATE on Product, then the aggregate (§7.4)
  findOrderedVariantIds: (ids: readonly VariantId[]) => Promise<Result<ReadonlySet<VariantId>, ProductReadError>>;
  findSkuOwners: (normalized: readonly string[]) => Promise<Result<ReadonlyMap<string, VariantId>, ProductReadError>>;
  findForeignOptionIds: (ids: readonly string[]) => Promise<Result<ReadonlySet<string>, ProductReadError>>;
  findImage: (imageId: ImageId) => Promise<Result<boolean, ImageLookupError>>;
  applyStructureChange: (change: ProductStructureChange) => Promise<Result<null, SaveProductError>>;  // bulk, §11
  newId: () => string; clock: () => Date;
  publishProductImageChanged: (productId: ProductId) => Promise<Result<void, EventBusError>>;
}>;
```

- **Flow:**
  1. Lock and load. Missing product: `PRODUCT_NOT_FOUND`. Version mismatch: `PRODUCT_CHANGED`.
  2. `findOrderedVariantIds(deletedVariantIds)`.
  3. `planProductSave(current, input, ordered)` returns `Result<ProductStructureChange, ValidationError>` with every issue together. The plan holds only the diff.
  4. Check SKUs, foreign ids and the image.
  5. An empty plan returns the product without writing.
  6. `applyStructureChange`, with `updatedAt = clock()`, and `structureVersion + 1` when structure changed.
  7. Reload through the editing read and return.
- **Constraint translation.** Each of these rolls back the whole save:
  - the FK from `OrderItem` → `VARIANT_HAS_ORDERS`;
  - the SKU index → `DUPLICATE_SKU`;
  - the `combinationKey` index → `DUPLICATE_COMBINATION`;
  - the option or value primary key → `ID_CONFLICT`.

### 5.3 `updateVariant` (new, products)

- **Input:** `{ productId; variantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null }` (patch).
- **Deps:** `transaction`, `lockProduct`, `findSkuOwners`, `updateVariantFields`.
- **Flow:**
  1. Lock and load. A variant of another product: `VARIANT_NOT_FOUND`.
  2. Validate prices and SKU.
  3. A SKU owned by another variant: `VALIDATION_ERROR` with the `DUPLICATE_SKU` issue on `sku`.
  4. No effective change: return.
  5. Write one `UPDATE`.
- Allowed on inactive variants. It does not bump `structureVersion`.

### 5.4 `changeVariantCombination` (new, products)

- **Input:** `{ productId; variantId; values: readonly ({ optionId; valueId } | { optionId; newValue: { id: OptionValueId; name: string } })[] }`.
- **Flow:**
  1. Lock and load. A product without options: `PRODUCT_WITHOUT_OPTIONS`.
  2. Normalize the input. A `newValue` whose id already exists in that option with the same normalized name counts as `{ valueId }`. A retry after an uncertain success is therefore a no-op, as the product requires. A `newValue` whose id exists under another name, or in another option or product, is a `VALIDATION_ERROR` with an `ID_CONFLICT` issue on that value (422).
  3. `planCombinationChange` (domain, `domain/variant-rules.ts`) checks:
     - exactly one entry per option;
     - a valid new value: name, not repeated in the option, at most 30 values. It is appended at the end of the option.
     - another variant with the target combination: `DUPLICATE_COMBINATION`;
     - values left without variants are removed.
  4. Same combination as today: return without writing.
  5. Write: update the variant's links and key, insert a new value, delete the emptied values. Bump `structureVersion`.
- Allowed with orders and on inactive variants. Only one variant changes key, so no transient collision is possible.

### 5.5 `changeVariantStatus` (new, products)

- **Input:** `{ productId; variantId; status: "active" | "inactive" }`.
- **Flow:**
  1. Lock and load. A product without options: `PRODUCT_WITHOUT_OPTIONS`.
  2. Same status: return without writing.
  3. One `UPDATE`.
- It does not bump `structureVersion`. The last active variant may be deactivated, and stock does not block.

### 5.6 `deleteVariant` (new, products)

- **Input:** `{ productId; variantId }`.
- **Flow:**
  1. Lock and load. A missing variant: `VARIANT_NOT_FOUND`.
  2. Check `VARIANT_HAS_ORDERS`, then `VARIANT_HAS_STOCK`, then `LAST_VARIANT`.
  3. Plan the deletion plus the removal of values and options left empty.
  4. Write: delete the stock and the variant (its links cascade), and delete the emptied values. Bump `structureVersion`. An FK violation becomes `VARIANT_HAS_ORDERS`.

### 5.7 Reads (modified, products)

- **`getProduct`** returns the aggregate with `options`, ordered variants, `hasOrders` per variant and `structureVersion`.
  - It is assembled in `src/composition/product-editing.ts` with `findOrderedVariantIds` over all variants. The loader and `hasOrders` run in one `RepeatableRead` read transaction (§7.4).
  - Every route and web loader that returns a product detail uses it, including after each per-variant action, so `hasOrders` is never stale or defaulted.
- **`listProducts`** computes its summaries in SQL and never loads the aggregate:
  - `variantCount` counts all variants;
  - `activeVariantCount` counts the active ones;
  - `minSalePrice` is `min(salePrice) FILTER (WHERE status = 'active')` and is `null` when there are none;
  - `hasDifferentPrices`, `totalStock` and the single-variant `sku` also cover active variants only;
  - the `in_stock` and `sold_out` predicates add `v.status = 'active'`.

### 5.8 `findOrderedVariantIds` (new, orders)

- **Signature:** `Result<ReadonlySet<VariantId>, { code: "PERSISTENCE_UNAVAILABLE" }>`.
- **Query:** a semi-join that probes the `(companyId, variantId)` index once per id and returns no row per order item:

```sql
SELECT id FROM unnest($ids::uuid[]) AS id
WHERE EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."companyId" = $c AND oi."variantId" = id)
```

- **Location:** `orders/infrastructure/order-repository.ts`, exposed through `orders/composition.ts`, which is the feature's entry point. Feature `index.ts` barrels are debt and are not extended (guide rule 4.5).
- **Owner:** T0, so the two wave-1 tasks never share an orders file.

### 5.9 Removed at the end

`updateProduct`, `PATCH /api/products/:productId` and `updateProductRequestSchema` are removed in T10, once neither client uses them. Until then `PATCH` edits only name, description, photo and the prices and SKUs of variants. It touches no structure, so it cannot bypass the structural rules.

## 6. Domain and typing

```ts
export type OptionId = string & { readonly __brand: "OptionId" };          // option identity survives rename and reorder
export type OptionValueId = string & { readonly __brand: "OptionValueId" };
export type OptionText = string & { readonly __brand: "OptionText" };      // trimmed, 1..30 code points; parseOptionText(raw): Result<OptionText, ValidationIssue>
export type VariantStatus = "active" | "inactive";
export type ProductOptionValue = Readonly<{ id: OptionValueId; name: OptionText }>;
export type ProductOption = Readonly<{ id: OptionId; name: OptionText; values: readonly [ProductOptionValue, ...ProductOptionValue[]] }>;
export type ProductVariant = Readonly<{
  id: VariantId; productId: ProductId;
  combination: Readonly<Record<OptionId, OptionValueId>>;   // replaces attributes; {} without options
  sku?: string; salePrice: Money; purchasePrice?: Money; qrCode: string;
  status: VariantStatus; stock: ProductStock;
}>;
export type Product = Readonly<{ /* unchanged fields */ structureVersion: number; options: readonly ProductOption[];
  variants: readonly [ProductVariant, ...ProductVariant[]] }>;
```

**`options` is an array, not a union.** Every reader of `variants` stays uniform. The invariant is `options.length === 0` ⇔ exactly one variant with `combination = {}`, and that variant is `active`. `parseProductStructure` and the row parser both enforce it.

**`domain/product-structure.ts`** holds:
- created by T0:
  - `combinationKey(combination)`, which follows the sort of §2;
  - `sortVariants(product)`, by option positions and then value positions;
  - `orderedAttributes(product, variant)`, a record with keys in option order;
- added by T1:
  - `parseProductStructure`, with the structural id rules;
  - `emptiedValues(options, remainingVariants)`, which T3 and T5 both use;
- added by T3: `planProductSave`.

**`domain/variant-rules.ts`** (T5) holds `planCombinationChange` and `planVariantDeletion`.

**`ProductStructureChange`** (new) is the bounded diff. Each part is written in bulk:
- `insertOptions` and `insertValues`;
- `renameOrMoveOptions` and `renameOrMoveValues`;
- `insertLinks` and `deleteLinksOfOptions`;
- `deleteValueIds` and `deleteOptionIds`;
- `rekeyVariants` (`id`, `combinationKey`);
- `variantFieldChanges` (`id`, only the changed SKU and prices);
- `insertVariants` (complete, with stock and links);
- `deleteVariantIds`;
- `product` (changed fields, `updatedAt`, `structureVersion`).

It replaces `UpdateChanges` and `UpdatePlan`.

**`errors.ts`.** Issue scopes:
- `option` (`optionIndex`, `optionId`);
- `value` (`optionIndex`, `valueIndex`, `valueId`);
- `variant` (`variantId`);
- `newVariant` (`index`).

Reasons added:
- `TOO_MANY_OPTIONS`, `TOO_MANY_VALUES`, `TOO_MANY_VARIANTS` (these three carry `maximum`);
- `DUPLICATE_OPTION`, `DUPLICATE_VALUE`, `OPTION_WITHOUT_VALUES`;
- `INVALID_COMBINATION`, `DUPLICATE_COMBINATION`;
- `VALUE_NOT_FOUND`, `VALUE_IN_USE`, `MISSING_VALUE_FOR_EXISTING_VARIANTS`;
- `VARIANT_HAS_ORDERS`, `VARIANT_HAS_STOCK`, `LAST_VARIANT`;
- `ID_CONFLICT`;
- `OPTION_HAS_SEVERAL_VALUES`, `LAST_OPTION_VARIANT_INACTIVE`.

`INVALID_ATTRIBUTES` and `DUPLICATE_ATTRIBUTES` are removed. T1 adds every scope, reason and error code of this section and of §5, so that T3 and T5 never edit `errors.ts`.

**Shared helpers.** `normalizeOptionText` (`trim` + lowercase) lives in `shared/contracts/products.ts`. `combinationLabel(options, combination)` lives only in `shared/product-variants.ts`, and core imports it.

| Layer | Types and authority |
| --- | --- |
| `shared/contracts/products.ts` | Wire schemas (strict requests, tolerant responses), `productOptionLimits`, `normalizeOptionText`, error and reason enums |
| `shared/product-variants.ts` | `combinationLabel` and the client editor rules. These are advisory: core re-validates everything |
| core `domain` | `Product`, `ProductOption`, `VariantStatus` and the structure rules. The only authority on limits, uniqueness, deletability and staleness |
| core `infrastructure` | Row parsing (`INVALID_STORED_DATA`), ordering, bulk writes, constraint translation |
| mobile `domain` | Its own `Product` model with core's names, with `status: "active" \| "inactive"` mapped from the tolerant string |

## 7. Persistence

### 7.1 Schema (`apps/core/prisma/schema.prisma`)

```prisma
model ProductOption {
  id        String @id @db.Uuid
  companyId String @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  company   Company @relation(fields: [companyId], references: [id])
  productId String @db.Uuid
  product   Product @relation(fields: [companyId, productId], references: [companyId, id], onDelete: Restrict)
  name      String @db.VarChar(30)
  position  Int
  values    ProductOptionValue[]
  @@unique([companyId, productId, id])          // also serves (companyId, productId) lookups
}

model ProductOptionValue {
  id        String @id @db.Uuid
  companyId String @default(dbgenerated(...)) @db.Uuid
  company   Company @relation(fields: [companyId], references: [id])
  optionId  String @db.Uuid
  productId String @db.Uuid
  option    ProductOption @relation(fields: [companyId, productId, optionId], references: [companyId, productId, id], onDelete: Cascade)
  name      String @db.VarChar(30)
  position  Int
  @@unique([companyId, optionId, id])           // serves loads by optionId IN (…)
}

model ProductVariantOptionValue {
  companyId String @default(dbgenerated(...)) @db.Uuid
  company   Company @relation(fields: [companyId], references: [id])
  productId String @db.Uuid
  variantId String @db.Uuid
  optionId  String @db.Uuid
  valueId   String @db.Uuid
  variant   ProductVariant     @relation(fields: [companyId, productId, variantId], references: [companyId, productId, id], onDelete: Cascade)
  option    ProductOption      @relation(fields: [companyId, productId, optionId], references: [companyId, productId, id], onDelete: Restrict)
  value     ProductOptionValue @relation(fields: [companyId, optionId, valueId], references: [companyId, optionId, id], onDelete: Restrict)
  @@id([companyId, variantId, optionId])
  @@index([companyId, optionId, valueId])     // FK to option (prefix), FK to value (full), deleteMany by optionId
}

// Product: structureVersion Int @default(0)
// ProductVariant: attributes removed; combinationKey String;
//   optionValues ProductVariantOptionValue[];
//   @@unique([companyId, productId, id])              → index "ProductVariant_companyId_productId_id_key"
//   @@unique([companyId, productId, combinationKey])  → index "ProductVariant_companyId_productId_combinationKey_key"
//   the existing @@index([companyId, productId]) is removed (prefix of both uniques)
// OrderItem.variantAttributes: Json @db.Json
```

- **CHECK constraints:**
  - `ProductVariant_status_valid`: `status IN ('active','inactive')`. It replaces `ProductVariant_status_active`.
  - Option and value names: `char_length(btrim(name)) BETWEEN 1 AND 30 AND name = btrim(name)`.
  - `position >= 0`.
  - `Product.structureVersion >= 0`.
- **Domain invariants, enforced under the product row lock:**
  - contiguous positions;
  - case-insensitive name uniqueness;
  - row counts per product (3 options, 30 values, 100 variants).

  The database does not enforce them. A unique expression index cannot be deferred, and a reorder or a name swap inside one save would trip it. No write path bypasses the lock: `PATCH` touches no structure.
- **Ownership.** The composite FKs that include `productId` guarantee that a link's option, value and variant belong to the same product and company.
- **Tenant isolation.** The three tables get the default `companyId`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and the policies `product_option_company_isolation`, `product_option_value_company_isolation` and `product_variant_option_value_company_isolation`. RLS is set up in the transaction that creates them. The isolation module is not touched.

### 7.2 Migration (T0, generated with `prisma migrate dev --create-only`)

There is no production data yet (founder, §17), so this is one plain migration with no data conversion, guard, thresholds or deferred steps.

**`add_product_options`.** Prisma generates the DDL, and T0 adds by hand only what Prisma does not model:
1. The three tables with their FKs and indexes. Each table also gets its default `companyId`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and its policy, in the same migration, as the database-migrations skill requires.
2. `Product`: `ADD COLUMN "structureVersion" integer NOT NULL DEFAULT 0`, with CHECK `>= 0`.
3. `ProductVariant`:
   - `DROP CONSTRAINT "ProductVariant_attributes_object"`, then `DROP COLUMN attributes`;
   - `ADD COLUMN "combinationKey" text NOT NULL DEFAULT ''`, then `DROP DEFAULT`;
   - replace `ProductVariant_status_active` with `ProductVariant_status_valid`;
   - the unique indexes `ProductVariant_companyId_productId_id_key` and `ProductVariant_companyId_productId_combinationKey_key`;
   - drop the redundant `ProductVariant_companyId_productId_idx`.
4. `OrderItem`:
   - `DROP CONSTRAINT "OrderItem_attributes_object"`;
   - `ALTER COLUMN "variantAttributes" TYPE json USING "variantAttributes"::json`;
   - re-add the CHECK as `json_typeof(…) = 'object' AND NOT jsonb_path_exists("variantAttributes"::jsonb, '$.* ? (@.type() != "string")')`.
5. The name and position CHECKs of §7.1.

**Existing rows.**
- Every existing variant becomes the single variant of a product without options, with `combinationKey ''`. Today's forms only create products with one variant and `{}` attributes, so that is all the data there is.
- A development database seeded with several variants per product fails on the `combinationKey` unique index, and the whole migration rolls back. That database is reset (`prisma migrate reset`) and seeded again with T0's seed helper.
- Order snapshots keep their values. The `json` cast keeps the key order `jsonb` gave them.

**One transaction.** Prisma runs a file without function bodies statement by statement. The whole file is therefore wrapped in `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'; … COMMIT;`, as `20260924060712_add_products` and `20261001022053` do. Any failure, including the unique index on a multi-variant development database, rolls back everything: `attributes`, the status CHECK and the new tables. Each new table and its RLS are therefore created in the same transaction, as the database-migrations skill requires.

**Locks.** The file runs inside the deploy, while order and product writes are stopped, as the README already requires for orders. With no production data, the brief `ACCESS EXCLUSIVE` locks of the `ALTER TABLE` statements are bounded by `lock_timeout` and need no `CONCURRENTLY` or split.

**Final state equals the schema.** Index and constraint names are the ones Prisma generates. T0's acceptance includes an empty `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma`.

**Deploy.** `web`, `worker` and `migrate` deploy together, as today. No running instance has to read `attributes` after the migration: all of them stop for the deploy.

### 7.3 Existing data

Nothing is converted. The product definition no longer asks to migrate products whose variants have attributes («Información que se conserva»), because there is no production data.

### 7.4 Rows read

- **One read snapshot per multi-query read.**
  - Each read that issues more than one query runs in one read transaction: `withinTransaction(work, { isolationLevel: "RepeatableRead" })`. That covers the aggregate loader together with `hasOrders`, catalog `find`, and every sellable read with its composition.
  - A save or delete committing between two of those queries therefore cannot surface as `INVALID_STORED_DATA`.
  - It also saves the `BEGIN`/`set_config`/`COMMIT` round-trips that each Prisma operation pays outside a transaction.
  - Inside the write use cases, the product row lock already gives a stable view.
- **Aggregate loader.**
  - Each table is read in one batched query:
    - the product row;
    - its variants with their stock;
    - the links by `variantId IN (…)`;
    - the options by `(companyId, productId)`, through the unique key;
    - the values by `optionId IN (…)`.

    That is at most six queries, depending on how Prisma loads `include`, for any variant count.
  - Rows are parsed with `z.strictObject` schemas.
  - These cases are `INVALID_STORED_DATA`:
    - an unknown status;
    - a link to a missing option or value;
    - a variant missing a value;
    - a product with options and a `{}` variant;
    - a simple product whose variant is inactive.
- **`infrastructure/variant-combinations.ts`.**
  - It receives rows already loaded for all the variants of a read, and loads links, values and options in one batched query ordered by `position`, never per variant.
  - It composes `orderedAttributes`.
  - Used by `order-stock.ts` (every sellable read and `searchSaleCatalog`), `catalog-products-repository.ts` (`find` only) and `mapProduct`.
  - For `searchSaleCatalog` and catalog `find`, it composes by `productId = ANY($productIds)` with a join on `ProductVariant`, passing about 20 parameters instead of up to 2,000 variant ids.
  - `findSellableVariant` composes with a single SQL join.

## 8. Contracts between applications

### 8.1 `shared/contracts/products.ts` (changed in place, T1)

```ts
export const productOptionLimits = { options: 3, valuesPerOption: 30, variants: 100, nameLength: 30 } as const;
export const normalizeOptionText = (value: string) => value.trim().toLowerCase();

// Requests: strict.
const optionRequestSchema = z.strictObject({ id: z.uuid(), name: z.string(),
  values: z.array(z.strictObject({ id: z.uuid(), name: z.string() })), valueForExistingVariants: z.uuid().optional() });
const newVariantSchema = z.strictObject({ values: z.array(z.uuid()), sku: z.string().nullable(), salePrice: z.number(),
  purchasePrice: z.number().nullable(), initialStock: z.number() });
export const createProductRequestSchema = z.strictObject({ id: productIdSchema, name: z.string(), description: z.string().nullable(),
  imageId: z.uuid().nullable(), currency: z.enum(currencies), options: z.array(optionRequestSchema), variants: z.array(newVariantSchema).min(1) });
export const saveProductRequestSchema = z.strictObject({ structureVersion: z.number().int().nonnegative(), name: z.string(),
  description: z.string().nullable(), imageId: z.uuid().nullable(), options: z.array(optionRequestSchema),
  variants: z.array(z.strictObject({ id: z.uuid(), sku: z.string().nullable(), salePrice: z.number(), purchasePrice: z.number().nullable() })),
  newVariants: z.array(newVariantSchema), deletedVariantIds: z.array(z.uuid()) });
export const updateVariantRequestSchema = z.strictObject({ sku: z.string().nullable().optional(), salePrice: z.number().optional(), purchasePrice: z.number().nullable().optional() });
export const changeCombinationRequestSchema = z.strictObject({ values: z.array(z.union([
  z.strictObject({ optionId: z.uuid(), valueId: z.uuid() }),
  z.strictObject({ optionId: z.uuid(), newValue: z.strictObject({ id: z.uuid(), name: z.string() }) })])) });
export const changeVariantStatusRequestSchema = z.strictObject({ status: z.enum(["active", "inactive"]) });

// Responses: tolerant, own objects.
const optionValueResponseSchema = z.object({ id: z.uuid(), name: z.string() });
const optionResponseSchema = z.object({ id: z.uuid(), name: z.string(), values: z.array(optionValueResponseSchema) });
const variantResponseSchema = z.object({ id: z.uuid(), combination: z.array(z.object({ optionId: z.uuid(), valueId: z.uuid() })),  // option order
  sku: z.string().nullable(), salePrice: moneySchema, purchasePrice: moneySchema.nullable(), qrCode: z.uuid(),
  status: z.string(), stock: z.number().int().nonnegative(), hasOrders: z.boolean() });
export const productDetailResponseSchema = z.object({ product: z.object({ id, name, description: z.string().nullable(),
  imageId: z.uuid().nullable(), currency, qrCode, createdAt, updatedAt, structureVersion: z.number().int().nonnegative(),
  options: z.array(optionResponseSchema), variants: z.array(variantResponseSchema).min(1) }),          // saved order
  image: productImageSchema.nullable() }).superRefine(/* ownership, currency, every combination matches options */);
export const productListResponseSchema = /* current item fields + activeVariantCount; minSalePrice nullable */;

export const productApiErrorCodeSchema = z.enum(["INVALID_INPUT", "VALIDATION_ERROR", "PRODUCT_NOT_FOUND", "VARIANT_NOT_FOUND", "IMAGE_NOT_FOUND",
  "PRODUCT_ID_CONFLICT", "PRODUCT_CHANGED", "ID_CONFLICT", "DUPLICATE_SKU", "DUPLICATE_COMBINATION", "VARIANT_HAS_ORDERS", "VARIANT_HAS_STOCK",
  "LAST_VARIANT", "PRODUCT_WITHOUT_OPTIONS", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "UNSUPPORTED_MEDIA_TYPE"]);
export const productIssueReasonSchema = z.enum([/* current reasons minus *_ATTRIBUTES, plus §6 reasons, UNKNOWN_FIELD, INVALID_FORMAT, DUPLICATE_FIELD */]);
export const productApiErrorSchema = z.object({ code: z.string(), error: z.string(), issues: z.array(productApiIssueSchema).optional() });
// clients narrow `code` with productApiErrorCodeSchema.safeParse; an unknown code maps to a generic error
```

`shared/contracts/registration.ts`: `apiErrorCodeSchema` gains `PRODUCT_CHANGED`, `ID_CONFLICT`, `DUPLICATE_COMBINATION`, `VARIANT_HAS_ORDERS`, `VARIANT_HAS_STOCK`, `LAST_VARIANT` and `PRODUCT_WITHOUT_OPTIONS`.

### 8.2 Routes and statuses

| Operation | Route | Success | Errors |
| --- | --- | --- | --- |
| List | `GET /api/products` | `200 productList` | 400 |
| Detail | `GET /api/products/:productId` | `200 productDetail` | 404 `PRODUCT_NOT_FOUND` |
| Create | `POST /api/products` | `201 { id }` | 400, 404 `IMAGE_NOT_FOUND`, 409 `PRODUCT_ID_CONFLICT`/`ID_CONFLICT`/`DUPLICATE_SKU`, 422 |
| Save editor | `PUT /api/products/:productId` | `200 productDetail` | 400, 404, 409 `PRODUCT_CHANGED`/`DUPLICATE_SKU`/`DUPLICATE_COMBINATION`/`VARIANT_HAS_ORDERS`/`ID_CONFLICT`, 422 |
| Edit variant | `PATCH /api/products/:productId/variants/:variantId` | `200 productDetail` | 404 `VARIANT_NOT_FOUND`, 409 `DUPLICATE_SKU`, 422 |
| Change combination | `PUT …/variants/:variantId/combination` | `200 productDetail` | 404, 409 `DUPLICATE_COMBINATION`/`PRODUCT_WITHOUT_OPTIONS`/`ID_CONFLICT`, 422 |
| Set status | `PUT …/variants/:variantId/status` | `200 productDetail` | 404, 409 `PRODUCT_WITHOUT_OPTIONS` |
| Delete variant | `DELETE …/variants/:variantId` | `200 productDetail` | 404, 409 `VARIANT_HAS_ORDERS`/`VARIANT_HAS_STOCK`/`LAST_VARIANT` |

- All routes require the session and an active company, as today, and answer with `Cache-Control: no-store`.
- A product or variant of another company answers 404, the same as a missing one.
- Web loaders and actions call the same use cases through `src/composition/product-editing.ts` and validate the body with the request schemas, which replace `presentation/input.ts`.

### 8.3 Orders, checkout and sale catalog

The shapes do not change:
- `variantAttributes` and `attributes` keep their record shape, with keys in option order at sale time.
- Variants in `orderCatalogSchema` come in saved order.
- Deactivated variants answer `404 VARIANT_NOT_FOUND` with `variantId`.

`searchSaleCatalog` returns up to 20 products, so with 100-variant products a «Nueva venta» search can carry up to 2,000 variants (about 200–300 KB). This is accepted for this version, given current catalog sizes. Capping the variants per product, with details loaded on selection, is listed as an improvement (§15).

### 8.4 Public catalog (web only)

- `CatalogProduct.attributes` is built from the product's options in saved order. Each option lists only values with at least one active variant.
- `CatalogVariant.attributes` is ordered.
- Options are loaded in `find` only.
- The list loads no variant rows. It computes the card's `price` and `soldOut` in SQL, grouped per product: `min(salePrice) FILTER (WHERE status = 'active')` and `bool_or(quantity > 0) FILTER (WHERE status = 'active')`. Its cost therefore does not grow with the variants per product.
- Cart lines in `localStorage` keep the record shape.

## 9. Events and cross-feature integration

### 9.1 Capabilities

| Capability | Owner | Consumer | Wiring |
| --- | --- | --- | --- |
| `findOrderedVariantIds` | orders | products `getProduct`, `saveProduct`, `deleteVariant` | `src/composition/product-editing.ts` (reads, create, save) and `src/composition/product-variant-actions.ts` (per-variant actions). Products never imports orders |
| Sellable lookups (`findSellableVariant*`, `searchSaleCatalog`) | products | orders, catalog, message-to-order | Unchanged signatures. Ordered attributes and `status = 'active'`. `createOrder` switches to the batched `findSellableVariants`: one query set per order, not per item (T2) |
| `deductProductStock`, `restoreProductStock` | products | orders | Unchanged. They do not filter by status, so existing orders with inactive variants are paid and cancelled as before |

No new event is added. `product_image_changed` is still published after commit when a save sets a new photo.

### 9.2 Readers that exclude inactive variants

| Flow | Mechanism | Change |
| --- | --- | --- |
| Web and mobile «Nueva venta», mobile queue, immediate sale | `findSellableVariant(s)`, `searchSaleCatalog` (`status: "active"`) | The UIs mark the item from `issues[].variantId` |
| Catalog cart and **Continuar** | `findSellableVariants` → `unavailable` line | None. **Continuar** on an existing order returns it without rechecking |
| Public catalog | `catalog-products-repository.ts` | Selectors in saved order; values without active variants are hidden |
| QR in a photo | `findSellableVariantsByQrCodes` | None. An inactive or deleted variant gives `unknown_qr_codes` |
| Visual search | `findNearestProductImages`, `findSellableVariantsOfProduct`, `selectVisualVariant` | `hasIndexedProducts` also requires an active variant |
| Payment deduction, cancellation restore | by `variantId`, no status filter | None. Covered by tests |

### 9.3 PR #150 (`resolveVariant`, task `6hq77XxMVfMp7wc3`)

It is not in `main` and nothing here depends on it. When it lands, its pull request connects:
1. `resolveVariant` receives only `findSellableVariantsOfProduct`.
2. The «Falta la variante» notices use `combinationLabel` and the option names from the products read.
3. Text matching uses the ordered combination. Value names are unique per option ignoring case.
4. Its tests include an inactive variant named in the caption.

## 10. Mobile

| Layer | File | Change | Task |
| --- | --- | --- | --- |
| infrastructure | `features/products/infrastructure/product-api.ts` | New detail, list and create shapes. Codes narrowed with `productApiErrorCodeSchema` | T1 |
| infrastructure | same | `PUT` save with `structureVersion` | T7 |
| domain | `features/products/domain/product.ts` | `options`, `combination`, `status` (mapped from the tolerant string), `hasOrders`, `structureVersion` | T1 |
| application | `features/products/application/product-operations.ts` | Create with `options: []` (T1), then with options and `saveProduct` (T7) | T1, T7 |
| application | `features/products/application/variant-operations.ts` (new) | The four per-variant actions | T9 |
| presentation | `product-form.tsx`, `product-management-screen.tsx`, `product-print-sheet.tsx`, `domain/product-label.ts`, `new-order-screen.tsx` | Compile against the new model: read-only variants shown with `combinationLabel` | T1 |
| presentation | `product-form.tsx`, `product-form-state.ts`, `create-product-screen.tsx`, `product-management-screen.tsx`, `catalog-screen.tsx` | Variants card, editor draft through `shared/product-variants.ts`, «Sin variantes activas», `PRODUCT_CHANGED` notice | T7 |
| presentation | `options-screen.tsx`, `variants-screen.tsx`, `draft-variant-screen.tsx` (new) | «Opciones», «Variantes», unsaved variant detail | T7 |
| presentation | `variant-detail-screen.tsx`, `change-combination-sheet.tsx` (new) | Saved variant detail, native alerts | T9 |
| presentation | `product-print-sheet.tsx`, `product-print-work.ts`, `domain/product-label.ts`, `infrastructure/product-label-renderer.ts` | «Desactivada», preselected variant, combination line on the label | T9 |
| routes | `src/app/products/[productId].tsx` → `[productId]/index.tsx`; `new/`, `[productId]/options.tsx`, `variants.tsx`, `draft-variant.tsx`, `products/_layout.tsx` (draft provider) | Full screen without the tab bar | T7 |
| routes | `src/app/products/[productId]/variants/[variantId].tsx` | Saved variant detail | T9 |
| orders | `features/orders/presentation/new-order-screen.tsx`, pending-sale review, `translations.ts` | Item marked «L / Azul ya no está disponible.» | T9 |

| Situation | Decision |
| --- | --- |
| Product writes | Online only, never queued. No automatic retry |
| Create after an uncertain result | Retry with the same product id. `409 PRODUCT_ID_CONFLICT` offers to review the list, as today |
| Save rejected with `PRODUCT_CHANGED` | The form stays intact with «Este producto cambió desde que lo abriste. Recarga el producto para ver los cambios.» and **Recargar producto** (with the discard confirmation). The same applies on web. The text lives in the product definition's «Cuando algo falla» table |
| Save or variant action after an uncertain result | **Recargar producto** / **Recargar variante**. Repeating status, combination (including a `newValue`) or delete has no further effect |
| Requests after a save or action | `PUT` and every variant action return the full detail. The screen replaces its state with that response and issues no follow-up `GET`; today's extra `GET` after saving (`product-management-screen.tsx:181`) is removed. The variant detail and the print sheet opened from the product screen reuse the loaded detail. Only **Recargar producto** and **Recargar variante** issue a `GET` (T7, T9) |
| Pending sale rejected with `VARIANT_NOT_FOUND` | Stays definitive and goes back to review with the item marked |

## 11. Transactions and concurrency

**Transaction:**
1. `withTenantIsolation(companyId)` → `withinTransaction(work, { timeout, maxWait })`.
   - `withinTransaction` gains optional Prisma interactive-transaction options (T0).
   - Product editing passes `PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS`, an environment variable with initial value 10,000, adjustable, and `maxWait` 2,000. T1 owns it: Zod parsing at startup, the default, and the entries in `apps/core/.env.example` and `compose.yaml`.
   - Prisma's timeout is a client-side timer: the statement in flight keeps running on the server. The editing transaction therefore also sets `lock_timeout` 3 s and `statement_timeout` 8 s as transaction-local settings, in the same `set_config` round-trip as `app.company_id` (`set_config('lock_timeout', '3s', true)`). Both stay below the Prisma timeout and cost no extra statement.
2. `withLockedForUpdate` on the `Product` row.
3. Load the aggregate (§7.4, at most six queries).
4. Run the domain plan. On rejection nothing is written.
5. Bulk writes in this fixed order:
   1. **Deletions.** `deleteMany` `ProductStock` of deleted variants, then `deleteMany` `ProductVariant`; their links cascade.
   2. **New options and values.** `createMany` options, then `createMany` values.
   3. **Renames and reorders.** One `UPDATE … FROM (VALUES …)` for options, one for values.
   4. **Links.** For options added to saved variants, `createMany` links (one per saved variant). For deleted options, `deleteMany` links where `optionId IN (…)`.
   5. **Removed values and options.** `deleteMany` values, then `deleteMany` options.
   6. **Saved variants:**
      1. One `UPDATE … FROM (VALUES …)` of `combinationKey`, for every saved variant whose key changed.
      2. One `UPDATE … SET sku = NULL` for variants whose SKU changes.
      3. One `UPDATE … FROM (VALUES …)` of SKU and prices for the changed variants. SKU swaps inside one save therefore never trip the non-deferrable SKU index.
   7. **New variants.** `createMany` variants (with key and QR), then `createMany` stock, then `createMany` links.
   8. **Product.** One `UPDATE` of `Product`: changed fields, `updatedAt`, `structureVersion`.
6. Commit. Logs go through `afterTransactionCommit`.

**Statement budget.**
- **What counts:** SQL statements sent to PostgreSQL inside the use case's transaction. `BEGIN`, `COMMIT` and the `set_config` of tenant isolation are not counted.
- **Ceilings (worst case, independent of the variant count):**

| Phase | Create | Save |
| --- | --- | --- |
| Reads before writing | ≤ 4: `productExists`, `findSkuOwners`, `findForeignOptionIds`, `findImage` | ≤ 11: product lock 1, aggregate loader ≤ 6, `findOrderedVariantIds` 1, `findSkuOwners` 1, `findForeignOptionIds` 1, `findImage` 1 |
| Writes | ≤ 6: product, options, values, variants, stock, links | ≤ 17: the steps of point 5 above |
| Reload for the response | none, it returns the id | ≤ 7: loader ≤ 6 plus `hasOrders` 1 |
| **Total** | **≤ 10** | **≤ 35** |

- **Per-variant actions** (`updateVariant`, `changeVariantCombination`, `changeVariantStatus`, `deleteVariant`) stay at or under **20** statements, including the reload:
  - the lock 1;
  - the loader ≤ 6;
  - `findOrderedVariantIds` 1, for delete only;
  - writes ≤ 5. For example, change combination does: a new value (`createMany`), the variant's links in one `UPDATE … FROM (VALUES …)` on `valueId` (never `deleteMany` plus `createMany`), the variant's key and `structureVersion`, and the emptied values and options in one `deleteMany` each;
  - the reload ≤ 7.

  Emptied values and options are deleted in bulk, never one at a time, and `hasOrders` is one semi-join, never per variant.
- **The guard.** The integration test of §14 runs create and save with 2 variants and with 100 variants under 3 options. It asserts that both counts are equal and under the ceiling, and that the run stays within the timeout.
- **How it counts.** The test wraps `query` on the `pg` pool that the `@prisma/adapter-pg` adapter of the test persistence uses. This wrapper is test-only; production does not count statements.

**No transient collision on `combinationKey`.** The save only rekeys saved variants in two ways:
- adding a value of a new option to every key, which is injective;
- removing the single value of a deleted option from every key, which is injective because every key contains it.

Deleted variants are removed first, and new variants are inserted last, with combinations the domain checked against the final saved keys. Mid-statement duplicates therefore cannot occur, and the index stays non-deferrable.

**Lock footprint.**
- The save holds `Product FOR UPDATE`.
- When keys change, it also holds `FOR UPDATE` on rekeyed variant rows, which conflicts with the `FOR KEY SHARE` of a concurrent `OrderItem` insert on those variants.
- With the budget above, these locks last tens of milliseconds, not seconds.
- **Deadlock prevention.** A rekeying save first locks the variants to rekey with `SELECT id FROM "ProductVariant" WHERE … ORDER BY id FOR UPDATE`, and then writes the `UPDATE … FROM (VALUES …)` sorted by id. `savePendingOrder` inserts `OrderItem` rows sorted by `variantId` (T2), so both sides take variant locks in the same order, as stock deduction already does. If a deadlock (`40P01`) or a lock timeout (`55P03`) still happens, the `transaction` dependency logs `product_save_failed` with `stage: "lock_conflict"`, not `transaction_timeout`, and answers `PERSISTENCE_UNAVAILABLE`. The client's retry is safe.

| Situation | What happens |
| --- | --- |
| Stale editor: another device saved a structural change | `structureVersion` differs → `409 PRODUCT_CHANGED`, nothing written, form intact |
| Stale editor: only prices, SKU or status changed elsewhere | The save proceeds. Changed price and SKU fields of listed variants are last-write-wins, as today. Status is not part of the save |
| Delete while an order is being created with the variant | The `OrderItem` insert holds `FOR KEY SHARE` on the variant row and the delete takes a row lock, so they serialize. If the order wins, the delete fails on the FK and returns `VARIANT_HAS_ORDERS`. If the delete commits before the sellable read, the order gets `VARIANT_NOT_FOUND`. If it commits between the read and the `OrderItem` insert, the insert fails with P2003 on `OrderItem_companyId_variantId_fkey`. `order-repository.ts` maps that violation to `VARIANT_NOT_FOUND` with the `variantId` (T2), for direct sales, immediate sales, catalog orders and message-to-order appends alike |
| Stock of a variant to delete | It only rises through a cancellation restore, which needs an order, and the FK forbids deleting a variant with orders. The stock-0 check under the product lock is enough |
| Deactivate while an order is being created | Not serialized (§2) |
| Same SKU saved at once in two products | The SKU index returns `DUPLICATE_SKU` (409). Within one save, the domain reports both rows |
| Duplicate combination under a race | The `combinationKey` index returns `DUPLICATE_COMBINATION` |
| Repeating create | `PRODUCT_ID_CONFLICT`, as today |
| Repeating status, combination or delete | Same status or same combination: success without writing. A `newValue` that already exists with the same name counts as `valueId`. Delete again: `VARIANT_NOT_FOUND` |
| Transaction timeout | The transaction rolls back (Prisma P2028) at the `withinTransaction` boundary. The `transaction` dependency built in `src/composition/product-editing.ts` (and in `product-variant-actions.ts`) maps it to `PERSISTENCE_UNAVAILABLE` and logs `product_save_failed` with `stage: "transaction_timeout"` once. The repository does not log it again |

## 12. Code organization

| Area | New or modified files |
| --- | --- |
| `shared/` | `contracts/products.ts` and `contracts/products.test.mjs`, `contracts/registration.ts` (T1); `product-variants.ts` and `product-variants.test.mjs` (`combinationLabel` in T1, editor rules in T4). The tests use `.mjs` at those paths because `scripts/ci.sh` only runs `shared/*.test.mjs` and `shared/contracts/*.test.mjs` |
| `shared/infrastructure/persistance.ts` | `withinTransaction` accepts transaction options (T0) |
| `scripts/` | `seed.ts`, seeding through the helper (T0) |
| `prisma/` | `schema.prisma` and the `add_product_options` migration (T0) |
| `products/domain` | `product.ts` (T0: `combination`, `options`, `structureVersion` and `VariantStatus` widened), `errors.ts` and `validation.ts` (T1 only), `rules.ts` (T1), `product-structure.ts` (T0 creates it, T1 and T3 extend it, §6), `variant-rules.ts` (T5), `catalog-product.ts` (T2) |
| `products/application` | `create.ts`, `get.ts`, `list.ts` and `repository.ts` (T1 only). `save-product.ts` (T3) and the variant use cases (T5) declare their dependency types in their own files, as §5.2 shows, so wave 2 never edits `repository.ts`. `update.ts` is removed in T10 |
| `products/infrastructure` | `repository.ts` (loader and readers in T0, create and list in T1, structure writes in T3), `variant-combinations.ts` (T0), `variant-repository.ts` (T5), `order-stock.ts` (T0, single-join `findSellableVariant`), `catalog-products-repository.ts` (T0 reader, T2 options), `image-embeddings.ts` (T2), `product-seed.ts` (T0, test and seed helper) |
| `products/presentation` | `api-routes.ts` (T1, `PUT` in T3), `variant-api-routes.ts` (T5), `product-presenter.ts`, `product-form.tsx`, editor components, `messages.ts`. `input.ts` is removed in T1 |
| `orders` | `infrastructure/order-repository.ts` and `composition.ts`: `findOrderedVariantIds` (T0). `application/create-order.ts` and `composition.ts`: batched sellable lookup (T2, the only wave-1 task that edits orders) |
| `src/composition/` | `product-editing.ts` (T1, extended by T3), `product-variant-actions.ts` (T5). Both build the `transaction` dependency that maps and logs timeouts |
| `src/app.ts` | Mounts `variant-api-routes.ts` (T5) |
| `app/routes` | `product-new.tsx`, `product-detail.tsx`, `product-list.tsx` (T1 adapt, T6 editor), `product-variant.tsx` and `routes.ts` (T8), `catalog-product.tsx` and `order-new.tsx` (T2), `locales.ts` (T2, T6, T8) |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `product_created` | info | `createProduct`, after commit | `["companyId","productId","optionCount","variantCount","durationMs"]` |
| `product_saved` | info | `saveProduct`, after commit | `["companyId","productId","structureVersion","optionCount","variantCount","createdVariants","updatedVariants","deletedVariants","rekeyedVariants","removedValues","durationMs"]` |
| `product_save_rejected` | info | `saveProduct`/`createProduct` on a domain or staleness rejection | `["companyId","productId","errorCode","reasons","issueCount"]` |
| `product_save_failed` | error | the repository adapter on a technical failure; the `transaction` dependency of `src/composition/` on a timeout (§11) | `["companyId","productId","stage","errorCode","durationMs","err"]` |
| `product_variant_updated` | info | after commit | `["companyId","productId","variantId","fields","durationMs"]` |
| `product_variant_combination_changed` | info | after commit | `["companyId","productId","variantId","createdValue","removedValues","durationMs"]` |
| `product_variant_status_changed` | info | after commit | `["companyId","productId","variantId","status","activeVariantCount","durationMs"]` |
| `product_variant_deleted` | info | after commit | `["companyId","productId","variantId","removedValues","removedOptions","durationMs"]` |
| `product_variant_action_rejected` | info | variant use cases on a business rejection | `["companyId","productId","variantId","action","errorCode","durationMs"]` |
| `product_variant_action_failed` | error | the variant repository adapter on a technical failure; the `transaction` dependency of `product-variant-actions.ts` on a timeout or lock conflict | `["companyId","productId","variantId","action","stage","errorCode","durationMs","err"]` |
| `invalid_stored_product_data` | error | aggregate loader (existing event) | `["companyId","productId","stage","reason"]` |

Never logged: product, option or value names, SKUs, prices, stock quantities, descriptions, QR codes, image URLs or request bodies.

## 14. Tests

### Shared (`tsx --test`, `shared/product-variants.test.mjs`; schema titles in `shared/contracts/products.test.mjs`)

Both files match the globs `scripts/ci.sh` runs. A `.test.ts` name would never run in CI.

- `test("combinationLabel joins values in saved option order with ' / '")`
- `test("generates combinations in option and value order")`
- `test("adding a value creates only the combinations that contain it and skips removed ones")`
- `test("adding an option gives its first value to existing combinations and copies prices to the new ones")`
- `test("a new combination of a saved product copies prices from the first variant sharing the other values, preferring an active one")`
- `test("marking a value marks its rows and undoing it restores rows marked by themselves")`
- `test("the counter excludes marked rows and the limit check reports current plus new")`
- `test("with the Azul filter active the L chip selects only L / Azul")`
- `test("lists combinations not created in saved order and adding one respects the limit")`
- `test("with 30 × 30 × 30 values and 100 saved variants the counter and limit check use arithmetic and the uncreated list is paged")`
- `test("marking a value and deleting its option in the same draft builds a valid save body")`
- `test("a new combination copied from an inactive variant is flagged so the table warns it will go on sale")`
- `test("product detail schema accepts unknown fields on options, values and variants")`
- `test("product detail schema rejects a variant whose combination misses an option")`

### Core unit (Vitest)

- `domain/product-structure.test.ts`:
  - `test("rejects four options, thirty-one values and one hundred and one variants with every issue together")`
  - `test("treats 'm' and 'M ' as the same value in an option")`
  - `test("rejects a variant without exactly one value per option")`
  - `test("rejects two variants with the same combination, active or inactive")`
  - `test("rejects deleting a value whose saved variants are not all deleted")`
  - `test("rejects adding an option to a saved product without a value for existing variants")`
  - `test("adding the first option to a simple product keeps its variant and gives it the chosen value")`
  - `test("deleting the last single-valued option turns the product into a simple product")`
  - `test("rejects deleting an option that still has several values in the final state")`
  - `test("deletes an option whose other values are removed with their variants in the same save")`
  - `test("drops a value whose rows were all removed, on create and on save")`
  - `test("rejects a repeated id, a value moved to another option and valueForExistingVariants on a saved option")`
  - `test("rejects deleting the last option when the remaining variant is inactive")`
  - `test("the plan writes only variants whose price, SKU or key changed")`
  - `test("removes values left without variants and options left without values")`
  - `test("combination key sorts lowercase value ids by code unit and is stable across rename and reorder")`
  - `test("orders attributes by saved option position")`
- `application/save-product.test.ts`:
  - `test("rejects a save with a stale structure version and writes nothing")`
  - `test("returns the product unchanged without writing when nothing changed")`
  - `test("reports duplicate SKUs of two new variants on both rows")`
  - `test("reports a SKU used by another product of the company")`
- `application/change-variant-combination.test.ts`:
  - `test("appends a new value at the end of its option")`
  - `test("rejects a combination another variant has")`
  - `test("removes a value left without variants")`
  - `test("repeating a combination with a newValue that already exists succeeds without writing")`
- `application/change-variant-status.test.ts`:
  - `test("rejects changing the status of a product without options")`
  - `test("deactivating an inactive variant succeeds without writing")`
- `application/delete-variant.test.ts`:
  - `test("reports orders before stock before last variant")`
- `domain/catalog-product.test.ts`:
  - `test("catalog selectors follow saved order and hide values without active variants")`

### Core integration (Vitest + PostgreSQL)

- `infrastructure/repository.integration.test.ts`:
  - `test("create and save issue the same statement count for two and for one hundred variants, under the ceilings and the timeout")`
  - `test("creates a product with options, values, links and stock in one transaction")`
  - `test("swapping SKUs between two variants in one save succeeds")`
  - `test("adding an option rekeys every saved variant without a duplicate-key error")`
  - `test("a rekeying save and a two-item order on the same product both finish without deadlock")`
  - `test("rolls back a save when a deleted variant gained an order")`
  - `test("another company cannot read or link options of a product")`
  - `test("rejects a link whose value belongs to another option of the product")`
  - `test("the combination unique index rejects a duplicate combination")`
  - `test("an option id used by another product is a 422 ID_CONFLICT issue and a primary-key race answers 409 ID_CONFLICT")`
  - `test("list summaries cover only active variants without loading options")`
  - `test("the detail read sees one snapshot while a save commits between its queries")`
  - `test("findSkuOwners matches SKUs ignoring case and surrounding spaces")`
- `presentation/api-routes.integration.test.ts`:
  - `test("POST /api/products creates a product without options with one variant")`
  - `test("POST /api/products creates the six combinations in saved order")`
  - `test("PUT /api/products saves a renamed value, a reorder and a new option atomically")`
  - `test("PUT with a stale structureVersion answers 409 PRODUCT_CHANGED and keeps the values another device added")`
  - `test("PUT returns 422 with option, value and variant issues together")`
  - `test("PUT on a product of another company answers 404")`
  - `test("detail reports hasOrders, status and structureVersion")`
- `presentation/variant-api-routes.integration.test.ts`:
  - `test("PATCH variant edits price and SKU of an inactive variant")`
  - `test("PUT combination moves a variant with orders to a new value XL and keeps the order snapshot")`
  - `test("PUT status deactivates the last active variant and the list shows no minimum price")`
  - `test("DELETE variant removes it with its QR and drops a value left without variants")`
  - `test("DELETE variant with an unconfirmed catalog order answers VARIANT_HAS_ORDERS")`
  - `test("every variant action answers a detail with current hasOrders")`
  - `test("PATCH variant with a SKU used by another variant answers 422 with a DUPLICATE_SKU issue on sku")`
  - `test("every variant action on another company's product answers 404 like a missing one")`
  - `test("deleteVariant and changeVariantCombination issue the same statement count on two and on one hundred variants, under twenty")`
- `orders` integration:
  - `test("creating an order with an inactive variant answers VARIANT_NOT_FOUND with its variantId")`
  - `test("an existing order with an inactive variant is paid with stock deduction and cancelled with stock restore")`
  - `test("an unconfirmed catalog order with a variant deactivated later can be confirmed and paid")`
  - `test("order items from create-order, catalog order and message-to-order keep option order in variantAttributes after reading them back")`
  - `test("renaming Negro keeps it in the existing order and checkout and a new order shows Negro carbón")`
  - `test("a twenty-item order and an immediate sale resolve their variants with one batched lookup")`
  - `test("a variant deleted between the sellable read and the item insert answers VARIANT_NOT_FOUND with its variantId")`
  - `test("findOrderedVariantIds counts unconfirmed catalog orders")`
- Catalog and message-to-order integration:
  - `test("public catalog product hides inactive variants and orders selectors by saved order")`
  - `test("public catalog list computes price and sold out from active variants without loading variant rows")`
  - `test("a catalog purchase of M / Negro reaches checkout, deducts stock when paid and restores it when cancelled")`
  - `test("Continuar with a deactivated variant marks the line unavailable and creates no order")`
  - `test("a photo of the QR of an inactive variant adds no item")`
  - `test("visual search adds a product that has exactly one active variant left")`
  - `test("searchSaleCatalog omits products without active variants")`

### Mobile (Jest + RNTL)

- `product-api.test.ts`:
  - `test("maps issues by option, value and variant")`
  - `test("maps every productApiErrorCode to its status and an unknown code to a generic error")`
  - `test("an unknown variant status is shown as Desactivada")`
- `orders/order-api.test.ts`:
  - `test("an order response keeps variantAttributes in option order after parsing")`
- `create-product-screen.test.tsx`:
  - `test("adding Talla and Color shows six combinations with copied price and stock notice")`
  - `test("chip L selects both L variants and tapping it again deselects them")`
- `options-screen.test.tsx`:
  - `test("header Listo is disabled while an option has errors or the limit is exceeded")`
  - `test("X after a change asks to discard")`
- `variants-screen.test.tsx`:
  - `test("a rejected save marks rows and the product shows '2 con errores'")`
  - `test("a successful save shows the returned detail without another request")`
- `product-management-screen.test.tsx`:
  - `test("a PRODUCT_CHANGED rejection keeps the form and offers to reload")`
- `variant-detail-screen.test.tsx`:
  - `test("Desactivar confirms with a native alert and shows the deactivated notice")`
  - `test("delete reasons follow orders, stock, only variant")`
  - `test("offline deactivation keeps the variant and shows the retry text")`
  - `test("a deleted variant shows 'Esta variante ya no existe.' with Volver al producto")`
- `product-print-sheet.test.tsx`:
  - `test("opened from a variant preselects it and lists inactive ones marked")`
- `product-label.test.ts`:
  - `test("label carries the combination below the name and omits it for a simple product")`
- `pending-sale-review.test.tsx`:
  - `test("a sale rejected with VARIANT_NOT_FOUND marks 'L / Azul ya no está disponible.'")`

### Web route (Vitest)

- `app/routes/product-variant.test.ts` (T8):
  - `test("variant detail loader answers not-found with the product link for a deleted variant and without it for another company's product")`
  - `test("variant detail of a simple product redirects to the product page")`

### Web E2E (happy path only)

- `tests/e2e/product-variants.spec.ts`:
  - `test("creates Polo básico with Talla and Color, removes S / Azul and saves five variants")`
  - `test("adds XL to a saved product and shows the two new variants in the saved table")` (T6)
  - `test("renames Negro in the editor and a new order shows Negro carbón while the old one keeps Negro")` (T6)
  - `test("opens the detail of a new variant from the saved table")` (T8)
  - `test("deactivates a variant and the public catalog no longer offers it")`
  - `test("prints a variant label from its detail")`

### Pending manual checks

- **Printing:** Android with a Brother printer, printing from the variant detail. The label shows «XL / Negro», and a photo of it sent by WhatsApp adds the variant.
- **Mobile accessibility:** TalkBack and VoiceOver offer **Subir** and **Bajar** on the handles, and dragging only starts from the handle.
- **Web keyboard:** reorder with the arrows on a focused handle and the new position is announced.
- **Migration:** apply the migration to a development database created by today's forms, and to one seeded with several variants per product. The first applies cleanly. The second rolls back completely. In both, check that `prisma migrate diff` from the migrations to the schema is empty after a clean apply.

## 15. Limits and checks during implementation

- **Key order.** Verify that Prisma with `@prisma/adapter-pg` returns `json` with its stored key order, and that Zod 4 `z.record` and Hermes keep insertion order (the mobile `order-api` test above). Verify that no query compares `variantAttributes`.
- **Statement counting.** Verify that wrapping `query` on the adapter's `pg` pool sees every statement of an interactive transaction. If it does not, count through Prisma's query event with `log: [{ emit: "event", level: "query" }]` in the test client.
- **Transaction options.** Verify that `withinTransaction` passes `timeout`, `maxWait` and `isolationLevel` to `$transaction` when it opens the outermost transaction, and ignores them when nested.
- **`createMany` and RLS.** Confirm that `createMany` with the default `companyId` passes RLS `WITH CHECK`, as the single-row creates do today.
- **Variant order.** It is `sortVariants`. No variant position column is stored.
- **Sale catalog payload.** Capping the variants per product in «Nueva venta» search is an improvement, not part of this task.
- **Combination arithmetic.** The shared rules never enumerate the cartesian product just to count. The limit check and the «sin crear» count use the product of the value counts minus the existing combinations. Generation enumerates only when that product is within the variant limit. **Ver** lists the uncreated combinations lazily, 50 at a time with «Ver más», and mobile renders them in a virtualized `FlatList`.
- **Left out on purpose:** editing the stock of saved variants, photo per value, archiving products, bulk deactivation, CSV import, SKU generation.
- **Accessibility libraries.** Web reorder uses existing primitives; check the design system before adding a dependency. Mobile drag uses `react-native-gesture-handler` and `reanimated`; check that they are installed and that their versions match Expo.

## 16. Implementation plan

### Order and parallelism

```text
Wave 0:  T0 Options storage, migrations and ordered reads
            │
Wave 1:  ├─ T1 Contracts, create with options and product reads
         └─ T2 Sales, public catalog and message-to-order
            │
Wave 2:  ├─ T3 Core: editor save                      (needs T1)
         ├─ T4 Shared editor rules                    (needs T1)
         └─ T5 Core: per-variant actions              (needs T1)
            │
Wave 3:  ├─ T6 Web: product editor                    (needs T3, T4)
         └─ T7 Mobile: product editor                 (needs T3, T4)
            │
Wave 4:  ├─ T8 Web: variant detail and label          (needs T5, T6)
         └─ T9 Mobile: variant detail, printing, sales marking (needs T5, T7)
            │
Wave 5:  T10 Remove PATCH, documentation, final verification (needs all)
```

**File ownership (no two tasks of one wave edit the same file):**
- **T0 only:** `prisma/schema.prisma`, the migration, `persistance.ts`, `seed.ts` and the fixtures.
- **Products domain and ports:** `domain/errors.ts`, `domain/validation.ts` and `application/repository.ts` belong to T1 only. `domain/product-structure.ts` is created by T0, extended by T1, and in wave 2 edited only by T3. T5 imports `emptiedValues` from it.
- **T1:** `shared/contracts/products.ts` and `registration.ts`. Only T10 touches `products.ts` again, to remove `updateProductRequestSchema`.
- **`shared/product-variants.ts`:** created by T1 (`combinationLabel`) and extended by T4. If T6 or T7 find a defect in it, they report it to the coordinator, who assigns the fix to one task. Neither edits it directly.
- **`products/presentation/api-routes.ts`:** T1, then T3. `variant-api-routes.ts` and `src/app.ts` belong to T5. In wave 2, T3 and T5 use different files: T3 has `save-product.ts`, `product-structure.ts`, `repository.ts` and `product-editing.ts`; T5 has `variant-rules.ts`, `variant-repository.ts` and `product-variant-actions.ts`.
- **`orders/`:** T0 adds `findOrderedVariantIds` to `order-repository.ts` and `composition.ts`. In wave 1 only T2 edits orders files (`create-order.ts` and `composition.ts`); T1 edits none.
- **`apps/core/app/locales.ts`:** T2 (wave 1), T6 (wave 3), T8 (wave 4). T1 adds no texts.
- **`products/presentation/messages.ts`:** T1 owns it in wave 1. It maps every new reason and code to an existing generic text, with no new keys in `locales.ts`, so that it still compiles once `input.ts` and `*_ATTRIBUTES` are removed. T6 adds the final texts. On mobile, T1 does the same in the products error mapping without new keys in `translations.ts`, and T7 and T9 add the final texts.
- **`products/presentation/api-errors.ts` (new):** T1 moves the private helpers of `api-routes.ts` there: `sendOperationError` with every §8.2 code→status, `domainIssues`, `zodIssues` and `productIdFrom`. In wave 2, T3 (`api-routes.ts`) and T5 (`variant-api-routes.ts`) import it and neither edits it.
- **`products/composition.ts`:** T1 only, in wave 1. Create, get and list move to `src/composition/product-editing.ts`. T2 does not edit it; the sellable reads keep their signatures and wiring.
- **Mobile `translations.ts`:** T7 (wave 3) and T9 (wave 4).

There are 11 tasks. The extra wave keeps T0 reviewable: storage and migrations land without changing any contract. T0 is large but mostly mechanical, so its pull request separates the commits for «schema, migration and readers» from the commit for «fixture rewrite», and its reviewer reviews them separately.

### T0. Options storage, migrations and ordered reads

**Scope:**
- Prisma schema and the single migration of §7.2, with RLS and the CHECKs Prisma does not model.
- `withinTransaction` transaction options (`timeout`, `maxWait`, `isolationLevel`, and transaction-local `lockTimeout` and `statementTimeout` sent in the `set_config` round-trip), and `RepeatableRead` read transactions for the multi-query reads (§7.4).
- Domain: `ProductVariant.combination` replaces `attributes`. `Product.options` and `structureVersion` are added. `VariantStatus` widens to `"active" | "inactive"` and the row parser accepts both, so T2 can seed inactive variants while T1 runs in parallel. Until T1, the presenter emits the stored status under today's contract.
- `domain/product-structure.ts` with `combinationKey`, `sortVariants` and `orderedAttributes`.
- `findOrderedVariantIds` (§5.8) in `orders/infrastructure/order-repository.ts`, exposed through `orders/composition.ts`.
- The aggregate loader (§7.4) and `variant-combinations.ts`. Every products reader (`repository.ts`, `order-stock.ts` with a single-join `findSellableVariant`, `catalog-products-repository.ts`) composes ordered attributes.
- The presenter keeps today's contract: it builds `attributes` with `orderedAttributes`.
- Create keeps today's contract. It accepts only empty attributes and writes `combinationKey ''` and `structureVersion 1`. Non-empty attributes return `INVALID_ATTRIBUTES` until T1 replaces the contract.
- `products/infrastructure/product-seed.ts`: one helper that seeds a product with options, values, links, stock, status and orderable variants inside a tenant. It is used by integration tests, `tests/e2e/fixtures.ts` and `scripts/seed.ts`.
- Rewrite every existing seed and fixture that writes `ProductVariant.attributes` to use the helper. That covers the 23 core test files, the e2e specs and fixtures, `scripts/seed.ts` and `store-appearance/presentation/preview-fixtures.ts`.

**Out of scope:** contract changes, option writes through the API, UI.

**Acceptance criteria:**
1. A database with products created by today's forms migrates cleanly. Each product keeps its variant, QR and stock as a product without options (`combinationKey ''`).
2. A product seeded through the helper with Color before Talla returns its detail `attributes` with `Color` first.
3. A variant seeded as `inactive`: `POST /api/orders` answers `404 VARIANT_NOT_FOUND`, and the public catalog does not offer it.
4. An order item created through each of create-order, catalog order and message-to-order keeps its `variantAttributes` keys in option order when read back.
5. `scripts/ci.sh` is green. Existing product, order, catalog, dispatch-label and message-to-order suites pass, seeded through the helper.
6. `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` (with a shadow database) is empty. `combinationKey` is `NOT NULL`, and the index names match Prisma's.

**Tests:**
- unit: `orders attributes by saved option position`, `combination key sorts lowercase value ids by code unit…`;
- integration: `another company cannot read or link options of a product`, `rejects a link whose value belongs to another option of the product`, `the combination unique index rejects a duplicate combination`, `order items from create-order, catalog order and message-to-order keep option order…`, `creating an order with an inactive variant…`, `findOrderedVariantIds counts unconfirmed catalog orders`.

**Depends on:** nothing.

### T1. Contracts, create with options and product reads

**Scope:**
- `shared/contracts/products.ts` (§8.1) and the `registration.ts` codes. `combinationLabel` in `shared/product-variants.ts`.
- `parseProductStructure`, with the structural id rules and the dropping of values without variants, plus `emptiedValues`, both in `domain/product-structure.ts`.
- Every scope, reason and error code of §5 and §6 in `errors.ts`, and the ports of `application/repository.ts` it needs. T3 and T5 do not edit either file.
- `createProduct` with options and bulk insert (§11). `findSkuOwners` and `findForeignOptionIds`.
- `getProduct` with `hasOrders`, using T0's `findOrderedVariantIds`; `src/composition/product-editing.ts`.
- `listProducts` with SQL summaries over active variants.
- `PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS`: Zod parsing at startup, the default, and `apps/core/.env.example` and `compose.yaml` (§11).
- `POST` and `GET` routes in the new shapes.
- Adapt the current web screens (`product-new.tsx`, `product-detail.tsx`, `product-list.tsx`, `product-form.tsx`, remove `input.ts`) and mobile screens (§10, T1 rows) to the new shapes with today's behaviour: create sends `options: []`, several variants are read-only with `combinationLabel`, edits go through `PATCH`.

**Out of scope:** `PUT` save, variant actions, editor UI, new texts.

**Acceptance criteria:**
1. `POST /api/products` with Talla S/M/L, Color Negro/Azul and 5 variants (no S / Azul) creates 5 variants in saved order, with QR, stock and `structureVersion 1`.
2. `POST` with 4 options, 31 values or 101 variants answers 422 with every issue together, typed by `productIssueReasonSchema`.
3. Two new variants with SKU «POLO-01» get two `DUPLICATE_SKU` issues. The same SKU in another company is accepted.
4. The detail reports `hasOrders: true` for a variant whose only order is an unconfirmed catalog order.
5. A product whose variants are all inactive (seeded) is listed with `minSalePrice: null` and `activeVariantCount: 0`.
6. Web and mobile still create and edit simple products and open products with several variants read-only.
7. A create whose variants never use «Azul» stores Color without Azul.

**Tests:** shared `combinationLabel…` and both schema titles; the `parseProductStructure` limit and duplicate titles; integration `creates a product with options…`, `an option id used by another product…`, `list summaries cover only active variants…`, `findSkuOwners…`, both `POST` titles, `detail reports hasOrders…`; mobile `product-api` titles.

**Depends on:** T0.

### T2. Sales, public catalog and message-to-order

**Scope:**
- Catalog selectors from the options in saved order, hiding values without active variants. Options load in `find` only. Files: `catalog-product.ts`, `catalog-products-repository.ts`, `catalog/presentation/variant-selection.ts`, `catalog/cart-composition.ts`, `app/routes/catalog-product.tsx`, `app/components/catalog-cart.tsx`, `app/lib/catalog-cart-storage.ts`.
- `hasIndexedProducts` requires an active variant.
- The public catalog list computes card price and `soldOut` with SQL aggregates (§8.4).
- Both wirings of `findVariant: findSellableVariant` in `orders/composition.ts` switch to the batched `findSellableVariants`: `createOrder` and `registerImmediateSale`, which mobile «Nueva venta» uses through `createOrderInTransaction`.
- `savePendingOrder` inserts `OrderItem` rows sorted by `variantId`, the same lock order as a rekeying save (§11).
- `order-repository.ts` maps the P2003 violation of `OrderItem_companyId_variantId_fkey` to `VARIANT_NOT_FOUND` with the `variantId` (§11).
- Web «Nueva venta» marks the unavailable item (`order-new.tsx`, `locales.ts`).
- Integration coverage of sale, catalog, QR, photo, payment, cancellation and rename snapshots with inactive variants, seeded through the T0 helper.

**Out of scope:** mobile sales (T9), product editor.

**Acceptance criteria:**
1. With L / Azul inactive, the catalog cannot select it, and a value whose variants are all inactive is not shown.
2. With Color before Talla (seeded positions), the catalog shows Color first.
3. A photo of the L / Azul label adds no item.
4. An existing order with L / Azul is paid (stock −n) and cancelled (stock +n).
5. In web «Nueva venta», a variant deactivated after it was added sends the sale back with the item marked.
6. A catalog purchase of M / Negro reaches checkout, deducts stock when paid and restores it when cancelled (product AC 24).
7. Renaming a seeded value keeps old order and checkout snapshots, and a new order uses the new name (product AC 12, through a direct rename in the seed).

**Tests:** the catalog and message-to-order integration titles; the order titles about inactive variants, renames and the batched lookup; the `catalog-product` unit title.

**Depends on:** T0.

### T3. Core: editor save

**Scope:**
- `planProductSave` with the semantics of §5.2. `saveProduct` with `structureVersion`. Bulk `applyStructureChange` and the statement budget (§11).
- `PUT /api/products/:productId`.
- Save observability.

**Out of scope:** variant endpoints, UI.

**Acceptance criteria:**
1. `PUT` adding XL creates XL / Negro and XL / Azul with stock 0. M / Negro keeps its id, QR, stock and order.
2. `PUT` adding Manga with `valueForExistingVariants` Corta keeps the 8 ids and creates 8 «Larga».
3. A simple product with stock 5 and an order receives Talla S/M with S for the existing variant. S keeps its QR, stock 5 and order, and M is created with stock 0 (product AC 11).
4. Deleting the single-valued last option of a one-variant product makes it simple (product AC 19).
5. A save with an old `structureVersion` after another device added XL answers `409 PRODUCT_CHANGED`, and XL and its variants remain.
6. Deleting value «Azul» whose M / Azul has an order answers 422 `VARIANT_HAS_ORDERS` and writes nothing.
7. Create and save issue the same statement count with 2 and with 100 variants under 3 options, under the ceilings of §11, and within the timeout.
8. Marking «Azul» with its variants and deleting «Color» in the same save turns the remaining variants into Talla-only variants.
9. A save that adds «XL» and then removes both XL rows stores no XL.

**Tests:** the `product-structure` save titles, `save-product`, the repository titles on budget, SKU swap, rekeying and rollback, and the `PUT` route titles.

**Depends on:** T1.

### T4. Shared editor rules

**Scope:** `shared/product-variants.ts`, the pure functions behind the client rules of the product definition:
- generating combinations;
- changes before saving (rename, reorder, add value or option with `valueForExistingVariants`, remove with marks and undo);
- «Precios de combinaciones nuevas»;
- the copied-stock notice, and the flag on new combinations copied from an inactive variant (the notice that they will go on sale);
- the counter and limit messages;
- combinations not created;
- bulk selection by chips and filter;
- building the `saveProductRequestSchema` body from the draft, including `deletedVariantIds` for removed values.

**Out of scope:** UI, network.

**Acceptance criteria:**
1. Base price 39.90 and stock 4 with Talla S/M/L × Color Negro/Azul gives 6 rows, from S / Negro to L / Azul, each with 39.90 and 4.
2. Renaming Negro to «Negro carbón» and moving Color first keeps the edited price and SKU of L / Negro.
3. Adding Manga and then deleting it leaves the «Corta» combinations with their edits.
4. 5 × 6 × 4 reports the limit with 120. 98 saved plus 6 new reports 104.
5. The «L» chip with the «Azul» filter selects only L / Azul.
6. The body built for a saved product that adds Manga carries `valueForExistingVariants`.
7. With 30 × 30 × 30 values and 100 saved variants, the counter, the limit check and the «sin crear» count answer without enumerating, and the uncreated list comes in pages of 50.
8. A draft that marks «Azul» and then deletes «Color» is allowed and builds a valid body (single value in the final state).
9. Adding Manga when L / Azul is inactive flags L / Azul / Larga as copied from an inactive variant, so web and mobile show the same notice (product AC 10, second part).

**Tests:** the shared editor titles of §14.

**Depends on:** T1.

### T5. Core: per-variant actions

**Scope:**
- `updateVariant`, `changeVariantCombination` (with `newValue` normalization), `changeVariantStatus` and `deleteVariant`.
- `variant-rules.ts` and `variant-repository.ts`.
- `variant-api-routes.ts`, mounted in `src/app.ts`.
- `src/composition/product-variant-actions.ts`, with responses built through `getProduct`.
- Observability.

**Out of scope:** UI.

**Acceptance criteria:**
1. Changing M / Negro (with orders) to the existing M / Azul answers 409 `DUPLICATE_COMBINATION`.
2. Changing it to the new value XL saves XL / Negro and appends XL to Talla, and the order still shows «M / Negro». Repeating the same request succeeds without writing.
3. Deactivating L / Azul with stock 6 succeeds. Repeating it succeeds without writing.
4. Delete answers:
   - `VARIANT_HAS_ORDERS` with an unconfirmed catalog order;
   - `VARIANT_HAS_STOCK` with stock 3;
   - `LAST_VARIANT` when the variant is the only one.
5. Deleting the only XL variant removes XL from Talla.
6. A status change on a product without options answers `PRODUCT_WITHOUT_OPTIONS`.
7. `deleteVariant` and `changeVariantCombination` on a 100-variant product stay at or under 20 statements, the same count as on 2 variants (§11).

**Tests:** the `change-variant-*` and `delete-variant` unit titles; the variant route integration titles.

**Depends on:** T1.

### T6. Web: product editor

**Scope:**
- `/products/new` and `/products/:productId` with the «Variantes» card:
  - option editor;
  - reorder by handle, keyboard and drag;
  - table with chips, filter and bulk edits;
  - marks and **Deshacer**;
  - combinations not created;
  - unsaved variant dialog;
  - totals.
- Discard confirmation, including `beforeunload`.
- Rejection mapping by option, value and row, plus the `PRODUCT_CHANGED` notice.
- List with «Sin variantes activas» and active totals.
- Links to `/products/:productId/variants/:variantId`.

**Out of scope:** the saved variant detail (T8) and printing.

**Acceptance criteria:** product criteria 1–4, 6 (web), 7 (web), 8, 9, 10, 11, 12 (web: rename in the editor, then the old order keeps «Negro» and a new order shows «Negro carbón»), 13 (web), 17, 18, 19, 20 (web list and form), 28 (web), 29 (web) and 30, with the texts of the product definition.

**Links to the variant detail.** The table rows and the «Variantes» card do not link to the saved variant detail until T8 (web) and T9 (mobile) add the route and the link. No dead link ships in any wave.

**Tests:** E2E `creates Polo básico…` and `adds XL to a saved product and shows the two new variants in the saved table`. T8 adds `opens the detail of a new variant from the saved table`.

**Depends on:** T3, T4.

### T7. Mobile: product editor

**Scope:**
- «Nuevo producto» and the product screen with the «Variantes» card.
- «Opciones»: both **Listo**, **X**, the footer counter, the handle with **Subir**/**Bajar** and accessibility actions.
- «Variantes»: notices, chips, bulk sheets, marks, combinations not created, row errors.
- The unsaved variant detail.
- List with «Sin variantes activas».
- `PUT` save with the `PRODUCT_CHANGED` notice.
- Route restructure. Error mapping by code.

**Out of scope:** the saved variant detail, printing changes, sales marking (T9).

**Acceptance criteria:** product criteria 1–4, 5 (mobile ↔ web), 6 (mobile), 7 (mobile), 8, 9, 10, 11, 12 (mobile: the saved rename reaches a new sale), 13 (mobile), 17, 18, 19, 20 (mobile), 27 (except the variant detail), 28 (mobile), 29 (mobile) and 30 (mobile).

**Tests:** the mobile titles for `create-product-screen`, `options-screen`, `variants-screen` and `product-management-screen`.

**Depends on:** T3, T4.

### T8. Web: variant detail and label

**Scope:**
- Route `/products/:productId/variants/:variantId`:
  - loading, error and not-found states;
  - prices and SKU form;
  - **Cambiar combinación** with **Otro valor…**;
  - deactivate and activate;
  - delete with reasons;
  - in-progress states;
  - sibling list.
- Label and browser print with QR (`qrcode` in `apps/core/package.json`).
- The variant detail of a simple product redirects to the product page. A deleted variant shows not-found with «Volver al producto»; another company's product shows not-found with only «Volver a productos».

**Out of scope:** printing simple products on web.

**Acceptance criteria:** product criteria 14, 15, 16, 21, 22 and 26, plus 28 when opening a saved variant from a product with changes.

**Tests:** E2E `opens the detail of a new variant…`, `deactivates a variant…` and `prints a variant label from its detail`; the two `product-variant` route titles.

**Depends on:** T5, T6.

### T9. Mobile: variant detail, printing and sales marking

**Scope:**
- `variant-operations.ts`.
- Saved variant detail: native alerts, in-progress texts, uncertain results, **Recargar variante**, not-found states.
- Change combination sheet.
- Print sheet with «Desactivada» and preselection.
- Label with the combination.
- «Nueva venta» and pending-sale review marking the unavailable item.

**Out of scope:** web.

**Acceptance criteria:** product criteria 14, 15, 16, 21, 22 (mobile), 23 (mobile queue), 25 and 27 (variant detail).

**Tests:** the mobile titles for `variant-detail-screen`, `product-print-sheet`, `product-label`, `pending-sale-review` and `order-api`.

**Depends on:** T5, T7.

### T10. Remove PATCH, documentation and final verification

**Scope:**
- Remove `PATCH /api/products/:productId`, `updateProduct` and `updateProductRequestSchema`.
- Rewrite `docs/products.md`, plus the variant mentions in `docs/orders.md`, `docs/public-catalog.md` and `docs/image-product-search.md`.
- Align `docs/architecture.md` (line 146) with guide rule 4.5: cross-feature access goes through `composition.ts`, and `index.ts` barrels are debt.
- Add the deploy note (stop order and product writes during the deploy) and the PR #150 notes of §9.3 to the pull request.

**Out of scope:** behaviour changes.

**Acceptance criteria:**
1. Product criterion 31.
2. Nothing in `docs/` outside `drafts/` describes `attributes` as free or `status` as always active.
3. No code references `PATCH /api/products/:productId`.

**Depends on:** T0–T9.

### Final verification

- `scripts/ci.sh` on the integration branch.
- The pending manual checks of §14.

## 17. Open items and questions

### Questions decided by the review gate

1. **How does the products API evolve?**
   - **Answer:** `/api/products` and `shared/contracts` change in place, with no versioned API and no compatibility with installed builds.
   - **Who decided:** the founder, directly, on 2026-10-26: «aún no hay clientes, así que no tengamos un contrato v2». Both gate reviewers confirmed it.
   - **Reason:** there are no customers, so guide rule 6.9 applies.
   - **Discarded alternatives:**
     - a new `/api/v2/products` with `/api/products` frozen, which means two route sets and two presenters with no installed base to protect;
     - the same routes with a duplicate status field, which means one concept with two fields.
2. **How do order snapshots keep the option order of the moment of sale?**
   - **Answer:** (1) `OrderItem.variantAttributes` changes from `jsonb` to `json`, and every record carries its keys in option order.
   - **Who decided:** both gate reviewers (design and performance).
   - **Condition (performance reviewer):** the migration must be safe. It is satisfied by the founder's migration decision (question 4): with no production data, the type change runs on a near-empty table during a deploy with writes stopped.
   - **Reason:** the order, checkout, sale-catalog and catalog-cart shapes and screens do not change. `json` returns keys in insertion order through `@prisma/adapter-pg`, and is cheaper to output than `jsonb`.
   - **Accepted cost:** an option name made only of digits would move first.
   - **Discarded alternative:** an explicit `[{ name, value }]` array, which touches about 35 files inside the first wave.
3. **What does the seller see when «Guardar cambios» is rejected because the product changed (409 `PRODUCT_CHANGED`)?**
   - **Answer:** (1) The form stays intact, with the notice «Este producto cambió desde que lo abriste. Recarga el producto para ver los cambios.» and **Recargar producto**, which asks for the discard confirmation the product definition already defines. The text is in `docs/drafts/product-variants.md`: the «Concurrencia» rule and the «Cuando algo falla» table.
   - **Who decided:** both gate reviewers chose option (1). The design reviewer asked for the neutral text.
   - **Reason:**
     - It follows the «Concurrencia» rule and the «resultado dudoso» pattern.
     - It costs one detail `GET`, and only when the seller asks for it.
     - The same seller triggers this 409 when they retry their own save after a dropped connection. «Otra persona cambió este producto» would be false in that case.
   - **Discarded alternative:** reload automatically and reapply the seller's edits on top. It needs merge rules the product never defined, adds client work over up to 100 rows, and can loop while another device keeps saving.

4. **How are the schema change and the existing data migrated?**
   - **Answer:** one plain migration generated by Prisma. It keeps RLS, company relations, constraints and indexes, drops `ProductVariant.attributes` directly and converts no data. There is no guard, pre-deploy check query, threshold, fallback or deferred drop.
   - **Who decided:** the founder, on 2026-10-26, after the design gate's r3 blocker on partially applied migration files.
   - **Reason:** there is no production data yet, so the expand/contract split, the backfill and the recovery procedures protect nothing. Every instance stops during the deploy.
   - **Discarded alternatives:**
     - the split migrations with a guard, a backfill and a later `attributes` drop (r2 and r3 of this draft);
     - the same split with every file atomic or re-runnable (the r3 blocker's fix).

### Open questions

None. The design is closed. Deferred items with real risk are listed below so the founder can ask for their Todoist tasks.

### Deferred items with risk

- **Capping the variants per product in the «Nueva venta» search.** The payload of up to about 2,000 variants is accepted for this version. The risk is slow searches on mobile networks if catalogs grow. The founder can ask for its Todoist task.

### Proposed update to the architecture guide

- **Rule 6.8.** Add: «Business limits that clients must enforce synchronously (for example, product option limits) are constants in the shared contract, marked as initial values and adjustable by a code change. They are not environment variables.» This design applies it to `productOptionLimits`. The design gate accepted the proposal.

**Decided unless objected:**
- Options and values have their own tables. Each variant links to one value per option, and the T0 migration drops `ProductVariant.attributes`.
- Combination uniqueness uses `combinationKey`: lowercase value ids sorted by code unit, with a unique index per product. The index names follow Prisma's convention, so `prisma migrate diff` stays empty.
- Variant status is `active` or `inactive`. Responses carry it as a tolerant string, and clients treat anything other than `"active"` as not on sale.
- Response schemas are non-strict and never reuse the request objects.
- `structureVersion` detects stale editor forms (`409 PRODUCT_CHANGED`). Prices, SKUs and status stay last-write-wins.
- The save changes saved combinations only by adding an option (`valueForExistingVariants`) or by deleting an option that has a single value in the final state. Deleting a value requires listing its saved variants for deletion.
- Core drops every value left without a variant, and then options left without values, on create and on every save. That is the product rule «Valor sin variantes».
- Structural id errors in a request are `422 VALIDATION_ERROR` issues (`ID_CONFLICT`, `INVALID_COMBINATION`, `VALUE_NOT_FOUND`) before any write. The top-level `409 ID_CONFLICT` is only the primary-key race fallback.
- Product writes are diffed and bulk, with an explicit transaction timeout (`PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS`, 10 s). Statement ceilings per phase are in §11 (create ≤ 10, save ≤ 35, each per-variant action ≤ 20, excluding `BEGIN`/`COMMIT`/`set_config`). A test proves the count does not grow with the variant count.
- Multi-query reads run in one `RepeatableRead` read transaction.
- One Prisma-generated migration with RLS, company relations, constraints and indexes, wrapped in one `BEGIN … COMMIT` with `SET LOCAL lock_timeout` and `statement_timeout`. It drops `attributes` directly and converts no data (founder decision, §17).
- Editing transactions also set transaction-local `lock_timeout` (3 s) and `statement_timeout` (8 s) in the existing `set_config` round-trip.
- Rekeying saves lock variants in id order, and order inserts are sorted by `variantId`, so the two cannot deadlock. A deadlock or lock timeout is logged with `stage: "lock_conflict"`.
- An `OrderItem` insert that fails on the variant FK (a variant deleted mid-order) answers `VARIANT_NOT_FOUND` with the `variantId`.
- The link table has a single `(companyId, optionId, valueId)` index.
- Mobile replaces its state with the detail returned by a save or action, without a follow-up `GET`.
- Shared tests are `.test.mjs` files at the paths `scripts/ci.sh` runs.
- Product writes stop during deploy, in addition to order writes.
- The client generates option and value UUIDs. A repeated `newValue` with the same id and name counts as the existing value.
- «Has orders» is an orders semi-join injected from `src/composition/`. The `OrderItem` FK is the final guard.
- Order creation resolves variants with one batched lookup.
- List summaries and the public catalog card price and `soldOut` are SQL aggregates. The public catalog list loads no variant rows and no options.
- The shared rules count and limit combinations arithmetically. **Ver** lists the uncreated combinations 50 at a time.
- Production logs carry no statement count; only the integration test counts statements.
- Deactivation does not lock against concurrent order creation.
- Selling an inactive variant answers `VARIANT_NOT_FOUND` with `variantId`.
- Limits are shared constants (guide update proposed above).
- Error codes and reasons are shared Zod enums, all added by T1.
- `combinationLabel` and the editor rules live in `shared/product-variants.ts`.
- Variant order is computed from positions.
- Web prints with the browser dialog and `qrcode`.
- The «Nueva venta» search payload of up to about 2,000 variants is accepted for this version.
- PR #150 connections are listed in §9.3.
