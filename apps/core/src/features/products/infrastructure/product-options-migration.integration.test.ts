import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import pg from "pg";
import { expect, test } from "vitest";

const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const optionsMigration = migrations.findIndex((name) => name.endsWith("_add_product_options"));

async function withScratchDatabase(work: (db: pg.Client, migrate: (names: readonly string[]) => void) => Promise<void>) {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Migration tests require administrative test credentials");
  const name = `product_options_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    await db.connect();
    await work(db, (names) => { execFileSync("psql", [url.toString(), "-q", "-v", "ON_ERROR_STOP=1", ...names.flatMap((migration) => ["-f", `prisma/migrations/${migration}/migration.sql`])], { stdio: "pipe" }); });
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

/** A product as today's forms create it: one variant with `{}` attributes and its stock, plus an order that sold it. */
async function legacyProduct(db: pg.Client, companyId: string, variants: number) {
  const productId = randomUUID();
  await db.query(`INSERT INTO "Product" (id, "companyId", name, currency, "qrCode", status, "createdAt", "updatedAt") VALUES ($1, $2, 'Camisa', 'PEN', $3, 'active', now(), now())`, [productId, companyId, randomUUID()]);
  const ids: { id: string; qrCode: string }[] = [];
  for (let index = 0; index < variants; index += 1) {
    const variant = { id: randomUUID(), qrCode: randomUUID() };
    ids.push(variant);
    await db.query(`INSERT INTO "ProductVariant" (id, "companyId", "productId", attributes, sku, "salePrice", "qrCode", status) VALUES ($1, $2, $3, $4, $5, 10, $6, 'active')`,
      [variant.id, companyId, productId, variants > 1 ? { Talla: String(index) } : {}, `SKU-${index}`, variant.qrCode]);
    await db.query(`INSERT INTO "ProductStock" ("variantId", "companyId", quantity) VALUES ($1, $2, 7)`, [variant.id, companyId]);
  }
  return { productId, variants: ids };
}

test("migration keeps products created by today's forms as products without options", async () => {
  expect(optionsMigration).toBeGreaterThan(0);
  await withScratchDatabase(async (db, migrate) => {
    migrate(migrations.slice(0, optionsMigration));
    const companyId = randomUUID();
    await db.query(`INSERT INTO "Company" (id, name, country) VALUES ($1, 'Store', 'PE')`, [companyId]);
    const { productId, variants: [variant] } = await legacyProduct(db, companyId, 1);
    const orderId = randomUUID();
    await db.query(`INSERT INTO "Order" (id, number, "companyId", "fromCatalog", currency, total, "itemsTotal", "createdAt", "checkoutEnabledAt") VALUES ($1, 1001, $2, true, 'PEN', 10, 10, now(), now())`, [orderId, companyId]);
    await db.query(`INSERT INTO "OrderItem" (id, "companyId", "orderId", "variantId", "productName", "variantAttributes", quantity, "unitPrice", subtotal) VALUES ($1, $2, $3, $4, 'Camisa', $5, 1, 10, 10)`,
      [randomUUID(), companyId, orderId, variant.id, { Talla: "M", Color: "Azul" }]);

    migrate(migrations.slice(optionsMigration));

    const stored = (await db.query(`SELECT v.id, v."qrCode", v."combinationKey", v.sku, s.quantity::int AS stock, p."structureVersion" FROM "ProductVariant" v
      JOIN "ProductStock" s ON s."variantId" = v.id JOIN "Product" p ON p.id = v."productId" WHERE v."productId" = $1`, [productId])).rows;
    expect(stored).toEqual([{ id: variant.id, qrCode: variant.qrCode, combinationKey: "", sku: "SKU-0", stock: 7, structureVersion: 0 }]);
    const item = (await db.query(`SELECT "variantAttributes"::text AS attributes FROM "OrderItem"`)).rows[0];
    // jsonb sorted the keys before the cast; the json column keeps that order from now on.
    expect(Object.entries(JSON.parse(item.attributes))).toEqual([["Color", "Azul"], ["Talla", "M"]]);
    expect((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ProductVariant' AND column_name = 'attributes'`)).rows).toEqual([]);
    expect((await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'OrderItem' AND column_name = 'variantAttributes'`)).rows).toEqual([{ data_type: "json" }]);
    expect((await db.query(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'ProductVariant' AND column_name = 'combinationKey'`)).rows).toEqual([{ column_default: null, is_nullable: "NO" }]);
  });
});

