# Sales and best sellers in the AI assistant: technical design

**Status:** draft, round 3 after review gate rounds 1 and 2 (both rejected; section 18 lists how every finding was resolved); one open question (section 17). Based on [`docs/drafts/mcp-finances.md`](mcp-finances.md) (product definition closed at `177d3b0b`). Base: `jorgeluis594/mcp-3-4-finanzas-por-periodo-y-lo-mas-ve` at `177d3b0b`, on top of the merged MCP 1/4 and 2/4 documented in [AI assistants](../assistants.md).

## 1. Technical goal

Core adds three read-only tools to the MCP server, `resumen_de_ventas`, `lo_mas_vendido` and `productos_sin_ventas`, in one new tool module that requires both current scopes (`orders:read` and `products:read`). Each call goes through the unchanged per-call pipeline (connection, tenant context, store limit, «Último uso», input validation), resolves a period of whole Lima days, reads aggregates over orders, items, payments, variants and stock in one budgeted RepeatableRead snapshot (4 or 5 statements, every one bounded by the windows read or by the catalog, section 7.1), and returns a strict Spanish projection within 24 KB. No scope literal is added, no connection ends, nothing is written and no contract in `shared/` changes.

```text
agent ── tools/call ──▶ /mcp (unchanged transport, auth, limiter)
                         │
                         ▼
              sales ToolModule (scopes: orders:read + products:read)
                 │  period (assistants/domain/sales-period.ts, pure)
                 ▼
   src/composition/assistant-sales-capabilities.ts
     sales read slot (2 per process) ─▶ orders.readSalesForAssistant (budgeted snapshot)
        ├─ catalogStorefront.describe            (store currency)
        ├─ orders.summarizeSales                 (Order + Payment, one statement)
        ├─ orders.summarizeSoldVariants          (Order + OrderItem)
        ├─ orders.findVariantSaleDates           (OrderItem.orderCreatedAt index, per checked variant)
        ├─ products.describeVariantsForAssistant (Product + ProductVariant + values)
        └─ products.listStockedForAssistant      (Product + ProductVariant + ProductStock, one statement)
                 │
                 ▼
     pure projections in assistants/domain ─▶ strict output schema ─▶ ≤ 24 KB JSON
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Tool module scopes | `ToolModule.scope` becomes `scopes: readonly [AssistantScope, ...AssistantScope[]]`. The registry offers a module's tools and paragraph only when the connection holds every scope of the module. Orders and products modules declare one scope each; the sales module declares both. No scope literal is added and `assistantScopes` is unchanged. |
| Module | One module, `features/assistants/presentation/tools/sales-tools.ts`, with its own paragraph of server instructions, reading-failure text «No pudimos leer tus ventas en este momento. Inténtalo de nuevo en unos segundos.» and the too-many-orders text. |
| Who owns each read | The orders feature owns every read that decides what a sale is (not cancelled, visible, created in the period): `summarizeSales`, `summarizeSoldVariants`, `findVariantSaleDates`, and the snapshot opener `readSalesForAssistant`. The products feature owns product identity, current names, combinations, the text match and stock: `describeVariantsForAssistant`, `listStockedForAssistant`. Orders returns variant ids; products never reads orders; the composition joins them in memory. |
| Snapshot | One RepeatableRead snapshot per call opened by `orders.readSalesForAssistant`, with its own fixed budget `salesReadBudget = { maxWait: 1000, timeout: 10000, statementTimeoutMs: 1500, maxStatements: 6 }` and JIT off. The budget is the same for every tool and is fixed here, not discovered in T1/T2 (section 11 counts the statements of every path: 4, 5 and 4, at least one statement of margin). The generic budgeted snapshot is extracted from `products/infrastructure/assistant-read.ts` to `src/shared/infrastructure/budgeted-snapshot.ts`; it classifies failures and reports them to an `onFailure` callback, and each caller logs its own event (products keeps `product_search_failed` and its own constants; sales logs in the composition guard). |
| Statement counting | As memory 03011cbe: a counted statement is one that runs under the statement timeout, so the two `set_config` statements (tenant and timeout, `jit` off) and the storefront read count; `BEGIN`, `SET TRANSACTION` and `COMMIT` do not. Overhead is 2 statements, 3 with the storefront read. |
| In-flight limit | At most 2 sales reads in flight per process, separate from the 3 product slots (decided by the review gate, section 17). A call waits up to 2,000 ms for a sales slot; the wait runs before any transaction, holds no pool connection and costs nothing in pool terms, so an agent that asks for the summary and the ranking in parallel, plus a third call, still gets all three answers at normal volume. Product slots keep their 300 ms. The counting semaphore moves from `assistant-product-capabilities.ts` to `src/composition/assistant-read-slots.ts` with the wait as a parameter. The slots are shared by every store in the process (section 11). |
| Too many orders | The «demasiados pedidos» text is answered when the snapshot fails with `STATEMENT_TIMEOUT` in a statement whose cost grows with the period, and the period read has more than 31 days. Every read of the call is tagged `period` (summary figures, sold variants) or `catalog` (storefront, descriptions, stocked products, item dates); the guard remembers the step in progress. A failure in a `catalog` step, `TRANSACTION_TIMEOUT` (pool wait or Prisma timer), `PERSISTENCE_UNAVAILABLE`, a 31-day-or-shorter period over budget and a busy slot answer the sales reading-failure text, because a shorter period would fail the same way. Reason: the budget makes the statement limit fire before the transaction timer, so only a statement timeout in a period-bound step means the period itself is too heavy. `productos_sin_ventas` has no period-bound step, so it never answers the too-many text. |
| Maximum period | 366 days, constant `salesPeriodMaxDays` (initial value). Acceptance is by cost, not by plan shape (section 15): on the history fixture each statement at the maximum period, in the worst shape of its tool, stays within half its statement budget (750 ms), and the statements that exist for short periods are not slower on four years of history than on one. The value is lowered only if a period-bound statement fails that. |
| Expected maximum volume | 60,000 orders a year (about 165 per day), 2 items and 1.2 payments per order, 3,000 products with 4 variants. The load fixture (T0) seeds the store with four years at that rate (240,000 orders, 480,000 items, 290,000 payments), so both windows of a 366-day period are populated and two years of history precede them, plus the same volume spread over 20 other companies in the same tables, and runs `ANALYZE` after seeding. It includes the worst shapes: a case-2 period of 13 touched months (01/01/2027–01/01/2028, previous 01/12/2025–01/12/2026), and the worst unsold page, a store whose first 20 products by stock (80 variants, and one of 60 variants) are all stale with 3,000 old items per variant. Initial value, adjustable; above any current store and above the 50,000 orders `summarizeUnpaidOrders` was measured with. |
| Index | `Order_companyId_createdAt_idx` on `"Order"("companyId", "createdAt")`, created concurrently. Reason: without it a short period read scans the store's whole order history, so a month costs the same as five years. It also serves the existing created-date filter and newest-first sort of **Buscar pedidos**. At long periods PostgreSQL rightly prefers a sequential scan and hash join over half the table (section 15); the index is for the short windows that are the common case. Bounds compared with `createdAt` are untyped or `::timestamp` parameters, never `::timestamptz`: the `timestamp`–`timestamptz` operators are not leakproof and under the forced RLS policy would lose the index (memory e9e3a88e; `findOrders` already does it right, line 55 of `order-repository.ts` does not). |
| Item date | New column `"OrderItem"."orderCreatedAt"` (`timestamp(3)`, not null, immutable): a copy of the order's `createdAt` (which never changes; confirming a catalog order does not touch it), written by every path that inserts an item (the order `create` and the `createMany` of items added by an edit; T0 searches for every other write), backfilled in the migration, with index `(companyId, variantId, orderCreatedAt)`. Reason: it gives the exact last sale before and first sale after a period of every variant with a backward `LIMIT 1` probe that costs the catalog, not the history (measured by the performance reviewer: 12,080 variants in about 230 ms at any depth), so **Productos sin ventas** meets its product order rule exactly. The existing `(companyId, variantId)` index becomes a prefix of the new one; dropping it is left for later. |
| Period rules | Pure functions in `features/assistants/domain/sales-period.ts` over calendar days `AAAA-MM-DD`: defaults, cut to today, refusals, length, previous period (three cases). Day bounds become instants with `limaMidnightUtc` and `nextCalendarDay` of `shared/orders-date.ts` (`salesTimeZone`), the same helpers as **Buscar pedidos**. |
| Money | Sums are computed in SQL as `numeric`; amounts that feed cents arithmetic are returned as integer-cent text, `round(sum(x) * 100)::bigint::text`, exact on `numeric(15,2)`, validated with Zod (`^-?\d+$`, safe integer) and converted to `Money` as `cents / 100`; no `decimal.js` (declared only in `shared`, not resolvable from core) and no `Number(text) * 100`. The assistants domain reads cents back with `Math.round(amount * 100)`, exact for two-decimal amounts. Average ticket and percents are computed in integer cents with half-up rounding of the magnitude, the sign reapplied (−14.5% → −15%), in pure functions; no floating-point division decides a rounded figure. The ticket comparison uses the two rounded averages, so the displayed figures and the difference reconcile. Currencies are grouped, never added. |
| Payment method labels | `walletProviderLabel` of `shared/wallet-providers.ts` (the country catalog) for a provider, «Transferencia bancaria» for `bank_transfer`, «Billetera digital sin especificar» for a wallet payment without provider. No country literal in the sales code. |
| Text match | `texto` reuses the product search's accent- and case-insensitive partial match on the product name or any variant SKU, extracted to one function in `products/infrastructure` used by the search and the new reads. |
| Other-currency line with a filter | With `texto` or `producto`, the other-currency line names units and amount, without an order count, as the product draft's `producto` example (decided by the review gate, section 17). |
| Owed rule | One SQL fragment, `orderBalance`, in `features/orders/infrastructure/order-balance.ts`, extracted from `summarizeUnpaidOrders` (`total − confirmed` for an order whose `confirmed < total`) and used by it and by the summary, so «Por cobrar de estas ventas» and **Pedidos por cobrar** cannot drift. |
| Last sale of unsold products | Exact for every checked product, as the product draft orders it (most stock first, then oldest last sale before the period, none first, then name): one orders read returns, for every checked variant, whether it sold in the period, its last sale before the period and, for a period that ended before today, its first sale after it, from the item date index. No look-back and no page-only dates. |
| Server instructions | The orders paragraph drops «Este conector todavía no da totales de ventas ni finanzas…». The sales paragraph carries only the four rules of the product draft and stays within 700 characters, pinned by a unit test. |
| Shared contracts | None change. Inputs and outputs are internal to `features/assistants`, as the order and product tools. |
| Deferred | Everything the product draft lists under «Out of this version». MCP 4/4 adds its own module and reuses `scopes`. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `ToolModule` with one `scope` | `apps/core/src/features/assistants/presentation/tool-module.ts` | Reused; `scope` becomes `scopes` |
| Registry and static validator | `features/assistants/presentation/tool-registry.ts` (`buildToolDefinitions`, `createServer` filters by `access.scopes.includes(module.scope)`, `checkToolModules`, `maxToolOutputBytes = 24 KB`) | Modified for `scopes` |
| Modules list | `apps/core/src/composition/assistant-tools.ts` | One entry added |
| Validator test | `apps/core/src/composition/assistant-tools.test.ts` (`mcp:validate`), counts four, six and two tools per scope set | Extended to nine |
| Server instructions | `features/assistants/presentation/server-instructions.ts`; orders paragraph in `tools/orders-texts.ts` line «Este conector todavía no da totales de ventas ni finanzas» | Paragraph added; one sentence removed |
| Per-call pipeline | `features/assistants/application/answer-tool-call.ts` (`RegisteredTool`, `ToolRun`, `ToolRunError` `NOT_FOUND`/`INVALID_INPUT`/`FAILURE` with message) | Reused unchanged |
| Access resolution, scopes | `application/resolve-assistant-access.ts`, `domain/scopes.ts` (`assistantScopes = ["orders:read", "products:read"]`) | Unchanged |
| Date inputs and today | `tools/orders-tools.ts` (`day` schema, `rangeOf`, `startOf`/`endOf`), `shared/orders-date.ts` (`salesTimeZone`, `limaMidnightUtc`, `nextCalendarDay`, `limaCalendarDay`), `presentation/display.ts` (`formatMoney`, `formatDay`), `todayLine`, `reversedRangeMessage`, `dateFormatMessage` in `orders-texts.ts` | Reused; `day`, `page` and `unknownField` move to a shared input file |
| Budgeted product snapshot | `features/products/infrastructure/assistant-read.ts` (`assistantSnapshot`, `assistantReadBudget`, `assistantReadFailure`), `statement-timeout.ts` | Generic part extracted, behavior unchanged |
| Product read slots | `createSlots` local to `src/composition/assistant-product-capabilities.ts` (3 slots, 300 ms) | Extracted, behavior unchanged |
| Store currency | `catalogStorefront.describe(companyId)` → `StorefrontState.currency` | Reused |
| Visible-order rule | `visibleOrder` (`NOT (o."fromCatalog" AND o."checkoutConfirmedAt" IS NULL)`), not exported, in `features/orders/infrastructure/order-repository.ts`; `existsOrder` (`EXISTS … AND visibleOrder`, line 564) | Moved to its own file and shared by the new reads |
| Unpaid summary SQL | `summarizeUnpaidOrders` in `order-repository.ts` (groups every payment of the company, because it reads every unpaid order; rows validated with Zod) | Only the balance fragment is reused (`order-balance.ts`); its company-wide payment grouping is not (section 7.1) |
| Rethrow inside a snapshot | `products/infrastructure/ordered-variants.ts` rethrows database failures inside an active transaction so the snapshot classifies them | Pattern reused by every new read |
| Order, payment, item tables | `prisma/schema.prisma`: `Order` (`currency`, `total`, `itemsTotal`, `deliveryCharge`, `deliveryCost`, `cancelled`, `fromCatalog`, `checkoutConfirmedAt`, `createdAt`), `Payment` (`status`, `amount`, `currency`, `method`, `walletProvider`), `OrderItem` (`variantId`, `quantity`, `subtotal`) | Read only, except the new `OrderItem.orderCreatedAt` written with each item. A payment's currency always equals its order's (`order-state-machine.ts`) |
| Order indexes | `(companyId, id)`, `(companyId, number)`, `(companyId, chatId)`, `(companyId, completedAt, id)`, partial `Order_undeducted_pending_idx`, `Order_dispatch_queue_idx`; none on `(companyId, createdAt)` | Index added; precedent `20261030230316_add_order_dispatch_queue_index` |
| Item and payment indexes | `OrderItem (companyId, orderId, variantId)` unique, `OrderItem (companyId, variantId)`, `Payment (companyId, orderId, id)`; `OrderItem` has no date | Reused; `OrderItem.orderCreatedAt` and `(companyId, variantId, orderCreatedAt)` added |
| Product, variant, stock | `Product` (`name`, `currency`, `createdAt`), `ProductVariant` (`status`, `sku`), `ProductStock` (`quantity`), values through `ProductVariantOptionValue`; text match with `unaccent(lower(…)) LIKE` in `product-search-repository.ts` | Read only; match extracted |
| Stock levels | `features/products/domain/stock-level.ts` (`stockLevelOf`), product line summary in `assistants/domain/product-projection.ts` | Reused |
| Wallet labels | `shared/wallet-providers.ts` (`walletProviderLabel`, Peru catalog Yape, Plin) | Reused |
| Logged tool call | `assistant_tool_called` in the registry, outcome `failure` for read failures | Reused |

## 4. Gaps this design closes

1. A module cannot require two scopes (section 6.1).
2. No read aggregates sales of a period by currency with received, owed, overpaid, method breakdown, pending reports and cancelled lines (5.2).
3. No read sums units and amounts per variant sold in a period, nor gives the exact last and next sale dates of a variant (5.3, 5.4).
4. No products read returns current product names and combinations for a set of variants, nor the products with stock today created by a date with their variants (5.3, 5.4).
5. No snapshot spans orders, products and catalog reads with a budget that fits every tool's statements, and the budgeted snapshot lives inside products (6.3, 11).
6. No index lets a short period read cost in proportion to the period, and no date on `OrderItem` lets a per-variant last sale cost less than the variant's history (7, 7.1).
7. No pure rule computes the period, the previous period, the comparison lines, half-up shares or the ranking (6.2, 6.4).
8. The server instructions say there are no totals (12).

## 5. Use cases

All are reads. None writes, none takes a lock, none publishes an event.

### 5.1 `answerSalesSummary`, `answerBestSellers`, `answerUnsoldProducts` (assistants, presentation)

The `run` function of each `RegisteredTool`. Input: the parsed tool input. Access: `AssistantAccess` (company, connection, scopes). Deps: the tool's port, bound in `src/composition/assistant-sales-capabilities.ts`.

1. Resolve the period with `resolveSalesPeriod(input, today)` (6.2); a refusal answers `INVALID_INPUT` with its text and reads nothing.
2. `lo_mas_vendido` with a `producto` that is not a UUID answers the not-found text without reading.
3. Call the port, which takes a sales slot and runs every read of the call in one snapshot, in the sequences of 11.
4. Project with the pure functions of 6.4 and return `{ output, empty }`; empty answers are `empty: true`.
5. A port failure answers `FAILURE` with the text the port chose (too many orders or reading failure).

Sequences inside the snapshot (composition, section 11 counts them):
- Summary: storefront currency, then `summarizeSales`.
- Best sellers, ranking: storefront currency, `summarizeSoldVariants` for the period, `describeVariantsForAssistant` `by: "variants"` with the sold ids and `texto`, then the pure ranking.
- Best sellers, `producto`: storefront currency, `describeVariantsForAssistant` `by: "product"` (no row answers the not-found text and reads no order), `summarizeSoldVariants` narrowed to its variants.
- Unsold: `listStockedForAssistant` (nothing checked answers its empty text and reads no order), `findVariantSaleDates` for every checked variant, then the pure filter, sort and page.

Each read is wrapped in `step(name, bound, read)` (`bound` is `period` or `catalog`), so the guard knows which step was running when a statement timed out.

### 5.2 `summarizeSales` (orders, application)

```ts
export type SalesWindow = Readonly<{ from: Date; before: Date }>;          // [from, before), Lima midnights
export type SummarizeSalesInput = Readonly<{ current: SalesWindow; previous: SalesWindow }>;
export type ReceivedBy = Readonly<{ method: PaymentMethod; walletProvider: WalletProvider | null; amount: Money }>;
export type SalesFigures = Readonly<{
  currency: Currency;
  orders: number; items: Money; deliveryCharges: Money; total: Money;
  received: Money; owed: Money; overpaid: Money;           // total = received + owed − overpaid, per order then summed
  receivedBy: readonly ReceivedBy[];
  cancelled: Readonly<{ orders: number; total: Money; confirmed: Money }>;
}>;
export type SalesSummary = Readonly<{
  current: readonly SalesFigures[]; previous: readonly SalesFigures[];      // one entry per currency with orders (sales or cancelled) in that window
  pendingReports: Readonly<{ reports: number; orders: number }>;           // current window, not cancelled
  storeHasOrders: boolean;                                                  // an order visible to the seller exists, in any date
}>;
export type SummarizeSalesError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_ORDER"; message: string }>;
export type SummarizeSalesDependencies = Readonly<{
  readFigures: (input: SummarizeSalesInput, companyId: CompanyId) => Promise<Result<SalesSummary, SummarizeSalesError>>;
}>;
export async function summarizeSales(input: SummarizeSalesInput, access: OrderAccess, deps: SummarizeSalesDependencies): Promise<Result<SalesSummary, SummarizeSalesError>>
```

1. `readFigures` runs one statement, with one CTE of the orders visible and created in either window, `createdAt >= current.from AND createdAt < current.before` or `createdAt >= previous.from AND createdAt < previous.before` (two index ranges, never one range from `previous.from` to `current.before`), read through `Order_companyId_createdAt_idx`; each row is classified by those same two predicates and a row in neither window is dropped, because a case-2 previous period leaves a gap (called on 20/10 without dates, 21/09–30/09 belongs to neither window); one CTE of the payments of those orders only (section 7.1), and `UNION ALL` branches that return typed rows (`kind`): the figures per window and currency with the cancelled counters, the confirmed payments per window, currency, method and provider, the pending reports of the current window, and `EXISTS (… visibleOrder)` for `storeHasOrders`. One Zod discriminated union validates the rows. A summary is therefore 1 read statement, always the same count. Two bounds are explicit: the windows add up to at most 2 × 366 days of orders, and the gap between them is never read.
2. `storeHasOrders` is what separates «Tu tienda todavía no tiene pedidos.» from an empty period. It applies `visibleOrder` as `existsOrder` does, so an unconfirmed catalog order never makes the text disappear.
3. Per order: `confirmed` is the sum of `confirmed` payments; `owed` and `overpaid` come from the shared `orderBalance` fragment (`owed = max(total − confirmed, 0)`, `overpaid = max(confirmed − total, 0)`), the same balance `summarizeUnpaidOrders` uses for **Pedidos por cobrar**. Not cancelled orders feed sales, received, owed, overpaid and `receivedBy`; cancelled orders feed only `cancelled` (count, total, confirmed). Reported, rejected and voided payments never add money. Pending reports count `reported` payments of not cancelled orders and the distinct orders holding them.

### 5.3 `summarizeSoldVariants` (orders, application)

```ts
export type SoldVariant = Readonly<{ variantId: string; currency: Currency; units: number; amount: Money }>;
export type CurrencySoldTotals = Readonly<{ currency: Currency; orders: number; units: number; amount: Money }>;
export type SoldVariantsSummary = Readonly<{ variants: readonly SoldVariant[]; currencies: readonly CurrencySoldTotals[] }>;
export type SummarizeSoldVariantsInput = Readonly<{ window: SalesWindow; variantIds?: readonly string[] }>;  // variantIds narrows `variants`, never `currencies`
export async function summarizeSoldVariants(input: SummarizeSoldVariantsInput, access: OrderAccess, deps: Readonly<{
  readSoldVariants: (input: SummarizeSoldVariantsInput, companyId: CompanyId) => Promise<Result<SoldVariantsSummary, SummarizeSalesError>>;
}>): Promise<Result<SoldVariantsSummary, SummarizeSalesError>>
```

One statement over the items of visible, not cancelled orders of the window, the orders read first through the createdAt index and their items probed through `OrderItem (companyId, orderId, variantId)`. A `GROUPING SETS ((currency, variantId), (currency))` of `sum(quantity)` and `sum(subtotal)` only, which PostgreSQL can hash; the order count per currency is `count(*)` over the window CTE of the same statement (every order has at least one item), joined as one more row kind, never `count(DISTINCT …)`. `currencies` is always unfiltered: it is the denominator of every share and the unfiltered other-currency line. Rows hold at most one entry per variant of the store that sold in the window, so at most the catalog's variants.

### 5.4 `findVariantSaleDates` (orders, application)

```ts
export type VariantSaleDates = Readonly<{ variantId: string; soldInWindow: boolean; lastBefore: Date | null; firstAfter: Date | null }>;   // exact, in any date
export type FindVariantSaleDatesInput = Readonly<{ window: SalesWindow; variantIds: readonly string[]; needFirstAfter: boolean }>;       // needFirstAfter: the period ended before today
export async function findVariantSaleDates(input: FindVariantSaleDatesInput, access: OrderAccess, deps: Readonly<{
  readSaleDates: (input: FindVariantSaleDatesInput, companyId: CompanyId) => Promise<Result<readonly VariantSaleDates[], SummarizeSalesError>>;
}>): Promise<Result<readonly VariantSaleDates[], SummarizeSalesError>>
```

One statement over `unnest($variantIds::uuid[])` (at most the catalog's 12,000 checked variants, about 450 KB of text, measured in the load check) with, per variant, up to three correlated probes of `OrderItem (companyId, variantId, orderCreatedAt)` joined to the order by its primary key and filtered with `visibleOrder AND NOT cancelled`, each with `ORDER BY "orderCreatedAt" … LIMIT 1`: the first valid sale inside `[window.from, window.before)` (`soldInWindow`), the latest valid sale before `window.from` (`lastBefore`) and, only when `needFirstAfter`, the earliest at or after `window.before` (`firstAfter`). A unit in any currency counts. Each probe stops at the first valid sale, skipping only cancelled or unconfirmed-catalog items, so its cost depends on the catalog and not on how much history a variant has; a variant never sold has no index entry and costs one empty probe. Variants without any sale answer all-null. The bounds are untyped or `::timestamp` parameters (section 2, Index).

### 5.5 `describeVariantsForAssistant` (products, application)

```ts
export type DescribedVariant = Readonly<{ variantId: string; productId: ProductId; productName: string; values: readonly string[]; matchesText: boolean }>;
export type DescribeVariantsInput =
  | Readonly<{ by: "variants"; variantIds: readonly string[]; text?: string }>      // text trimmed, 1..120
  | Readonly<{ by: "product"; productId: ProductId }>;
