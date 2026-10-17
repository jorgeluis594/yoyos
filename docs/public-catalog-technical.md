# Public catalog: technical design

**Status:** design closed, pending implementation. Based on `docs/public-catalog.md`. Base: `df47ad02` (branch `jorgeluis594/catalog`). Tasks: `docs/public-catalog-tasks.md`.

## 1. Technical goal

A published company exposes `/catalogo/:companyId`. An anonymous buyer browses active products, keeps a cart in `localStorage` and taps **Continuar**: core creates a normal order (visible number, checkout already enabled, `fromCatalog = true`, no seller) with current prices and returns the existing checkout URL `/checkout/:companyId/:orderId`. While the buyer has not confirmed, the order is a **pending catalog order**: hidden from the seller. Confirming the checkout makes it a normal visible order. A daily job in the existing pg-boss worker deletes pending catalog orders created more than 7 days ago.

```text
browser cart ──Continuar──▶ catalog.continueToCheckout ──▶ orders.createCatalogOrder  (number = 1042, checkoutEnabledAt = now)
                                                              │
checkout page (unchanged) ──Confirmar──▶ confirmOrderCheckout / confirmCheckoutDelivery (unchanged) → checkoutConfirmedAt = now
                                                              │
worker (pg-boss schedule, daily) ──▶ orders.deleteExpiredCatalogOrders (fromCatalog AND checkoutConfirmedAt IS NULL AND createdAt < now − 7d)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Pending catalog order | `fromCatalog AND checkoutConfirmedAt IS NULL`. Derived from existing columns; no status column, no draft state. |
| Order number | Assigned at creation with the existing `allocateOrderNumber`, as every order. The checkout shows `Pedido #1042` from the start. Unchanged confirmation use cases. |
| Seller visibility | Seller lists, detail and mutations treat a pending catalog order as non-existent (`ORDER_NOT_FOUND`). |
| Cleanup | pg-boss `schedule` in the existing `worker` service, daily at 04:00 `America/Lima`; deletes pending catalog orders with `createdAt < now − CATALOG_ORDER_TTL_DAYS` (initial value 7, adjustable). Hard delete. Every unconfirmed catalog order consumes a number, so the seller sees gaps in the sequence (#1042, #1045) whether or not it is deleted. |
| Cross-company sweep | A `SECURITY DEFINER` function returns only the company ids that have expired pending catalog orders; the delete runs per company under RLS with `core_app`. No `BYPASSRLS` role. |
| Origin | New column `Order.fromCatalog boolean`; `source` in contracts gains `"catalog"`. |
| Seller of a catalog order | `Order.sellerId` becomes nullable, allowed `NULL` only when `fromCatalog`; lists show no seller for catalog orders. |
| Catalog publication | `Company.catalogPublished boolean default false`, owned by the new `catalog` feature. Existing companies start off. |
| Idempotency of **Continuar** | The browser generates the order UUID from the cart and keeps it while the cart (lines, quantities and prices shown) does not change. Core returns the existing order for a repeated id of the same company; a changed cart sends a new id. |
| Stock | Read without lock at **Continuar** to reject unavailable lines; not reserved, not deducted. Pending orders never touch stock, so deletion restores nothing. |
| Rate limit | In-memory fixed window per client IP on **Continuar**: 20 creations per 10 minutes (initial value, adjustable via `CATALOG_ORDER_RATE_LIMIT`). No new dependency. |
| Public surface | Web only, React Router routes (loaders/actions), like `checkout.tsx`. No public JSON API for mobile. Seller settings use `GET/PUT /api/catalog/settings` with a shared contract (mobile consumes it). |
| Search | `unaccent(lower(name)) LIKE unaccent(lower('%term%'))`, name only, minimum 2 characters. Requires the `unaccent` extension. |
| Page size | 24 products (initial value, adjustable). |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `Order` table | `apps/core/prisma/schema.prisma:433` | `number BigInt` NOT NULL; `sellerId` required FK to `User` (Restrict); `checkoutEnabledAt?`, `checkoutConfirmedAt?`; unique `(companyId, number)`. No `createdAt` index. |
| Order number counter | `Company.nextOrderNumber`; `allocateOrderNumber` in `src/features/orders/infrastructure/order-repository.ts:438` | Atomic `UPDATE … RETURNING`, requires an active transaction. Reused unchanged. |
| `OrderItem`, `Payment` | schema `487`, `471` | FK to `Order` with `onDelete: Restrict`. `OrderBuyer` and `OrderMessage` cascade. |
| `createOrder` / `createOrderInTransaction` | `src/features/orders/application/create-order.ts` | Allocates the number at creation, requires `userId`. |
| Checkout use cases | `src/features/orders/application/checkout.ts` | `enableOrderCheckout`, `getOrderCheckout`, `confirmOrderCheckout`, `confirmCheckoutDelivery`. Reused unchanged. |
| `OrderAggregate` | `src/features/orders/domain/order-state-machine.ts:39` | `sellerId: UserId`. |
| Order source | `presentation/order-json.ts:6`, `order-repository.ts:370` | Derived from `chatId`: `manual` or `whatsapp`. |
| Seller lists | `findOrderAggregates` (`order-repository.ts:384`), `findOrders` (`:353`) | No filter on checkout confirmation. |
| Checkout route | `app/routes/checkout.tsx`, `app/routes.ts:11` | Public, validates both UUIDs, `withTenantIsolation`, requires `checkoutEnabledAt`. Not changed by the catalog. |
| Buyer payment API | `src/features/orders/presentation/buyer-payment-routes.ts` | Public, company resolved via `resolve_buyer_order_company` (SECURITY DEFINER precedent). |
| Sellable variant | `findSellableVariant` in `src/features/products/infrastructure/order-stock.ts:24` | Active product and variant; returns price, no stock. |
| Product list | `products.list` → `listProducts` (`products/application/list.ts:54`) | Seller list with trigram search on name and SKU; exposes SKU and stock. Not reused for the public projection. |
| Checkout appearance | `checkoutAppearance.getPublic(companyId)` (`src/features/checkout-appearance/composition.ts:63`) | Reused as is for the catalog header and theme. |
| Event bus / worker | `src/shared/events/infrastructure/pg-boss-provider.ts`, `src/worker.ts`, `compose.prod.yaml` service `worker` | pg-boss 12.35.0, consumes events; `boss.schedule` not used. |
| Transactions | `src/shared/infrastructure/persistance.ts` | `withTenantIsolation`, `withinTransaction`, `systemPrisma`. |
| Roles | `scripts/create-role.sql`, `scripts/provision-role.sql` | `core_app` NOBYPASSRLS; RLS FORCE on tenant tables. |
| Contracts | `shared/contracts/orders.ts` | `sellerId: z.string()`, `orderSourceSchema = manual | whatsapp`. |
| Rate limiting, scheduler, catalog, `unaccent` | — | Do not exist. |

## 4. Gaps this design closes

1. No company-level catalog publication setting (§5.1, §7).
2. No public read of products without SKU, stock or cost (§5.2).
3. Orders cannot exist without a seller user (§6, §7).
4. No creation path from an anonymous cart with stock check and idempotent id (§5.3, §5.4).
5. Seller reads do not hide unconfirmed catalog orders (§5.5).
6. No scheduled job infrastructure and no cross-company cleanup (§5.6, §9).
7. Origin «Desde el catálogo» is not stored (§6, §8).
8. No protection against mass order creation (§11).

## 5. Use cases

### 5.1 `getCatalogSettings`, `setCatalogPublication` (feature `catalog`)

```ts
type CatalogSettings = Readonly<{ published: boolean }>;
type CatalogSettingsError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type CatalogSettingsDependencies = Readonly<{
  readPublished: (companyId: CompanyId) => Promise<Result<boolean, CatalogSettingsError>>;
  savePublished: (companyId: CompanyId, published: boolean) => Promise<Result<null, CatalogSettingsError>>;
}>;
export function getCatalogSettings(access: OrderAccess, deps: Pick<CatalogSettingsDependencies, "readPublished">): Promise<Result<CatalogSettings, CatalogSettingsError>>;
export function setCatalogPublication(input: Readonly<{ published: boolean }>, access: OrderAccess, deps: CatalogSettingsDependencies): Promise<Result<CatalogSettings, CatalogSettingsError>>;
```

Flow: write the flag scoped to `access.companyId`; return the stored value. Idempotent: setting the same value succeeds. The presentation adds the URL `${BETTER_AUTH_URL}/catalogo/${companyId}`; the URL never changes.

### 5.2 `browseCatalog`, `getCatalogProduct` (feature `catalog`)

```ts
type CatalogAccess = Readonly<{ companyId: CompanyId }>;  // from the URL, validated as UUID
type BrowseCatalogInput = Readonly<{ search: CatalogSearch | null; page: number }>;
type CatalogUnavailable = Readonly<{ code: "CATALOG_UNAVAILABLE"; message: string }>;
type BrowseCatalogDependencies = Readonly<{
  readPublished: (companyId: CompanyId) => Promise<Result<boolean, PersistenceError>>;
  listCatalogProducts: (criteria: CatalogCriteria) => Promise<Result<CatalogPage, PersistenceError>>;   // products.listForCatalog
}>;
type GetCatalogProductDependencies = Readonly<{
  readPublished: BrowseCatalogDependencies["readPublished"];
  findCatalogProduct: (productId: ProductId) => Promise<Result<CatalogProduct | null, PersistenceError>>; // products.findForCatalog
}>;
```

Flow: (1) `readPublished`; `false` → `CATALOG_UNAVAILABLE`. (2) query with normalized criteria `{ search, offset: page * 24, limit: 24 }`, newest first, tie-breaker `id`. `getCatalogProduct` returns `PRODUCT_UNAVAILABLE` for `null`. Errors: `CATALOG_UNAVAILABLE | PRODUCT_UNAVAILABLE | PERSISTENCE_UNAVAILABLE`. An unknown company and an unpublished one both read `published = false` under RLS (no row visible) and yield the same `CATALOG_UNAVAILABLE`.

### 5.3 `continueToCheckout` (feature `catalog`, owns the intention)

```ts
type ContinueToCheckoutInput = Readonly<{ orderId: OrderId; lines: readonly CartLine[] }>;  // 1..30 lines, unique variantId
type ContinueToCheckoutError = CatalogUnavailable | CreateCatalogOrderError;
type ContinueToCheckoutDependencies = Readonly<{
  readPublished: (companyId: CompanyId) => Promise<Result<boolean, PersistenceError>>;
  createCatalogOrder: (input: CreateCatalogOrderInput, access: CatalogAccess) => Promise<Result<OrderAggregate, CreateCatalogOrderError>>; // orders composition
}>;
export function continueToCheckout(input: ContinueToCheckoutInput, access: CatalogAccess, deps: ContinueToCheckoutDependencies): Promise<Result<OrderAggregate, ContinueToCheckoutError>>;
```

Flow: (1) `readPublished` → `CATALOG_UNAVAILABLE`. (2) `createCatalogOrder`. The route builds the checkout URL with the existing orders helper and redirects. The publication check is not under lock: a catalog hidden in the same instant may still receive that one order, which stays hidden until confirmed or deleted.

### 5.4 `createCatalogOrder` (feature `orders`, new)

```ts
type CreateCatalogOrderInput = Readonly<{ id: OrderId; lines: readonly CartLine[] }>;
type CartLine = Readonly<{ variantId: VariantId; quantity: CartQuantity }>;
type LineIssue = Readonly<{ variantId: VariantId } & (
  | { reason: "unavailable" }                       // deleted or inactive product/variant
  | { reason: "sold_out" }
  | { reason: "insufficient"; available: number }   // 1..98, shown as «Solo quedan n»
  | { reason: "other_currency" }                    // priced in a currency other than the first sellable line's
)>;
type CreateCatalogOrderError =
  | Readonly<{ code: "LINES_UNAVAILABLE"; message: string; issues: readonly LineIssue[] }>
  | Readonly<{ code: "ORDER_ID_CONFLICT" | "ORDER_NUMBER_EXHAUSTED" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
type CreateCatalogOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CreateCatalogOrderError>>) => Promise<Result<T, CreateCatalogOrderError>>;
  findOrder: (id: OrderId) => Promise<Result<OrderAggregate | null, CreateCatalogOrderError>>;
  findSellableVariants: (ids: readonly VariantId[]) => Promise<Result<readonly SellableVariant[], CreateCatalogOrderError>>; // products, now with stock
  allocateNumber: (companyId: CompanyId) => Promise<Result<OrderNumber, CreateCatalogOrderError>>; // existing allocateOrderNumber
  saveCatalogOrder: (order: OrderAggregate) => Promise<Result<null, CreateCatalogOrderError>>;
  newItemId: () => OrderItemId;
  clock: () => Date;
}>;
```

Flow, inside `transaction(companyId)`:
1. `findOrder(id)`. Exists and `fromCatalog` → return it (automatic retry, guide 6.4). Exists and not from the catalog → `ORDER_ID_CONFLICT`.
2. `findSellableVariants`. Domain `checkCartAvailability(lines, variants)` returns all issues at once; any issue → `LINES_UNAVAILABLE` with no write and no number allocated.
3. `allocateNumber`.
4. Domain `buildCatalogOrder({ id, companyId, number, lines, variants, now })`: `sellerId: null`, `fromCatalog: true`, `customer: general_public`, `checkoutEnabledAt: now`, prices from the variants.
5. `saveCatalogOrder`. A primary-key violation from another company (same UUID, invisible under RLS) → `ORDER_ID_CONFLICT`; a concurrent insert of the same id in the same company rolls back, including the counter, then the use case re-reads and returns the stored order.

### 5.5 Seller reads and mutations (modified)

- `findOrderAggregates` and `findOrders` exclude `fromCatalog AND checkoutConfirmedAt IS NULL`.
- `readOrderAggregate` and every seller-authenticated use case that loads by id (`registerPayment`, `cancelOrder`, `setOrderDelivery`, `deductStock`, `fulfillOrder`, `updateOrderShipping`, `enableOrderCheckout`, `voidPayment`) return `ORDER_NOT_FOUND` for a pending catalog order. Implemented once: the seller composition wraps `findOrder`/`findOrderForUpdate` with `rejectPendingCatalogOrder`; the public checkout keeps the unwrapped readers.
- Buyer payment routes (`/api/buyer/orders/:orderId/...`) reject an unconfirmed order with the same 404 (verify current behavior, §15).

### 5.6 `deleteExpiredCatalogOrders` (feature `orders`, new)

```ts
type DeleteExpiredCatalogOrdersInput = Readonly<{ cutoff: Date }>;
type DeleteExpiredCatalogOrdersDependencies = Readonly<{
  listCompaniesWithExpiredCatalogOrders: (cutoff: Date) => Promise<Result<readonly CompanyId[], PersistenceError>>;  // definer function
  deleteExpiredCatalogOrders: (companyId: CompanyId, cutoff: Date, limit: number) => Promise<Result<number, PersistenceError>>; // own transaction per call
}>;
type DeleteExpiredCatalogOrdersOutput = Readonly<{ companies: number; deleted: number; failedCompanies: number }>;
```

Flow: (1) list companies. (2) per company, repeat `deleteExpiredCatalogOrders(companyId, cutoff, 500)` until it deletes fewer than 500. A failed company is counted and the loop continues with the next one; the job fails (pg-boss retries) only when the listing fails. The worker computes `cutoff = now − CATALOG_ORDER_TTL_DAYS`.

## 6. Domain and typing

| Type | Change | Why |
| --- | --- | --- |
| `OrderAggregate.sellerId` | `UserId \| null` | A catalog order has no creating user. |
| `OrderAggregate.fromCatalog` | `boolean` | Origin is a permanent attribute; not derivable from `chatId`. |
| `CartQuantity` | branded, `parseCartQuantity` integer 1..99 | Catalog-specific bound; order quantities have no upper limit today. |
| `CatalogSearch` | branded, `parseCatalogSearch` trimmed, 2..80 chars | The 2-character rule belongs to the catalog. |
| `CartLine`, `LineIssue` | new | Input and per-line rejection; no existing type carries the reason. |
| `SellableVariant` | `CatalogItem` + `available: number` | The order creation needs stock to reject; `CatalogItem` stays as is for other callers. |
| `CatalogProduct`, `CatalogPage` (products) | new public read models without SKU, cost, stock quantity or QR | The seller `Product` exposes those fields. `CatalogProduct` = `{ id, name, description, imageId, price: { kind: "single"; amount } \| { kind: "from"; amount }, soldOut, attributes, variants: { id, attributes, price, maxQuantity }[] }` where `maxQuantity = min(stock, 99)` and `0` means «Agotado». |

Rules (pure, `orders/domain/catalog-order.ts`): `checkCartAvailability`, `buildCatalogOrder`, `isPendingCatalogOrder(order) = order.fromCatalog && order.checkoutConfirmedAt === null`.

| Layer | Types and authority |
| --- | --- |
| Browser | Cart lines in `localStorage` (`variantId`, `quantity`, last seen price, `orderId`); display only. |
| Catalog presentation | Zod schemas for route params, search, cart and action body. |
| Core domain | Availability, quantity bounds, catalog order construction. |
| Database | CHECKs for catalog invariants, uniqueness of `(companyId, number)`. |

## 7. Persistence

Migration `add_public_catalog` (Prisma CLI generated, then edited for the SQL Prisma cannot express, per `database-migrations`):

- `Company.catalogPublished BOOLEAN NOT NULL DEFAULT false`.
- `Order.fromCatalog BOOLEAN NOT NULL DEFAULT false`.
- `Order.sellerId` → nullable; CHECK `Order_seller_present`: `"sellerId" IS NOT NULL OR "fromCatalog"`.
- CHECK `Order_catalog_without_chat`: `NOT ("fromCatalog" AND "chatId" IS NOT NULL)`.
- Index `@@index([fromCatalog, checkoutConfirmedAt, createdAt])` for the sweep and the seller filter.
- `CREATE EXTENSION IF NOT EXISTS unaccent` (runs as the migration role).
- Function:

```sql
CREATE FUNCTION public.list_companies_with_expired_catalog_orders(cutoff timestamptz)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$ SELECT DISTINCT "companyId" FROM public."Order"
      WHERE "fromCatalog" AND "checkoutConfirmedAt" IS NULL AND "createdAt" < cutoff $$;
REVOKE ALL ON FUNCTION public.list_companies_with_expired_catalog_orders(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_companies_with_expired_catalog_orders(timestamptz) TO core_app;
```

The function returns only ids; it reads and deletes nothing else. All columns are additive or relaxations: no backfill, existing rows satisfy every new CHECK.

`deleteExpiredCatalogOrders` (per company, inside `withinTransaction` under RLS):

```sql
WITH doomed AS (
  SELECT id FROM "Order"
  WHERE "fromCatalog" AND "checkoutConfirmedAt" IS NULL AND "createdAt" < $cutoff
    AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = "Order".id)
  ORDER BY "createdAt" LIMIT $limit
  FOR UPDATE SKIP LOCKED
), items AS (DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM doomed))
DELETE FROM "Order" WHERE id IN (SELECT id FROM doomed);
```

`OrderItem` and `Payment` FKs keep `Restrict`; items are deleted explicitly, `OrderBuyer` cascades. The number of a deleted order is never reused (the counter only grows). Rows read by the catalog projections are parsed with Zod in the products repository; a row that fails is `INVALID_STORED_DATA`.

## 8. Contracts between applications

`shared/contracts/catalog.ts` (new, consumed by web settings and mobile):

```ts
export const catalogSettingsSchema = z.strictObject({ published: z.boolean(), url: z.url() });
export const setCatalogPublicationSchema = z.strictObject({ published: z.boolean() });
```

| Route | Access | Use case | Errors |
| --- | --- | --- | --- |
| `GET /api/catalog/settings` | Seller session | `getCatalogSettings` | 503 `SERVICE_UNAVAILABLE` |
| `PUT /api/catalog/settings` | Seller session | `setCatalogPublication` | 400 `INVALID_CATALOG_SETTINGS`, 503 |

`shared/contracts/orders.ts`: `orderSourceSchema` adds `"catalog"`; `sellerId: z.string().nullable()` in `orderSchema`, `orderAggregateSchema` and summaries. The checkout contract does not change.

Public catalog routes are web-only and validate with schemas in `src/features/catalog/presentation/schemas.ts`:

| Route | Kind | Result |
| --- | --- | --- |
| `catalogo/:companyId` | page, loader `?q=&page=` | Header (appearance + name) and page of products; `CATALOG_UNAVAILABLE` → «Catálogo no disponible» with 404. |
| `catalogo/:companyId/productos/:productId` | page, loader | `CatalogProduct`; `PRODUCT_UNAVAILABLE` → 404 page with **Volver al catálogo**. |
| `catalogo/:companyId/carrito` | resource route: loader `?v=<variantIds>` refreshes cart prices and availability; action `POST { orderId, lines }` | Action success → `{ checkoutUrl }`; `LINES_UNAVAILABLE` → 409 with `issues`; `CATALOG_UNAVAILABLE` → 409; rate limited → 429; `ORDER_ID_CONFLICT` → 409 (client regenerates the id and retries once). |

The action responds with `Cache-Control: no-store`; catalog pages carry `Referrer-Policy: no-referrer` like the checkout and `noindex` in this version.

## 9. Events and cross-feature integration

No new domain event. Integration by public composition:

- `catalog` → `products`: `products.listForCatalog`, `products.findForCatalog`, `findSellableVariants` (with stock).
- `catalog` → `orders`: `orders.createCatalogOrder`, `orders.checkoutUrl(companyId, orderId)`.
- `catalog` → `checkout-appearance`: `checkoutAppearance.getPublic`.
- `orders` does not import `catalog`.

Scheduled job: the event bus provider gains `schedule(name, cron, handler, { tz })`, implemented with `boss.createQueue` + `boss.schedule` + `boss.work` in `pg-boss-provider.ts`; the in-memory provider records the registration for tests. `src/composition/scheduled-jobs.ts` declares `delete-expired-catalog-orders` (`0 4 * * *`, `America/Lima`), registered only from `src/worker.ts`.

| Failure window | What happens | Effect for the user |
| --- | --- | --- |
| Worker down at 04:00 | pg-boss runs the schedule on the next tick after the worker restarts | Pending orders live a few hours longer; hidden. |
| Listing fails | Job fails, pg-boss retries (3 retries, 5 min backoff, initial values) | None. |
| One company's delete fails | Logged, others continue; retried next day | None. |
| Buyer confirms while the sweep runs | `SKIP LOCKED` skips the locked order; once confirmed it no longer matches | Confirmation succeeds. |
| Sweep deletes an order whose checkout tab is open | Confirm/read returns not found | Checkout shows «Enlace no disponible»; **Continuar** with the same cart recreates it with the same id and a new number. |

## 10. Mobile

| File | Change |
| --- | --- |
| `src/features/orders/infrastructure/*` (HTTP adapter) | Accept `source: "catalog"` and `sellerId: null` from the contract. |
| `src/features/orders/domain` order model | `source` adds `"catalog"`; `sellerId` nullable. |
| Order list and detail components | Badge «Desde el catálogo» when `source === "catalog"`; no seller shown when `sellerId` is `null`. |
| `src/features/catalog/` (new): `infrastructure/catalog-settings-api.ts`, `application/catalog-settings.ts`, `presentation/screens/catalog-settings-screen.tsx` | Read, publish/hide with confirmation, copy, **Compartir** (system share sheet), **Ver catálogo** (browser). |
| `src/app/settings/catalog.tsx` | Route delegating to the screen. |

No local SQLite changes; the setting is not cached offline. A failed write restores the switch.

## 11. Transactions and concurrency

`createCatalogOrder`:
1. `scopedOrderTransaction(companyId)`.
2. Read by id (no lock; uniqueness closes the race).
3. Read variants and stock without lock: there is no reservation, so a later sale may still take the stock; the seller resolves it as with chat orders.
4. `allocateOrderNumber` (`Company` row lock until commit, as every order creation).
5. Insert order and items in one nested create with `checkoutEnabledAt = now`.
6. Commit. Two simultaneous **Continuar** with the same id: one inserts, the other gets the unique violation, rolls back its counter increment, re-reads and returns the same order.

Confirmation is unchanged.

Sweep: per company, `FOR UPDATE SKIP LOCKED` over pending catalog orders plus the re-evaluated `WHERE` guarantees an order being confirmed is never deleted and a confirmed order never matches.

Rate limit: `catalog/presentation/rate-limit.ts`, `Map<ip, { windowStart, count }>` pruned on access. shortcut: per process, resets on deploy; move to PostgreSQL or Redis when there is more than one web instance.

## 12. Code organization

| File | Change |
| --- | --- |
| `apps/core/prisma/schema.prisma`, `prisma/migrations/<ts>_add_public_catalog/` | §7. |
| `src/features/catalog/domain/catalog.ts` | `CatalogSearch`, `CartQuantity` parsers. |
| `src/features/catalog/application/catalog-settings.ts` | §5.1. |
| `src/features/catalog/application/browse-catalog.ts` | §5.2. |
| `src/features/catalog/application/continue-to-checkout.ts` | §5.3. |
| `src/features/catalog/infrastructure/catalog-settings-repository.ts` | `readPublished`, `savePublished` on `Company`. |
| `src/features/catalog/presentation/api-routes.ts`, `schemas.ts`, `rate-limit.ts` | Settings API, public schemas, limiter. |
| `src/features/catalog/composition.ts` | Wires settings, browse, continue. |
| `app/routes/catalog.tsx`, `catalog-product.tsx`, `catalog-cart.tsx`, `catalog-settings.tsx`; `app/routes.ts` | Public pages, cart resource route, seller settings (web). |
| `src/features/products/application/catalog-products.ts`, `infrastructure/catalog-products-repository.ts` | `listForCatalog`, `findForCatalog`. |
| `src/features/products/infrastructure/order-stock.ts` | `findSellableVariants(ids)` with `available`. |
| `src/features/orders/domain/catalog-order.ts`, `order-state-machine.ts` | §6. |
| `src/features/orders/application/create-catalog-order.ts`, `delete-expired-catalog-orders.ts` | §5.4, §5.6. |
| `src/features/orders/infrastructure/order-repository.ts` | `saveCatalogOrder`, `deleteExpiredCatalogOrders`, `listCompaniesWithExpiredCatalogOrders`, seller filters, mapping of nullable `sellerId` and `fromCatalog`. |
| `src/features/orders/presentation/order-json.ts` | `source` adds `"catalog"`. |
| `src/features/orders/composition.ts` | `createCatalogOrder`, `checkoutUrl`, `deleteExpiredCatalogOrders`, `rejectPendingCatalogOrder` for seller readers. |
| `src/shared/events/infrastructure/pg-boss-provider.ts`, in-memory provider | `schedule`. |
| `src/composition/scheduled-jobs.ts`, `src/worker.ts` | Register the cleanup job. |
| `shared/contracts/catalog.ts`, `orders.ts` | §8. |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `catalog_publication_changed` | info | `catalog` composition after the write | `["companyId", "userId", "published"]` |
| `unable_to_save_catalog_settings` | error | `savePublished` adapter | `["companyId", "errorCode", "err"]` |
| `catalog_order_created` | info | `orders` composition after commit, only when inserted (not on retry) | `["companyId", "orderNumber", "linesCount"]` |
| `catalog_order_rejected` | debug | `continueToCheckout` route | `["companyId", "errorCode", "issuesCount"]` |
| `catalog_order_rate_limited` | warn | rate limiter | `["companyId"]` |
| `order_checkout_confirmed` (existing) | info | add field `fromCatalog` | existing fields + `["fromCatalog"]` |
| `unable_to_save_catalog_order` | error | `saveCatalogOrder` | `["companyId", "errorCode", "err"]` |
| `unable_to_allocate_order_number` (existing) | error | `allocateOrderNumber` | existing fields with `operation: "create_catalog_order"` |
| `unable_to_read_catalog` | error | catalog repositories | `["companyId", "operation", "errorCode", "err"]` |
| `catalog_orders_deleted` | info | worker job, after all companies | `["companies", "deleted", "failedCompanies", "cutoff", "durationMs"]` |
| `unable_to_delete_catalog_orders` | error | `deleteExpiredCatalogOrders` adapter | `["companyId", "errorCode", "err"]` |
| `catalog_order_cleanup_failed` | error | worker job when the listing fails | `["errorCode", "err"]` |

Never logged: the order UUID (the checkout URL is a credential), client IP, cart contents, prices, search terms.

## 14. Tests

Unit (core):
- `test("rejects every unavailable line at once and creates nothing")`
- `test("reports the available quantity when a line asks for more than the stock")`
- `test("builds a numbered catalog order without seller and with checkout enabled")`
- `test("returns the existing catalog order when Continuar repeats the same id")`
- `test("rejects an id that belongs to an order not created by the catalog")`
- `test("rejects continuing when the catalog is not published")`
- `test("seller use cases treat an unconfirmed catalog order as not found")`
- `test("cleanup continues with the next company when one company fails")`
- `test("parses search terms of 2 to 80 characters and quantities of 1 to 99")`
- `test("shows «Desde» price when variants of a product have different prices")`

Integration (core, real database):
- `test("migration keeps existing orders valid and the number sequence continues")`
- `test("database rejects an order without seller that is not from the catalog, and a catalog order with a chat")`
- `test("two simultaneous Continuar with the same id create one order and consume one number")`
- `test("a rejected cart allocates no number")`
- `test("an id already used by another company is rejected without revealing the order")`
- `test("seller list and detail do not include unconfirmed catalog orders, and include them after confirmation")`
- `test("cleanup deletes unconfirmed catalog orders older than the cutoff with their items and keeps newer ones, confirmed ones and non-catalog orders")`
- `test("cleanup skips an order locked by a confirmation in progress")`
- `test("cleanup leaves orders with payments untouched")`
- `test("catalog projection never contains SKU, cost or stock quantity")`
- `test("search finds «POLO OVERSIZE» and «Polo básico» for «polo» and ignores accents")`
- `test("an unpublished catalog and an unknown company return the same unavailable result")`
- `test("buyer payment routes reject an unconfirmed catalog order")`
- `test("settings API publishes, hides and keeps the same url")`

Mobile:
- `test("catalog settings screen restores the switch when saving fails")`
- `test("order list shows «Desde el catálogo» for catalog orders and no seller")`

E2E (web, happy path):
- `test("seller publishes the catalog, buyer adds two variants, continues, confirms and the seller sees the order from the catalog")`

Manual checks: catalog inside the Instagram and WhatsApp in-app browsers (cart persists in `localStorage`), **Compartir** on Android, the scheduled job firing in the deployed worker.

## 15. Limits and checks during implementation

- Verify pg-boss 12.35.0 `schedule` signature and that scheduling runs only where `schedule` is enabled; the web process must not register the job.
- Verify `unaccent` is available in `postgres:18-alpine` (contrib is bundled) and that the migration role can create it.
- Verify the buyer payment routes reject orders without `checkoutConfirmedAt`; add the guard if they do not.
- Verify how the React Router action obtains the client IP behind Coolify's proxy (`trust proxy` is set on Express).
- Verify every seller entry point that loads an order by id goes through the `rejectPendingCatalogOrder` readers, including mobile sync paths.
- A buyer who reuses the same cart after a price change without reloading the cart keeps the order's old price; the checkout shows it before confirming. The cart refreshes prices on load, which changes the id.
- Out of scope: readable address, per-product visibility, notifications, reservation, multi-instance rate limit.
