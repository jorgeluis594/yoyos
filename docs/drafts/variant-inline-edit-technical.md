# Variant inline editing on mobile: technical design

**Status:** definition ready for founder review. Based on [variant-inline-edit.md](variant-inline-edit.md). Base: `jorgeluis594/movil-editar-la-variante-dentro-de-la-li` at `014508e5` (main at `b17e27a4`, PR #395 merged).

## 1. Technical goal

The shared contract lets the per-variant `PATCH` carry `stock`. Core writes every seller stock change through one use case, `setVariantStock`, called by the product save (replacing its loose SQL) and by the per-variant update, inside the caller's transaction. Mobile replaces the variant detail, both draft-variant screens and the change-combination sheet with one inline editor per row in «Variantes», and maps every server issue to its field or a named text.

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Founder decisions (Jorge, 2026-11-06) | F1 one inline editor replaces the saved-variant detail and both draft-variant screens; saved rows persist from the row, «Nueva» rows write into the draft. F2 stock is a direct value with today's `QuantityStepper` and whole-number rule. F3 build on PR #395; the stock write lives in one use case, never loose SQL. F4 last save wins, no version, no lock. F5 explicit save per row. F6 reported failure reproduced (3.1). F7 correct `docs/products.md`. F8 no restock: a manual increase publishes no event and deducts no waiting order in the same step; the existing `recover-due-stock-deductions` job (every minute) still deducts a covered waiting order, which shows «Descontando stock» meanwhile, and a newer paid sale can take the units first, as with PR #395's product save (Todoist 6hwgCJh37mMQ3fRV). Review round (2026-11-06): rare edge cases stay undefined (product deleted elsewhere, session expiry, pending edits on reload, the acted row's own pending bulk values on a status change); in doubt keeps «save again, repeating is harmless», no **Recargar variante**; the purchase price is «Precio de compra» / «Preço de compra». |
| Transport | `PATCH /api/products/:productId/variants/:variantId` gains an optional `stock`. The product `PUT` keeps PR #395's shape. Both answers are unchanged. Reason: the inline save must not resend other pending edits nor depend on `structureVersion`. |
| One stock write | `setVariantStock` in `products/application/set-variant-stock.ts` writes the count of existing variants. Used by `saveProduct` and `updateVariant`. Initial stock of a new variant stays in the variant insert. Order deductions and cancellation restores keep their paths. |
| Validation | Same rule as the product save: whole number ≥ 0 within the safe range (`INVALID_STOCK`), product total within it (`INVALID_TOTAL_STOCK`). The `PATCH` reports the field as `stock`. |
| Web | The web variant action does not accept `stock`: it parses `updateVariantRequestSchema.omit({ stock: true })`. Web variant detail keeps read-only stock. No other web change. |
| Mobile session | An inline answer updates only the acted row (values and `original`) in draft and baseline; other pending edits stay. The product screen replaces only `product` when a variant answer is published, keeping `values` and the editor draft. |
| Mobile issues | One pure mapper, every field and reason to a text; no generic fallback for known fields. Maps `INVALID_PRECISION` (core never sends `TOO_MANY_DECIMALS`). |
| Docs on merge | The product draft's list (Closed decisions). `docs/orders.md`: «When it is attempted» (:84), «Restock» (:88), «Stock source» (:92), Known limitations (:120). `docs/products.md`: Stock row (:33), Statuses (:63-64), Product page, Variants table, Bulk editing (:77), Marks (:78), Variant detail and Unsaved variant detail (mobile halves), Discard confirmation, API (`PATCH` with stock; the **Recargar variante** line :275 is web only). |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Product save with stock | `apps/core/src/features/products/application/save-product.ts`, `domain/product-structure.ts` | PR #395: `variants[].stock` optional, planned as `variantFieldChanges[].stock` only when sent and different; does not raise `structureVersion`. |
| Stock write of the product save | `infrastructure/repository.ts:301-305` (`applyStructureChange`) | Loose `UPDATE "ProductStock"` in variant order with the tenant predicate. Publishes nothing. |
| Per-variant update | `application/update-variant.ts`, `application/variant-action.ts`, `presentation/variant-api-routes.ts:46` | `sku`, `salePrice`, `purchasePrice` only. Product row `FOR UPDATE`, aggregate load, `planVariantPatch`, one `UPDATE`. Answers the detail. |
| Contract | `shared/contracts/products.ts:55-59` | `updateVariantRequestSchema` is strict without `stock`; an unknown key answers `400 INVALID_INPUT` `{ field: "stock", reason: "UNKNOWN_FIELD" }` (`presentation/api-errors.ts:12-16`). |
| Stock rules | `domain/validation.ts:62-70, 96-105` | `INVALID_STOCK` and `INVALID_TOTAL_STOCK` inside Zod schemas of create and save. |
| Web variant action | `presentation/variant-detail-model.ts:52` | Parses `updateVariantRequestSchema`; would accept `stock` once the contract has it. |
| Mobile saved-variant detail | `apps/mobile/src/features/products/presentation/variant-detail-screen.tsx`, route `src/app/products/[productId]/variants/[variantId].tsx`, `change-combination-sheet.tsx` | Stock read-only; the change-combination sheet (`changeCombination` in `application/variant-operations.ts`, `infrastructure/product-api.ts`) is used only here. Issue mapping only for `sku`, `salePrice`, `purchasePrice` (:169-176); anything else → `variantSaveError` (:177). Checks `TOO_MANY_DECIMALS`, which core never sends. |
| Mobile draft-variant screen | `presentation/draft-variant-screen.tsx`, routes `src/app/products/[productId]/draft-variant.tsx`, `src/app/products/new/draft-variant.tsx` | Field state (:37), whole-number check (:47), `QuantityStepper` (:77-80), `setRow` into the draft. |
| Mobile session reset | `presentation/product-management-screen.tsx:81-88` | A published variant answer calls `editor.reset`, which drops pending product edits. |
| Unmerged commit | `4aa10dec` on `origin/edit-variant-stock` | Adds `stock` to the `PATCH` contract and a loose `prisma.productStock.update`. Not merged; this design replaces it. |

### 3.1 Reported failure

**What the founder saw.** Saving a changed stock of a saved variant on mobile showed «No se pudo guardar la variante. Revisa los datos e inténtalo otra vez.» (`variantSaveError`).

**Where it comes from.** That text is set only at `variant-detail-screen.tsx:177`, when a save answers `VALIDATION_ERROR` or `INVALID_INPUT` and no issue has `field` in `sku`, `salePrice`, `purchasePrice`. The screen on `main` has no stock input, so stock can only reach that branch from a build of the unmerged commit `4aa10dec`, whose detail screen sends `{ sku, salePrice, purchasePrice, stock }` in the `PATCH` and maps only `initialStock` besides the three price/SKU fields.

**Reproduction (2026-11-06, this worktree's compose stack at `localhost:3002`, core = `main`):** script `~/yoyos-landing-capturas/variant-inline-edit/repro.sh`, output in `repro-output.txt` next to it.

| Request | Answer |
| --- | --- |
| `PATCH …/variants/<L/Azul>` `{"sku":null,"salePrice":40,"purchasePrice":null,"stock":7}` (what `4aa10dec` sends) | `400 {"code":"INVALID_INPUT","issues":[{"field":"stock","reason":"UNKNOWN_FIELD"}]}` |
| Same without `stock` (what `main` sends) | `200` with the detail |
| `PUT /api/products/<id>` with `variants[L/Azul].stock = 7` (PR #395 path) | `200`; `ProductStock.quantity` = 7 |

**Cause.** The mobile half was confirmed by reading `4aa10dec`, not by running it; the founder's build is inferred from the commit's timing and from being the only code path that sends stock. (1) Core refuses `stock` in the per-variant save: PR #395 put saved stock only in the product save and the `PATCH` schema is strict. (2) Mobile maps a closed list of fields and falls back to a generic text, so the refusal named no field. Also, mobile checks `TOO_MANY_DECIMALS` while core sends `INVALID_PRECISION`, so a 3-decimal price shows the price-required text. Fixed by T1 (core accepts `stock`) and T2 (mapper without generic fallback).

## 4. Gaps this design closes

1. The `PATCH` refuses `stock` (3.1) → 5.2, 8, T1.
2. The product save writes stock with loose SQL → 5.1, T1.
3. Mobile shows a generic text for unmapped issues and maps a reason core never sends → 10, T2.
4. Mobile has three intermediate screens and a combination sheet the founder removed → 10, T2, T3.
5. Publishing a variant answer resets the mobile session and drops pending edits → 10, T2.

## 5. Use cases

### 5.1 `setVariantStock` (new), products

Runs inside the caller's transaction, after the caller locked the product row and validated the counts. Opens no transaction and publishes nothing.

```ts
// products/application/set-variant-stock.ts
export type StockCount = Readonly<{ variantId: VariantId; stock: number }>; // whole number ≥ 0, validated by the caller
export type SetVariantStockDependencies = Readonly<{
  writeStock: (companyId: CompanyId, counts: readonly StockCount[]) => Promise<Result<void, ProductReadError>>;
}>;
export async function setVariantStock(input: Readonly<{ counts: readonly StockCount[] }>, access: ProductAccess, deps: SetVariantStockDependencies): Promise<Result<void, ProductReadError>>;
```

Flow: no counts → `ok()` without a statement; otherwise `writeStock` the counts sorted by `variantId` and answer its result. `writeStock` answers `PERSISTENCE_UNAVAILABLE` when the written rows differ from the counts (logged there, section 13). A future stock history attaches here as one more dependency, without changing input, routes or contracts.

### 5.2 `updateVariant` (modified), products

- `UpdateVariantInput` adds `stock?: number`; `UpdateVariantDone.fields` adds `"stock"`.
- `UpdateVariantDependencies` adds `setVariantStock` (bound by the composition with access and adapter).
- Flow inside `runVariantAction` (product row locked, aggregate loaded): find the variant (`VARIANT_NOT_FOUND`); validate prices and SKU as today and stock with the shared stock rule plus the product-total check, all issues together as `VALIDATION_ERROR` `{ scope: "variant", variantId, field: "stock", reason }`; write price/SKU changes as today; when `stock` was sent and differs from the loaded count, `setVariantStock({ counts: [{ variantId, stock }] })`. The "nothing changed" check covers price/SKU and stock together: a stock-only `PATCH` does not call `updateVariantFields` and does not return before `setVariantStock`; nothing changed at all → `ok(null)` as today. Stock does not raise `structureVersion`.

### 5.3 `saveProduct` (modified), products

`ProductStructureChange` moves stock out of `variantFieldChanges` into `stockCounts: readonly StockCount[]` (same rule as today: sent and different from the loaded count). `applyStructureChange` stops writing `ProductStock` for saved variants and still inserts the stock rows of new variants. After `applyStructureChange`, `saveProduct` calls `setVariantStock({ counts: change.stockCounts })`; its error rolls the save back. `isEmptyChange` counts `stockCounts`. Behavior is identical to today.

## 6. Domain and typing

- `parseStockCount(value: unknown): Result<number, { reason: "INVALID_STOCK" }>` and `checkProductStockTotal(product, variantId, stock)` added to the existing `products/domain/stock-level.ts` (beside `stockLevelOf`): the rule exists only inside Zod schemas and the `PATCH` needs it as a function; the create/save `initialStock` refinement calls the same parser, so both paths report the same reason.
- `ProductStructureChange.stockCounts` in `products/domain/product-structure.ts`: separates the stock write (owned by `setVariantStock`) from field writes.
- Mobile `VariantIssueText` in `presentation/variant-row-issues.ts`: `{ kind: "field"; field: "salePrice" | "purchasePrice" | "stock" | "sku"; text } | { kind: "form"; text }`.

## 7. Persistence

No schema change, no migration. `writeStock` moves the existing statement of `applyStructureChange` (`UPDATE "ProductStock" … FROM (VALUES …)`, `variantId` order, explicit `"companyId"` predicate next to RLS) to `products/infrastructure/stock-repository.ts`. Lock timeouts and transaction-ending failures are rethrown and logged once by the existing `product_save_failed` / `product_variant_action_failed`.

## 8. Contracts between applications

`shared/contracts/products.ts`:

```ts
export const updateVariantRequestSchema = z.strictObject({
  sku: z.string().nullable().optional(),
  salePrice: z.number().optional(),
  purchasePrice: z.number().nullable().optional(),
  stock: z.number().optional(), // replaces the count; whole number ≥ 0, validated by core
}).readonly();
```

| Situation | Status · code | Issue |
| --- | --- | --- |
| `stock` not a number | 400 `INVALID_INPUT` | `{ field: "stock", reason: "INVALID_TYPE" }` |
| `stock` negative, fractional or above the safe range | 422 `VALIDATION_ERROR` | `{ scope: "variant", variantId, field: "stock", reason: "INVALID_STOCK" }` |
| Product total above the safe range | 422 `VALIDATION_ERROR` | `{ …, field: "stock", reason: "INVALID_TOTAL_STOCK" }` |
| Price, SKU, unknown field, foreign variant | as today | `INVALID_PRICE`, `INVALID_PRECISION`, `TOO_LONG`, `DUPLICATE_SKU`, `UNKNOWN_FIELD`; 404 |

Success answers 200 with the product detail; responses do not change.

## 9. Web

The web variant action parses `updateVariantRequestSchema.omit({ stock: true })` (strict), so a crafted web form with `stock` answers `UNKNOWN_FIELD`. No web screen changes.

## 10. Mobile

| File | Change |
| --- | --- |
| `application/variant-operations.ts`, `infrastructure/product-api.ts` | `VariantPatch` adds `stock`; `changeCombination` removed. |
| `presentation/variant-row-editor.tsx` (new) | Expanded row. Saved form: prices, stock (`QuantityStepper`, whole-number rule from `draft-variant-screen.tsx:47`), SKU, **Guardar variante**, **Cancelar**, QR/**Imprimir etiqueta**, **Desactivar/Activar**, **Eliminar** or its reason. «Nueva» form: **Aplicar**, **Cancelar**, **Quitar**. Sends only fields that differ from the row's `original`. |
| `presentation/variant-row-issues.ts` (new) | Pure `variantIssueText(error, t)` per the product draft's refusal table: reads the issues and also the top-level code, so `409 DUPLICATE_SKU` without issues maps to the SKU field; `initialStock` treated as `stock`. No branch returns `variantSaveError`. |
| `presentation/variants-screen.tsx` | Rows expand instead of navigating; one expanded `ref`; typed values and dirty flag kept at screen level by `ref` (survive virtualization, read by the back guard); selection bar hidden while expanded; pinned «Variante eliminada.» line; memoized rows so typing does not re-render others. |
| `presentation/product-editor-state.tsx`, `shared/product-variants.ts` | `adoptVariant(draft, answered, variantId)`: the acted row's values and `original` become the answered ones in draft and baseline; other rows untouched. `removeSavedVariant(draft, variantId)` plus the answered `structureVersion` for delete. |
| `presentation/product-management-screen.tsx` | The publish effect (:81-88) replaces only `product` (for `structureVersion` and `original`); no `setValues`, no `editor.reset`, so name, description and the other `values` and the editor draft stay. |
| `presentation/variant-editor-translations.ts`, `presentation/translations.ts`, `presentation/product-routes.ts` | es and pt-BR texts of the product draft (reusing the keys it names), plus the kept texts moved from `variant-detail-translations.ts` (`itemNoLongerAvailable` and others imported by `translations.ts`); `variantPath` and `"draft-variant"` removed. |
| Deleted | `variant-detail-screen.tsx` (+ test), `variant-detail-translations.ts`, `change-combination-sheet.tsx`, `draft-variant-screen.tsx`, routes `[productId]/variants/[variantId].tsx`, `[productId]/draft-variant.tsx`, `new/draft-variant.tsx`. |

Offline: `isOnline()` false → offline text, nothing sent. In doubt (codes in `uncertainCodes`): in-doubt text, **Guardar variante** stays available because the request sets values and a repeat is harmless. Activate, deactivate and delete in doubt behave the same: «No se pudo confirmar el cambio. Inténtalo otra vez.», the button stays available; no text points to a reload button. One action at a time per editor (ref guard). A late answer after collapse is adopted into the row and never reopens it. Delete is offered only when the session has no pending product edits.

## 11. Transactions and concurrency

The `PATCH` runs in the existing product write transaction: product row `FOR UPDATE`, aggregate load, validation, price/SKU `UPDATE`, stock `UPDATE` through `setVariantStock`, commit, reload the detail. The product save keeps its order with the stock write after `applyStructureChange`. Two saves of one product serialize on the product row. A payment deducting the same variant serializes on the stock row; whoever commits last wins (F4). No version, no lock beyond the row lock the `UPDATE` takes.

## 12. Code organization

Core: products `domain/` (`stock-level.ts`, `validation.ts`, `product-structure.ts`), `application/` (`set-variant-stock.ts` new, `update-variant.ts`, `save-product.ts`), `infrastructure/` (`stock-repository.ts` new, `repository.ts`), `presentation/` (`variant-api-routes.ts`, `variant-detail-model.ts`) and composition (`product-editing.ts`, `product-variant-actions.ts`). Shared: `shared/contracts/products.ts`, `shared/product-variants.ts`. Mobile: section 10. No cross-feature capability.

## 13. Observability

| Event | Level | Fields |
| --- | --- | --- |
| `product_variant_updated`, `product_saved` (existing) | info | existing fields; `fields` may include `"stock"`; `product_saved` adds `["stockChanges"]` |
| `product_stock_write_failed` (new) | error | `["companyId","stage","errorCode","durationMs"]`, `errorCode` = `UNEXPECTED_ROW_COUNT` |

Owner: `writeStock` in `stock-repository.ts` logs `product_stock_write_failed` once when the row count differs; thrown failures are logged by the caller's existing `product_save_failed` / `product_variant_action_failed`.

Never logged: stock counts, prices, SKUs, names.

## 14. Tests

Core unit (Vitest):
- `stock-level.test.ts`: `test("parses a whole number from 0 up to the safe bound")`, `test("rejects a negative, fractional or too large stock with INVALID_STOCK")`, `test("rejects a count that takes the product total out of range with INVALID_TOTAL_STOCK")`.
- `set-variant-stock.test.ts`: `test("writes the counts in variant order")`, `test("writes nothing when no count is given")`, `test("answers the writeStock error unchanged")`.
- `update-variant.test.ts`: `test("saves a changed stock through setVariantStock")`, `test("a stock-only patch calls setVariantStock and not updateVariantFields")`, `test("does not send stock to setVariantStock when it was not sent")`, `test("reports stock, price and SKU issues together and writes nothing")`.
- `save-product.test.ts`: `test("writes saved-variant stock through setVariantStock after the structure change")`.

Core integration (real database), `variant-api-routes.integration.test.ts`: `test("PATCH with stock replaces the count and keeps the structure version")`, `test("PATCH with a fractional or negative stock answers 422 with a stock issue and writes nothing")`, `test("PATCH with stock as text answers 400 INVALID_TYPE")`, `test("PATCH with the founder's body from 3.1 answers 200 and stores the stock")`, `test("PATCH raising stock deducts no waiting order within the request")`, `test("PATCH with a variant of another company answers not found")`, `test("the web variant action refuses a form with stock as an unknown field")`, `stock-repository.integration.test.ts`: `test("answers PERSISTENCE_UNAVAILABLE and logs when the written rows differ")`. Statement-count test (≤ 20, 2 vs 100 variants): `test("PATCH with salePrice, sku and stock stays within the statement budget")`, `test("a product save changing stock on 100 variants issues one ProductStock UPDATE")`.

Mobile (Jest, RNTL):
- `variant-row-issues.test.ts`: `test("maps every stock reason to its text")`, `test("maps INVALID_PRECISION to the two-decimals text")`, `test("maps a known field with an unknown reason to the not-accepted text")`, `test("never answers the generic save text for a known field")`.
- `product-variants.test.mjs`: `test("adopting a variant answer updates only that row's values and original")`, `test("removing a saved variant keeps the other rows' pending values")`; `product-management-screen.test.tsx`: `test("a published variant answer keeps a pending product rename and the editor draft")`.
- `variants-screen.test.tsx`: `test("tapping a row expands its editor and collapses the open one")`, `test("saving a changed stock sends only the stock and shows Variante guardada")`, `test("a stock refusal shows its text under Stock")`, `test("an empty stock on a saved row is refused before sending")`, `test("an inline save keeps other rows' pending edits")`, `test("a Nueva row applies its values to the draft without sending")`, `test("tapping another row with typed changes asks to discard")`, `test("delete is replaced by the pending-edits text while the product has pending edits")`, `test("only the expanded row renders an editor with 100 variants")`.

Manual: the founder's flow from 3.1 on a device build of the integration branch; keyboard keeps the focused field visible; Android back and iOS swipe ask to discard.

## 15. Limits and checks during implementation

- `origin/edit-variant-stock` (`4aa10dec`) is not merged. `restore-cancelled-order-stock.ts` keeps its own increment; it is an order return, not a seller write. Repository memory 15f539a2 says stock editing must publish `product_stock_increased`; F8 defers that to 6hwgCJh37mMQ3fRV.

Deferred:
- Restock on a manual increase: Todoist 6hwgCJh37mMQ3fRV.
- Stock history attached to `setVariantStock` (and to variant creation).
- Concurrency protection on stock.
- Answering only the changed variant instead of the full detail.

## 16. Implementation plan

The older child branch `variant-inline-edit-t0` (commits `f9ab7445`, `81c52728`, `6debf5f4`) implemented a contract with a required `restock` field. It is discarded; every task starts from the integration branch.

```text
T1 core + contract ──► T2 mobile saved rows ──► T3 mobile «Nueva» rows
```

| Task | Depends on | Files it owns |
| --- | --- | --- |
| T1 | — | `shared/contracts/products.ts`; core `products/domain/{stock-level,validation,product-structure}.ts`, `application/{set-variant-stock,update-variant,save-product}.ts`, `infrastructure/{stock-repository,repository}.ts`, `presentation/{variant-api-routes,variant-detail-model}.ts`, `product-editing.ts`, `product-variant-actions.ts` (+ tests) |
| T2 | T1 | mobile `application/variant-operations.ts`, `infrastructure/product-api.ts`, `presentation/{variants-screen,variant-row-editor,variant-row-issues,variant-editor-translations,translations,product-editor-state,product-management-screen,product-routes}.ts(x)`, `shared/product-variants.ts`, deleted detail files and route (+ tests) |
| T3 | T2 | `variants-screen.tsx`, `variant-row-editor.tsx`, `variant-editor-translations.ts`, `product-routes.ts`, deleted draft-variant screen and routes (+ tests) |

### T1. Core and contract: stock in the per-variant save through one use case

**Scope:** 5, 6, 7, 8, 9, 13; core tests of 14.
**Out of scope:** mobile, any web screen change, restock.
**Acceptance criteria:**
1. `PATCH { stock: 7 }` on «L / Azul» at 10 answers 200, stores 7, `structureVersion` unchanged; the founder's body from 3.1 does the same.
2. `PATCH { stock: 2.5 }` answers 422 `{ field: "stock", reason: "INVALID_STOCK" }`; nothing written.
3. A product save changing stock behaves as today; `grep` finds no `UPDATE "ProductStock"` for seller writes outside `stock-repository.ts`.
4. Raising stock with a paid order «Esperando stock» deducts nothing within the request and publishes no event (recovery may deduct it afterwards, F8).
5. The web variant action with a crafted `stock` answers `UNKNOWN_FIELD`.
**Depends on:** nothing.

### T2. Mobile: inline editor for saved rows, issue mapping, removal of the detail screen

**Scope:** 10 for saved rows; delete the detail screen, its route, `variantPath`, the change-combination sheet and mobile `changeCombination`; the publish effect keeps pending edits.
**Out of scope:** «Nueva» rows (they keep opening the draft-variant screen until T3).
**Acceptance criteria:** product draft criteria 1, 2, 4–6, 8–11, 13 against a fake API; no file under `apps/mobile/src` contains `variantSaveError`, `ChangeCombinationSheet` or `variants/[variantId]`.
**Depends on:** T1.

### T3. Mobile: inline editor for «Nueva» rows, removal of the draft-variant screens

**Scope:** «Nueva» form (**Aplicar**, **Cancelar**, **Quitar**, empty stock as 0); delete `draft-variant-screen.tsx`, both routes and `"draft-variant"` in `product-routes.ts`.
**Acceptance criteria:** product draft criteria 7 and 12.
**Depends on:** T2.

### Final verification

On the integration branch with core and a device build of the same commit: product draft criteria 1–3 end to end and the founder's flow from 3.1. Results and screenshots go in the pull request.