export async function describeVariantsForAssistant(input: DescribeVariantsInput, deps: Readonly<{
  readVariants: (input: DescribeVariantsInput, companyId: CompanyId) => Promise<Result<readonly DescribedVariant[], ProductReadError>>;
}>): Promise<Result<readonly DescribedVariant[], ProductReadError>>
```

One statement: current product name, the variant's values in option order (empty for a product without options), and whether the product matches `text` (name or any variant SKU, active or not).
- `by: "variants"` describes the given ids (the variants that sold). Another company's variant id is absent; deactivated variants are described. The values come from one join over those variants, bounded by the catalog (at most 12,000 variants, about 2 values each); the answer shows at most 20 × 3 of them, but splitting the read in two would add a statement to a path that has one of margin, so it is not split. The T2 load check measures it with a 12,000-id list (about 450 KB of text) and decides on the measure (section 15).
- `by: "product"` is the light read of `producto`: the product of this store by id and all its variants with their values, in one statement, with none of the detail `findForAssistant` loads (prices, purchase prices, SKUs, stock, options of the storefront). An unknown or foreign product returns no row, which the composition answers with the not-found text without reading orders.

### 5.6 `listStockedForAssistant` (products, application)

```ts
export type StockedProduct = Readonly<{
  id: ProductId; name: string; createdAt: Date;
  stock: Readonly<{ total: number; soldOut: number; low: number; onlyLevel: StockLevel | null }>;   // active variants only, as the search's product line
  variantIds: readonly string[];                                                                   // every variant, deactivated included
}>;
export type StockedProducts = Readonly<{
  storeHasProducts: boolean; matching: number; withStock: number;   // matching = products matching text (all when none); withStock = matching with active stock > 0 today
  checked: readonly StockedProduct[];                               // withStock and created before `createdBefore`
}>;
export type ListStockedInput = Readonly<{ createdBefore: Date; text?: string }>;
export async function listStockedForAssistant(input: ListStockedInput, deps: Readonly<{
  readStocked: (input: ListStockedInput, companyId: CompanyId) => Promise<Result<StockedProducts, ProductReadError>>;
}>): Promise<Result<StockedProducts, ProductReadError>>
```

One statement: a row per product matching `text` (all when none) with its active-stock summary and variant ids, plus `EXISTS (any product)` for `storeHasProducts`; `matching`, `withStock` and `checked` are derived from those rows in the application. Bounded by the catalog (3,000 products, 12,000 variant ids), not by orders. `checked` is complete (not paged): the order depends on sale dates that only orders knows.

### 5.7 `readSalesForAssistant` (orders, composition)

`orders.readSalesForAssistant(work)` opens the budgeted snapshot of 6.3 with `salesReadBudget` and no `onFailure`, and runs `work`, in which every read of 5.2–5.6 and `catalogStorefront.describe` join the open transaction. It returns `Result<T, E | SalesReadError>` with the failure classification and nothing logged. The composition guard `salesRead` (6.5) logs `sales_read_failed` once, with the step that was running, because it alone knows the operation, the period read, the step and the answer chosen, which is product policy and must not live in `src/shared/infrastructure`.

### Existing use cases that change

- `buildToolDefinitions`, `createToolRegistry().createServer` and `checkToolModules`: per module `scopes` instead of `scope` (6.1).
- `assistantSnapshot` of products: becomes `budgetedSnapshot(assistantReadBudget, onFailure)` with an `onFailure` that logs `product_search_failed` with the same fields, same behavior and log.
- `summarizeUnpaidOrders` takes its balance from the shared `orderBalance` fragment and `visibleOrder` from `order-visibility.ts`; its results do not change.

## 6. Domain and typing

### 6.1 Tool module scopes

```ts
export type ToolModule = Readonly<{
  scopes: readonly [AssistantScope, ...AssistantScope[]];   // a connection sees the module only when it holds every one
  access: "read"; instructions: string; readFailureMessage: string;
  tools: readonly RegisteredTool<any, any>[];
}>;
```

`ToolDefinition.scope` becomes `scopes`. `createServer` filters modules and definitions with `scopes.every((scope) => access.scopes.includes(scope))`. `checkToolModules` adds one violation: a repeated scope in a module. Messages name the module by its scopes joined with «+». Justification: a group of tools over data of two categories needs both consents; a second module per scope would split one tool's reads.

### 6.2 Sales period (`features/assistants/domain/sales-period.ts`, pure)

```ts
export type SalesPeriod = Readonly<{ from: string; through: string; cutToToday: boolean }>;        // AAAA-MM-DD, inclusive Lima days
export type PreviousPeriod = Readonly<{ from: string; through: string; month: Readonly<{ year: number; month: number }> | null }>;
export type PeriodRefusal =
  | Readonly<{ kind: "only_through" }>
  | Readonly<{ kind: "reversed"; from: string; through: string }>
  | Readonly<{ kind: "from_after_today"; from: string; today: string }>
  | Readonly<{ kind: "too_long"; maxDays: number }>;