test("migration rolls back entirely on a database seeded with several variants per product", async () => {
  await withScratchDatabase(async (db, migrate) => {
    migrate(migrations.slice(0, optionsMigration));
    const companyId = randomUUID();
    await db.query(`INSERT INTO "Company" (id, name, country) VALUES ($1, 'Store', 'PE')`, [companyId]);
    await legacyProduct(db, companyId, 2);
    expect(() => migrate(migrations.slice(optionsMigration))).toThrow();
    expect((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ProductVariant' AND column_name = 'attributes'`)).rows).toHaveLength(1);
    expect((await db.query(`SELECT to_regclass('public."ProductOption"') AS name`)).rows[0].name).toBeNull();
    expect((await db.query(`SELECT count(*)::int AS count FROM pg_constraint WHERE conname = 'ProductVariant_status_active'`)).rows[0].count).toBe(1);
  });
});

test("the migrated schema allows inactive variants and rejects invalid statuses, names and positions", async () => {
  await withScratchDatabase(async (db, migrate) => {
    migrate(migrations);
    const companyId = randomUUID();
    const productId = randomUUID();
    await db.query(`INSERT INTO "Company" (id, name, country) VALUES ($1, 'Store', 'PE')`, [companyId]);
    await db.query(`INSERT INTO "Product" (id, "companyId", name, currency, "qrCode", status, "createdAt", "updatedAt") VALUES ($1, $2, 'Camisa', 'PEN', $3, 'active', now(), now())`, [productId, companyId, randomUUID()]);
    const variant = (status: string, key: string) => db.query(`INSERT INTO "ProductVariant" (id, "companyId", "productId", "combinationKey", "salePrice", "qrCode", status) VALUES ($1, $2, $3, $4, 10, $5, $6)`,
      [randomUUID(), companyId, productId, key, randomUUID(), status]);
    await variant("inactive", "a");
    await expect(variant("archived", "b")).rejects.toMatchObject({ code: "23514", constraint: "ProductVariant_status_valid" });
    await expect(variant("active", "a")).rejects.toMatchObject({ code: "23505", constraint: "ProductVariant_companyId_productId_combinationKey_key" });
    const option = (name: string, position: number) => db.query(`INSERT INTO "ProductOption" (id, "companyId", "productId", name, position) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), companyId, productId, name, position]);
    await option("Talla", 0);
    await expect(option(" Color", 1)).rejects.toMatchObject({ code: "23514", constraint: "ProductOption_name_valid" });
    await expect(option("x".repeat(31), 1)).rejects.toMatchObject({ code: "22001" });
    await expect(option("Color", -1)).rejects.toMatchObject({ code: "23514", constraint: "ProductOption_position_valid" });
    await expect(db.query(`UPDATE "Product" SET "structureVersion" = -1`)).rejects.toMatchObject({ code: "23514", constraint: "Product_structureVersion_valid" });
    const order = randomUUID();
    await db.query(`INSERT INTO "Order" (id, number, "companyId", "fromCatalog", currency, total, "itemsTotal", "createdAt", "checkoutEnabledAt") VALUES ($1, 1001, $2, true, 'PEN', 10, 10, now(), now())`, [order, companyId]);
    const item = (attributes: unknown) => db.query(`INSERT INTO "OrderItem" (id, "companyId", "orderId", "orderCreatedAt", "variantId", "productName", "variantAttributes", quantity, "unitPrice", subtotal)
      SELECT $1, $2, $3, (SELECT "createdAt" FROM "Order" WHERE id = $3), id, 'Camisa', $4::json, 1, 10, 10 FROM "ProductVariant" WHERE "combinationKey" = 'a'`, [randomUUID(), companyId, order, JSON.stringify(attributes)]);
    await expect(item({ Talla: 1 })).rejects.toMatchObject({ code: "23514", constraint: "OrderItem_attributes_object" });
    await expect(item(["M"])).rejects.toMatchObject({ code: "23514", constraint: "OrderItem_attributes_object" });
    await item({ Talla: "M" });
  });
});
