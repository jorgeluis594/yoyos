import { randomUUID } from "node:crypto";
import pg from "pg";

/**
 * Seeds stores with years of orders by set-based SQL through the administrative connection (it bypasses row-level security), so the
 * sales reads can be judged for cost on the volume of the technical design: 60,000 orders a year (165 a day), 2 items and 1.2 payments per order,
 * 3,000 products with 4 variants. Opt-in: the callers run only with `SALES_LOAD=1`, except the small store of the order-search plan test.
 */
export const salesLoadEnabled = process.env.SALES_LOAD === "1";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type StoreSeed = Readonly<{
  companyId: string;
  /** Orders are spread evenly over `[start, end)`, `AAAA-MM-DD` in UTC. */
  start: string; end: string; ordersPerDay: number;
  products: number;
  /** The first products are stale: highest stock, never sold in the history except by the old orders below. */
  staleProducts?: number;
  /** One stale product with this many variants (after the stale ones). */
  wideProductVariants?: number;
  /** Old orders that each hold one unit of every variant of the stale and wide products: `staleItemsPerVariant` items per variant. */
  staleItemsPerVariant?: number;
  staleStart?: string;
}>;

export type SeededStore = Readonly<{
  companyId: string; sellerId: string; orders: number; items: number; payments: number; variants: number;
  staleProductIds: readonly string[]; wideProductId: string | null;
}>;

const ordinaryVariants = 4;
const stat = (value: number) => Math.max(0, Math.round(value));