export const salesPeriodMaxDays = 366;                                                              // initial value
export function resolveSalesPeriod(input: Readonly<{ desde?: string; hasta?: string }>, today: string): Result<SalesPeriod, PeriodRefusal>;
export function previousPeriod(period: SalesPeriod): PreviousPeriod;
export function periodDays(period: Readonly<{ from: string; through: string }>): number;
export function windowOf(period: Readonly<{ from: string; through: string }>): Readonly<{ from: Date; before: Date }>;
```

`resolveSalesPeriod` checks in this order: only `hasta`; reversed (on the input dates); `desde` after today; defaults (no dates: first of today's month to today; only `desde`: to today); `hasta` after today is cut to today with `cutToToday: true`; length over `salesPeriodMaxDays` on the period read. Format errors are refused earlier by the input schema. `previousPeriod` applies the three cases of the product draft in order: (1) `from` is a 1st and `through` the last day of its month: the same number of whole months just before, with `month` set only when it is one month; (2) `from` is a 1st: moved back by the number of calendar months it touches, same day numbers, end cut to that month's last day; (3) otherwise the same number of days just before. Days are computed on UTC calendar arithmetic of the strings, never on instants. Justification: a new type because no existing type carries a period with its cut flag; `DispatchDate` stays for dispatch.

### 6.3 Budgeted snapshot (`src/shared/infrastructure/budgeted-snapshot.ts`)

```ts
export type ReadBudget = Readonly<{ maxWait: number; timeout: number; statementTimeoutMs: number; maxStatements: number }>;
export type BudgetedReadError =
  | Readonly<{ code: "STATEMENT_TIMEOUT"; message: string }>
  | Readonly<{ code: "TRANSACTION_TIMEOUT"; message: string }>
  | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export function budgetedSnapshot(budget: ReadBudget, onFailure?: (failure: BudgetedReadError, cause: unknown, durationMs: number) => void):
  <T, E extends AppError>(read: () => Promise<Result<T, E>>) => Promise<Result<T, E | BudgetedReadError>>;
