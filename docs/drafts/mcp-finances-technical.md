# Sales and best sellers in the AI assistant: technical design

**Status:** draft, round 2 after review gate round 1 (rejected; section 18 lists how every finding was resolved); no open question. Based on [`docs/drafts/mcp-finances.md`](mcp-finances.md) (product definition closed at `177d3b0b`). Base: `jorgeluis594/mcp-3-4-finanzas-por-periodo-y-lo-mas-ve` at `177d3b0b`, on top of the merged MCP 1/4 and 2/4 documented in [AI assistants](../assistants.md).

## 1. Technical goal

Core adds three read-only tools to the MCP server, `resumen_de_ventas`, `lo_mas_vendido` and `productos_sin_ventas`, in one new tool module that requires both current scopes (`orders:read` and `products:read`). Each call goes through the unchanged per-call pipeline (connection, tenant context, store limit, «Último uso», input validation), resolves a period of whole Lima days, reads aggregates over orders, items, payments, variants and stock in one budgeted RepeatableRead snapshot (4 to 5 statements, every one bounded by the windows read or by the catalog, section 7.1), and returns a strict Spanish projection within 24 KB. No scope literal is added, no connection ends, nothing is written and no contract in `shared/` changes.

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
        ├─ orders.summarizeVariantActivity       (Order + OrderItem, period + 183 days back)
        ├─ orders.findVariantSaleDates           (OrderItem + Order, the page's variants only)
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
| Who owns each read | The orders feature owns every read that decides what a sale is (not cancelled, visible, created in the period): `summarizeSales`, `summarizeSoldVariants`, `summarizeVariantActivity`, `findVariantSaleDates`, and the snapshot opener `readSalesForAssistant`. The products feature owns product identity, current names, combinations, the text match and stock: `describeVariantsForAssistant`, `listStockedForAssistant`. Orders returns variant ids; products never reads orders; the composition joins them in memory. |
| Snapshot | One RepeatableRead snapshot per call opened by `orders.readSalesForAssistant`, with its own fixed budget `salesReadBudget = { maxWait: 1000, timeout: 10000, statementTimeoutMs: 1500, maxStatements: 6 }` and JIT off. The budget is the same for every tool and is fixed here, not discovered in T1/T2 (section 11 counts the statements of every path: 4, 5 and 5, one statement of margin). The generic budgeted snapshot is extracted from `products/infrastructure/assistant-read.ts` to `src/shared/infrastructure/budgeted-snapshot.ts`; it classifies failures and reports them to an `onFailure` callback, and each caller logs its own event (products keeps `product_search_failed` and its own constants; sales logs in the composition guard). |
| Statement counting | As memory 03011cbe: a counted statement is one that runs under the statement timeout, so the two `set_config` statements (tenant and timeout, `jit` off) and the storefront read count; `BEGIN`, `SET TRANSACTION` and `COMMIT` do not. Overhead is 2 statements, 3 with the storefront read. |
| In-flight limit | At most 2 sales reads in flight per process, separate from the 3 product slots (question 1, option 1). A call waits up to 2,000 ms for a sales slot; the wait runs before any transaction, holds no pool connection and costs nothing in pool terms, so an agent that asks for the summary and the ranking in parallel, plus a third call, still gets all three answers at normal volume. Product slots keep their 300 ms. The counting semaphore moves from `assistant-product-capabilities.ts` to `src/composition/assistant-read-slots.ts` with the wait as a parameter. The slots are shared by every store in the process (section 11). |
| Too many orders | The «demasiados pedidos» text is answered when the snapshot fails with `STATEMENT_TIMEOUT` and the period read has more than 31 days. `TRANSACTION_TIMEOUT` (pool wait or Prisma timer), `PERSISTENCE_UNAVAILABLE`, a 31-day-or-shorter period over budget and a busy slot answer the sales reading-failure text. Reason: the budget makes the statement limit fire before the transaction timer, so only a statement timeout means the period itself is too heavy. |
| Maximum period | 366 days, constant `salesPeriodMaxDays` (initial value). Each tool's load check (section 14) runs every statement of the tool on the history fixture below at the maximum period; the value is lowered only if a statement exceeds half its statement budget (750 ms) there. |
| Expected maximum volume | 60,000 orders a year (about 165 per day), 2 items and 1.2 payments per order, 3,000 products with 4 variants. The load fixture (T0) seeds four years at that rate: the 366-day period, the 366-day previous period read by the summary (732 days) and two years of earlier history, with 240,000 orders, 480,000 items and 290,000 payments; 30% of the variants have no sale in the last 549 days and 20 of them hold 3,000 old items each. Initial value, adjustable; above any current store and above the 50,000 orders `summarizeUnpaidOrders` was measured with. |
| Index | `Order_companyId_createdAt_idx` on `"Order"("companyId", "createdAt")`, created concurrently. Reason: without it a period read scans the store's whole order history, so a month costs the same as five years and the 366-day rule could not be calibrated by period (section 7.1). It also serves the existing created-date filter and newest-first sort of **Buscar pedidos**. |
| Period rules | Pure functions in `features/assistants/domain/sales-period.ts` over calendar days `AAAA-MM-DD`: defaults, cut to today, refusals, length, previous period (three cases). Day bounds become instants with `limaMidnightUtc` and `nextCalendarDay` of `shared/orders-date.ts` (`salesTimeZone`), the same helpers as **Buscar pedidos**. |
| Money | Sums are computed in SQL as `numeric`, returned as decimal text and validated with Zod. Orders converts the text to integer cents exactly with `decimal.js` (`new Decimal(text).times(100)`, already a dependency of `shared`; never `Number(text) * 100`) and builds `Money` as `cents / 100`; the assistants domain reads cents back with `Math.round(amount * 100)`, exact for two-decimal amounts. Average ticket and percents are computed in integer cents with half-up rounding of the magnitude, the sign reapplied (−14.5% → −15%), in pure functions; no floating-point division decides a rounded figure. The ticket comparison uses the two rounded averages, so the displayed figures and the difference reconcile. Currencies are grouped, never added. |
| Payment method labels | `walletProviderLabel` of `shared/wallet-providers.ts` (the country catalog) for a provider, «Transferencia bancaria» for `bank_transfer`, «Billetera digital sin especificar» for a wallet payment without provider. No country literal in the sales code. |
| Text match | `texto` reuses the product search's accent- and case-insensitive partial match on the product name or any variant SKU, extracted to one function in `products/infrastructure` used by the search and the new reads. |
| Other-currency line with a filter | With `texto` or `producto`, the other-currency line names units and amount, without an order count, as the product draft's `producto` example (decided by the review gate, section 17). |
| Owed rule | One SQL fragment, `orderBalance`, in `features/orders/infrastructure/order-balance.ts`, extracted from `summarizeUnpaidOrders` (`total − confirmed` for an order whose `confirmed < total`) and used by it and by the summary, so «Por cobrar de estas ventas» and **Pedidos por cobrar** cannot drift. |
| Last sale of unsold products | The exact «Última venta antes del periodo» and «Volvió a venderse» dates would need every older item of every checked variant. The design reads them only for the variants of the 20 products on the page; the order of the list uses the last sale found in the 183 days before the period (`salesLookBackDays`). See section 7.1 and «Decided unless objected». |
| Server instructions | The orders paragraph drops «Este conector todavía no da totales de ventas ni finanzas…». The sales paragraph carries only the four rules of the product draft and stays within 700 characters, pinned by a unit test. |
| Shared contracts | None change. Inputs and outputs are internal to `features/assistants`, as the order and product tools. |
| Deferred | A per-variant last-sale date kept up to date (a column on `OrderItem` or a read model); everything the product draft lists under «Out of this version». MCP 4/4 adds its own module and reuses `scopes`. |

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
| Order, payment, item tables | `prisma/schema.prisma`: `Order` (`currency`, `total`, `itemsTotal`, `deliveryCharge`, `deliveryCost`, `cancelled`, `fromCatalog`, `checkoutConfirmedAt`, `createdAt`), `Payment` (`status`, `amount`, `currency`, `method`, `walletProvider`), `OrderItem` (`variantId`, `quantity`, `subtotal`) | Read only. A payment's currency always equals its order's (`order-state-machine.ts`) |
| Order indexes | `(companyId, id)`, `(companyId, number)`, `(companyId, chatId)`, `(companyId, completedAt, id)`, partial `Order_undeducted_pending_idx`, `Order_dispatch_queue_idx`; none on `(companyId, createdAt)` | Index added; precedent `20261030230316_add_order_dispatch_queue_index` |
| Item and payment indexes | `OrderItem (companyId, orderId, variantId)` unique, `OrderItem (companyId, variantId)`, `Payment (companyId, orderId, id)` | Reused |
| Product, variant, stock | `Product` (`name`, `currency`, `createdAt`), `ProductVariant` (`status`, `sku`), `ProductStock` (`quantity`), values through `ProductVariantOptionValue`; text match with `unaccent(lower(…)) LIKE` in `product-search-repository.ts` | Read only; match extracted |
| Stock levels | `features/products/domain/stock-level.ts` (`stockLevelOf`), product line summary in `assistants/domain/product-projection.ts` | Reused |
| Wallet labels | `shared/wallet-providers.ts` (`walletProviderLabel`, Peru catalog Yape, Plin) | Reused |
| Logged tool call | `assistant_tool_called` in the registry, outcome `failure` for read failures | Reused |

## 4. Gaps this design closes

1. A module cannot require two scopes (section 6.1).
2. No read aggregates sales of a period by currency with received, owed, overpaid, method breakdown, pending reports and cancelled lines (5.2).
3. No read sums units and amounts per variant sold in a period, nor tells which variants sold or the last and next sale dates of a variant (5.3, 5.4).
4. No products read returns current product names and combinations for a set of variants, nor the products with stock today created by a date with their variants (5.3, 5.4).
5. No snapshot spans orders, products and catalog reads with a budget that fits every tool's statements, and the budgeted snapshot lives inside products (6.3, 11).
6. No index lets a period read cost in proportion to the period, and no read bounds the history it looks at (7, 7.1).
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

1. `readFigures` runs one statement, with one CTE of the orders visible and created in `[previous.from, current.before)` read through `Order_companyId_createdAt_idx`, one CTE of the payments of those orders only (section 7.1), and `UNION ALL` branches that return typed rows (`kind`): the figures per window and currency with the cancelled counters, the confirmed payments per window, currency, method and provider, the pending reports of the current window, and `EXISTS (… visibleOrder)` for `storeHasOrders`. One Zod discriminated union validates the rows. A summary is therefore 1 read statement, always the same count.
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

### 5.4 `summarizeVariantActivity` and `findVariantSaleDates` (orders, application)

```ts
export type VariantActivityInput = Readonly<{ window: SalesWindow; lookBackFrom: Date }>;       // lookBackFrom: Lima midnight, salesLookBackDays before window.from
export type VariantActivity = Readonly<{ variantId: string; soldInWindow: boolean; lastBefore: Date | null }>;   // lastBefore: latest sale in [lookBackFrom, window.from)
export async function summarizeVariantActivity(input: VariantActivityInput, access: OrderAccess, deps: Readonly<{
  readActivity: (input: VariantActivityInput, companyId: CompanyId) => Promise<Result<readonly VariantActivity[], SummarizeSalesError>>;
}>): Promise<Result<readonly VariantActivity[], SummarizeSalesError>>

export type VariantSaleDates = Readonly<{ variantId: string; lastBefore: Date | null; firstAfter: Date | null }>;   // exact, in any date
export type FindVariantSaleDatesInput = Readonly<{ window: SalesWindow; variantIds: readonly string[] }>;           // the variants of one page
export async function findVariantSaleDates(input: FindVariantSaleDatesInput, access: OrderAccess, deps: Readonly<{
  readSaleDates: (input: FindVariantSaleDatesInput, companyId: CompanyId) => Promise<Result<readonly VariantSaleDates[], SummarizeSalesError>>;
}>): Promise<Result<readonly VariantSaleDates[], SummarizeSalesError>>
```

- `summarizeVariantActivity`: one statement over the items of visible, not cancelled orders created in `[lookBackFrom, window.before)` (at most 366 + 183 = 549 days, read through the createdAt index and `OrderItem (companyId, orderId, variantId)`), grouped by variant: `bool_or` inside the window and `max(createdAt)` before it. It takes no variant ids: its rows are the variants that sold in that span, at most the catalog's variants, so no id list travels to the database. A unit in any currency counts. Variants without a sale in the span are absent.
- `findVariantSaleDates`: one statement over `unnest($variantIds::uuid[])` with, per variant, a correlated `max(createdAt)` before `window.from` and `min(createdAt)` at or after `window.before` over `OrderItem (companyId, variantId)` joined to the order by its primary key, visible and not cancelled. It is exact, in any date, and its cost is the older items of the variants of one page (at most 20 products), never of the whole store (section 7.1). The composition skips it when the page is empty.

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

`orders.readSalesForAssistant(work)` opens the budgeted snapshot of 6.3 with `salesReadBudget` and no `onFailure`, and runs `work`, in which every read of 5.2–5.6 and `catalogStorefront.describe` join the open transaction. It returns `Result<T, E | SalesReadError>` with the failure classification and nothing logged. The composition guard `salesRead` (6.5) logs `sales_read_failed` once, because it alone knows the operation, the period read and the answer chosen, which is product policy and must not live in `src/shared/infrastructure`.

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
export const salesLookBackDays = 183;                                                               // how far back the order of Productos sin ventas looks
export function resolveSalesPeriod(input: Readonly<{ desde?: string; hasta?: string }>, today: string): Result<SalesPeriod, PeriodRefusal>;
export function previousPeriod(period: SalesPeriod): PreviousPeriod;
export function periodDays(period: Readonly<{ from: string; through: string }>): number;
export function windowOf(period: Readonly<{ from: string; through: string }>): Readonly<{ from: Date; before: Date }>;
export function lookBackFrom(period: Readonly<{ from: string }>): Date;                           // Lima midnight salesLookBackDays before period.from
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
export const salesPathStatements = { summary: 4, best_sellers: 5, unsold: 5 } as const;   // overhead 2 + storefront 1 where the tool reads it, plus its reads (section 11)
```

Unit tests pin, for both budgets, `maxStatements × statementTimeoutMs + maxWait ≤ timeout` (6 × 1500 + 1000 = 10,000), and for the sales budget that every `salesPathStatements` value is at most `maxStatements − 1`, so each path keeps one statement of margin and the invariant holds on every path. Only T0 edits these constants; a tool whose measured count differs escalates instead of editing them.

### 6.4 Projections (pure, `features/assistants/domain`)

- `sales-figures.ts` (shared by the three tools): `centsOf(money)`; `roundHalfUp(numerator, denominator)` on integers, rounding the magnitude and reapplying the sign; `sharePercent(part, whole)` → `{ kind: "percent"; value } | { kind: "under_one" }`; `averageCents(totalCents, orders)`; `compareFigure(current, previous)` → `{ kind: "same" } | { kind: "more" | "less"; difference; percent: number | "under_one" | null }` (`null` when the previous figure is 0); `counted(n, singular, plural)`. Percent of a comparison is relative to the previous figure, half up, with the sign of the difference. The ticket comparison compares the two rounded averages.
- `sales-projection.ts` (summary): `SalesSummaryOutput` from `SalesSummary`, the period, the previous period and the store currency: blocks ordered store currency first then code A–Z, a block per currency with sales in either window or with cancelled orders in the current window (a block with only cancelled orders opens with «No hay ventas en USD del …» as the product draft's block without sales, then its cancelled lines, so the money-on-cancelled remedy is never lost; an assumption recorded in section 17), the meaning line once, method lines largest first then label A–Z, the comparison or the previous figures alone, the open-period line when `through` is today, the cancelled lines, the singular forms.
- `product-sales-projection.ts` (both product tools): `rankSoldProducts(variants, described, { order, page, storeCurrency, text })` groups store-currency variant rows by product, keeps matching products, sorts (units: units, amount, name; amount: amount, units, name; names with `Intl.Collator("es", { sensitivity: "base" })`), pages 20 and caps variants at 3 (units, amount, combination); `listUnsoldProducts(checked, activity, { page })` keeps products none of whose variants sold in the window, folds the activity per product (latest `lastBefore`), sorts by stock, last sale found in the look-back (none first), name, and pages 20; `foldSaleDates(page, dates, { periodEndedBeforeToday })` then replaces the look-back date with the exact dates of `findVariantSaleDates` for the products of the page.

### 6.5 Layers

| Layer | Types and authority |
| --- | --- |
| `features/orders` | What a sale is and every money figure: `SalesFigures`, `SoldVariantsSummary`, `VariantSaleDates`; rows validated with Zod (`INVALID_STORED_ORDER` on an invalid row) |
| `features/products` | Product identity, current names, combinations, text match, stock: `DescribedVariant`, `StockedProducts` |
| `features/assistants/domain` | Period, previous period, comparisons, shares, ranking, wording; its own `Projectable*` types, no import from orders or products |
| `src/composition/assistant-sales-capabilities.ts` | The only place that sees both sides: maps feature types onto assistant types, joins variants with products in memory, chooses the failure text and logs `sales_read_failed` once |

## 7. Persistence

One migration, generated with the Prisma CLI per the [Database migrations](../../.agents/skills/database-migrations/SKILL.md) skill: `@@index([companyId, createdAt])` on `Order` (a plain index, so it is declared in `schema.prisma`, unlike the partial indexes of memory a20f16a6), migration `add_order_company_created_at_index`, edited to follow `20261030230316_add_order_dispatch_queue_index`: alone in its file, `RESET lock_timeout; RESET statement_timeout;` first, a comment with the recovery (`DROP INDEX CONCURRENTLY IF EXISTS "Order_companyId_createdAt_idx"; prisma migrate resolve --rolled-back <migration>`; deploy again) and `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_companyId_createdAt_idx" ON "Order" ("companyId", "createdAt")`. `IF NOT EXISTS` silently keeps an INVALID index left by a failed build and the planner ignores it, so T0's acceptance checks `pg_index.indisvalid`. After adding the `@@index`, a no-change `prisma migrate dev --create-only` must emit nothing. Plain columns, so row-level security does not prevent its use (no non-leakproof function in the key). No table, column, constraint or policy changes; no data is deleted.

Every new query filters `"companyId" = $companyId` explicitly besides RLS, repeats `visibleOrder` from the shared file, and validates its rows with a Zod schema (decimal strings `^\d+(\.\d+)?$`, integer counts, currencies with `isCurrency`). Database failures inside the snapshot are rethrown, as `findOrderedVariantIds` does, so the snapshot classifies them; outside a transaction they map to `PERSISTENCE_UNAVAILABLE`.

### 7.1 Read bounds

Every statement is bounded by the windows it reads, by the catalog, or by a list of at most one page; none depends on the store's whole history. «Window» is the period, plus the previous period for the summary: at most 366 + 366 = 732 days.

| Statement | Bound | How it is bounded |
| --- | --- | --- |
| Summary figures (one statement) | Orders of `[previous.from, current.before)`, at most 732 days | Orders through `Order_companyId_createdAt_idx`. Payments only of those orders: the payment CTE joins the window's orders and is served by `Payment (companyId, orderId, id)`; the `WHERE "companyId" = …` grouping of every payment that `summarizeUnpaidOrders` uses is forbidden here. If the plan on the history fixture reads `Payment` with a sequential scan, the statement uses a correlated `LATERAL` probe per order, as `findDispatchCandidates` does |
| `storeHasOrders` | One row | `EXISTS` stops at the first visible order of the company |
| Sold variants | Orders of the period, at most 366 days | Same index; their items probed through `OrderItem (companyId, orderId, variantId)`, driven by the window and not by a hash of every item of the store |
| Variant activity | Orders of `[lookBackFrom, window.before)`, at most 549 days | Same index and item probes; rows at most the catalog's variants |
| Exact sale dates | Variants of one page (≤ 20 products) | `OrderItem (companyId, variantId)` then the order by primary key, per variant; its cost is the older items of those variants, not of the store. The fixture holds 20 stale variants with 3,000 old items each to measure the worst page |
| Product descriptions, stocked products | The catalog (3,000 products, 12,000 variants) | Joins on product and variant keys |

Why the sale dates of unsold products are not exact for every product: the last sale before the period of every checked variant has no index that skips history (`OrderItem` has no date of its own, so each older item costs a heap read of its order). On a store with years of history and the default 30 days, that statement would grow with the history and would fail on every call as the generic reading failure, which the too-many-orders rule cannot distinguish for a short period. Reading the page's variants only keeps the displayed dates exact. Only the order inside the list uses the 183-day look-back: among products with the same stock, those with no sale in the look-back are ordered by name instead of by an older last-sale date. A kept per-variant last-sale date (a column and index on `OrderItem`, or a read model) would make both exact; it is deferred (section 2) and recorded in «Decided unless objected».

## 9. Events and cross-feature integration

No event. Cross-feature capabilities, all composed operations:

| Capability | Owner | Consumer |
| --- | --- | --- |
| `orders.readSalesForAssistant`, `orders.summarizeSales`, `orders.summarizeSoldVariants`, `orders.summarizeVariantActivity`, `orders.findVariantSaleDates` | orders | `src/composition/assistant-sales-capabilities.ts` |
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
| `productos_sin_ventas` | overhead 2, stocked products, variant activity, exact dates of the page's variants (skipped for an empty page) | 5 |

The worst path has 5 statements against `maxStatements: 6`: one statement of margin on every path, and `6 × 1,500 + 1,000 = 10,000 ≤ 10,000`, so on every path the statement limit fires before the transaction timer. A call holds a pool connection at most 10 s, and only in a failure; a normal call holds it for hundreds of milliseconds.

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
| `src/composition/assistant-sales-capabilities.ts` (+ integration test) | New: sales slot (2, 2,000 ms), `salesRead(operation, access, period, work)` guard: failure-text choice, `sales_read_failed` and `assistant_sales_reads_busy` logs | T0 |
| `src/composition/assistant-sales-summary-capabilities.ts` | New in T0 exporting `salesSummaryTools = []`; T1 fills it | T0, T1 |
| `src/composition/assistant-product-sales-capabilities.ts` | New in T0 exporting `productSalesTools = []`; T2 fills it | T0, T2 |
| `src/composition/assistant-tools.ts` | Sales module entry `createSalesToolsModule([...salesSummaryTools, ...productSalesTools])`; never edited again | T0 |
| `src/composition/assistant-tools.test.ts` | Expected names derived: the six existing tools plus the tools of the sales module; T3 pins the nine names | T0, T3 |
| `features/orders/infrastructure/order-visibility.ts`, `order-balance.ts` | New: `visibleOrder` moved from `order-repository.ts`; `orderBalance` fragment extracted from `summarizeUnpaidOrders` | T0 |
| `features/orders/infrastructure/order-repository.ts` | Imports both fragments; no behavior change | T0 |
| `features/orders/infrastructure/sales-read.ts` | New: `salesReadBudget`, `salesPathStatements`, snapshot opener | T0 |
| `features/orders/infrastructure/decimal-cents.ts` (+ test) | New: exact decimal text → cents | T0 |
| `features/orders/composition.ts` | `readSalesForAssistant`; spreads `salesSummaryOperations` and `soldVariantsOperations`; never edited again | T0 |
| `features/orders/composition-sales-summary.ts`, `composition-sold-variants.ts` | New in T0 exporting `{}`; T1 and T2 fill them | T0, T1, T2 |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_add_order_company_created_at_index/` | Index | T0 |
| `tests/support/sales-load-fixture.ts` (+ `sales-load-fixture.integration.test.ts`) | New: the history fixture of section 2 (opt-in, `SALES_LOAD=1`) and the checks of the index (`indisvalid`, plan on four years of history) | T0 |
| `features/orders/application/summarize-sales.ts` (+ test), `infrastructure/sales-summary-repository.ts` (+ integration test) | New | T1 |
| `features/assistants/domain/sales-projection.ts` (+ test), `presentation/tools/sales-summary-tool.ts` (+ test) | New | T1 |
| `src/composition/sales-summary-tool.integration.test.ts`, `sales-summary-load.integration.test.ts` | New: summary through `/mcp` with its statement count; load check on the T0 fixture | T1 |
| `features/orders/application/summarize-sold-variants.ts`, `summarize-variant-activity.ts`, `find-variant-sale-dates.ts` (+ tests), `infrastructure/sold-variants-repository.ts` (+ integration test) | New | T2 |
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
| `sales_read_failed` | error | the `salesRead` guard in `assistant-sales-capabilities.ts`, once per failed call (the shared snapshot logs nothing for sales) | `["companyId", "operation", "errorCode", "periodDays", "answer", "durationMs"]`; `operation` `summary`/`best_sellers`/`unsold`, `errorCode` `STATEMENT_TIMEOUT`/`TRANSACTION_TIMEOUT`/`PERSISTENCE_UNAVAILABLE`, `answer` `too_many_orders`/`read_failure` |
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

`budgeted-snapshot.test.ts` and `assistant-read.test.ts`
- `test("keeps maxStatements × statementTimeoutMs + maxWait within the transaction timer for the product and the sales budgets")`
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

`sales-figures.test.ts`
- `test("rounds the average ticket half up to the cent")`
- `test("shows a share below 0.5% as menos de 1% and never adjusts shares to 100")` (three methods at S/ 10.00 → 33% each)
- `test("states a comparison with both figures, the direction in words and a percent of the previous figure")` (680 vs 600 → +13%; 170 vs 200 → −15%)
- `test("shows menos de 1% for a non-zero difference that rounds to 0 and no percent when the previous figure is 0")` (601 vs 600; 380 vs 0)
- `test("uses the singular for one in every counter")`

`summarize-sales.test.ts` (fakes)
- `test("asks whether the store has orders only when both periods are empty")`
- `test("answers the persistence failure of its reads without a partial summary")`

`sales-projection.test.ts`
- `test("projects the October example: sales, products, deliveries, orders, ticket, received by method, owed, overpaid, review and cancelled lines")` (acceptance 1)
- `test("projects the summary after voiding a confirmed payment of #1001")` (acceptance 2)
- `test("shows Recibido S/ 0.00 and no method breakdown when no payment is confirmed")`
- `test("adds the open-period line only when the period read ends today")`
- `test("shows the previous figures alone for an empty period and Tampoco hubo ventas when both are empty")`
- `test("orders currency blocks store currency first then by code and opens a block without sales with its currency")` (acceptance 18)
- `test("says Tu tienda todavía no tiene pedidos alone for a store without orders")`

`sales-summary-tool.test.ts`
- `test("refuses invalid periods with their texts and calls no port")` (acceptance 15)
- `test("answers the too-many-orders text the port chose and the reading-failure text otherwise")`

`product-sales-projection.test.ts`
- `test("ranks the October example by units and by amount with whole-period shares")` (acceptance 7)
- `test("shows three variants and the remaining count, and every variant for one product")` (acceptance 8)
- `test("keeps the whole-period share and names the denominator when texto narrows the ranking")`
- `test("ranks only the store currency and adds one line per other currency, filtered without order count")`
- `test("lists products with stock that did not sell, ordered by stock, last earlier sale and name")` (acceptance 10)
- `test("folds variant sale dates into the product's last sale before and first sale after the period")`
- `test("says Volvió a venderse only for a period that ended before today")`
- `test("picks the empty text in order: no products, no match, no stock, all created after, all sold")` (acceptance 13)
- `test("adds the short-period line under 14 days")` (acceptance 14)

`best-sellers-tool.test.ts`, `unsold-products-tool.test.ts`
- `test("answers a producto that is not an identifier with the not-found text without reading")`
- `test("adds Con producto se ignoran texto, orden y pagina when any of them was sent with producto")`
- `test("answers a page beyond the last with the existing page text")`

`assistant-tools.test.ts` (static validator)
- `test("lists the nine tools, all read only, for a connection with both scopes")`
- `test("a page of 20 products at maximum lengths with 3 variants each and a producto answer of 60 variants fit 24 KB")` (acceptance 19, sample outputs)
- `test("a summary with three currency blocks at maximum amounts fits 24 KB")`
- `test("the sales instructions paragraph stays within 700 characters and the orders paragraph no longer says there are no totals")`

### Integration (core, real PostgreSQL)

`sales-summary-repository.integration.test.ts`
- `test("sums the October example: voided, rejected and reported payments add nothing and the unconfirmed catalog order does not exist")` (acceptance 1, 2, 6)
- `test("keeps cancelled orders out of sales and counts their confirmed payments in the cancelled line only")`
- `test("counts pending reports and the orders holding them, never on cancelled orders")`
- `test("groups figures by currency and never adds two currencies")` (acceptance 18)
- `test("another store's orders and payments change no figure")` (acceptance 17)

`sold-variants-repository.integration.test.ts`
- `test("sums units and item subtotals per variant sold, excluding delivery, cancelled and unconfirmed catalog orders")` (acceptance 6, 9)
- `test("narrows variants to the given ids and keeps the per-currency totals of the whole period")`
- `test("finds the last sale before, the first sale after and sales inside the period for each variant in any currency")`

`product-sales-repository.integration.test.ts`
- `test("describes variants with the current product name, values in option order and the text match on name or any SKU")`
- `test("lists products created before the period end with active stock today, counting store, matching and stocked products")` (Chompa, Short, Vestido excluded)
- `test("another store's variant and product never appear")` (acceptance 17)

`sales-tools.integration.test.ts` (through `/mcp`, like `products-tools.integration.test.ts`)
- `test("a connection lists nine tools and calls resumen_de_ventas, lo_mas_vendido and productos_sin_ventas on the example store")` (acceptance 21)
- `test("a call over the store limit answers the limit text with the seconds")` (acceptance 20)
- `test("a 200-day read over its statement budget answers the too-many-orders text and a 31-day one the reading-failure text")` (acceptance 16, with a lowered statement timeout)
- `test("a third concurrent sales read waits 300 ms and answers the reading-failure text")`

`sales-load.integration.test.ts` (load check, like `product-search-performance.integration.test.ts`)
- `test("at the expected maximum volume a 366-day summary, best sellers and unsold read each statement within half its budget")`
- `test("issues the measured number of statements, within maxStatements, for the worst case of each sales tool")`

`order-repository.integration.test.ts`
- `test("the created-date filter and newest-first order of the order search use Order_companyId_createdAt_idx")` (`EXPLAIN` on a seeded store)

### Web E2E

None: no screen changes.

### Pending manual checks

- Claude and ChatGPT connected to a preview with the example store: «¿cómo me fue este mes?», «¿qué es lo que más vendí?», «¿qué talla de polo sale más?», «¿qué no se está vendiendo?», in Spanish and in Portuguese; the agent repeats figures unchanged and does not recompute comparisons.
- MCP Inspector lists exactly nine tools, all read-only.

## 15. Limits and checks during implementation

- Left out: everything in the product draft's «Out of this version»; a time zone per store; a cache of figures; writes.
- Verify the statement count of `catalogStorefront.describe` and set `maxStatements` to the measured worst case of each tool.
- Verify with `EXPLAIN` on the load fixture that the period read uses `Order_companyId_createdAt_idx` under RLS and that the sale-dates read probes `OrderItem_companyId_variantId_idx`.
- Verify that `GROUPING SETS` rows validate with one Zod schema with a nullable `variantId`.
- If the load check exceeds half the statement budget at 366 days, lower `salesPeriodMaxDays` (the refusal text follows the constant) and record the measured value in the pull request.
- The sales module exists with an empty tool list between T0 and T1 on the integration branch only; it never reaches `main` that way.
- The pool reserve for the web app and order tools goes from 7 to 5 connections with question 1's option 1.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T0  scopes, shared snapshot and slots, index, period, sales module frame
Wave 2:  T1  Resumen de ventas            ║  T2  Lo más vendido + Productos sin ventas   (parallel, both depend on T0)
Wave 3:  T3  promote drafts into docs/assistants.md   (depends on T1 and T2)
```

Shared lines in wave 2, additive and non-adjacent where possible; on conflict keep both: the tool list of the sales entry in `src/composition/assistant-tools.ts`; the expected sales tool names in `src/composition/assistant-tools.test.ts`; the `orders` object in `features/orders/composition.ts` (T1 after `summarizeUnpaid`, T2 after `listDispatchQueue`). No other file is edited by both.

### T0. Two-scope modules and the sales read frame

**Scope:** `ToolModule.scopes` with registry, validator and both existing modules; `budgeted-snapshot.ts` extracted from products with the products behavior unchanged; `createReadSlots` extracted; `visibleOrder` moved to `order-visibility.ts`; `orders.readSalesForAssistant` with `salesReadBudget`; the index migration; `sales-period.ts` and `sales-figures.ts`; `input-fields.ts`; `sales-texts.ts` (paragraph, period refusals, reading-failure, too-many texts); `sales-tools.ts` with `createSalesToolsModule(tools)` registered with no tools; the sales slot and `salesRead` guard in `assistant-sales-capabilities.ts`, which picks the too-many text for `STATEMENT_TIMEOUT` over 31 days; the orders paragraph without the no-totals sentence; the load fixture seeder for the expected maximum volume.
**Out of scope:** any sales tool, query or projection; `docs/assistants.md`.
**Acceptance criteria:**
1. A connection with both scopes lists the six existing tools; a module declared with both scopes is listed only to it, and one with only `orders:read` sees four tools and no sales paragraph.
2. Product tools behave as before: every existing product test, including the statement-count and the 3-slot tests, passes unchanged apart from imports.
3. `resolveSalesPeriod` answers every row of the product draft's previous-period table and each refusal text of «Period inputs».
4. `Order_companyId_createdAt_idx` exists after `prisma migrate deploy` and the created-date search of **Buscar pedidos** uses it.
5. `pnpm --dir apps/core mcp:validate` passes.
**Tests:** the `tool-registry`, `budgeted-snapshot`, `sales-period` and `sales-figures` unit tests of section 14, and the index integration test.
**Depends on:** nothing.

### T1. Resumen de ventas

**Scope:** `orders.summarizeSales` with `sales-summary-repository.ts`; `sales-projection.ts`; `sales-summary-tool.ts` with its description (meaning of each figure, next-step tools with the creation dates, «Billetera digital» as Yape or Plin, open period, web remedy for cancelled money); `assistant-sales-summary-capabilities.ts`; the tool added to the sales entry; its sample outputs; its statement count and load check.
**Out of scope:** product tools; other modules' texts.
**Acceptance criteria:** acceptance criteria 1–5, 11, 12, 15, 16, 17, 18 and 20 of the product draft through `resumen_de_ventas`; the October example store answers exactly the figures of criterion 1; a 366-day summary at the expected maximum volume stays within half its statement budget or `salesPeriodMaxDays` is lowered with the measured value in the pull request.
**Tests:** `summarize-sales`, `sales-projection`, `sales-summary-tool` unit tests; `sales-summary-repository` integration tests; the summary cases of `sales-tools.integration.test.ts` and `sales-load.integration.test.ts`; the summary sample of the static validator.
**Depends on:** T0.

### T2. Lo más vendido and Productos sin ventas

**Scope:** `orders.summarizeSoldVariants` and `orders.findVariantSaleDates` with `sold-variants-repository.ts`; `products.describeVariantsForAssistant` and `products.listStockedForAssistant` with `product-sales-repository.ts` and the extracted `product-text-match.ts`; `product-sales-projection.ts`; `best-sellers-tool.ts` and `unsold-products-tool.ts` with their descriptions (singular-stem advice, `producto` ignoring the rest, last 30 days for unsold questions without a period); `assistant-product-sales-capabilities.ts`; both tools added to the sales entry; their sample outputs at maximum lengths; their statement counts and load check.
**Out of scope:** the summary; stock alerts (MCP 4/4); variants without sales inside a sold product.
**Acceptance criteria:** acceptance criteria 6–10, 13, 14, 15, 17, 18 and 19 of the product draft through `lo_mas_vendido` and `productos_sin_ventas`; a 366-day ranking and unsold read at the expected maximum volume stay within half their statement budget; the existing product search answers the same results with the extracted text match.
**Tests:** `product-sales-projection`, `best-sellers-tool`, `unsold-products-tool` unit tests; `sold-variants-repository` and `product-sales-repository` integration tests; the product cases of `sales-tools.integration.test.ts` and `sales-load.integration.test.ts`; the 20 × 3 and 60-variant samples of the static validator; the existing product-search integration tests.
**Depends on:** T0.

### T3. Promote the drafts

**Scope:** rewrite `docs/assistants.md` with every item of the product draft's «Changes to permanent documents on merge» plus this design's architecture (module scopes, sales snapshot and slots, index, observability events), following the [Documentation](../../.agents/skills/documentation/SKILL.md) skill; delete both drafts.
**Out of scope:** repository memories (the coordinator updates them after merge, as the product draft says).
**Acceptance criteria:** `docs/assistants.md` says nine tools, the sales group, the scope rule for groups over listed data, both new failure texts and «exactly nine tools» in the checking steps; no draft remains for this feature.
**Tests:** none new; the static validator and the full `test:unit` stay green.
**Depends on:** T1, T2.

### Final verification

On the integration branch after T3: `scripts/ci.sh`; the static validator lists nine tools; the pending manual checks of section 14 with Claude and ChatGPT on a preview and with MCP Inspector. Results go in the pull request description.

## 17. Open items and questions

Questions (answer with the option number):

1. How many sales reads may be in flight at once, given the 10-connection pool?
   (1) 2 sales slots separate from the 3 product slots. Recommended: a heavy 10-second summary never makes a product search fail, and the web app and order tools keep 5 of 10 connections. Consequence: the documented reserve of 7 becomes 5.
   (2) One shared pool of 3 slots for product and sales reads. Keeps the reserve of 7, but two slow summaries make product searches answer the reading-failure text after 300 ms.
   (3) 1 sales slot separate. Keeps a reserve of 6; a second owner asking for a summary at the same moment waits 300 ms and gets the reading-failure text.

2. With `texto` in **Lo más vendido**, does the other-currency line name the number of orders?
   (1) No: units and amount, as the `producto` example («Además vendiste en USD: 3 unidades, US$ 90.00 en productos, fuera de este ranking.»). Recommended: the order count of matching products cannot be summed from per-variant totals, and other currencies are rare.
   (2) Yes, as the unfiltered line. Needs one more statement per call that counts distinct orders of the matching variants per currency.

Decided unless objected:
- `ToolModule.scope` becomes `scopes`; a module is offered only when every scope is held; no scope literal is added (product question 3). This replaces the convention in memories fc437ed9, 854b8b20, 3b49cccc and 4b823bad, which the coordinator updates after merge.
- Orders owns every read that decides what a sale is; products owns names, combinations, the text match and stock; the composition joins them in memory by variant id.
- One RepeatableRead snapshot per call with `salesReadBudget` 1 s / 10 s / 1.5 s per statement / 6 statements, constants pinned by a unit test; the budgeted snapshot and the read slots move to shared files with the products behavior unchanged.
- Too many orders means a statement timeout in a period over 31 days; every other failure answers the sales reading-failure text.
- New index `Order_companyId_createdAt_idx`, created concurrently; no other schema change.
- Expected maximum volume for the load check: 60,000 orders in 366 days; 366 days stays unless the check fails.
- Period, previous period, shares, comparisons and ranking are pure functions in `features/assistants/domain`; money is summed in SQL and rounded half up in integer cents.
- `productos_sin_ventas` reads every checked product of the store in one statement and pages in memory, because its order depends on sale dates.
- Sales instructions paragraph within 700 characters.
- Logs: `sales_read_failed` (error, with `periodDays` and `answer`) and `assistant_sales_reads_busy` (warn); no input, amount or name is logged.
- Four tasks in three waves: T0, then T1 and T2 in parallel, then T3 for the permanent docs.
