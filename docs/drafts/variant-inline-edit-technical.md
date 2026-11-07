# Variant inline editing on mobile: technical design

**Status:** design closed, pending implementation (approved by the architecture review gate in round 4; its answers are in section 17 for the founder to confirm in the pull request). Based on [variant-inline-edit.md](variant-inline-edit.md) (product definition, closed). Base: `jorgeluis594/movil-editar-la-variante-dentro-de-la-li` at `f618e394` (main at `b17e27a4`, PR #395 merged).

## 1. Technical goal

When done, every seller write of a variant's stock in core (the per-variant save from the mobile «Variantes» row, and the product save from mobile and web) goes through one products application operation, `setVariantStock`, that locks the stock rows, replaces the counts, publishes `product_stock_increased` in the same transaction for the variants whose count went up, and returns how many units of those variants went to how many waiting orders. The per-variant `PATCH` accepts `stock` and answers the refreshed detail plus that restock summary. Mobile replaces the saved-variant detail, both unsaved-variant screens and the change-combination sheet with one inline editor inside the «Variantes» list, maps every server issue to a field or a named reason, and keeps pending product edits across inline actions. Web only adds the restock sentence after its product save.

```text
mobile «Variantes» row ──PATCH /variants/:id {stock?, sku?, prices?}──┐
mobile product «Guardar» ──PUT /products/:id {variants[].stock?}──────┤
web product «Guardar cambios» (route action → saveProduct) ───────────┤
                                                                      ▼
                       products: updateVariant / saveProduct (product row FOR UPDATE)
                                                                      │
                                         setVariantStock (one operation, same transaction)
                                           lock stock rows by variantId → write counts
                                           → publishStockIncreased(increased ids)  ── injected from src/composition
                                                                      │                         │
                                                                      ▼                         ▼
                                                          Restock { units, orders }   orders: serveWaitingOrders
                                                                      │                (in-transaction listener)
                                                     response: { product, restock }
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Source of the product decisions | Founder (Jorge, 2026-11-06): F1 one inline editor replaces both intermediate screens; F2 stock is a direct value with today's `QuantityStepper` and whole-number validation; F3 build on PR #395 and put every seller stock write in one application operation, never loose SQL, so the coming per-variant stock history attaches without an API change; F4 concurrency out of scope, last save wins; F5 explicit save per row, no autosave; F6 reproduce the reported failure first, state its cause, fix it here if it is a server failure; F7 correct `docs/products.md` where saved stock is read-only. |
| Reported failure | Reproduced (section 3.1). Cause: a mobile build of the unmerged commit `4aa10dec` sends `stock` in the per-variant `PATCH`, which core refuses as an unknown field, and the detail screen maps no issue outside `sku`, `salePrice`, `purchasePrice` and `initialStock`. Fixed by T0 (contract), T2 (core accepts and writes `stock` through `setVariantStock`) and M2 (inline editor with full issue mapping). |
| One stock operation | `setVariantStock` in `products/application/set-variant-stock.ts` owns every seller write of an existing variant's count: the per-variant save and the product save (saved rows, bulk, and the single variant of a product without options). `applyStructureChange` no longer writes `ProductStock` for saved variants. |
| What is not a seller stock write | The initial count of a variant created by a product save or creation stays inside the variant insert: a new variant has no waiting orders and no previous count. Order deductions, cancellation restores and edit returns keep their own paths in orders and products. |
| Per-variant transport | `PATCH /api/products/:productId/variants/:variantId` gains an optional `stock`. The product `PUT` stays as PR #395 left it. Reason: the inline save must not touch other pending edits nor depend on `structureVersion`, which a `PUT` of the whole desired state does; the variant `PATCH` is already the per-variant route for prices and SKU (no product-level `PATCH` exists by decision). |
| Restock in the seller save | A seller increase publishes `product_stock_increased` once per transaction with the variants whose count went up, as `docs/orders.md` requires of any use case that increases stock. Serving runs in the products transaction through the existing orders in-transaction listener. |
| Restock result | `Restock = { units, orders }`: `units` counts the units of the increased variants deducted for served orders (waiting and `partial_waiting`), `orders` the distinct orders served. The orders listener adds `servedUnits` to `ServeOutcome`; products never imports orders and receives the publisher, already mapped to `Restock`, from `src/composition/product-stock-publisher.ts`. |
| Responses | `PATCH` variant answers `{ product, restock }` (`updateVariantResponseSchema`); `PUT` product answers `{ product, catalogEmptied, restock }`. `restock` is always present; `{ units: 0, orders: 0 }` means nothing was served. The other variant actions keep `{ product }`. |
| Stock validation | One pure parser `parseStockCount` in products domain: whole number ≥ 0 and ≤ `Number.MAX_SAFE_INTEGER`; `INVALID_STOCK` with `maximum` when the value is an integer above the bound, without it otherwise; `INVALID_TOTAL_STOCK` when the product total would leave the safe range. The per-variant `PATCH` reports the field as `stock`; the product save keeps reporting saved and new rows as `initialStock`, as today. |
| Concurrency | Last save wins (F4). No version on stock. Stock rows are locked `FOR UPDATE` in `variantId` order before the write so the increase is computed against the committed count, not the aggregate read before. This short in-transaction row lock is not the protection F4 excludes: no lock or version is held across the seller's editing, and the `UPDATE` would take the same row lock anyway; it is the lock order every stock path in `docs/orders.md` already follows. |
| Repeated requests | A repeated request after an applied save is a new seller intent: compared with the stored count (already net of the units served), it is a new increase and serves again. Core does not deduplicate (no idempotency key, no version: F4). Every client guarantees it never resends an in-doubt save: mobile's product save disables **Guardar** while uncertain and the inline editor allows only **Recargar variante**; the web product form disables **Guardar cambios** after an in-doubt save until **Recargar** (T3). Decided by the coordinator (section 17). |
| Statement budget | Per-variant `PATCH`: ≤ 20 statements without stock (unchanged, memory 3f7940ad); ≈ 22 with a stock change and no increase (lock + write); ≈ 29 with an increase and no waiting order (listener with no candidate: savepoint, read and set timeouts, budget `set_config`, candidate list, release, restore = 7); ≈ 39 when it serves (17 listener statements). The product save, measured against today's save of the same input (which already runs the loose stock `UPDATE` that T1 removes), adds 1 / 8 / 18 statements; the test names that baseline. Each count is constant in the number of variants and of waiting orders served; the integration tests pin it (section 14). |
| Web | Unchanged except the restock sentence after the product save (`?restockedUnits=&restockedOrders=` on the redirect, next to `catalogEmptied`) and the in-doubt guard of the product form (**Guardar cambios** disabled after an in-doubt save until **Recargar**). The web variant detail keeps read-only stock and **Cambiar combinación**; core keeps `PUT …/combination`. Its action parses its own `webUpdateVariantRequestSchema` (`updateVariantRequestSchema.omit({ stock: true })`, strict), so a crafted form with `stock` is refused as an unknown field and stock stays read-only on the server path too, not only in the UI. The restock sentence travels in redirect query parameters on purpose, following `catalogEmptied`: reloading or sharing that URL shows the sentence again, which is accepted; it is not moved to another mechanism. After every successful product save the web form shows the stored counts: a save that changes only stock still stamps the product's `updatedAt`, so the route's existing form key (`updatedAt:structureVersion:reloads`) remounts the form from the loader with the counts core stored, net of what was served (section 11). |
| Mobile | One inline editor per expanded row (`variant-row-editor.tsx`); a pure issue mapper (`variant-row-issues.ts`) with no generic fallback; the saved-variant detail, both draft-variant routes and the change-combination sheet are deleted with their tests and texts. The editor context adopts every inline answer (save, activate/deactivate, delete) into every saved row without resetting the session: rows without pending values take the answered values, pending values stay against the answered `original`; **Recargar variante** changes only its row (10.2). |
| Product decisions noted as assumptions | None beyond the product draft. |
| Deferred | Stock history (next feature, attaches to `setVariantStock`; it must also hook variant creation, because initial stock stays in the variant insert); concurrency protection on stock; web stock hint; restock sentence after an in-doubt save; answering only the changed variant instead of the full detail (section 10.4). All product items are recorded in the product draft with their triggers. |
| Docs corrected on merge (documentation worker) | `docs/products.md`: Stock row, Product page, Variants table, Bulk editing, Marks, Variant detail (mobile half), Unsaved variant detail (mobile screen), Discard confirmation, API (PATCH body and responses), Observability. `docs/orders.md`: Rules · Restock ("Today the only one is the cancellation…"), Rules · Stock source (the seller's stock save becomes a source that increases and decreases stock), Mechanism ("Producers that publish run with a 2000 ms lock timeout and a 3000 ms statement timeout under the 5000 ms transaction timeout": product saves publish under 10 s / 3 s / 8 s and containment holds through `listenerLimitMs`, which derives from the producer's own timer) and Accepted gaps ("Sellers cannot increase stock by hand…"). `docs/event-bus.md` if its in-transaction event table lists producers. Repository memories: 62a56cc4 ("initial stock … read-only after creation") and f5e5b54e ("Stock of saved variants, currency and QR identifiers are immutable from the product form"), both stale since PR #395, and e1b24f0d (the 2000/3000/5000 producer rule), 3f7940ad (per-variant actions «stay within 20 statements»: the `PATCH` with stock reaches ≈ 22 / 29 / 39 by design) and f4d975e1 (variant detail keeps stock read-only: now web only, the mobile route is gone) are updated by the memory maintainer; 706c71f4 (the web form keyed by `updatedAt`, `structureVersion` and a reload counter) stays true and gains that a stock-only save stamps `updatedAt` too. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Product save with stock | `apps/core/src/features/products/application/save-product.ts`, `domain/product-structure.ts:338-346` | PR #395: `variants[].stock` optional; planned as `variantFieldChanges[].stock` only when sent and different; does not raise `structureVersion`. Verified: a `PUT` with `stock: 7` answers 200 and stores 7. |
| Stock write of the product save | `infrastructure/repository.ts:300-305` (`applyStructureChange`) | Loose `UPDATE "ProductStock"` in variant order; publishes nothing, so a seller increase serves no waiting order. |
| Per-variant update | `application/update-variant.ts`, `variant-action.ts`, `product-variant-actions.ts`, `presentation/variant-api-routes.ts:44-49` | `sku`, `salePrice`, `purchasePrice` only. Product row `FOR UPDATE`, aggregate load, `planVariantPatch`, one `UPDATE`. `runVariantAction` returns the `ProductId`; the composition reloads the detail. Answers `{ product }`. |
| Contract | `shared/contracts/products.ts:55-59` | `updateVariantRequestSchema` is strict and has no `stock`; an unknown key answers `400 INVALID_INPUT` with `{ field: "stock", reason: "UNKNOWN_FIELD" }` (`presentation/api-errors.ts:12-16`). `saveProductResponseSchema` = detail + `catalogEmptied`. |
| Stock rules | `domain/validation.ts:62-70, 96-105` | `INVALID_STOCK` (no `maximum`) and `INVALID_TOTAL_STOCK` on create and product save. |
| Restock event | `products/application/events.ts:7`, `restore-cancelled-order-stock.ts` | `ProductStockIncreased = { companyId, variantIds }`; published only by the cancellation restore, wired in `src/composition/event-handlers.ts:55`. |
| Serving waiting orders | `orders/application/deduct-due-stock.ts:184-255`, `orders/composition.ts:162-207` | `serveWaitingOrders` in a savepoint; `ServeOutcome = { candidates, deducted, skippedLocked, skippedInvalid, budgetExhausted, failed }`; no unit count. Savepoint restores the producer's local timeouts (`shared/infrastructure/persistance.ts:215-258`). |
| Stock row lock | `products/infrastructure/order-stock.ts:84-91` (`lockVariantStock`) | `SELECT … ORDER BY "variantId" FOR UPDATE [SKIP LOCKED]`; requires an active transaction. |
| Product write transaction | `products/product-editing.ts:20-28` | 10 s timeout, 3 s lock timeout, 8 s statement timeout (adjustable by `PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS`). |
| Web product save | `apps/core/app/routes/product-detail.tsx:41-61, 123` | Action redirects with `?saved=1&catalogEmptied=1`; the alert shows `products.saved` then `catalogEmptied`. |
| Mobile saved-variant detail | `apps/mobile/src/features/products/presentation/variant-detail-screen.tsx`, route `src/app/products/[productId]/variants/[variantId].tsx` | Stock read-only (:307-310). Save maps issues only for `sku`, `salePrice`, `purchasePrice` (:169-176); anything else falls to `variantSaveError` (:177, text `variant-detail-translations.ts:47`). Maps `TOO_MANY_DECIMALS`, which core never sends (core sends `INVALID_PRECISION`), so a 3-decimal price shows «Escribe un precio mayor que 0.». Opening it requires discarding pending edits (`variants-screen.tsx:62-66`). |
| Mobile draft-variant screens | `presentation/draft-variant-screen.tsx`, routes `src/app/products/[productId]/draft-variant.tsx`, `src/app/products/new/draft-variant.tsx` | `QuantityStepper` (:77-80), whole-number check (:47), `setRow` into the draft. |
| Mobile change combination | `presentation/change-combination-sheet.tsx`, `VariantApi.changeCombination` (`application/variant-operations.ts`, `infrastructure/product-api.ts`) | Used only by the detail screen. |
| Mobile editor session | `presentation/product-editor-state.tsx`, `shared/product-variants.ts` (`EditorRow.original`, `buildSaveProductBody`) | A saved row is pending when its values differ from `original`; stock is sent only when it differs. `publish(detail)` makes the product screen reset the draft and form (`product-management-screen.tsx:81-88`), which drops pending edits. |
| Mobile product save | `product-management-screen.tsx:163-190`, `application/product-operations.ts` | «Cambios guardados» alert with `productUpdated` and the catalog notice. |
| Mobile bulk stock | `variants-screen.tsx` `BulkSheet` | Applies to saved and new rows (PR #395); no hint. |
| Unmerged stock-in-PATCH commit | `4aa10dec` «Edit stock from the saved variant detail», only on `origin/edit-variant-stock`, pushed 7 h after PR #395 merged | Adds `stock` to the PATCH contract, a loose `prisma.productStock.update` in `variant-repository.ts`, and an editable stock in the detail screen. Not in `main`. This design replaces it; the branch is not merged. |

### 3.1 Reported failure

**What the founder saw.** Saving a changed stock of a saved variant on mobile showed «No se pudo guardar la variante. Revisa los datos e inténtalo otra vez.» (`variantSaveError`).

**Where it comes from.** That text is set only at `variant-detail-screen.tsx:177`, when a save answers `VALIDATION_ERROR` or `INVALID_INPUT` and no issue has `field` in `sku`, `salePrice`, `purchasePrice`. The detail screen on `main` has no stock input (:307-310), so stock can only reach that branch from the build of commit `4aa10dec` (`origin/edit-variant-stock`, unmerged), whose detail screen sends `{ sku, salePrice, purchasePrice, stock }` in `PATCH /api/products/:productId/variants/:variantId` (its line 168) and maps only `initialStock` besides the three price/SKU fields (its line 177).

**Reproduction (2026-11-06, this worktree's compose stack at `localhost:3002`, core = `main`):** script `~/yoyos-landing-capturas/variant-inline-edit/repro.sh`, output in `repro-output.txt` next to it (sign-up, company, product «Polo» with «L / Azul» at 10 and «M / Azul» at 5):

| Request | Answer |
| --- | --- |
| `PATCH …/variants/<L/Azul>` `{"sku":null,"salePrice":40,"purchasePrice":null,"stock":7}` (what `4aa10dec` sends) | `400 {"code":"INVALID_INPUT","issues":[{"field":"stock","reason":"UNKNOWN_FIELD"}]}` |
| Same without `stock` (what `main` sends) | `200` with the detail |
| `PUT /api/products/<id>` with `variants[L/Azul].stock = 7` (PR #395 path) | `200`; `ProductStock.quantity` = 7 |

The mobile half was confirmed by reading `4aa10dec`, not by running it (this worktree has no mobile `node_modules`), and the identity of the founder's build is inferred from the commit's timing and from being the only code path that sends stock; the PR says both, and the Final verification runs the founder's flow on a device build: `400 INVALID_INPUT` with a `stock` issue → mobile adapter keeps the issues (`product-api.ts:80-104`) → the detail screen maps none (`field: "stock"` is not `initialStock`) → line 177 → the generic text.

**Cause.** Two defects together: (1) the server does not accept stock in the per-variant save, because PR #395 put saved-variant stock only in the product save and `updateVariantRequestSchema` is strict; (2) the mobile save maps a closed list of fields and falls back to a generic text for anything else, so the refusal named no field. Saving stock through the product save works on the server today. Fix: T0 + T2 make the per-variant save accept stock through `setVariantStock`; M2 replaces the screen with an editor whose mapping has no generic fallback.

## 4. Gaps this design closes

1. The per-variant save refuses `stock` (3.1); the mobile inline editor needs it (closed in 5.2, 8, T0, T2).
2. Seller stock writes are loose SQL in `applyStructureChange`; the coming stock history needs one operation (5.1, T1).
3. A seller increase serves no waiting order (5.1, 9, T1).
4. Neither save reports what a restock served (5.1, 8, T1, T3, M1).
5. `ServeOutcome` has no unit count (9, T1).
6. Stock rules have no `maximum` for the «demasiado grande» text and no total check in the per-variant save (6, T2).
7. Mobile shows a generic text for unmapped issues and maps a price reason core never sends (10.3, M2).
8. Mobile has three intermediate screens and a combination sheet the founder removed (10, M2, M3).
9. Publishing an action's answer resets the mobile editing session, which would drop pending edits after an inline action (10.2, M1).
10. Mobile stock inputs have no hint (10, M1, M2).

## 5. Use cases

### 5.1 `setVariantStock` (new), products

The single seller stock write. It runs inside the caller's transaction, after the caller locked the product row; it does not open a transaction.

```ts
// products/application/set-variant-stock.ts
export type StockCount = Readonly<{ variantId: VariantId; stock: StockQuantity }>;
export type SetVariantStockInput = Readonly<{ productId: ProductId; counts: readonly StockCount[] }>; // distinct variants of this product, already validated; productId only for logs
export type Restock = Readonly<{ units: number; orders: number }>;
export type SetVariantStockError = ProductReadError | TransactionEndingError;
export type SetVariantStockDependencies = Readonly<{
  /** `FOR UPDATE` on the stock rows in `variantId` order (waits, within the transaction's lock timeout); the committed counts. */
  lockStock: (variantIds: readonly VariantId[]) => Promise<Result<ReadonlyMap<VariantId, StockQuantity>, SetVariantStockError>>;
  /** One statement for every changed count, in `variantId` order; returns the number of rows written. */
  writeStock: (counts: readonly StockCount[]) => Promise<Result<number, SetVariantStockError>>;
  /** In-transaction publisher; only a transaction-ending failure comes back, everything else is contained and reported as zero served. */
  publishStockIncreased: (event: ProductStockIncreased) => Promise<Result<Restock, TransactionEndingError>>;
}>;
export async function setVariantStock(input: SetVariantStockInput, access: ProductAccess, deps: SetVariantStockDependencies): Promise<Result<SetStock, SetVariantStockError>>;
export type SetStock = Readonly<{ written: readonly Readonly<{ variantId: VariantId; previous: StockQuantity; stock: StockQuantity }>[]; restock: Restock }>;
```

Flow:
1. With no counts, return `{ written: [], restock: { units: 0, orders: 0 } }` without a statement.
2. `lockStock` the requested variants. A variant with no stock row, or a row that `parseStockCount` refuses, is `PERSISTENCE_UNAVAILABLE` (`INVALID_STORED_DATA` in the log): every variant has a valid one by construction.
3. Keep the counts whose `stock` differs from the locked value; with none, return as in step 1.
4. `writeStock` the kept counts; a row count different from their number is `PERSISTENCE_UNAVAILABLE`.
5. Increased = kept counts with `stock > previous`. With at least one, `publishStockIncreased({ companyId: access.companyId, variantIds })` once; its result is the `Restock`. A transaction-ending failure is returned and rolls the save back; a contained failure arrives as `{ units: 0, orders: 0 }` (recovery serves later, product draft · Served later).
6. Return `written` (for logs and the future history) and `restock`.

The stock history attaches here later as one more dependency (`recordStockChanges(written, access, reason)`) without changing input, output or any route.

### 5.2 `updateVariant` (modified), products

- `UpdateVariantInput` adds `stock?: number`.
- `UpdateVariantDone` becomes `{ variantId; fields: readonly ("sku" | "salePrice" | "purchasePrice" | "stock")[]; restock: Restock }`.
- `UpdateVariantDependencies` adds `setVariantStock: (input: SetVariantStockInput) => Promise<Result<SetStock, SetVariantStockError>>` (the composition binds access and adapters).
- `UpdateVariantError` adds nothing new: stock issues are `VALIDATION_ERROR` issues.

Flow inside `runVariantAction` (product row locked, aggregate loaded):
1. Find the variant; absent → `VARIANT_NOT_FOUND`.
2. Validate prices and SKU with `validateVariantPatch` as today, and stock with `parseStockCount(input.stock)` plus `checkProductStockTotal(product, variantId, stock)`; every issue is collected and returned together as `VALIDATION_ERROR` with `{ scope: "variant", variantId, field: "stock", reason, maximum? }`.
3. Plan price and SKU changes with `planVariantPatch`; check SKU owners as today; write them with `updateVariantFields` (no stock there).
4. When `stock` was sent, `setVariantStock({ productId, counts: [{ variantId, stock }] })`.
5. Nothing written at all → `ok(null)` (as today). Otherwise `ok({ variantId, fields, restock })`; `fields` includes `"stock"` only when the count changed.

`runVariantAction` returns `{ productId, done }` instead of the bare `ProductId`, so the composition can answer `restock`; the other three actions ignore `done`.

### 5.3 `saveProduct` (modified), products

- `SaveProductDependencies` adds `setVariantStock` (bound as in 5.2).
- `SavedProduct` becomes `{ detail; hidLastOffered; restock: Restock }`.
- `ProductStructureChange` moves stock out of `variantFieldChanges` into `stockCounts: readonly StockCount[]` (every saved variant whose stock was sent, whatever the aggregate says: `setVariantStock` drops the unchanged ones after `lockStock`, step 3 of 5.1, so a sale between the aggregate load and the lock never swallows the seller's count). This adds no lock to ordinary saves: both clients send a saved variant's stock only when the seller changed it against the loaded value (`buildSaveProductBody`, `shared/product-variants.ts:421-433`), so a rename or a price edit sends no stock and takes no stock lock. `applyStructureChange` stops writing `ProductStock` for saved variants; it still inserts the rows of new variants. A plan with any sent saved-variant stock is a change even when nothing else changed: `planProductSave` counts `stockCounts` in `changed` whether or not the sent count differs from the aggregate, so it stamps `product.updatedAt` (and never `structureVersion`), as a stock change stamps it today as a `variantFieldChange`. Reason: `updatedAt` is the product's last edit and the web form remounts on it (section 11); deciding it against the pre-lock aggregate would leave a form that typed the count a sale had just reached (loaded 5, sale to 3, seller types 3) unremounted and dirty, ready to resend 3 later. Clients send stock only when the seller changed it, so the stamp adds no write to ordinary saves.
- Flow: after `applyStructureChange` (which still runs for a stock-only plan, since `product.updatedAt` makes it non-empty; it then writes only the `Product` stamp) and nothing slow after it (rule: the stock lock is taken last, only the hidden-catalog check and the reload follow it before commit, so a later change must not move it before `applyStructureChange` and widen the window in which payments wait on these rows), `setVariantStock({ productId, counts: change.stockCounts })`; its error rolls back the save; its `restock` goes in the result. `isEmptyChange` counts `stockCounts`. `SaveObserver.saved` adds `stockChanges` (rows written) and `restockedOrders`, `restockedUnits`; it fires for every non-empty plan, so a save whose sent counts all equal the locked ones logs `stockChanges: 0`.

### 5.4 `serveWaitingOrders` (modified), orders

`ServeOutcome` adds `servedUnits: number`: the sum of the planned deduction lines whose `variantId` is in `payload.variantIds`, over the orders actually deducted (pending parts included). `containedServeOutcome` reports `servedUnits: 0`. Nothing else in the listener changes; `deducted` already counts distinct orders.

## 6. Domain and typing

| Type | Where | Why |
| --- | --- | --- |
| `StockQuantity` (brand) + `parseStockCount(value: unknown): Result<StockQuantity, StockIssue>` | `products/domain/stock-level.ts` (existing file of stock rules) | The rule "whole number, 0 or more, within the safe range" exists only inside a Zod schema; the per-variant save and `setVariantStock` need it as a value. Orders' `NonNegativeInteger`/`parseStockQuantity` (`orders/domain/stock-deduction.ts`) brands the same column but belongs to orders, which products must not import; each feature keeps its own parser of the column, and `lockStock` parses the rows it reads with `parseStockCount`. `StockIssue = { reason: "INVALID_STOCK"; maximum?: number }`. The create schema's `initialStock` refinement calls it, so both report the same reason, and the new `maximum` reaches the product save too. |
| `checkProductStockTotal(product, variantId, stock): StockTotalIssue \| null` | same file | `INVALID_TOTAL_STOCK` for one variant changed in place; the product save keeps its whole-list check. |
| `Restock` | `products/application/set-variant-stock.ts` | What a seller save served; products owns it because it is the save's answer. Not an alias of `ServeOutcome`, which is orders' internal accounting (candidates, skipped, budget). |
| `StockCount`, `SetStock` | same file | Input and output of the one write; `SetStock.written` carries `previous` for logs and the coming history. |
| `ProductStructureChange.stockCounts` | `products/domain/product-structure.ts` | Separates the stock write (owned by `setVariantStock`) from field writes (owned by `applyStructureChange`). |
| `ServeOutcome.servedUnits` | `orders/application/deduct-due-stock.ts` | The product sentence needs units of the increased variants; only the listener knows what it deducted. |
| Mobile `Restock` | `apps/mobile/src/features/products/domain/product.ts` | Mobile model with core's names, built by the adapter from the contract. |
| Mobile `VariantIssueText` | `apps/mobile/src/features/products/presentation/variant-row-issues.ts` | `{ kind: "field"; field: "salePrice" \| "purchasePrice" \| "stock" \| "sku"; text } \| { kind: "form"; text }`: where each refusal is shown. |

| Layer | Types and authority |
| --- | --- |
| Core domain | `StockQuantity`, stock issues, plan with `stockCounts`; decides validity. |
| Core application | `setVariantStock` decides what is written and what increased, from locked counts. |
| Orders | Decides which orders are served and reports `deducted` and `servedUnits`. |
| Contract | `restock` as plain integers; `stock` as a number validated by core. |
| Mobile | Validates before sending with the same rules and texts; never decides what was served. |

## 7. Persistence

No schema change and no migration. `ProductStock` is written by `writeStock` (one `UPDATE … FROM (VALUES …)` in `variantId` order, the statement `applyStructureChange` has today, moved to `products/infrastructure/stock-repository.ts` next to a new `lockStock`: its own statement with the same shape as `lockVariantStock` (`ORDER BY "variantId" FOR UPDATE`, waiting) plus the tenant predicate). `lockVariantStock` in `order-stock.ts`, which orders call on its payment, shipment and recovery paths, is left unchanged. Rows read under the lock are parsed with `parseStockCount` (section 6); an unparsable row is `INVALID_STORED_DATA`, logged and answered as `PERSISTENCE_UNAVAILABLE`. Both statements keep the explicit tenant predicate `"companyId" = $companyId` next to RLS, as the current write does (`repository.ts:303-305`); `lockStock` carries it in its own query rather than relying on RLS alone. Like the other editing adapters, `lockStock` and `writeStock` rethrow lock timeouts, deadlocks and transaction-ending failures, which `productTransaction`/`variantTransaction` log once (`product_save_failed`, `product_variant_action_failed`) and answer as `PERSISTENCE_UNAVAILABLE`; they log `product_stock_write_failed` only for `INVALID_STORED_DATA` and `UNEXPECTED_ROW_COUNT`, with the `productId` of the input.

## 8. Contracts between applications

`shared/contracts/products.ts`:

```ts
export const updateVariantRequestSchema = z.strictObject({
  sku: z.string().nullable().optional(),
  salePrice: z.number().optional(),
  purchasePrice: z.number().nullable().optional(),
  // Replaces the count with the units free to sell; sent only when the seller changed it. Validated by core.
  stock: z.number().optional(),
}).readonly();

export const restockSchema = z.strictObject({ units: z.number().int().nonnegative(), orders: z.number().int().nonnegative() }).readonly();
export const updateVariantResponseSchema = productDetailBaseSchema.extend({ restock: restockSchema }).superRefine(checkProductDetail);
export const saveProductResponseSchema = productDetailBaseSchema.extend({ catalogEmptied: z.boolean(), restock: restockSchema }).superRefine(checkProductDetail);
```

| Situation | Status · code | Issues |
| --- | --- | --- |
| `stock` not a number (string, null) | 400 `INVALID_INPUT` | `{ field: "stock", reason: "INVALID_TYPE" }` |
| Unknown field | 400 `INVALID_INPUT` | `{ field, reason: "UNKNOWN_FIELD" }` |
| `stock` negative or fractional | 422 `VALIDATION_ERROR` | `{ scope: "variant", variantId, field: "stock", reason: "INVALID_STOCK" }` |
| `stock` an integer above `Number.MAX_SAFE_INTEGER` | 422 `VALIDATION_ERROR` | same with `maximum: 9007199254740991` |
| Product total out of range | 422 `VALIDATION_ERROR` | `{ …, field: "stock", reason: "INVALID_TOTAL_STOCK" }` |
| Price, SKU | as today | `INVALID_PRICE`, `INVALID_PRECISION` (`maxDecimals`), `TOO_LONG` (`maxLength`), `DUPLICATE_SKU`, `INVALID_TYPE` |
| Variant of another product or company | 404 `VARIANT_NOT_FOUND` / `PRODUCT_NOT_FOUND` | — (nothing written, nothing served) |
| Success | 200 | `{ product, restock }` |

Core validates the response with the schema before sending, as it does today for the detail. Mobile validates request and response with these schemas in `product-api.ts`. `productIssueReasonSchema` needs no new reason. The web variant detail reads `{ product }` and ignores `restock`.

## 9. Events and cross-feature integration

- Event: `product_stock_increased` `{ companyId, variantIds }` (existing, in-transaction, outcome `ServeOutcome`). Published by `setVariantStock` once per transaction with the variants whose count went up. Not published on a decrease nor on an unchanged count.
- Publisher capability: `apps/core/src/composition/product-stock-publisher.ts` exports `publishProductStockIncreased(event): Promise<Result<Restock, TransactionEndingError>>`, built from `publishStockEvent("product_stock_increased", event)` in orders' composition and mapping `{ units: outcome.servedUnits, orders: outcome.deducted }`. `products/product-editing.ts` and `products/product-variant-actions.ts` import it (precedent: `composition/event-bus.ts` imported by features). `src/composition/event-handlers.ts` keeps its restore wiring. Products never imports orders.
- Lock order: product row → (deleted or rekeyed variant rows) → stock rows in `variantId` order → listener takes waiting orders `FOR NO KEY UPDATE SKIP LOCKED` and their stock rows `SKIP LOCKED`. Orders take order row → stock rows; they never wait for a product row. The seller save holds stock rows before order rows, which is safe because the listener never waits once it holds its first lock.

| Failure window | What happens | Effect for the seller |
| --- | --- | --- |
| Stock rows held by a payment or shipment | `lockStock` waits up to the product transaction's 3 s lock timeout; beyond it the save rolls back (`PERSISTENCE_UNAVAILABLE`, `lock_conflict`) | Mobile treats the 503 `SERVICE_UNAVAILABLE` as in doubt and offers **Recargar variante**, which shows nothing was saved (decided in section 17) |
| A payment, order edit or delivery change needs stock rows this save holds (from `lockStock` to commit: serving ≤ 500 ms, then the hidden-catalog check and the reload) | Its in-transaction deduction waits up to the listener limit (≤ 1 s); beyond it the deduction is contained and the payment still commits | The order shows «Descontando stock» until recovery deducts it (≤ 1 min); keep "nothing slow after `lockStock`" (5.3) |
| A waiting order or its stock row locked elsewhere | Skipped, units stay free, recovery serves it within a minute | Sentence counts only what this save served |
| Listener budget (500 ms) runs out | Contained, `servedUnits: 0` for the rest | Same |
| Listener data fault | Contained, logged by orders as `stock_deduction_failed` | Save succeeds; `restock` zero or partial |
| Transaction-ending failure in the listener | The whole save rolls back | Mobile in-doubt text; web error alert |

## 10. Mobile

### 10.1 Files

| File | Change |
| --- | --- |
| `domain/product.ts` | `Restock` type; `SavedProduct` adds `restock` (T0, with the adapter). |
| `application/variant-operations.ts` | `VariantPatch` adds `stock`; `updateVariant` answers `{ product, restock }`; `changeCombination` removed from `VariantApi` and the operations. `VariantActionCode` unchanged except removals the compiler asks for. |
| `application/product-operations.ts` | `saveProduct` passes `restock` through. |
| `infrastructure/product-api.ts` | PATCH body with `stock`; parse `updateVariantResponseSchema` and `saveProductResponseSchema` with `restock`; `changeCombination` removed. |
| `presentation/variant-row-editor.tsx` (new) | The expanded row: saved-variant form (sale price, purchase price, stock with hint, SKU, **Guardar variante**, **Cancelar**, QR and **Imprimir etiqueta**, **Desactivar/Activar variante**, **Eliminar variante** or its reason) and «Nueva» form (**Aplicar**, **Cancelar**, **Quitar**). Owns typed values, busy state, notices, the in-doubt state and **Recargar variante**. Stock uses `QuantityStepper` and the whole-number rule of today's draft-variant screen. |
| `presentation/variant-row-issues.ts` (new) | Pure `variantIssueText(issue, t)` and `variantSaveFailure(error, t)` per the product draft's rejection table: field + reason → text; known field with an unknown reason → «No se aceptó este valor…»; unexpected field → «Esta versión de Yoyos envió un dato que ya no se acepta ({{field}})…»; unknown code without field (`API_ERROR`) → «…por un motivo que esta versión de Yoyos no reconoce…»; transport codes → offline or in doubt. No branch returns `variantSaveError`. Maps `INVALID_PRECISION` (not `TOO_MANY_DECIMALS`). |
| `presentation/restock-sentence.ts` (new) | Pure `restockSentence(restock, t): string \| null` (null when `orders === 0`), the three plural forms of the product draft. |
| `presentation/variants-screen.tsx` | Rows are a memoized row component with a stable `renderItem`; `extraData` carries only the expanded ref and selection, so expanding or typing does not re-render the other mounted rows; adopting an answer re-renders only the rows whose values changed (row props compared by value). The expanded editor stores only the fields the seller touched; every untouched field reads the current draft row, so an adopted answer (a status answer, or a late answer that changed this row's stock) shows in the open editor and **Guardar variante** never sends a value the seller did not type. The touched values and dirty flag live at screen level keyed by `ref` (not inside the virtualized cell), so the back guard and «tapping another row asks to discard» read them and a cell scrolled out of the window loses nothing. Rows expand instead of navigating; one expanded ref; chevron down/up; «Sin guardar» mark in the warning style; accessible name «Editar …», expanded state and description; selection bar hidden while a row is expanded; pinned status line for «Variante eliminada.»; back guard (top bar, hardware back, swipe) for typed inline changes; only the expanded row renders an editor; bulk stock sheet shows the hint. No route push to detail or draft-variant. |
| `presentation/product-editor-state.tsx` | `adoptAnswer(product, acted)` and `adoptDeletion(product, variantId)`: publish the detail and apply `adoptAnsweredVariants` (rule in 10.2) to both `draft` and `baseline`, so every saved row's `original` is what core answered and every pending value survives; deletion removes the row from both, adopts the new structure version and adopts the answer into the remaining rows. When `draft === baseline` before adopting (no pending edits), it adopts once and keeps one object for both, so `dirty` stays an identity check; `adoptAnsweredVariants` returns its input when no row changed and keeps unchanged rows by reference. `reset` is no longer called on a publish. |
| `shared/product-variants.ts` | Pure `adoptAnsweredVariants(draft, answered, acted)` with `acted: { variantId; kind: "save" \| "status" \| "reload" }` (rule in 10.2), `removeSavedVariant(draft, variantId)` and `hasPendingValues(row)` (saved row with at least one field whose value differs from `original`). Only mobile calls the adopt functions; web keeps its current use. |
| `presentation/product-form-state.ts` | `INVALID_RESPONSE` joins the product save's uncertain codes (section 11). |
| `presentation/product-management-screen.tsx` | The publish effect (`:81-88`) takes the published product (structure version, `hasOrders`) without resetting a dirty draft or typed form values; the «Cambios guardados» alert appends `restockSentence`; the stock field of a product without options shows the hint (full on a saved product, short while creating — `create-product-screen.tsx`/`product-form.tsx`). |
| `presentation/product-form.tsx` | Stock hint under the stepper. |
| `presentation/variant-editor-translations.ts` | All texts of the product draft (es and pt-BR) the inline editor uses, including those moved from `variant-detail-translations.ts` (deactivate/delete confirmations, delete reasons, QR texts). |
| `presentation/translations.ts` | Restock sentence and hint keys used by the product screen. |
| `presentation/product-routes.ts` | `variantPath` and `"draft-variant"` removed. |
| Deleted | `presentation/variant-detail-screen.tsx` (+ test), `presentation/variant-detail-translations.ts`, `presentation/change-combination-sheet.tsx`, `presentation/draft-variant-screen.tsx`, `src/app/products/[productId]/variants/[variantId].tsx`, `src/app/products/[productId]/draft-variant.tsx`, `src/app/products/new/draft-variant.tsx`. |

### 10.2 Session rules

| Situation | Decision |
| --- | --- |
| Adopting an answer (every inline action) | `adoptAnsweredVariants`, applied to draft and baseline. The acted row follows its action (rows below). Every other saved row present in the answer, for **Guardar variante** and status answers: `original`, status and `hasOrders` become the answered ones; each field (sale price, purchase price, stock, SKU) whose value equals the old `original` (not pending) takes the answered value; each pending field keeps its value, now compared with the new `original` (a pending value equal to the answered one stops being pending). Example (criterion 29): saving «L / Azul» at 1 serves #1030, whose «M / Azul» line takes «M / Azul» from 5 to 4; the answer carries 4, «M / Azul» had no pending value, so it shows 4 with `original.stock = 4`; had it a pending bulk stock of 6, it keeps 6 against `original.stock = 4` and the product's **Guardar** sends 6. A saved row absent from the answer and every «Nueva» row are left as they are. Reason: a stale `original` would make a later edit back to the old value look unchanged and silently drop it from the product save. |
| **Guardar variante** succeeds | Acted row (`kind: "save"`): values and `original` become the answered ones in draft and baseline, so the product's **Guardar** does not resend them and «Sin guardar» disappears; other rows follow the adoption rule above. The editor shows the answered values (stock already net of served units) and «Variante guardada.» plus `restockSentence`. |
| Activate / deactivate succeeds | Acted row (`kind: "status"`): status, `hasOrders` and `original` from the answer, fields by the per-field rule (pending values kept); selection eligibility follows the status; typed values in the editor stay. Other rows follow the adoption rule above. |
| Delete succeeds | Offered only when `editor.dirty` is false and the product form is clean; `adoptDeletion` removes the row, adopts the structure version and applies `adoptAnsweredVariants` to the remaining rows (none can be pending, so each takes the answered values and `original`). |
| Recargar variante | `products.loadProduct`, then `adoptAnsweredVariants` with `kind: "reload"`: the acted row's values and `original` become the loaded ones (after asking to discard typed changes); no other row changes, as the product draft's «In doubt» row states. |
| Late answer after collapse or leaving | Still adopted into the session if it is alive; never reopens a row nor shows a message. An open editor shows the adopted values in its untouched fields (10.1). |
| Offline before sending | `isOnline()` false → offline text, nothing sent. |
| In doubt | Transport codes in `uncertainCodes` plus `INVALID_RESPONSE` → in-doubt text and **Recargar variante**; no other action on the row until reloaded. |
| Double tap | One action at a time per editor (ref guard as today's detail). |

### 10.3 Issue mapping

`variant-row-issues.ts` implements exactly the product draft's «Rejection texts» table. Fields known to the editor: `salePrice`, `purchasePrice`, `stock`, `sku`; `initialStock` is treated as `stock` (product save rows). A test enumerates every reason of `productIssueReasonSchema` for each editor field and asserts no result equals `variantSaveError` or `variantActionError`.

### 10.4 Requests and payload

Per screen: opening «Variantes» costs no request (the product is already loaded); each **Guardar variante**, **Desactivar**/**Activar** and **Eliminar** is one request whose answer is the full product detail (up to 100 variants, order of tens of KB at the limit) parsed with `checkProductDetail`; **Recargar variante** is one product `GET`. Today a saved row costs a `GET` when opening the detail plus the `PATCH`, so the inline flow sends fewer requests. Answering only the changed variant is deferred: it would be a contract change, decided consciously when the payload becomes a measured problem.

## 11. Transactions and concurrency

Per-variant save (`PATCH`), in the product write transaction (tenant scope, 10 s / 3 s lock / 8 s statement):
1. `SELECT … FROM "Product" … FOR UPDATE` (`runVariantAction`).
2. Load the aggregate (6 statements).
3. Validate; SKU owners if the SKU changes.
4. `UPDATE "ProductVariant"` for price/SKU changes.
5. If `stock` was sent: `SELECT … FROM "ProductStock" … ORDER BY "variantId" FOR UPDATE`; `UPDATE "ProductStock"` if it differs.
6. If it increased: `product_stock_increased` → savepoint → serving (bounded, `SKIP LOCKED`) → savepoint released, producer timeouts restored.
7. Commit; then the composition reloads the detail (as today) and logs.

Product save: unchanged order, with step "stock" (lock, write, publish) after `applyStructureChange` and before the hidden-catalog check and the reload.

Two simultaneous saves of one product serialize on the product row; the second sees the first's committed counts (last save wins). A payment deducting the same variant serializes on the stock row: if it commits first, the seller's count replaces the result (last save wins, F4); if the seller commits first, the payment deducts from the new count. A repeated request after an applied save is not a no-op: the stored count is already net of the units the first save served, so the same typed count is a new increase and serves again (example: «L / Azul» at 0, #1010 (2) and #1012 (3) waiting; the seller saves 7, 5 units go to the orders and 2 are stored; the same request again raises 2 → 7 and serves any other waiting order). Core does not deduplicate: an idempotency key or a version is the concurrency protection F4 excludes. The guarantee is in the clients: no client resends a save whose outcome is unknown. Mobile's product save keeps **Guardar** disabled while uncertain (`product-management-screen.tsx:222-235`), and M1 adds `INVALID_RESPONSE` to the product save's uncertain codes (`product-form-state.ts:41`), because a `200` whose body fails the schema is an applied save; the inline editor offers only **Recargar variante** after an in-doubt answer (10.2); the web product form disables **Guardar cambios** after an in-doubt save until **Recargar** remounts it with the stored values (T3). After reloading, the form shows the stored count, so a seller who types the same number again expresses a new intent. The success path gives the same guarantee: after every successful save every client shows the counts core stored, so nothing typed before the save stays pending against an outdated original. Mobile resets the draft from the answer (`product-management-screen.tsx:181-185`) and the inline editor adopts the answer into every saved row by the rule of 10.2 (rows without pending values show the stored values, pending values keep their originals coherent with the stored ones); web remounts the form because every product save that changed anything against the loaded product, a stock-only change included, stamps `updatedAt` (5.3). Example: «L / Azul» at 0, #1010 (2) and #1012 (3) waiting; the seller saves 7 on web; core stores 2 and the form, remounted, shows 2 and is not dirty, so a following rename does not send stock. An integration test pins the repeat behavior and unit and web tests pin the remount (section 14).

## 12. Code organization

| Feature | Layer | Files |
| --- | --- | --- |
| products | domain | `stock-level.ts` (`StockQuantity`, `parseStockCount`, `checkProductStockTotal`), `validation.ts` (initialStock refinement calls the parser), `product-structure.ts` (`stockCounts`), `rules.ts` (unchanged API) |
| products | application | `set-variant-stock.ts` (new), `update-variant.ts`, `variant-action.ts`, `save-product.ts` |
| products | infrastructure | `stock-repository.ts` (new: `lockStock`, `writeStock`), `repository.ts` (`applyStructureChange` without saved-variant stock) |
| products | presentation | `variant-api-routes.ts` (`{ product, restock }`), `api-routes.ts` (save answers `restock`), `product-presenter.ts` |
| products | composition | `product-editing.ts`, `product-variant-actions.ts` (bind `setVariantStock` with `publishProductStockIncreased`) |
| orders | application | `deduct-due-stock.ts` (`servedUnits`) |
| app | composition | `src/composition/product-stock-publisher.ts` (new) |
| web | routes | `app/routes/product-detail.tsx` (restock query params and sentence), `app/routes/product-variant.tsx` (consumes `{ productId, done }` from the actions; refuses `stock`), `app/locales.ts` (es, pt-BR) |
| web | products presentation | `product-form.tsx` (submit disabled after an in-doubt save until reload), `variant-detail-model.ts` (parses `webUpdateVariantRequestSchema`, without `stock`) |
| shared | contracts | `shared/contracts/products.ts`; `shared/product-variants.ts` (adopt helpers) |
| mobile | see 10.1 | |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `product_variant_updated` (existing) | info | `product-variant-actions.ts`, after commit | `["companyId","productId","variantId","fields","stockIncreased","restockedOrders","restockedUnits","durationMs"]` |
| `product_saved` (existing) | info | `product-editing.ts`, after commit | existing fields + `["stockChanges","stockIncreases","restockedOrders","restockedUnits"]` |
| `product_variant_action_rejected` (existing) | info | composition | `["companyId","productId","variantId","action","errorCode","durationMs"]` (a stock issue arrives as `VALIDATION_ERROR`) |
| `product_stock_write_failed` | error | `stock-repository.ts` (`productId` from `SetVariantStockInput`) | `["companyId","productId","stage","errorCode","durationMs"]`, `stage` ∈ `lock_stock`, `write_stock`, `errorCode` ∈ `INVALID_STORED_DATA`, `UNEXPECTED_ROW_COUNT`. Lock timeouts, deadlocks and transaction-ending failures are rethrown and logged once by `product_save_failed` / `product_variant_action_failed` with their `stage` |
| `waiting_orders_served` (existing, orders) | info / warn | orders composition | unchanged, plus `servedUnits` |
| `stock_deduction_failed`, `stock_deduction_contended`, `stock_deduction_rolled_back` (existing) | as today | orders | unchanged; `trigger: "product_stock_increased"` |

Never logged: stock counts, prices, SKUs, names, order numbers. Counts of rows, orders and units are logged; the count values are not.

## 14. Tests

### Core unit (Vitest)

`products/domain/stock-level.test.ts`
- `test("parses a whole number from 0 up to the safe integer bound as a stock quantity")`
- `test("rejects a negative or fractional stock with INVALID_STOCK and no maximum")`
- `test("rejects an integer above the safe bound with INVALID_STOCK and the maximum")`
- `test("rejects a variant count that would take the product total out of the safe range with INVALID_TOTAL_STOCK")`

`products/application/set-variant-stock.test.ts`
- `test("writes only the counts that differ from the locked stock and returns nothing served when none increased")`
- `test("publishes product_stock_increased once with only the variants whose count went up")`
- `test("does not publish on a decrease and never returns units to deducted orders")`
- `test("returns the units and orders the listener reported for the increase")`
- `test("compares against the locked count, not the count the caller read before")`
- `test("rolls the caller back when the publisher reports a transaction-ending failure")`
- `test("answers PERSISTENCE_UNAVAILABLE when a stock row is missing or the write count differs")`
- `test("writes nothing and locks nothing when no count is requested")`

`products/application/update-variant.test.ts`
- `test("saves a changed stock through setVariantStock and lists stock among the written fields")`
- `test("reports stock, price and SKU issues together and writes nothing")`
- `test("saves only the price when stock is not sent, so a sale made meanwhile keeps its count")`
- `test("answers the restock the stock operation returned")`
- `test("writes nothing and announces nothing when every sent value equals the saved one")`

`products/application/save-product.test.ts`
- `test("passes every sent saved-variant stock to setVariantStock after the structure change")`
- `test("writes the seller's count when a sale changed the stored count between loading and locking")`
- `test("answers the restock served by stock increases of the save")`
- `test("does not treat the initial stock of a new variant as a restock")`
- `test("saves a stock-only change without raising the structure version")`

`products/domain/product-structure.test.ts`
- `test("a stock-only change stamps the product's update time without raising the structure version")`
- `test("plans every sent stock as a stock count, not a field change")`
- `test("a sent stock equal to the loaded count still stamps the update time")`

`orders/application/deduct-due-stock.test.ts`
- `test("counts served units only for the increased variants of the deducted orders")`
- `test("counts the pending units of a partially waiting order served by a restock")`
- `test("reports zero served units when serving is contained")`

`src/composition/product-stock-publisher.test.ts`
- `test("maps the served outcome to units and orders")`

### Core integration (real database)

`products/presentation/variant-api-routes.integration.test.ts`
- `test("PATCH with stock replaces the variant's count and answers the product with an empty restock")`
- `test("PATCH raising stock serves waiting orders oldest first and answers the units and orders served")`
- `test("PATCH raising stock skips a waiting order that does not fit and serves the next one")`
- `test("PATCH raising an inactive variant's stock serves its waiting orders")`
- `test("PATCH raising stock serves an order's pending part and counts only the increased variant's units")`
- `test("PATCH lowering stock leaves deducted orders deducted")`
- `test("PATCH with a fractional or negative stock answers 422 with a stock issue and writes nothing")`
- `test("PATCH with stock above the safe bound answers 422 with INVALID_STOCK and the maximum")`
- `test("PATCH with stock as text answers 400 with a stock INVALID_TYPE issue")`
- `test("PATCH with a variant of another company or another product answers not found and serves no order")`
- `test("PATCH with stock does not raise the structure version")`
- `test("PATCH of price without stock stays within 20 statements on 2 and 100 variants")`
- `test("PATCH with a stock decrease runs the same number of statements on 2 and 100 variants")`
- `test("PATCH with a stock increase and no waiting order runs the same number of statements on 2 and 100 variants")`
- `test("PATCH with a stock increase runs the same number of statements whether it serves 1 or 30 waiting orders")`
- `test("PATCH whose stock row is held past the lock timeout answers 503 and writes and serves nothing")` (runs in its own describe with `PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS=2000`, a 600 ms lock timeout; the shortened timeout never applies to the restock and statement-count tests, whose listener limit would otherwise drop to its floor)
- `test("repeating an applied PATCH that raised stock raises the stored count again and serves the next waiting order")`

`products/infrastructure/save-product.integration.test.ts`
- `test("a product save raising a saved variant's stock serves its waiting orders in the same transaction")`
- `test("a product save serving one order through two increased variants counts the order once and both variants' units")`
- `test("a product save that only lowers stock answers an empty restock")`
- `test("a product without options serves waiting orders when its stock is raised by the product save")`
- `test("a product save raising 100 variants at once runs the same number of statements as one raising 2")` (and adds 1 / 8 / 18 to today's save of the same input)
- `test("a stock-only product save changes the product's update time")`
- `test("a product save serving 30 waiting orders runs the same number of statements as one serving 1")`

`orders/stock-deduction.integration.test.ts`
- `test("a seller stock increase deducts a waiting order before a newer payment can take the units")`

### Web (Vitest, React Router)

`app/routes/product-detail.test.tsx`
- `test("the saved message adds the restock sentence when the save served waiting orders")`
- `test("the saved message has no restock sentence when nothing was served")`
- `test("after a save that served waiting orders the form shows the stored count and is not dirty")`
- `test("after a stock-only save a following rename sends no stock")`

`src/features/products/presentation/product-form.test.tsx`
- `test("after an in-doubt save Guardar cambios stays disabled until the seller reloads")`
- `test("reloading after an in-doubt save shows the stored values and enables Guardar cambios again")`

`src/features/products/presentation/variant-detail-model.test.ts` and `app/routes/product-variant.test.ts`
- `test("the web variant action refuses a form with stock as an unknown field and writes nothing")`
- `test("the web variant action still answers the refreshed product after a price update")`

### Web E2E (Playwright, happy path)

`tests/e2e/products-edit.spec.ts`
- `test("raising a variant's stock in the variants table serves a waiting order and says so after saving")`

### Mobile (Jest, React Native Testing Library)

`shared/product-variants.test.mjs` (`node:test`, as the file is today)
- `test("adopting a save answer updates the acted row's values and original")`
- `test("adopting an answer refreshes the saved values of rows without pending values")`
- `test("adopting an answer keeps a row's pending values and moves its original to the answered values")`
- `test("after adoption a pending value set back to the stored value is no longer sent")`
- `test("after adoption a row edited back to its previous count is sent by the product save")`
- `test("adopting a status answer keeps the acted row's pending values")`
- `test("adopting a reload answer changes only the acted row")`
- `test("adopting an answer leaves Nueva rows and rows absent from the answer as they are")`
- `test("a saved row whose values differ from its original has pending values")`
- `test("removing a saved variant keeps the other rows and their pending values")`
- `test("adopting a delete answer refreshes the remaining rows' values and originals")`
- `test("adopting an answer that changes no row returns the same draft and keeps unchanged rows by reference")`

`presentation/variant-row-issues.test.ts`
- `test("maps every stock reason to its text next to the stock field")`
- `test("maps INVALID_PRECISION on a price to the two-decimals text")`
- `test("maps a known field with an unknown reason to the not-accepted text next to the field")`
- `test("maps an unexpected field to the update-the-app text naming the field")`
- `test("maps an unknown rejection without field to the unrecognized-reason text")`
- `test("never answers the generic save or action text for any reason of any editor field")`

`presentation/restock-sentence.test.ts`
- `test("says nothing when no order was served")`
- `test("uses the singular forms for one unit and one order and the plural forms otherwise")`

`presentation/variants-screen.test.tsx`
- `test("tapping a row expands its editor in the list and collapses the one that was open")`
- `test("saving a changed stock sends only the stock and shows Variante guardada with the answered count")`
- `test("saving shows the restock sentence when the answer served waiting orders")`
- `test("saving a row whose restock serves an order with a line of another variant shows that variant's new stock on its row")`
- `test("a stock refusal shows its text under Stock and keeps the typed value")`
- `test("an empty stock on a saved row is refused before sending")`
- `test("offline sends nothing and keeps the typed values")`
- `test("an unreadable answer shows the in-doubt text and Recargar variante instead of Guardar variante")`
- `test("an inline save keeps the bulk prices and new rows pending on other rows")`
- `test("saving a row with a pending bulk price saves it and removes Sin guardar")`
- `test("a Nueva row applies its values to the draft without sending anything")`
- `test("a Nueva row with an empty stock applies zero")`
- `test("tapping another row with typed changes asks to discard them")`
- `test("the hardware back with typed changes asks to discard them")`
- `test("the selection bar hides while a row is expanded and returns with the selection intact")`
- `test("delete is replaced by the pending-edits text while the product has pending edits")`
- `test("deleting a variant removes the row and shows Variante eliminada in the pinned status line")`
- `test("deactivating keeps the typed values unsaved and Guardar variante enabled")`
- `test("a deactivate answer that lowers the stock shows the new stock in the open editor and a following save sends no stock")`
- `test("a collapsed row with pending values is announced with Sin guardar, its stock and price")`
- `test("only the expanded row renders an editor in a product with 100 variants")`
- `test("the bulk stock sheet shows the free-units hint")`
- `test("bulk Editar stock on a chip marks every active row with the value pending until Guardar")`
- `test("a variant gone on the server shows Esta variante ya no existe with Recargar producto")`
- `test("an answer that arrives after the row collapsed updates the row without reopening it or showing a message")`
- `test("typing in the expanded editor does not re-render the other rows")`
- `test("typed values survive scrolling the expanded row out of the window and back")`

`presentation/product-management-screen.test.tsx`
- `test("the saved alert adds the restock sentence when the save served waiting orders")`
- `test("an inline action's answer does not discard the product page's pending edits")`
- `test("adopting an answer into a session without pending edits keeps draft and baseline the same object")`
- `test("a product save answered with an unreadable body is in doubt and keeps Guardar disabled until reload")`
- `test("the stock field of a product without options shows the free-units hint")`

`infrastructure/product-api.test.ts`
- `test("sends stock in the variant patch and reads the restock of the answer")`
- `test("reads the restock of a product save answer")`
- `test("treats a variant answer without restock as an invalid response")`

### Pending manual checks

- On an Android and an iOS device: expand a row, the keyboard keeps the focused field visible; hardware back and swipe back ask to discard; TalkBack/VoiceOver read «Editar L / Azul», the marks and «Variante guardada.» once.
- With a paid order «Esperando stock», raise the variant from the phone and see the sentence; the order detail leaves «Esperando stock».
- The founder's flow from 3.1 on a build of the integration branch against core of the same branch: «Variante guardada.» and the new stock stored.

## 15. Limits and checks during implementation

- Out of scope: stock history, concurrency protection, web stock hint and web variant-detail stock, restock sentence after an in-doubt save (product draft · Out of this version).
- Verify the module graph: `product-editing.ts` → `src/composition/product-stock-publisher.ts` → `orders/composition.ts` must not form an evaluation cycle with `products/index.ts`; if it does, resolve the publisher lazily (as `event-handlers.ts` does) rather than moving code between features.
- The statement counts of section 2 (≈ 22 / 29 / 39 for the `PATCH`, + 1 / 8 / 18 for the product save over today's save of the same input) are estimates from the current listener; the tests assert that each count is constant in variants and in orders served, and the implementer records the measured numbers in the test and the PR. A count that grows with variants or orders is a defect.
- Keep the stock lock last in the product save (5.3).
- `restore-cancelled-order-stock.ts` keeps its own `restoreProductStock` increment (an order return, not a seller write); only its publisher type follows `ServeOutcome` changes.
- The branch `origin/edit-variant-stock` with `4aa10dec` must not be merged; its loose `prisma.productStock.update` contradicts F3. The founder needs a mobile build of the integration branch to stop seeing the generic text.
- `uncertainCodes` on mobile treats `SERVICE_UNAVAILABLE` as in doubt; a lock timeout of the save answers 503 and is shown as in doubt although nothing was saved. Accepted (section 17): reload resolves it.
- No client may resend an in-doubt save (section 11). A new client or flow that saves stock must keep that guard; core does not deduplicate.

## 16. Implementation plan

### Order and parallelism

```text
Wave 0:  T0 contract and zero restock (shared, core presenters, mobile adapter)
Wave 1:  T1 core stock operation + product save restock      ║  M1 mobile session adoption + product-save restock + hints
Wave 2:  T2 core per-variant stock save  ║  T3 web restock sentence  ║  M2 mobile inline editor for saved rows + removals
Wave 3:  M3 mobile inline editor for «Nueva» rows + draft-variant removal
Final:   end-to-end verification on devices
```

| Task | Depends on | Files it owns (no other task of its wave edits them) |
| --- | --- | --- |
| T0 | — | `shared/contracts/products.ts`, `apps/core/src/features/products/presentation/product-presenter.ts`, `…/presentation/api-routes.ts`, `…/presentation/variant-api-routes.ts`, `…/presentation/variant-detail-model.ts`, `apps/mobile/src/features/products/infrastructure/product-api.ts`, `apps/mobile/src/features/products/domain/product.ts` (`Restock`, `SavedProduct.restock`), `apps/mobile/src/features/products/application/variant-operations.ts` (variant update result with `restock`) (+ tests) |
| T1 | T0 | `products/domain/stock-level.ts`, `domain/validation.ts`, `domain/product-structure.ts`, `application/set-variant-stock.ts`, `application/save-product.ts`, `infrastructure/stock-repository.ts`, `infrastructure/repository.ts`, `product-editing.ts`, `presentation/api-routes.ts`, `orders/application/deduct-due-stock.ts`, `orders/composition.ts` (log field), `products/application/restore-cancelled-order-stock.ts` (publisher type), `src/composition/event-handlers.ts` (restore wiring follows the publisher type), `src/composition/product-stock-publisher.ts` (+ tests). Not `products/infrastructure/order-stock.ts`, which stays unchanged |
| M1 | T0 | `apps/mobile/src/features/products/application/product-operations.ts`, `presentation/product-editor-state.tsx`, `presentation/product-management-screen.tsx`, `presentation/product-form-state.ts` (`INVALID_RESPONSE` uncertain), `presentation/product-form.tsx`, `presentation/create-product-screen.tsx`, `presentation/restock-sentence.ts`, `presentation/translations.ts`, `shared/product-variants.ts` (+ tests) |
| T2 | T1 | `products/application/update-variant.ts`, `application/variant-action.ts`, `product-variant-actions.ts`, `presentation/variant-api-routes.ts`, `presentation/variant-detail-model.ts`, `application/change-variant-status.ts`, `application/delete-variant.ts`, `application/change-variant-combination.ts` (callers of `runVariantAction`), `app/routes/product-variant.tsx`, `app/routes/product-variant.test.ts` (+ tests) |
| T3 | T1 | `apps/core/app/routes/product-detail.tsx`, `apps/core/src/features/products/presentation/product-form.tsx`, `apps/core/app/locales.ts`, `tests/e2e/products-edit.spec.ts` (+ tests) |
| M2 | T0, M1 | `apps/mobile/src/features/products/presentation/variants-screen.tsx`, `variant-row-editor.tsx`, `variant-row-issues.ts`, `variant-editor-translations.ts`, `product-routes.ts`, `application/variant-operations.ts`, `infrastructure/product-api.ts` (removal of `changeCombination`), deleted detail files and route (+ tests) |
| M3 | M2 | `variants-screen.tsx`, `variant-row-editor.tsx`, `variant-editor-translations.ts`, deleted draft-variant screen and routes (+ tests) |

### T0. Contract: stock in the variant patch and restock in both answers

**Scope:** `updateVariantRequestSchema` gains `stock`; `restockSchema`, `updateVariantResponseSchema`, `saveProductResponseSchema` with `restock` (section 8). Core answers `restock: { units: 0, orders: 0 }` from the product save and the variant `PATCH` (presenter level). Until T2 lands, the `PATCH` route answers a sent `stock` exactly as today (`400 INVALID_INPUT`, `{ field: "stock", reason: "UNKNOWN_FIELD" }`), so the integration branch never accepts a stock it does not write; T2 removes that check. For the same reason T0 makes the web variant action (`src/features/products/presentation/variant-detail-model.ts`) parse `webUpdateVariantRequestSchema = updateVariantRequestSchema.omit({ stock: true })`, a web-only schema kept in that file (guide 5.2), so a web form with `stock` keeps being refused as an unknown field; T2 owns the file afterwards. The mobile adapter accepts `stock` in the patch body and parses the new answers into `{ product, restock }`, exposing `restock` on `SavedProduct` and on the variant update result (callers ignore it until M1 and M2).
**Out of scope:** writing stock in the `PATCH`, computing a real restock, any screen.
**Acceptance criteria:**
1. `PUT /api/products/:id` with a stock change answers 200 with `restock: { units: 0, orders: 0 }` and stores the stock (PR #395 behavior kept).
2. `PATCH …/variants/:id` with `{ salePrice: 45 }` answers 200 with `{ product, restock: { units: 0, orders: 0 } }`.
3. The mobile adapter refuses a variant answer without `restock` as `INVALID_RESPONSE`.
4. The web variant detail form posted with an extra `stock` field is refused as an unknown field and writes nothing.
**Tests:** product-api tests "reads the restock of a product save answer", "treats a variant answer without restock as an invalid response"; existing route integration tests updated for `restock`.
**Depends on:** nothing.

### T1. Core: one stock operation, and the product save as a restock

**Scope:** `parseStockCount`/`checkProductStockTotal` (6); `setVariantStock` with `lockStock`/`writeStock` (5.1, 7); plan `stockCounts` and remove the saved-variant stock write from `applyStructureChange` (5.3); `saveProduct` calls it and answers `restock`; `ServeOutcome.servedUnits` (5.4); `src/composition/product-stock-publisher.ts` (9); `product_saved` fields and `product_stock_write_failed` (13); `api-routes.ts` sends the real `restock`.
**Out of scope:** the per-variant `PATCH` (T2), web text (T3), mobile.
**Acceptance criteria:**
1. «L / Azul» at 0 with paid orders #1010 (2, older) and #1012 (3) waiting: a product save setting it to 4 deducts #1010, leaves #1012 waiting, stores 2 and answers `restock: { units: 2, orders: 1 }`.
2. Order #1030 waits with 1 «L / Azul» and 1 «M / Azul»; a product save raising both from 0 to 1 deducts #1030 and answers `{ units: 2, orders: 1 }`.
3. A product save lowering «L / Azul» from 10 to 4 with #1020 deducted keeps #1020 deducted and answers `{ units: 0, orders: 0 }`.
4. A product save creating a variant with stock 3 publishes no `product_stock_increased`.
5. `grep` finds no `UPDATE "ProductStock"` for seller writes outside `stock-repository.ts`.
6. A product save that changes only «L / Azul»'s stock stamps the product's `updatedAt` and keeps its `structureVersion`.
**Tests:** stock-level, set-variant-stock, save-product, product-structure, deduct-due-stock and product-stock-publisher unit titles; save-product integration titles; `orders/stock-deduction.integration.test.ts` title.
**Depends on:** T0.

### T2. Core: the per-variant save accepts stock

**Scope:** `stock` in `UpdateVariantInput`, validation with the domain parser and total check, write through `setVariantStock`, `fields` and `restock` in `UpdateVariantDone`; `runVariantAction` returns `{ productId, done }`; the route drops T0's temporary refusal of `stock`, passes it to the use case and answers `{ product, restock }`; `product_variant_updated` fields; `app/routes/product-variant.tsx` follows the new `{ productId, done }` result of the actions and keeps refusing `stock` through `webUpdateVariantRequestSchema` (the web variant detail never writes stock, F-scope of the product draft).
**Out of scope:** product save, mobile, any visible change on the web variant detail.
**Acceptance criteria:**
1. `PATCH` `{ stock: 7 }` on «L / Azul» at 10 answers 200, stores 7, `restock: { units: 0, orders: 0 }`, `structureVersion` unchanged.
2. «L / Azul» at 0 with #1010 (2) and #1012 (3) waiting: `PATCH { stock: 7 }` deducts both, stores 2, answers `{ units: 5, orders: 2 }`.
3. `PATCH { stock: 2.5 }` answers 422 with `{ field: "stock", reason: "INVALID_STOCK" }`; `{ stock: 9007199254740992 }` answers it with `maximum`; nothing written.
4. `PATCH { salePrice: 45 }` while a shipment moved stock 10 → 9 leaves 9.
5. A variant id of another company answers 404 and no order of any company is deducted.
6. The founder's request from 3.1 (`{ sku: null, salePrice: 40, purchasePrice: null, stock: 7 }`) answers 200 and stores 7.
7. «L / Azul» at 0, #1010 (2) and #1012 (3) waiting and #1014 (4) newer: `PATCH { stock: 7 }` stores 2; the same request again stores 3 and serves #1014 (the behavior section 11 states; clients never resend).
8. Statement counts are constant on 2 and 100 variants and on 1 and 30 orders served (section 2 numbers recorded in the test).
9. The web variant detail action with a crafted `stock` field answers the unknown-field rejection and changes no stock.
**Tests:** update-variant unit titles; variant-api-routes integration titles (statement counts, lock timeout, repeated request); web variant action titles.
**Depends on:** T1.

### T3. Web: restock sentence after the product save

**Scope:** the success-path guarantee of the web product form: after every successful save the form remounts from the loader (existing key, now also moved by stock-only saves through T1's `updatedAt` stamp) and shows the stored counts, not dirty; the in-doubt guard of the web product form: after an in-doubt save (`errors.inDoubt`, from the server action's catch or the client action's lost answer) **Guardar cambios** stays disabled until **Recargar** remounts the form with the stored product, so the same intent is never sent twice (section 11); the product-detail action adds `restockedUnits`/`restockedOrders` to the redirect when `orders > 0`; the loader reads them; the alert appends the sentence (es, pt-BR) after `products.saved` and before or after `catalogEmptied` as the product draft orders them (after «Producto guardado correctamente.»).
**Out of scope:** web variant detail, web stock hint.
**Acceptance criteria:**
1. Raising «L / Azul» from 0 to 4 in the variants table with #1010 (2) waiting and saving shows «Producto guardado correctamente. Se descontaron 2 unidades para 1 pedido que esperaba stock.», and the «L / Azul» stock field then shows 2 with the form not dirty; renaming the product and saving again sends no stock and serves nothing more.
2. A save that serves nothing shows only «Producto guardado correctamente.».
3. A save whose answer is lost shows the in-doubt notice with **Recargar** and a disabled **Guardar cambios**; after **Recargar** the form shows the stored stock and the button is enabled again.
**Tests:** product-detail route titles (including the stored-count and rename-after-save titles); product-form in-doubt titles; E2E title.
**Depends on:** T1.

### M1. Mobile: keep pending edits on publish, restock after the product save, stock hints

**Scope:** `adoptAnsweredVariants`, `removeSavedVariant`, `hasPendingValues` in `shared/product-variants.ts` with the adoption rule of 10.2 for every saved row; `adoptAnswer`/`adoptDeletion` in the editor context; `INVALID_RESPONSE` as uncertain in `product-form-state.ts`; the product screen's publish effect no longer resets a dirty session; «Cambios guardados» appends `restockSentence`; hint on the stock field of a product without options (full when saved, short while creating).
**Out of scope:** the «Variantes» screen and inline editor (M2, M3).
**Acceptance criteria:**
1. With a pending rename on the product page, publishing a variant answer keeps the rename and the draft's pending bulk prices.
2. Saving a product whose stock increase served #1010 shows «Cambios guardados» with «Se descontaron 2 unidades para 1 pedido que esperaba stock.».
3. A saved product without options shows «Unidades libres para vender. No cuentes las de pedidos pagados que aún no entregas ni envías.» under **Stock**; creating one shows «Unidades libres para vender.».
4. A product save whose `200` answer fails the schema shows the in-doubt notice and keeps **Guardar** disabled until **Recargar**.
5. Draft with «L / Azul» acted, «M / Azul» stored 5 with no pending value and «S / Azul» with a pending bulk stock 6 over stored 3; adopting an answer where «M / Azul» is 4 and «S / Azul» is 2 leaves «M / Azul» at 4 with original 4 (not pending) and «S / Azul» at 6 with original 2 (pending, sent by **Guardar**); setting «M / Azul» back to 5 afterwards makes the product save send 5.
**Tests:** shared/product-variants titles (all twelve); restock-sentence titles; product-management-screen titles.
**Depends on:** T0.

### M2. Mobile: inline editor for saved rows, full issue mapping, removal of the detail screen

**Scope:** `variant-row-editor.tsx` (saved form), `variant-row-issues.ts`, expansion, marks, accessibility, selection bar, pinned status line and back guard in `variants-screen.tsx`; bulk stock hint; `updateVariant` with `stock` and `restock`; activate, deactivate, delete, print and reload inline; delete of `variant-detail-screen.tsx` (+ test), `variant-detail-translations.ts`, `change-combination-sheet.tsx`, the `[variantId]` route, `variantPath`, mobile `changeCombination`. Texts of the product draft in es and pt-BR.
**Out of scope:** «Nueva» rows (M3; they keep opening the draft-variant screen until then), core.
**Acceptance criteria:** product draft criteria 1, 3, 4, 7–11, 13–21, 25–30, 33–35, 37, 38 against a fake API (criterion 29's mobile half: the answer's «M / Azul» 4 is shown on its row after saving «L / Azul»); in particular:
1. «L / Azul» at 10 → stock 7 → **Guardar variante** sends `{ stock: 7 }` only and shows «Variante guardada.» and «7 en stock».
2. A server answer `400 { issues: [{ field: "stock", reason: "UNKNOWN_FIELD" }] }` shows «Esta versión de Yoyos envió un dato que ya no se acepta (stock)…», never «No se pudo guardar la variante. Revisa los datos…».
3. No file under `apps/mobile/src` contains `variantSaveError`, `ChangeCombinationSheet`, `variants/[variantId]` or «Cambiar combinación».
4. Product draft criterion 24 (bulk **Editar stock** on a chip, saved with **Guardar**) keeps passing; criterion 22's web half (the web variant detail still offers **Cambiar combinación**) is covered by the existing web variant-detail tests, which stay green.
**Tests:** variant-row-issues titles; variants-screen titles for saved rows (including variant gone, late answer, other row updated by a restock, untouched fields following an adopted answer, re-render and scroll titles); product-api "sends stock in the variant patch and reads the restock of the answer".
**Depends on:** T0, M1.

### M3. Mobile: inline editor for «Nueva» rows, removal of the draft-variant screens

**Scope:** «Nueva» form in `variant-row-editor.tsx` (**Aplicar**, **Cancelar**, **Quitar**, short or full hint, «El QR se crea al guardar el producto.»), row-error clearing on **Aplicar**; delete `draft-variant-screen.tsx`, both `draft-variant` routes and `"draft-variant"` in `product-routes.ts`.
**Out of scope:** saved rows, core.
**Acceptance criteria:** product draft criteria 12, 23 and 36 (creation hint); «XL / Azul» stock 3 → **Aplicar** collapses with «3 en stock» and «Nueva», nothing sent; «2.5» shows «Ingresa un número entero no negativo.».
**Tests:** variants-screen titles for «Nueva» rows.
**Depends on:** M2.

### Final verification

On the integration branch with core and a device build of the same commit: product draft acceptance criteria 1–6, 26, 29, 31, 32 end to end (waiting orders created through payments), the founder's flow from 3.1, and the manual checks of section 14. Results and screenshots go in the pull request description.

## 17. Questions decided by the review gate

| Question | Answer | Decided by | Reason | Discarded |
| --- | --- | --- | --- | --- |
| Does the initial stock of a variant created by a product save go through `setVariantStock`? | No: it stays in the variant insert. The stock-history task must hook variant creation too (section 2 · Deferred). | Both architecture reviewers (design and performance), round 1 | A new variant has no previous count and no waiting orders, so it is not a restock; locking a row inserted in the same transaction is a round trip with nothing to protect; F3 only requires that the API not change, which holds | Routing it through `setVariantStock`: one more lock per save with new variants for no protection |
| A save refused by a lock timeout on the stock row answers 503, shown on mobile as in doubt although nothing was saved. Keep it? | Keep. | Both architecture reviewers, round 1 | Core's 503 after a rollback cannot be told from a gateway 503 after a commit without a new contract distinction; payments hold stock rows for milliseconds; **Recargar variante** resolves it with one `GET` | A definitive `PERSISTENCE_UNAVAILABLE` text: a public contract distinction and two more texts for a rare case |
| A repeated request after an applied save raises the stored count again (it is net of the units served) and serves again. How is stock protected from one intent applied twice? (gate blocker B1) | Clients never resend an in-doubt save. Web is guarded like mobile: after an in-doubt product save the web form disables **Guardar cambios** until **Recargar**; mobile's product save and inline editor keep their existing guards. Core treats a repeated request as a new increase, and an integration test pins it (section 11, T2, T3). Completed in round 2 for the success path and unreadable answers: every successful save leaves every client showing the stored counts (a stock-only product save stamps `updatedAt`, so the web form remounts), and the mobile product save treats `INVALID_RESPONSE` as in doubt. | Coordinator, round 1, on the design reviewer's blocker; success path and `INVALID_RESPONSE` added after the design reviewer's round 2 blocker and suggestion | The same intent can only be repeated by a client that resends without reloading; mobile already cannot; closing the web path removes the only remaining one without a new mechanism | An idempotency key or an optimistic version on stock: the concurrency protection F4 excludes. Recording it as an accepted gap: it would let a lost answer on web overstate stock and oversell |

Decided unless objected (accepted without objection by the review gate, rounds 1 to 4, with the clarifications applied):
- The per-variant save is the existing `PATCH /api/products/:productId/variants/:variantId` with an optional `stock`; the product `PUT` keeps PR #395's shape.
- `setVariantStock` is an application operation inside the caller's transaction (not its own route or transaction); stock history attaches to it as a dependency.
- `ServeOutcome` gains `servedUnits`; `Restock = { units, orders }` lives in products and is mapped in `src/composition/product-stock-publisher.ts`.
- Both answers always carry `restock`; `{ 0, 0 }` means nothing served.
- Stock above `Number.MAX_SAFE_INTEGER` answers `INVALID_STOCK` with `maximum`; the per-variant `PATCH` names the field `stock`, the product save keeps `initialStock`.
- Stock rows are locked `FOR UPDATE` in `variantId` order before the write, with the explicit tenant predicate; increases are computed against the locked count. It is a short in-transaction lock, not the protection F4 excludes.
- The product write transaction keeps its current timeouts (10 s / 3 s / 8 s); the listener's savepoint restores them after serving.
- `product_variant_updated` and `product_saved` gain restock counts; new `product_stock_write_failed` only for stored-data and row-count faults (lock and transaction failures keep their single existing log).
- The web variant action refuses `stock` with its own schema; the web product form disables **Guardar cambios** after an in-doubt save until reload.
- Mobile removes `changeCombination` from its API; core keeps `PUT …/combination` for installed apps.
- The editor context adopts each inline answer into both draft and baseline instead of resetting the session: the acted row by its action, every other saved row field by field (stored values where nothing is pending, pending values kept against the answered `original`); the delete answer refreshes the remaining rows; the open editor keeps only touched fields; **Recargar variante** changes only its row.
- Web carries the restock to the alert through redirect query parameters, like `catalogEmptied`; reloading that URL shows the sentence again (accepted).
- A product save with any sent saved-variant stock stamps `updatedAt` (never `structureVersion`), even when the sent count equals the stored one, so the web form remounts with the stored counts after every successful save.
- The mobile product save treats `INVALID_RESPONSE` as in doubt.
- `lockStock` is its own statement in `stock-repository.ts`; orders' `lockVariantStock` is unchanged.
- The branch `origin/edit-variant-stock` (`4aa10dec`) is not merged.
- F3 is read as allowing the optional `stock` in the per-variant `PATCH`: both transports funnel into `setVariantStock`, the `PUT` keeps PR #395's shape, and the API does not change when stock history arrives; the pull request states this reading in one line for the founder. Discarded: saving a row through the product `PUT` with only that row's change on the loaded baseline, which resends the whole product from a possibly stale baseline, fails with `PRODUCT_CHANGED` for unrelated structure changes and costs the full product-save statement count.

Deferred items with real risk, for the founder to ask for their Todoist tasks if wanted (none is created otherwise): stock history attached to `setVariantStock` and to variant creation; answering only the changed variant when the full-detail payload becomes a measured problem on low-end phones (10.4); concurrency protection on stock if sellers report overwritten counts (product draft trigger).