```

The body, the failure classification and `isStatementTimeout` move from products unchanged; products' `assistantSnapshot(operation)` becomes a call with `assistantReadBudget` and an `onFailure` that logs `product_search_failed`. Orders defines, in `features/orders/infrastructure/sales-read.ts`, `salesReadBudget`, `SalesReadError = BudgetedReadError` and the statements of each path:

```ts
export const salesReadBudget = { maxWait: 1000, timeout: 10000, statementTimeoutMs: 1500, maxStatements: 6 } as const;
export const salesPathStatements = { summary: 4, best_sellers: 5, unsold: 4 } as const;   // overhead 2 + storefront 1 where the tool reads it, plus its reads (section 11)
```

Unit tests pin, for both budgets, `maxStatements × statementTimeoutMs + maxWait ≤ timeout` (6 × 1500 + 1000 = 10,000), and for the sales budget that every `salesPathStatements` value is at most `maxStatements − 1`, so each path keeps one statement of margin and the invariant holds on every path. Only T0 edits these constants; a tool whose measured count differs escalates instead of editing them.

### 6.4 Projections (pure, `features/assistants/domain`)

- `sales-figures.ts` (shared by the three tools): `centsOf(money)`; `roundHalfUp(numerator, denominator)` on integers, rounding the magnitude and reapplying the sign; `sharePercent(part, whole)` → `{ kind: "percent"; value } | { kind: "under_one" }`; `averageCents(totalCents, orders)`; `compareFigure(current, previous)` → `{ kind: "same" } | { kind: "more" | "less"; difference; percent: number | "under_one" | null }` (`null` when the previous figure is 0); `counted(n, singular, plural)`. Percent of a comparison is relative to the previous figure, half up, with the sign of the difference. The ticket comparison compares the two rounded averages.
- `sales-projection.ts` (summary): `SalesSummaryOutput` from `SalesSummary`, the period, the previous period and the store currency: blocks ordered store currency first then code A–Z, a block per currency with sales in either window and none for a currency without sales in either (as the product draft says; the cancelled-only currency edge is question 1 of section 17), the meaning line once, method lines largest first then label A–Z, the comparison or the previous figures alone, the open-period line when `through` is today, the cancelled lines, the singular forms. When no currency has sales in either window the answer is «No hay ventas del …» without a currency (acceptance 11), then the cancelled lines of each currency (the store currency first; a currency code only when more than one has cancelled orders) and the previous period as the product draft defines it; the same rule gives the single-currency store its cancelled lines.
- `product-sales-projection.ts` (both product tools): `rankSoldProducts(variants, described, { order, page, storeCurrency, text })` groups store-currency variant rows by product, keeps matching products, sorts (units: units, amount, name; amount: amount, units, name; names with `Intl.Collator("es", { sensitivity: "base" })`), pages 20 and caps variants at 3 (units, amount, combination); `listUnsoldProducts(checked, dates, { page, periodEndedBeforeToday })` keeps products none of whose variants sold in the window, folds the dates per product (latest `lastBefore`, earliest `firstAfter`), sorts as the product draft says (most stock first, oldest last sale before the period with none first, name A–Z) and pages 20.

### 6.5 Layers

| Layer | Types and authority |
| --- | --- |
| `features/orders` | What a sale is and every money figure: `SalesFigures`, `SoldVariantsSummary`, `VariantSaleDates`; rows validated with Zod (`INVALID_STORED_ORDER` on an invalid row) |
| `features/products` | Product identity, current names, combinations, text match, stock: `DescribedVariant`, `StockedProducts` |
| `features/assistants/domain` | Period, previous period, comparisons, shares, ranking, wording; its own `Projectable*` types, no import from orders or products |
| `src/composition/assistant-sales-capabilities.ts` | The only place that sees both sides: maps feature types onto assistant types, joins variants with products in memory, chooses the failure text and logs `sales_read_failed` once |

## 7. Persistence

Two migrations, generated with the Prisma CLI per the [Database migrations](../../.agents/skills/database-migrations/SKILL.md) skill. The first adds `OrderItem.orderCreatedAt`: nullable column, backfill `UPDATE "OrderItem" i SET "orderCreatedAt" = o."createdAt" FROM "Order" o WHERE o."companyId" = i."companyId" AND o.id = i."orderId"`, then `SET NOT NULL`, in one transaction; there is no production data (memory «No customers/prod data yet»), so no batching, and the migration says so. The second, below, builds both indexes, each concurrently and each alone in its own file when generated: `@@index([companyId, createdAt])` on `Order` (a plain index, so it is declared in `schema.prisma`, unlike the partial indexes of memory a20f16a6), migration `add_order_company_created_at_index`, edited to follow `20261030230316_add_order_dispatch_queue_index`: alone in its file, `RESET lock_timeout; RESET statement_timeout;` first, a comment with the recovery (`DROP INDEX CONCURRENTLY IF EXISTS "Order_companyId_createdAt_idx"; prisma migrate resolve --rolled-back <migration>`; deploy again) and `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_companyId_createdAt_idx" ON "Order" ("companyId", "createdAt")`; the same file pattern, with its own recovery comment, for `OrderItem_companyId_variantId_orderCreatedAt_idx` on `"OrderItem" ("companyId", "variantId", "orderCreatedAt")`, declared with `@@index` in `schema.prisma`. `IF NOT EXISTS` silently keeps an INVALID index left by a failed build and the planner ignores it, so T0's acceptance checks `pg_index.indisvalid`. After adding the `@@index`, a no-change `prisma migrate dev --create-only` must emit nothing. Plain columns, so row-level security does not prevent its use (no non-leakproof function in the key). The item write paths set `orderCreatedAt` from the order's `createdAt` in the same statement that inserts the item, and the invariant «`OrderItem.orderCreatedAt` equals its order's `createdAt`» is tested for a created order and for an item added by an edit. No policy changes; no data is deleted.

Every new query filters `"companyId" = $companyId` explicitly besides RLS, repeats `visibleOrder` from the shared file, and validates its rows with a Zod schema (integer-cent text `^-?\d+$`, integer counts, currencies with `isCurrency`). Database failures inside the snapshot are rethrown, as `findOrderedVariantIds` does, so the snapshot classifies them; outside a transaction they map to `PERSISTENCE_UNAVAILABLE`.

### 7.1 Read bounds

Every statement is bounded by the windows it reads or by the catalog; none depends on the store's whole history. «Windows» are the period, plus the previous period for the summary, each at most 366 days, never the gap between them.

| Statement | Bound | How it is bounded |
| --- | --- | --- |
| Summary figures (one statement) | Orders of the two windows, at most 2 × 366 days | Two `createdAt` ranges on `Order_companyId_createdAt_idx`; rows outside both are dropped. Payments only of those orders: the payment CTE joins the window's orders and is served by `Payment (companyId, orderId, id)`; the `WHERE "companyId" = …` grouping of every payment that `summarizeUnpaidOrders` uses is forbidden here |
| `storeHasOrders` | One row | `EXISTS` stops at the first visible order of the company |
| Sold variants | Orders of the period, at most 366 days | Same index; their items through `OrderItem (companyId, orderId, variantId)`; rows at most the catalog's variants |
| Item dates | The catalog's checked variants (≤ 12,000) | Three `LIMIT 1` probes per variant on `OrderItem (companyId, variantId, orderCreatedAt)`; independent of the period and of the history |
| Product descriptions, stocked products | The catalog (3,000 products, 12,000 variants) | Joins on product and variant keys |

At long windows a sequential scan and hash join over the table is the right plan: the summary at 366 days reads half of four years. The index is for short windows. For that reason the load checks judge cost and not plan shape (section 15).

## 9. Events and cross-feature integration

No event. Cross-feature capabilities, all composed operations:

| Capability | Owner | Consumer |
| --- | --- | --- |
| `orders.readSalesForAssistant`, `orders.summarizeSales`, `orders.summarizeSoldVariants`, `orders.findVariantSaleDates` | orders | `src/composition/assistant-sales-capabilities.ts` |
| `products.describeVariantsForAssistant`, `products.listStockedForAssistant` | products | same |
| `catalogStorefront.describe` (existing) | catalog | same |

`features/assistants` imports nothing from orders, products or catalog; it declares `SalesToolsDependencies` with plain data and its own projectable types.

## 11. Transactions and concurrency

Read-only. Each call:

1. Takes a sales slot (2 per process); after 2,000 ms without one it answers the sales reading-failure text and logs `assistant_sales_reads_busy`. The wait holds no connection.
2. Opens one RepeatableRead transaction in the connection's tenant context with `salesReadBudget` (`set_config` for tenant and timeout, `set_config` for `jit` off).
3. Runs the tool's reads in order, all in the same snapshot, so figures, ranking, names and stock never disagree with a concurrent save.
4. Commits (nothing to write) and releases the slot in `finally`.

Statements per path, counted as in section 2 (overhead 2, storefront 1 where the tool reads the store currency). `salesPathStatements` pins the totals and each integration test asserts the measured count equals it:

| Path | Statements | Total |
| --- | --- | --- |
| `resumen_de_ventas` | overhead 2, storefront currency, figures (includes `storeHasOrders`) | 4 |
| `lo_mas_vendido`, ranking (with or without `texto`) | overhead 2, storefront currency, sold variants, descriptions of the sold variants | 5 |
| `lo_mas_vendido` with `producto` | overhead 2, storefront currency, product description (light read), sold variants narrowed to its variants | 5 |
| `productos_sin_ventas` | overhead 2, stocked products, item dates of every checked variant (skipped when nothing is checked) | 4 |

The worst path has 5 statements against `maxStatements: 6`: at least one statement of margin on every path, and `6 × 1,500 + 1,000 = 10,000 ≤ 10,000`, so on every path the statement limit fires before the transaction timer. A call holds a pool connection at most 10 s, and only in a failure; a normal call holds it for hundreds of milliseconds.

Pool: sales reads (2 slots, ≤ 10 s) and product reads (3 slots, ≤ 5 s) can hold 5 of the 10 connections in the worst case, so the reserve is 5, not 7. The reserve is shared by the web app, the order tools (they have no slots) and the per-call pipeline (`touchConnection`, token checks), and it is reached only when 5 assistant reads are in flight at once. The sales slots are shared by every store of the process: two heavy summaries of one store make another store's sales call wait up to 2 s and then answer the reading-failure text; it is the same class of risk `docs/assistants.md` lists for product slots, and T4 records both.

