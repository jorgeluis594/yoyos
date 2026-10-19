# Public catalog: implementation tasks

**Status:** pending. Design: `docs/public-catalog-technical.md`.

## Order and parallelism

```text
T0 ──┬── T1 (settings)
     ├── T2 (browse)
     ├── T3 (Continuar → checkout)  ──────── T5 (E2E)
     └── T4 (cleanup job)
```

T1–T4 run in parallel after T0. T5 closes when T1–T3 are merged.

## T0. Schema and catalog order types

**Scope:** migration `add_public_catalog` (§7): `Company.catalogPublished`, nullable `Order.sellerId`, `Order.fromCatalog`, the two CHECKs, `[fromCatalog, checkoutConfirmedAt, createdAt]` index, `unaccent`, `list_companies_with_expired_catalog_orders`. `OrderAggregate.sellerId: UserId | null`, `fromCatalog`; repository mapping; contracts `source: "catalog"`, nullable `sellerId`; seller readers exclude unconfirmed catalog orders and `rejectPendingCatalogOrder` (§5.5); mobile adapter accepts the new contract values.
**Out of scope:** creating catalog orders, catalog pages, job.
**Acceptance criteria:**
1. After migrating a database with orders #1001–#1003, the next created order is #1004 and all existing orders read unchanged.
2. Inserting an order with `sellerId NULL` and `fromCatalog = false` fails with a CHECK violation.
3. An unconfirmed catalog order inserted directly in the database does not appear in `GET /api/orders` list or detail; `GET /api/orders/:id` returns 404.
4. Typecheck passes in core and mobile.
**Tests:** "migration keeps existing orders valid…", "database rejects an order without seller…", "seller list and detail do not include unconfirmed catalog orders…", "seller use cases treat an unconfirmed catalog order as not found".
**Depends on:** nothing.

## T1. Catalog publication setting (web and mobile)

**Scope:** feature `catalog` settings (§5.1), `GET/PUT /api/catalog/settings`, `shared/contracts/catalog.ts`, web page Settings → Catalog, mobile screen Settings → Catalog with copy, share and open.
**Out of scope:** the public pages.
**Acceptance criteria:**
1. The seller turns on **Publicar catálogo** on the web; mobile shows it on with the same URL `…/catalogo/<companyId>`.
2. Hiding asks for confirmation; after hiding and publishing again the URL is identical.
3. With the API down, the switch returns to its previous position and shows «No pudimos guardar el cambio».
**Tests:** "settings API publishes, hides and keeps the same url", "catalog settings screen restores the switch when saving fails".
**Depends on:** T0.

## T2. Public browsing

**Scope:** `products.listForCatalog`, `products.findForCatalog`, `browseCatalog`, `getCatalogProduct`, routes `catalogo/:companyId` and `catalogo/:companyId/productos/:productId` with appearance header, search, 24 per page, «Agotado», «Desde», placeholder without photo, all states of the product screens, search and scroll kept on return.
**Out of scope:** cart and **Continuar**.
**Acceptance criteria:** product acceptance criteria 2–5, 14, 15, 16.
**Tests:** "catalog projection never contains SKU…", "search finds «POLO OVERSIZE»…", "an unpublished catalog and an unknown company…", "shows «Desde» price…", "parses search terms…".
**Depends on:** T0. T1 is not required (publish by SQL in tests).

## T3. Cart, Continuar and checkout handover

**Scope:** cart in `localStorage` with the order UUID tied to the cart content, resource route `catalogo/:companyId/carrito` (refresh loader and action), `continueToCheckout`, `createCatalogOrder` (number allocated at creation), `findSellableVariants` with stock, rate limiter, cart emptied after confirmation, «Desde el catálogo» in web and mobile list and detail, buyer payment guard.
**Out of scope:** cleanup.
**Acceptance criteria:** product acceptance criteria 6–13 and 17. A cart rejected for stock consumes no number. A 21st **Continuar** from one IP within 10 minutes returns 429.
**Tests:** every unit test of §5.3–§5.4 in the design, "two simultaneous Continuar…", "a rejected cart allocates no number", "an id already used by another company…", "buyer payment routes reject an unconfirmed catalog order", "order list shows «Desde el catálogo»…".
**Depends on:** T0. Uses the T2 pages to reach the cart; can start against the route directly.

## T4. Weekly cleanup of unconfirmed catalog orders

**Scope:** `schedule` in the pg-boss and in-memory providers, `src/composition/scheduled-jobs.ts`, registration in `src/worker.ts`, `deleteExpiredCatalogOrders` (use case and adapter), `listCompaniesWithExpiredCatalogOrders`, `CATALOG_ORDER_TTL_DAYS` (default 7), logs of §13.
**Out of scope:** cleaning any other order kind.
**Acceptance criteria:**
1. Unconfirmed catalog orders created 8 and 6 days ago, a confirmed catalog order and a manual order created 30 days ago: after the job, only the 8-day unconfirmed order and its items are gone.
2. Companies A and B with expired orders and A's delete failing: B's orders are deleted and `catalog_orders_deleted` reports `failedCompanies: 1`.
3. An order locked by an open confirmation transaction is not deleted and the confirmation commits.
4. The web process does not register the schedule.
**Tests:** "cleanup deletes unconfirmed catalog orders older than the cutoff…", "cleanup skips an order locked…", "cleanup leaves orders with payments untouched", "cleanup continues with the next company…".
**Depends on:** T0.

## T5. End-to-end journey

**Scope:** the E2E test of §14.
**Depends on:** T1, T2, T3.

## Final verification

- Open the catalog link from the Instagram and WhatsApp in-app browsers on a phone, add products, close and reopen: the cart is there.
- **Compartir** from the mobile settings screen on Android.
- After deploy, check the worker logs for `catalog_orders_deleted` the next day at 04:00 Lima.