/** Seeds one store. Ids are derived from the company id, so a store can be removed by company. */
export async function seedStore(admin: pg.Client, seed: StoreSeed): Promise<SeededStore> {
  const { companyId } = seed;
  if (!uuidPattern.test(companyId) || !datePattern.test(seed.start) || !datePattern.test(seed.end)) throw new Error("Invalid fixture seed");
  const sellerId = `seller-${companyId}`;
  const stale = seed.staleProducts ?? 0;
  const wide = seed.wideProductVariants ?? 0;
  const wideProduct = wide > 0 ? stale + 1 : 0;
  const staleVariants = stale * ordinaryVariants + wide;
  const staleItemsPerVariant = seed.staleItemsPerVariant ?? 0;
  const days = Math.round((Date.parse(`${seed.end}T00:00:00Z`) - Date.parse(`${seed.start}T00:00:00Z`)) / 86_400_000);
  const orders = stat(days * seed.ordersPerDay);
  const staleOrders = staleVariants > 0 ? staleItemsPerVariant : 0;
  const c = `'${companyId}'`;
  await admin.query("SET TIME ZONE 'UTC'");
  await admin.query(`INSERT INTO "Company" (id, name, country) VALUES (${c}::uuid, ${c}, 'PE')`);
  await admin.query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "companyId") VALUES ('${sellerId}', 'Seller', '${sellerId}@fixture.test', true, now(), now(), ${c}::uuid)`);

  // Catalog: variant slots first, so every table below reads the same ids.
  await admin.query(`CREATE TEMP TABLE fixture_variants AS
    SELECT s.n AS product, s.k, row_number() OVER (ORDER BY s.n, s.k)::int AS idx,
      md5(${c} || 'x' || s.n || '-' || s.k)::uuid AS id, md5(${c} || 'v' || s.n || '-' || s.k)::uuid AS value_id
    FROM (SELECT n, generate_series(0, CASE WHEN n = ${wideProduct} THEN ${Math.max(wide, 1)} - 1 ELSE ${ordinaryVariants - 1} END) AS k FROM generate_series(1, ${seed.products}) n) s`);
  await admin.query(`INSERT INTO "Product" (id, "companyId", name, currency, "qrCode", status, "createdAt", "updatedAt", "structureVersion")
    SELECT md5(${c} || 'p' || n)::uuid, ${c}::uuid, 'Producto ' || n, 'PEN', md5(${c} || 'pq' || n), 'active', '2023-01-01'::timestamp, '2023-01-01'::timestamp, 1 FROM generate_series(1, ${seed.products}) n`);
  await admin.query(`INSERT INTO "ProductOption" (id, "companyId", "productId", name, position)
    SELECT md5(${c} || 'o' || n)::uuid, ${c}::uuid, md5(${c} || 'p' || n)::uuid, 'Talla', 0 FROM generate_series(1, ${seed.products}) n`);
  await admin.query(`INSERT INTO "ProductOptionValue" (id, "companyId", "optionId", "productId", name, position)
    SELECT v.value_id, ${c}::uuid, md5(${c} || 'o' || v.product)::uuid, md5(${c} || 'p' || v.product)::uuid, 'T' || v.k, v.k FROM fixture_variants v`);
  await admin.query(`INSERT INTO "ProductVariant" (id, "companyId", "productId", "combinationKey", sku, "salePrice", "qrCode", status)
    SELECT v.id, ${c}::uuid, md5(${c} || 'p' || v.product)::uuid, lower(v.value_id::text), 'SKU-' || v.product || '-' || v.k, 10 + (v.idx % 40), md5(${c} || 'vq' || v.idx), 'active' FROM fixture_variants v`);
  await admin.query(`INSERT INTO "ProductVariantOptionValue" ("companyId", "productId", "variantId", "optionId", "valueId")
    SELECT ${c}::uuid, md5(${c} || 'p' || v.product)::uuid, v.id, md5(${c} || 'o' || v.product)::uuid, v.value_id FROM fixture_variants v`);
  await admin.query(`INSERT INTO "ProductStock" ("variantId", "companyId", quantity)
    SELECT v.id, ${c}::uuid, CASE WHEN v.product <= ${stale} THEN 1000 WHEN v.product = ${wideProduct} THEN 900 ELSE abs(hashint4(v.idx)::bigint) % 60 END FROM fixture_variants v`);

  if (orders > 0) {
    const pool = (await admin.query<{ count: number }>(`SELECT count(*)::int AS count FROM fixture_variants WHERE idx > ${staleVariants}`)).rows[0]!.count;
    if (pool < 2) throw new Error("The fixture needs at least two ordinary variants");
    // One row per order: two distinct ordinary variants, quantities, the delivery charge and the state mix.
    await admin.query(`CREATE TEMP TABLE fixture_orders AS
      SELECT g.i, md5(${c} || 'o' || g.i)::uuid AS id,
        (('${seed.start}'::timestamp) + (g.i - 1) * (${days}::numeric * 86400 / ${orders}) * interval '1 second')::timestamp(3) AS created_at,
        a.id AS variant1, b.id AS variant2, q.q1, q.q2, 10 + (a.idx % 40) AS price1, 10 + (b.idx % 40) AS price2,
        CASE WHEN g.i % 4 = 0 THEN 10 ELSE 0 END AS charge, g.i % 25 = 0 AS cancelled,
        CASE WHEN g.i % 40 = 7 THEN 'unconfirmed' WHEN g.i % 40 = 17 THEN 'confirmed' ELSE 'manual' END AS source
      FROM generate_series(1, ${orders}) g(i)
      CROSS JOIN LATERAL (SELECT ${staleVariants} + 1 + abs(hashint4(g.i)::bigint) % ${pool} AS ai) ai
      CROSS JOIN LATERAL (SELECT ${staleVariants} + 1 + ((ai.ai - ${staleVariants} - 1) + 1 + abs(hashint4(g.i * 7 + 3)::bigint) % ${pool - 1}) % ${pool} AS bi) bi
      JOIN fixture_variants a ON a.idx = ai.ai JOIN fixture_variants b ON b.idx = bi.bi
      CROSS JOIN LATERAL (SELECT 1 + g.i % 3 AS q1, 1 + (g.i / 3) % 3 AS q2) q`);
    await admin.query(`INSERT INTO "Order" (number, id, "companyId", "sellerId", "fromCatalog", "checkoutEnabledAt", "checkoutConfirmedAt", currency, total, "itemsTotal",
        "deliveryCost", "deliveryCharge", "deliveryStatus", cancelled, "cancelledAt", "createdAt")
      SELECT 1000 + o.i, o.id, ${c}::uuid, CASE WHEN o.source = 'manual' THEN '${sellerId}' END, o.source <> 'manual',
        CASE WHEN o.source <> 'manual' THEN o.created_at END, CASE WHEN o.source = 'confirmed' THEN o.created_at END, 'PEN',
        o.q1 * o.price1 + o.q2 * o.price2 + o.charge, o.q1 * o.price1 + o.q2 * o.price2, o.charge, o.charge, 'pending', o.cancelled, CASE WHEN o.cancelled THEN o.created_at END, o.created_at
      FROM fixture_orders o`);
    await admin.query(`INSERT INTO "OrderItem" (id, "companyId", "orderId", "orderCreatedAt", "variantId", "productName", "variantAttributes", quantity, "unitPrice", subtotal)
      SELECT md5(${c} || 'i1' || o.i)::uuid, ${c}::uuid, o.id, o.created_at, o.variant1, 'Producto', '{}'::json, o.q1, o.price1, o.q1 * o.price1 FROM fixture_orders o
      UNION ALL SELECT md5(${c} || 'i2' || o.i)::uuid, ${c}::uuid, o.id, o.created_at, o.variant2, 'Producto', '{}'::json, o.q2, o.price2, o.q2 * o.price2 FROM fixture_orders o`);
    // One payment per order (a tenth of them a report awaiting review) and a second, partial one for a fifth.
    await admin.query(`INSERT INTO "Payment" (id, "companyId", "orderId", status, amount, currency, method, "walletProvider", "deductStockIfPartial", data)
      SELECT md5(${c} || 'p1' || o.i)::uuid, ${c}::uuid, o.id, CASE WHEN o.i % 10 = 0 THEN 'reported' ELSE 'confirmed' END,
        CASE WHEN o.i % 10 = 0 THEN NULL ELSE o.q1 * o.price1 + o.q2 * o.price2 + o.charge END, 'PEN',
        CASE WHEN o.i % 10 = 0 THEN NULL WHEN o.i % 3 = 0 THEN 'bank_transfer' ELSE 'digital_wallet' END,
        CASE WHEN o.i % 10 = 0 OR o.i % 3 = 0 THEN NULL WHEN o.i % 3 = 1 THEN 'yape' ELSE 'plin' END, false,
        CASE WHEN o.i % 10 = 0 THEN jsonb_build_object('receiptImageId', md5(${c} || 'r' || o.i)::uuid, 'reportedAt', to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          ELSE jsonb_build_object('confirmedAt', to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'confirmedBy', jsonb_build_object('kind', 'seller', 'userId', '${sellerId}'), 'evidence', jsonb_build_object('kind', 'manual')) END
      FROM fixture_orders o WHERE o.source <> 'unconfirmed'
      UNION ALL SELECT md5(${c} || 'p2' || o.i)::uuid, ${c}::uuid, o.id, 'confirmed', 5, 'PEN', 'bank_transfer', NULL, false,
        jsonb_build_object('confirmedAt', to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'confirmedBy', jsonb_build_object('kind', 'seller', 'userId', '${sellerId}'), 'evidence', jsonb_build_object('kind', 'manual'))
      FROM fixture_orders o WHERE o.i % 5 = 1 AND o.source <> 'unconfirmed'`);
  }

  if (staleOrders > 0) {
    const staleStart = seed.staleStart ?? seed.start;
    await admin.query(`CREATE TEMP TABLE fixture_stale AS
      SELECT j, md5(${c} || 'so' || j)::uuid AS id, ('${staleStart}'::timestamp + j * interval '1 minute')::timestamp(3) AS created_at FROM generate_series(1, ${staleOrders}) j`);
    const total = (await admin.query<{ total: string }>(`SELECT sum(10 + (idx % 40))::text AS total FROM fixture_variants WHERE idx <= ${staleVariants}`)).rows[0]!.total;
    await admin.query(`INSERT INTO "Order" (number, id, "companyId", "sellerId", "fromCatalog", currency, total, "itemsTotal", "deliveryCost", "deliveryCharge", "deliveryStatus", cancelled, "createdAt")
      SELECT ${1000 + orders} + s.j, s.id, ${c}::uuid, '${sellerId}', false, 'PEN', ${total}, ${total}, 0, 0, 'pending', false, s.created_at FROM fixture_stale s`);
    await admin.query(`INSERT INTO "OrderItem" (id, "companyId", "orderId", "orderCreatedAt", "variantId", "productName", "variantAttributes", quantity, "unitPrice", subtotal)
      SELECT md5(${c} || 'si' || s.j || '-' || v.idx)::uuid, ${c}::uuid, s.id, s.created_at, v.id, 'Producto', '{}'::json, 1, 10 + (v.idx % 40), 10 + (v.idx % 40)
      FROM fixture_stale s CROSS JOIN fixture_variants v WHERE v.idx <= ${staleVariants}`);
    await admin.query("DROP TABLE fixture_stale");
  }
  await admin.query(`UPDATE "Company" SET "nextOrderNumber" = ${1001 + orders + staleOrders} WHERE id = ${c}::uuid`);
  const counts = (await admin.query<{ variants: number; items: number; payments: number }>(`SELECT
    (SELECT count(*)::int FROM fixture_variants) AS variants, (SELECT count(*)::int FROM "OrderItem" WHERE "companyId" = ${c}::uuid) AS items,
    (SELECT count(*)::int FROM "Payment" WHERE "companyId" = ${c}::uuid) AS payments`)).rows[0]!;
  const staleProductIds = (await admin.query<{ id: string }>(`SELECT md5(${c} || 'p' || n)::uuid::text AS id FROM generate_series(1, ${stale}) n`)).rows.map((row) => row.id);
  const wideProductId = wide > 0 ? (await admin.query<{ id: string }>(`SELECT md5(${c} || 'p' || ${wideProduct})::uuid::text AS id`)).rows[0]!.id : null;
  await admin.query("DROP TABLE IF EXISTS fixture_orders");
  await admin.query("DROP TABLE fixture_variants");
  return { companyId, sellerId, orders: orders + staleOrders, items: counts.items, payments: counts.payments, variants: counts.variants, staleProductIds, wideProductId };
}

/** Removes the stores, children first, as the administrative role. */
export async function removeStores(admin: pg.Client, companyIds: readonly string[]): Promise<void> {
  if (companyIds.length === 0) return;
  const ids = companyIds.map((id) => { if (!uuidPattern.test(id)) throw new Error("Invalid company id"); return `'${id}'`; }).join(", ");
  for (const table of ["Payment", "OrderItem", "Order", "ProductVariantOptionValue", "ProductStock", "ProductVariant", "ProductOptionValue", "ProductOption", "Product", "user", "Company"]) {
    await admin.query(`DELETE FROM "${table}" WHERE ${table === "Company" ? "id" : '"companyId"'} IN (${ids})`);
  }
}

export type Window = Readonly<{ from: string; through: string }>;

export type SalesLoadFixture = Readonly<{
  /** The store with four years of history, the stale products and the wide product. */
  store: SeededStore;
  /** The same yearly volume with one year of history only: the baseline of "not slower on four years than on one". */
  oneYearStore: SeededStore;
  otherStores: readonly SeededStore[];
  /** Fixture time: the history runs from 2023-12-01 to 2028-01-01. */
  windows: Readonly<{ month: Window; worstSummary: Readonly<{ current: Window; previous: Window }> }>;
  companyIds: readonly string[];
}>;

const vacuumTables = ["Company", "user", "Product", "ProductOption", "ProductOptionValue", "ProductVariant", "ProductVariantOptionValue", "ProductStock", "Order", "OrderItem", "Payment"];

/**
 * The history fixture of the technical design: the store at the expected maximum volume over four years (and the stale shapes of the unsold page),
 * a baseline store with one year, and the same volume as the main store spread over 20 other companies in the same tables, then `VACUUM (ANALYZE)`,
 * the steady state autovacuum reaches in production (without it the visibility map is not set and index-only probes fetch every heap tuple).
 * `scale` shrinks the volumes for a dry run of the mechanics; counts are returned so a run can report them.
 */
export async function seedSalesLoadFixture(admin: pg.Client, options: Readonly<{ scale?: number }> = {}): Promise<SalesLoadFixture> {
  const scale = options.scale ?? 1;
  const ordersPerDay = 165 * scale;
  const catalog = stat(3000 * scale) + 21;
  const store = await seedStore(admin, {
    companyId: randomUUID(), start: "2023-12-01", end: "2028-01-01", ordersPerDay, products: catalog,
    staleProducts: 20, wideProductVariants: 60, staleItemsPerVariant: stat(3000 * scale), staleStart: "2023-12-01",
  });
  const oneYearStore = await seedStore(admin, { companyId: randomUUID(), start: "2027-01-01", end: "2028-01-01", ordersPerDay, products: catalog });
  const otherStores: SeededStore[] = [];
  for (let index = 0; index < 20; index += 1) {
    otherStores.push(await seedStore(admin, { companyId: randomUUID(), start: "2023-12-01", end: "2028-01-01", ordersPerDay: ordersPerDay / 20, products: Math.max(stat(150 * scale), 3) }));
  }
  for (const table of vacuumTables) await admin.query(`VACUUM (ANALYZE) "${table}"`);
  return {
    store, oneYearStore, otherStores, companyIds: [store.companyId, oneYearStore.companyId, ...otherStores.map((other) => other.companyId)],
    windows: {
      month: { from: "2027-06-01", through: "2027-06-30" },
      worstSummary: { current: { from: "2027-01-01", through: "2028-01-01" }, previous: { from: "2025-12-01", through: "2026-12-01" } },
    },
  };
}