Concurrent writes are invisible to the snapshot; repeating a call returns the figures of that moment. No lock, no duplicate policy.

## 12. Code organization

Wave-2 tasks never edit the same file: everything both would touch is finished in T0 through stubs that T1 and T2 fill in their own files, and everything that needs both is in T3.

| File | Change | Task |
| --- | --- | --- |
| `features/assistants/presentation/tool-module.ts` | `scopes`; the doc comment («A later category adds a module file, a scope literal…») corrected: a group over several categories declares several scopes and no literal is added | T0 |
| `features/assistants/presentation/tool-registry.ts` (+ test) | Scopes filter, validator checks | T0 |
| `features/assistants/presentation/tools/orders-tools.ts`, `products-tools.ts` | `scopes: ["orders:read"]`, `scopes: ["products:read"]`; `day`, `page`, `unknownField` imported from `tools/input-fields.ts` | T0 |
| `features/assistants/presentation/tools/input-fields.ts` | New: `day`, `page`, `unknownField` moved from orders and products tools | T0 |
| `features/assistants/presentation/tools/orders-texts.ts` | Drops the no-totals sentence | T0 |
| `features/assistants/presentation/tools/sales-tools.ts`, `sales-texts.ts` | New: `createSalesToolsModule(tools)`, paragraph, period refusal texts, reading-failure and too-many texts | T0 |
| `features/assistants/domain/sales-period.ts`, `sales-figures.ts` (+ tests) | New, pure | T0 |
| `src/shared/infrastructure/budgeted-snapshot.ts` (+ test) | New: moved from products, with `onFailure` | T0 |
| `features/products/infrastructure/assistant-read.ts`, `statement-timeout.ts` | Use the shared snapshot; `statement-timeout.ts` moves | T0 |
| `src/composition/assistant-read-slots.ts` | New: `createReadSlots(count, waitMs)` moved from product capabilities | T0 |
| `src/composition/assistant-product-capabilities.ts` | Imports `createReadSlots` | T0 |
| `src/composition/assistant-sales-capabilities.ts` (+ integration test) | New: sales slot (2, 2,000 ms), `step(name, bound, read)` and the `salesRead(operation, access, period, work)` guard: failure-text choice by step, `sales_read_failed` and `assistant_sales_reads_busy` logs | T0 |
| `src/composition/assistant-sales-summary-capabilities.ts` | New in T0 exporting `salesSummaryTools = []`; T1 fills it | T0, T1 |
| `src/composition/assistant-product-sales-capabilities.ts` | New in T0 exporting `productSalesTools = []`; T2 fills it | T0, T2 |
| `src/composition/assistant-tools.ts` | Sales module entry `createSalesToolsModule([...salesSummaryTools, ...productSalesTools])`; never edited again | T0 |
| `src/composition/assistant-tools.test.ts` | Expected names derived: the six existing tools plus the tools of the sales module; T3 pins the nine names | T0, T3 |
| `features/orders/infrastructure/order-visibility.ts`, `order-balance.ts` | New: `visibleOrder` moved from `order-repository.ts`; `orderBalance` fragment extracted from `summarizeUnpaidOrders` | T0 |
| `features/orders/infrastructure/order-repository.ts` | Imports both fragments; no behavior change | T0 |
| `features/orders/infrastructure/sales-read.ts` | New: `salesReadBudget`, `salesPathStatements`, snapshot opener | T0 |
| `features/orders/infrastructure/sales-cents.ts` (+ test) | New: Zod schema and parser for integer-cent text | T0 |
| `features/orders/infrastructure/order-repository.ts` (item inserts) | `orderCreatedAt` set from the order's `createdAt` in the `create` and in the `createMany` of items added by an edit, and in any other item write T0 finds | T0 |
| `features/orders/composition.ts` | `readSalesForAssistant`; spreads `salesSummaryOperations` and `soldVariantsOperations`; never edited again | T0 |
| `features/orders/composition-sales-summary.ts`, `composition-sold-variants.ts` | New in T0 exporting `{}`; T1 and T2 fill them | T0, T1, T2 |
| `prisma/schema.prisma`, `prisma/migrations/` (column and backfill; `Order_companyId_createdAt_idx`; `OrderItem_companyId_variantId_orderCreatedAt_idx`) | `OrderItem.orderCreatedAt` and two indexes | T0 |
| `tests/support/sales-load-fixture.ts` (+ `sales-load-fixture.integration.test.ts`) | New: the history fixture of section 2 (opt-in, `SALES_LOAD=1`) and the checks of the index (`indisvalid`, plan on four years of history) | T0 |
| `features/orders/application/summarize-sales.ts` (+ test), `infrastructure/sales-summary-repository.ts` (+ integration test) | New | T1 |
| `features/assistants/domain/sales-projection.ts` (+ test), `presentation/tools/sales-summary-tool.ts` (+ test) | New | T1 |
| `src/composition/sales-summary-tool.integration.test.ts`, `sales-summary-load.integration.test.ts` | New: summary through `/mcp` with its statement count; load check on the T0 fixture | T1 |
| `features/orders/application/summarize-sold-variants.ts`, `find-variant-sale-dates.ts` (+ tests), `infrastructure/sold-variants-repository.ts` (+ integration test) | New | T2 |
| `features/products/application/describe-variants-for-assistant.ts`, `list-stocked-for-assistant.ts` (+ tests), `infrastructure/product-sales-repository.ts` (+ integration test), `infrastructure/product-text-match.ts` | New; `product-search-repository.ts` uses the extracted match | T2 |
| `features/products/composition.ts` | Two operations | T2 |
| `features/assistants/domain/product-sales-projection.ts` (+ test), `presentation/tools/best-sellers-tool.ts`, `unsold-products-tool.ts` (+ tests) | New | T2 |
| `src/composition/sales-product-tools.integration.test.ts`, `sales-products-load.integration.test.ts` | New: both tools through `/mcp` with their statement counts; load check on the T0 fixture | T2 |
| `src/composition/sales-tools.integration.test.ts` | New: nine tools, store limit, example store end to end | T3 |
| `docs/assistants.md`, drafts | Promotion | T4 |

## 13. Observability

Events follow [Logging](../logging.md). Never logged: tool inputs and outputs, dates sent, search text, product names or ids, amounts, counts of sales, currencies, store subdomain.

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `assistant_tool_called` (existing) | info | registry | `["companyId", "connectionId", "tool", "outcome", "durationMs"]`; a too-many answer is `failure` |
| `sales_read_failed` | error | the `salesRead` guard in `assistant-sales-capabilities.ts`, once per failed call (the shared snapshot logs nothing for sales) | `["companyId", "operation", "step", "errorCode", "periodDays", "answer", "durationMs"]`; `operation` `summary`/`best_sellers`/`unsold`, `step` the read in progress (`storefront`, `figures`, `sold_variants`, `descriptions`, `stocked`, `item_dates`), `errorCode` `STATEMENT_TIMEOUT`/`TRANSACTION_TIMEOUT`/`PERSISTENCE_UNAVAILABLE`, `answer` `too_many_orders`/`read_failure` |
| `assistant_sales_reads_busy` | warn | `assistant-sales-capabilities.ts` | `["companyId", "connectionId", "tool", "waitedMs"]` (up to 2,000 ms) |
| `assistant_tool_failed` (existing) | error | capabilities, registry | `["companyId", "connectionId", "tool", "errorCode"]` for `INVALID_STORED_ORDER`, an output that fails its schema, or an unexpected code |
| `product_search_failed` (existing) | error | the `onFailure` that products pass to the shared snapshot | unchanged |

`periodDays` is the number of days read, not the dates. `assistant_tool_called` with `tool: "resumen_de_ventas"` measures the product hypothesis.

## 14. Tests

### Unit (core, Vitest)

`tool-registry.test.ts`
- `test("offers a module that requires orders and products only to a connection holding both scopes")`
- `test("a connection with only the orders scope sees neither the sales tools nor their instructions paragraph")`
- `test("refuses a module that repeats a scope")`

`budgeted-snapshot.test.ts`, `assistant-read.test.ts` and `sales-read.test.ts`
- `test("keeps maxStatements × statementTimeoutMs + maxWait within the transaction timer for the product and the sales budgets")`
- `test("keeps every sales path at least one statement under maxStatements")` (`salesPathStatements`)
- `test("reports a failure to onFailure with its duration and logs nothing by itself")`
- `test("classifies a PostgreSQL statement timeout as STATEMENT_TIMEOUT and a Prisma P2028 as TRANSACTION_TIMEOUT")`

`sales-period.test.ts`
- `test("without dates reads from the first of the current month to today in Lima")`
- `test("with only desde reads up to today")`
- `test("refuses only hasta with the initial-date text")`
- `test("cuts a future hasta to today and marks the period as cut")`
- `test("refuses a desde after today echoing both dates as AAAA-MM-DD")`
- `test("refuses a reversed range with the existing reversed-range text")`
- `test("refuses a period read longer than 366 days and accepts a leap year of 366")`
- `test("compares whole months with the same number of months before and names a single month")` (01/10–31/10 → septiembre de 2026; 01/07–30/09 → 01/04–30/06)
- `test("moves a period starting on the 1st back by the months it touches and cuts the end to the month's last day")` (01/10–20/10, 01/09–20/10, 01/03–30/03, 01/10–01/10, 01/10–07/10)
- `test("compares any other period with the same number of days just before")` (11/10–17/10, 15/09–14/10)
- `test("an order at 23:30 Lima on 31/10 falls inside October's window and one at 00:05 on 01/11 outside it")`

`sales-cents.test.ts`
- `test("parses integer-cent text exactly, including 10, 7, 123456789 and negative differences, and builds Money as cents / 100")`
- `test("refuses text that is not an integer or is not a safe integer")`

`sales-figures.test.ts`
- `test("rounds the average ticket half up to the cent")`
- `test("shows a share below 0.5% as menos de 1% and never adjusts shares to 100")` (three methods at S/ 10.00 → 33% each)
- `test("states a comparison with both figures, the direction in words and a percent of the previous figure")` (680 vs 600 → +13%; 170 vs 200 → −15%)
- `test("rounds half up on the magnitude for negative comparisons")` (171 vs 200 → −15%, not −14%; 229 vs 200 → +15%)
- `test("compares the two rounded average tickets so the shown figures and the difference reconcile")`
- `test("shows menos de 1% for a non-zero difference that rounds to 0 and no percent when the previous figure is 0")` (601 vs 600; 380 vs 0)
- `test("uses the singular for one in every counter")`

`summarize-sales.test.ts` (fakes)
- `test("passes both windows to one read and returns its figures and storeHasOrders")`
- `test("answers the persistence failure of its read without a partial summary")`

`sales-projection.test.ts`
- `test("projects the October example: sales, products, deliveries, orders, ticket, received by method, owed, overpaid, review and cancelled lines")` (acceptance 1)
- `test("projects the summary after voiding a confirmed payment of #1001")` (acceptance 2)
- `test("shows Recibido S/ 0.00 and no method breakdown when no payment is confirmed")`
- `test("adds the open-period line only when the period read ends today")`
- `test("shows the previous figures alone for an empty period and Tampoco hubo ventas when both are empty")`
- `test("orders currency blocks store currency first then by code and opens a block without sales with its currency")` (acceptance 18)
- `test("a currency with cancelled orders and no sales in either window has no block")` (product rule; question 1)
- `test("a period with only cancelled orders in a single-currency store answers No hay ventas del … without a currency, then the cancelled lines and the previous period")` (acceptance 11)
- `test("shows (hasta hoy) in the header when a future hasta was cut to today, and a plain header otherwise")` (acceptance 5)
- `test("projects three methods of S/ 10.00 as 33% each and S/ 601.00 against S/ 600.00 as S/ 1.00 más que en el anterior (menos de 1%)")` (acceptance 12, T1 projection; the pure rules are tested in T0)
- `test("adds a sales sample with three currency blocks at maximum amounts that fits 24 KB")` (T1 sample outputs, checked by the static validator)
- `test("shows no money-on-cancelled line once the cancelled order holds no confirmed payment")` (acceptance 2, voiding #1003's S/ 40.00)
- `test("shows Sin ventas en el periodo anterior with no comparison lines when only this period has sales")` (acceptance 4)
- `test("says Tu tienda todavía no tiene pedidos alone for a store without orders")`

`sales-summary-tool.test.ts`
- `test("refuses invalid periods with their texts and calls no port")` (acceptance 15)
- `test("answers the too-many-orders text the port chose and the reading-failure text otherwise")`
- `test("states in its sample outputs the 24 KB worst case of the summary")`

`product-sales-projection.test.ts`
- `test("ranks the October example by units and by amount with whole-period shares")` (acceptance 7)
- `test("shows three variants and the remaining count, and every variant for one product")` (acceptance 8)
- `test("keeps the whole-period share and names the denominator when texto narrows the ranking")`
- `test("ranks only the store currency and adds one line per other currency, filtered without order count")`
- `test("answers the no-sales text for texto gorro whose only order is cancelled")` (acceptance 8)
- `test("lists products with stock that did not sell, ordered by most stock, oldest last sale before the period with none first, then name")` (acceptance 10; at equal stock «Zapato · Ninguna venta antes del periodo» precedes «Bufanda · 14/03/2025», which precedes «Abrigo · 01/01/2026»)
- `test("folds variant sale dates into the product's last sale before and first sale after the period")`
- `test("says Volvió a venderse only for a period that ended before today")`
- `test("picks the empty text in order: no products, no match, no stock, all created after, all sold")` (acceptance 13)
- `test("adds the short-period line under 14 days")` (acceptance 14)
- `test("a page of 20 products at maximum lengths with 3 variants each, a producto answer of 60 variants and an unsold page of 20 at maximum name lengths fit 24 KB")` (acceptance 19, T2 sample outputs, checked by the static validator; the three samples live in the tools' own files, never in assistant-tools.test.ts)

`best-sellers-tool.test.ts`, `unsold-products-tool.test.ts`
- `test("answers a producto that is not an identifier with the not-found text without reading")`
- `test("adds Con producto se ignoran texto, orden y pagina when any of them was sent with producto")`
- `test("answers a page beyond the last with the existing page text")`

`assistant-tools.test.ts` (static validator)
- `test("lists the six existing tools plus the tools of the sales module for a connection with both scopes")` (T0; T3 pins the nine names and `test("lists exactly the nine tools, all read only, for a connection with both scopes")`)
- `test("the sales instructions paragraph stays within 700 characters and the orders paragraph no longer says there are no totals")`

### Integration (core, real PostgreSQL)

`assistant-sales-capabilities.integration.test.ts` (T0, with a synthetic `work`, no tool)
- `test("answers the too-many-orders text for a statement timeout in a period-bound step of a period over 31 days, and the reading-failure text for one in a period of 31 days or fewer or in a catalog-bound step")` (acceptance 16, with a lowered statement timeout and `pg_sleep`)
- `test("logs sales_read_failed once with operation, step, errorCode, periodDays and answer, and no input or amount")`
- `test("a third concurrent sales read waits for a slot and runs when one frees within 2,000 ms, and one that waits 2,000 ms answers the reading-failure text and logs assistant_sales_reads_busy")`
- `test("a sales read in flight never takes a product slot")`
- `test("measures the overhead of the opener with the storefront read at 3 statements and without it at 2")`

`sales-load-fixture.integration.test.ts` (T0, opt-in `SALES_LOAD=1`)
- `test("both new indexes are valid (pg_index.indisvalid) and a window read of 31 days or fewer, run as core_app under RLS, uses Order_companyId_createdAt_idx on four years of history")`
- `test("a 31-day window read costs no more on four years of history than on one (within 1.5 times plus 50 ms) and the per-variant probes use the item date index")`
- `test("the migration backfills orderCreatedAt, and an item written by a create and one added by an edit carry the order's createdAt")`
- `test("a no-change prisma migrate dev --create-only emits nothing for the two indexes")` (script check)

`sales-summary-repository.integration.test.ts` (T1)
- `test("a previous period that leaves a gap excludes the gap: with today 20/10 an order of 25/09 changes neither the October-to-date figures nor the 01/09–20/09 previous figures")` (case 2)
- `test("sums the October example: voided, rejected and reported payments add nothing and the unconfirmed catalog order does not exist")` (acceptance 1, 2, 6)
- `test("keeps cancelled orders out of sales and counts their confirmed payments in the cancelled line only")`
- `test("counts pending reports and the orders holding them, never on cancelled orders")`
- `test("groups figures by currency and never adds two currencies")` (acceptance 18)
- `test("another store's orders and payments change no figure")` (acceptance 17)
- `test("an order at 23:30 Lima on 31/10 counts in October and one at 00:05 on 01/11 in November")` (acceptance 3, through the repository)
- `test("storeHasOrders ignores an unconfirmed catalog order and sees a cancelled one")`
- `test("the owed figure over a period covering every order equals the owed of Pedidos por cobrar")` (shared `orderBalance`)

`sold-variants-repository.integration.test.ts` (T2)
- `test("sums units and item subtotals per variant sold, excluding delivery, cancelled and unconfirmed catalog orders")` (acceptance 6, 9)
- `test("narrows variants to the given ids and keeps the per-currency totals and order counts of the whole period")`
- `test("reports for each variant whether it sold in the window, its exact last sale before it and, when asked, its first sale after it, however old, in any currency")`
- `test("skips cancelled and unconfirmed catalog orders when looking for the last and first sale of a variant")`
- `test("a variant never sold answers all-null")`

`product-sales-repository.integration.test.ts` (T2)
- `test("describes variants with the current product name, values in option order and the text match on name or any SKU")`
- `test("describes one product of the store with all its variants by id and returns nothing for another store's product")` (acceptance 17)
- `test("lists products with active stock today, counting store, matching and stocked products in one statement")` (Chompa, Short, Vestido excluded from `checked`)

`sales-summary-tool.integration.test.ts` (T1), `sales-product-tools.integration.test.ts` (T2) (through `/mcp`, like `products-tools.integration.test.ts`)
- `test("answers the example store and issues exactly the salesPathStatements count for the worst case of each path")` (the summary; ranking, `producto` and unsold respectively)
- `test("a producto of another store and a texto without sales answer their texts")` (T2)

`sales-summary-load.integration.test.ts` (T1) and `sales-products-load.integration.test.ts` (T2), opt-in `SALES_LOAD=1`, on the history fixture of section 2 (each file measures the statements its task introduces)
- `test("a 366-day summary of the worst case-2 shape reads figures within half the statement budget on four years of history with other companies' rows")`
- `test("the 30-day summary and sold variants are not slower on four years of history than on one (within 1.5 times plus 50 ms)")`
- `test("a 366-day ranking reads sold variants and descriptions of 12,000 sold variants within half the statement budget")`
- `test("productos_sin_ventas reads stocked products and the item dates of 12,000 checked variants within half the statement budget when the first 20 products by stock (80 variants, one of 60) are stale with 3,000 old items per variant, for the default 30 days and for 366 days")`
- `test("records, for every statement, the time of the first and repeated run and the buffers read")` (printed for the pull request)

`sales-tools.integration.test.ts` (T3)
- `test("a connection lists nine tools and calls resumen_de_ventas, lo_mas_vendido and productos_sin_ventas on the example store")` (acceptance 21)
- `test("an existing connection keeps working and sees the nine tools without a new scope")` (acceptance 21)
- `test("a call over the store limit answers the limit text with the seconds")` (acceptance 20)

`order-repository.integration.test.ts` (T0)
- `test("the created-date filter and newest-first order of the order search use Order_companyId_createdAt_idx")` (`EXPLAIN` on a seeded store)
- `test("summarizeUnpaidOrders gives the same figures after taking its balance and visibility from the shared fragments")`

### Web E2E

None: no screen changes.

### Pending manual checks

- Claude and ChatGPT connected to a preview with the example store: «¿cómo me fue este mes?», «¿qué es lo que más vendí?», «¿qué talla de polo sale más?», «¿qué no se está vendiendo?», in Spanish and in Portuguese; the agent repeats figures unchanged and does not recompute comparisons.
- MCP Inspector lists exactly nine tools, all read-only.
- On a preview store with years of history, `productos_sin_ventas` for the default 30 days answers in about a second, and a 366-day summary answers or says too many orders.

## 15. Limits and checks during implementation

- Left out: everything in the product draft's «Out of this version»; a time zone per store; a cache of figures; writes; dropping `OrderItem (companyId, variantId)`, now a prefix of the new index.
- T0 measures the opener overhead (2 statements, 3 with the storefront read) and pins `salesPathStatements`; T1 and T2 assert their measured counts equal it.
- **Acceptance is by cost, not by plan shape.** At 366 days the summary reads half of four years of orders and PostgreSQL correctly chooses a sequential scan and a hash join; forcing plans with `enable_seqscan`, hints or `LATERAL` rewrites to satisfy a plan-shape rule is forbidden. The load checks assert:
  1. every statement at the maximum period, in the worst shape of its tool (the case-2 period of 13 touched months for the summary; the stale 80-variant page for unsold), runs within half its statement budget (750 ms);
  2. the statements that exist for short periods (the 30-day summary and sold variants) are not slower on four years of history than on one (within 1.5 times plus 50 ms), which is what `Order_companyId_createdAt_idx` is for;
  3. the item-dates statement costs the same at one year and at four (same tolerance) and its probes use `OrderItem_companyId_variantId_orderCreatedAt_idx`;
  4. the only `EXPLAIN` index assertion is for windows of 31 days or fewer, run as `core_app` under the forced RLS policy (as `scripts/run-tests.sh` does), because bounds typed `timestamptz` would lose the index and an untyped or `::timestamp` bound keeps it.
- The fixture holds the store's four years plus the same volume in 20 other companies, runs `ANALYZE` after seeding, and includes the worst shapes of section 2.
- The pull request records, for each statement, the hardware, the first and the repeated run and the buffers read, not only milliseconds, so the margin can be transferred to the production database.
- If a period-bound statement fails the 750 ms rule at 366 days, `salesPeriodMaxDays` is lowered (the refusal text follows the constant) and the measured value goes in the pull request. A catalog-bound statement that fails it is rewritten, because shortening the period does not help.
- If the descriptions of 12,000 variants take more than a quarter of the budget, T2 reports it to the coordinator before splitting the read, because a split ranking path would have 6 statements and no margin.
- `GROUPING SETS` of the sold variants must stay hashable (no `DISTINCT` aggregate) and validate with one Zod schema with a nullable `variantId`.
- If the measured overhead or any path count differs from section 11, the change of `salesReadBudget` or `salesPathStatements` is the coordinator's decision, made before wave 2 continues; wave-2 tasks never edit them.
- The sales module exists with an empty tool list between T0 and the first tool on the integration branch only; it never reaches `main` that way.
- The pool reserve for the web app, order tools and per-call pipeline goes from 7 to 5 connections (section 11).

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T0  scopes, shared snapshot and slots, budget, item date column and indexes, history fixture, period, sales module frame and stubs
Wave 2:  T1  Resumen de ventas   ║   T2  Lo más vendido + Productos sin ventas      (parallel, both depend on T0; T2 is about twice T1)
Wave 3:  T3  nine-tool acceptance                                                   (depends on T1 and T2)
Wave 4:  T4  promote the drafts into docs/assistants.md                             (last step; the coordinator's documentation step; nothing depends on it)
```

Before T0 is dispatched the coordinator supersedes memories fc437ed9, 854b8b20, 3b49cccc and 4b823bad (MCP 3/4 adds no scope literal; the module declares `scopes`), or puts that rule in every worker brief: an implementer that follows the old memory and adds a literal to `assistantScopes` would end every live connection.

**File ownership.** Every shared file has one owner, and wave-2 tasks edit no common file: `salesReadBudget`, `salesPathStatements`, `assistant-tools.ts`, `assistant-tools.test.ts` (until T3), `features/orders/composition.ts`, `order-repository.ts` (including the item writes), the schema, the sales module and the history fixture belong to T0; T1 and T2 fill the stub files T0 creates for them (section 12) and write their own test files, with their 24 KB samples in their own tool files; `assistant-tools.test.ts` (nine names) and `sales-tools.integration.test.ts` belong to T3. A wave-2 task that needs a change in a T0 file escalates to the coordinator.

**Size.** T2 holds two tools, four use cases, two repositories in two features, the extracted text match and two load checks, about twice T1. With the exact dates read the unsold half is a single orders statement and a pure ordering, so the coordinator can plan T2's review in two parts (best sellers, then unsold) without splitting the task; a split would share `sold-variants-repository.ts`, `composition-sold-variants.ts` and `product-sales-projection.ts`.

**Acceptance criteria of the product draft by owner:** T0: 3 (pure), 12 (pure rounding and shares) and 16; T1: 1–5, 6 (summary), 11, 12 (projected), 15 (summary refusals), 17, 18 (summary), 3 (repository); T2: 6 (ranking and dates), 7–10, 13, 14, 15 (product tools), 17, 18 (ranking), 19; T3: 20 and 21.

### T0. Two-scope modules, the sales read frame, the item date and the history fixture

**Scope:** `ToolModule.scopes` with registry, validator, both existing modules and the corrected doc comment of `tool-module.ts`; `budgeted-snapshot.ts` extracted from products with the products behavior unchanged; `createReadSlots(count, waitMs)` extracted; `visibleOrder` and the `orderBalance` fragment extracted; `orders.readSalesForAssistant` with `salesReadBudget` and `salesPathStatements`; `sales-cents.ts`; `OrderItem.orderCreatedAt` with its backfill, written by every item insert path; the two index migrations; `sales-period.ts` and `sales-figures.ts`; `input-fields.ts`; `sales-texts.ts`; `sales-tools.ts` with `createSalesToolsModule(tools)`; the sales slot, `step` and the `salesRead` guard (failure-text choice by step, both logs); the stub files and wiring of section 12 (`assistant-tools.ts`, `orders/composition.ts`, the two capability files and two composition files); the orders paragraph without the no-totals sentence; the history load fixture and its index checks.
**Out of scope:** any sales tool, query or projection; `docs/assistants.md`.
**Acceptance criteria:**
1. A connection with both scopes lists the six existing tools; a module declared with both scopes is listed only to it, and one with only `orders:read` sees four tools and no sales paragraph.
2. Product tools behave as before: every existing product test, including the statement-count and the 3-slot tests, passes unchanged apart from imports; `summarizeUnpaidOrders` returns the same figures; existing order tests pass with the item column.
3. `resolveSalesPeriod` answers every row of the product draft's previous-period table and each refusal text of «Period inputs».
4. After `prisma migrate deploy` the column is not null and equals the order's `createdAt` for existing items and for items written by a create and by an edit; both indexes exist and are valid (`pg_index.indisvalid`); a no-change `migrate dev --create-only` emits nothing; a window read of 31 days or fewer, as `core_app`, uses `Order_companyId_createdAt_idx` on the four-year fixture, and the created-date search of **Buscar pedidos** uses it.
5. The guard answers the too-many-orders text only for a statement timeout in a period-bound step over 31 days, logs `sales_read_failed` once with its step, and the slot tests of section 14 pass; the budget invariant and the per-path margin tests pass.
6. `pnpm --dir apps/core mcp:validate` passes.
**Tests:** the unit and integration tests of section 14 marked T0.
**Depends on:** nothing.

### T1. Resumen de ventas

**Scope:** `orders.summarizeSales` with `sales-summary-repository.ts` and `composition-sales-summary.ts`; `sales-projection.ts`; `sales-summary-tool.ts` with its description (meaning of each figure, next-step tools with the creation dates, «Billetera digital» as Yape or Plin, open period, web remedy for cancelled money); `salesSummaryTools` in `assistant-sales-summary-capabilities.ts`; its sample outputs; its statement count (4) and its load check.
**Out of scope:** product tools; any T0 file; other modules' texts.
**Acceptance criteria:** the criteria owned by T1 through `resumen_de_ventas`; the October example store answers exactly the figures of criterion 1; a gap-leaving previous period reads neither window's gap; the summary issues exactly `salesPathStatements.summary` statements; the cost rules of section 15 hold for its statements on the four-year fixture, or `salesPeriodMaxDays` is lowered with the measured value in the pull request.
**Tests:** the T1 tests of section 14.
**Depends on:** T0.

### T2. Lo más vendido and Productos sin ventas

**Scope:** `orders.summarizeSoldVariants` and `findVariantSaleDates` with `sold-variants-repository.ts` and `composition-sold-variants.ts`; `products.describeVariantsForAssistant` and `products.listStockedForAssistant` with `product-sales-repository.ts`, `products/composition.ts` and the extracted `product-text-match.ts`; `product-sales-projection.ts`; `best-sellers-tool.ts` and `unsold-products-tool.ts` with their descriptions (singular-stem advice, `producto` ignoring the rest, last 30 days for unsold questions without a period); `productSalesTools` in `assistant-product-sales-capabilities.ts`; their sample outputs at maximum lengths; their statement counts (5 and 4) and load checks.
**Out of scope:** the summary; stock alerts (MCP 4/4); variants without sales inside a sold product; any T0 file.
**Acceptance criteria:** the criteria owned by T2 through `lo_mas_vendido` and `productos_sin_ventas`; the unsold list is ordered as the product draft says, including «none first» and oldest first at equal stock; each path issues exactly its `salesPathStatements` count; the cost rules of section 15 hold for both tools on the four-year fixture, including the stale 80-variant page; the existing product search answers the same results with the extracted text match.
**Tests:** the T2 tests of section 14.
**Depends on:** T0.

### T3. Nine-tool acceptance

**Scope:** the nine names pinned in `assistant-tools.test.ts`; `sales-tools.integration.test.ts` (criteria 20 and 21); a read of every tool description for contradictions between the two wave-2 tasks; `scripts/ci.sh` on the integration branch.
**Out of scope:** new behavior; any change to a tool, a read or a T0 constant (a defect goes back to the task that owns the file).
**Acceptance criteria:** criteria 20 and 21 of the product draft; the static validator lists exactly nine tools, all read-only; `scripts/ci.sh` passes.
**Tests:** those of section 14 marked T3.
**Depends on:** T1, T2.

### T4. Promote the drafts

**Scope:** rewrite `docs/assistants.md` with every item of the product draft's «Changes to permanent documents on merge» plus this design's architecture (module scopes, sales snapshot, budget and per-path statements, slots, the new pool reserve of 5 and who shares it, the cross-store slot risk and its trigger, the two indexes, the `OrderItem.orderCreatedAt` invariant and the read bounds, observability events), and `docs/orders.md` if it describes item fields, following the [Documentation](../../.agents/skills/documentation/SKILL.md) skill; delete both drafts. Done by the coordinator's documentation step; no other task depends on it.
**Out of scope:** repository memories (the coordinator updates them, as the product draft says).
**Acceptance criteria:** `docs/assistants.md` says nine tools, the sales group, the scope rule for groups over listed data, both new failure texts and «exactly nine tools» in the checking steps; no draft remains for this feature.
**Tests:** none new; the static validator and the full `test:unit` stay green.
**Depends on:** T3.

### Final verification

On the integration branch after T3: `scripts/ci.sh`; the static validator lists nine tools; the pending manual checks of section 14 with Claude and ChatGPT on a preview and with MCP Inspector. Results go in the pull request description.

## 17. Open items and questions

Questions (answer with the option number):

1. A currency with cancelled orders but no sales in either period: where does its money-on-cancelled remedy go? The product draft says «a currency without sales in either period has no block», and its question-2 remedy («En pedidos cancelados hay … Si devolviste ese dinero, anula esos pagos…») needs somewhere to appear. Example: an all-PEN store with one cancelled USD order that still holds a confirmed US$ 40.00.
   (1) Follow the product draft: no block and no line for that currency; the money stays unreported. Default implemented until answered. Consequence: that rare case loses the remedy.
   (2) One line per such currency after the last block, only when its cancelled orders hold confirmed money, for example «En pedidos cancelados en USD hay US$ 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web.», with no block. Recommended: it keeps «no block» and the remedy. Consequence: one more text in the product draft, to be amended before T1 if chosen.

### Questions decided by the review gate

1. **How many sales reads may be in flight at once, given the 10-connection pool?** Answer: (1) 2 sales slots separate from the 3 product slots. Decided by the review gate (design and performance reviewers, in agreement, rounds 1 and 2), as the founder's answer. Reason: a sales read can hold a connection up to 10 s; sharing slots would make a slow summary fail product searches that have a tighter 5 s budget; one slot would make two owners asking at month-end collide, and an agent calling two sales tools for one question would fail its second call. Accepted consequence: the reserve for the web app, order tools and per-call pipeline goes from 7 to 5 of 10 connections, and the slots are shared across stores (section 11). Discarded: (2) one shared pool of 3 slots, because two slow summaries would make product searches fail; (3) one separate slot, because a second concurrent summary would fail.
2. **With `texto` in Lo más vendido, does the other-currency line name the number of orders?** Answer: (1) no, units and amount, as the `producto` example. Decided by the review gate (both reviewers, rounds 1 and 2), as the founder's answer. Reason: the order count of matching products cannot be summed from per-variant totals, it would cost one more statement on a path with one statement of margin, and other currencies are rare. Discarded: (2) yes, with one more statement per call.
3. **How is the order of Productos sin ventas met within the read budget?** Answer: (a) an immutable `OrderItem.orderCreatedAt` copied from the order's `createdAt`, with index `(companyId, variantId, orderCreatedAt)`, giving exact last and first sale dates per variant at a cost bounded by the catalog. Decided by the coordinator on the recommendation of both reviewers in round 2, as the founder's answer. Reason: it meets the closed product rule exactly («most stock first, then oldest last sale before the period, none first, then name»), the product draft does not change, and the unsold path drops to 4 statements. Discarded: (b) an `EXISTS` per variant, which restores «none first» only; (c) amending the product rule (look-back of 183 days, order by name in the tied group), which contradicts what the page shows beside it; the same page-only dates read, which cost about 1 s for an 80-variant stale page.

### Decided unless objected

- `ToolModule.scope` becomes `scopes`; a module is offered only when every scope is held; no scope literal is added (product question 3). The coordinator supersedes memories fc437ed9, 854b8b20, 3b49cccc and 4b823bad before T0 is dispatched.
- Orders owns every read that decides what a sale is; products owns names, combinations, the text match and stock; the composition joins them in memory by variant id.
- One RepeatableRead snapshot per call with `salesReadBudget` 1 s / 10 s / 1.5 s per statement / 6 statements, fixed here and edited only by T0; paths count 4, 5 and 4 statements (overhead 2 `set_config`, the storefront read where used, the reads); `lo_mas_vendido` with `producto` uses a light products read by product id.
- The budgeted snapshot reports failures to an `onFailure` callback; products keep `product_search_failed` and sales log `sales_read_failed` once, with the step, in the composition guard.
- Sales slots: 2 per process, 2,000 ms wait; product slots unchanged. No cap per company: starvation needs one store producing sustained failing reads, `assistant_sales_reads_busy` shows it, and T4 records the trigger (a cap of one in-flight sales read per company if it appears).
- Too many orders means a statement timeout in a period-bound step of a period over 31 days; every other failure, including any catalog-bound step, answers the sales reading-failure text.
- `OrderItem.orderCreatedAt` (immutable copy of the order's `createdAt`, written by every item insert, backfilled) and its index, in T0, with the two `Order`/`OrderItem` indexes created concurrently as `add_order_dispatch_queue_index` was; no other schema change.
- Every statement is bounded by the windows read (each at most 366 days, the gap of a case-2 previous period excluded) or by the catalog; acceptance is by cost (750 ms at the maximum period in the worst shape; short-window statements not slower on four years than on one), not by plan shape; the fixture has four years, other companies' rows and the worst shapes.
- Summary: one statement (figures, methods, pending reports, `storeHasOrders` with `visibleOrder`), payments only of the window's orders, owed from one balance fragment shared with **Pedidos por cobrar**.
- Money: integer-cent text from SQL, no `decimal.js` in core, half-up on the magnitude, ticket comparison on rounded averages.
- Bounds compared with `createdAt` are untyped or `::timestamp`, never `::timestamptz`.
- Period, previous period, shares, comparisons and ranking are pure functions in `features/assistants/domain`.
- Sales instructions paragraph within 700 characters.
- Logs: `sales_read_failed` (error, with `step`, `periodDays` and `answer`) and `assistant_sales_reads_busy` (warn); no input, amount or name is logged.
- Five tasks in four waves: T0, then T1 and T2 in parallel (T2 about twice T1), then T3 (nine-tool acceptance), then T4 (the permanent docs, last).

## 18. Review gate: how each finding was resolved

### Round 2

| Finding | Resolution |
| --- | --- |
| Design B1, performance B3 (order of Productos sin ventas contradicts the product draft) | Option (a) decided by the coordinator: `OrderItem.orderCreatedAt` and its index in T0; exact dates per variant; look-back and `salesLookBackDays` removed; the product draft unchanged (2, 5.4, 7, 17 question 3) |
| Performance B1 (exact-dates statement bounded by history, worst page unmeasured) | One statement of `LIMIT 1` probes for every checked variant, catalog-bound; the unsold path drops to 4 statements; the fixture's worst page is 80 stale variants (one of 60) with 3,000 old items each, on page 1 (2, 5.4, 7.1, 14) |
| Performance B2 (plan-shape rule fails correct plans) | Cost-based acceptance (750 ms at 366 days in the worst shape; short windows not slower on four years than on one; `EXPLAIN` index assertion only for windows of 31 days or fewer as `core_app`); no forced plans; fixture with other companies and `ANALYZE` (2, 15) |
| Performance S1 (`::timestamptz` loses the index under RLS) | Accepted: untyped or `::timestamp` bounds, stated in the Index row, in 5.4 and in the checks (2, 15) |
| Performance S2 (record hardware, runs, buffers) | Accepted (15, 14) |
| Performance S3 (cap per company) | Rejected for now: starvation needs sustained failing reads from one store, the busy log shows it, and T4 records the trigger; a cap adds state and a test (17) |
| Performance S4 | No action |
| Design S1 (case-2 gap) | Two explicit window predicates, rows in neither dropped, test of the 25/09 order, real bound 2 × 366 days with the 13-month shape in the fixture (5.2, 7.1, 14) |
| Design S2 (`decimal.js` not resolvable from core) | Integer cents from SQL (`round(sum(x) * 100)::bigint::text`); no `decimal.js`; `sales-cents.ts` (2, 12, 14) |
| Design S3 (two tasks edit `assistant-tools.test.ts`) | The three maximum samples move to the tools' own files and tests; the file belongs to T0 then T3 (14, 16) |
| Design S4 (test gaps for acceptance 5, 11, 12) | Titles added; acceptance 12 assigned to T0 (pure) and T1 (projected) (14, 16) |
| Design S5 (too-many text for period-independent statements) | Each read tagged `period` or `catalog`; the guard answers too-many only for a period-bound step; `step` is logged (2, 5.1, 13) |
| Design S6 (T2 size) | Imbalance stated (about twice T1) and a two-part review suggested; the exact dates read removes most of the unsold work (16) |
| Design S7 (cancelled-only currency block) | The product draft is not silent («a currency without sales in either period has no block»), so the design follows it; the lost remedy for that rare case is question 1 with a recommended option (6.4, 17) |

### Round 1

| Finding | Resolution |
| --- | --- |
| Design B1, performance B1 (`producto` does not fit the budget; undercounted `set_config`) | Light `by: "product"` read instead of `findForAssistant` (5.5); statement counting stated (section 2); per-path counts pinned and tested with margin (6.3, 11) |
| Design B2, performance B2 and B3 (reads bounded by history; fixture without history) | Read bounds (7.1); four-year fixture with both windows and old history (section 2); round 2 completed it with the item date and cost-based checks |
| Load check in the task that introduces the reads | Fixture and index checks in T0; each load check file in T1 or T2 beside the statements it measures (12, 14, 16) |
| Design B3 (criterion 21, nine-tool assertions, shared files, budget constant) | T3 owns criteria 20–21 and the nine names; stubs let T0 finish every shared file; T0 alone edits the budget (16) |
| Design S1 (where `sales_read_failed` is logged) | Logged once in the `salesRead` guard; the snapshot has `onFailure` (5.7, 6.3, 13) |
| Design S2 (exact cents, half-up negatives, ticket comparison) | Magnitude rounding, rounded averages, tests (2, 6.4, 14); the cents source changed in round 2 |
| Design S3, performance S6 (index precedent) | `add_order_dispatch_queue_index` precedent, `indisvalid` check, no-change `create-only` check (7) |
| Design S4 (`hasAnyOrder` and `visibleOrder`) | `storeHasOrders` applies `visibleOrder` inside the summary statement (5.2) |
| Design S5 (owed rule shared with Pedidos por cobrar) | `orderBalance` fragment and an integration assertion (2, 5.2, 14) |
| Design S7 (stale guidance) | `tool-module.ts` comment corrected in T0; memories superseded by the coordinator before T0 (12, 16) |
| Design S8 (test gaps) | Titles added for criteria 2, 3, 4, 8 and the maximum unsold page (14) |
| Design S9, performance S8 (slots shared by every store; reserve shared) | Stated in 11, recorded by T4 |
| Performance S1 (company-wide payment grouping) | Payments only of the window's orders (7.1) |
| Performance S2 (merge the two summary statements) | One statement (5.2) |
| Performance S3 (EXPLAIN of joins) | Replaced in round 2 by the cost rules (15) |
| Performance S4 (describe over-fetch) | The `producto` path no longer over-fetches; the ranking description is measured with 12,000 ids and not split, to keep a statement of margin (5.5, 15) |
| Performance S5 (`GROUPING SETS` with `count(DISTINCT)`) | Sums only in the grouping sets, orders counted in the window CTE (5.3) |
| Performance S7 (slot wait) | 2,000 ms for sales slots, product slots unchanged (2, 11) |
