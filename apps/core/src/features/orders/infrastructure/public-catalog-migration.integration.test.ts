import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import pg from "pg";
import { expect, test } from "vitest";

const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const firstCatalogMigration = migrations.findIndex((name) => name.endsWith("_add_public_catalog"));

async function withScratchDatabase(work: (db: pg.Client, migrate: (names: readonly string[]) => void) => Promise<void>) {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Migration tests require administrative test credentials");
  const name = `catalog_migration_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    await db.connect();
    // psql runs each statement on its own, as Prisma does for files with CREATE INDEX CONCURRENTLY.
    await work(db, (names) => { execFileSync("psql", [url.toString(), "-q", "-v", "ON_ERROR_STOP=1", ...names.flatMap((migration) => ["-f", `prisma/migrations/${migration}/migration.sql`])], { stdio: "pipe" }); });
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

const insertOrder = (db: pg.Client, values: Readonly<{ companyId: string; number: number; sellerId: string | null; fromCatalog?: boolean; chatId?: string }>) =>
  db.query(`INSERT INTO "Order" (id, number, "companyId", "sellerId", currency, total, "itemsTotal", "createdAt"${values.fromCatalog === undefined ? "" : `, "fromCatalog"`}${values.chatId ? `, "chatId"` : ""})
    VALUES ($1, $2, $3, $4, 'PEN', 10, 10, now()${values.fromCatalog === undefined ? "" : `, ${values.fromCatalog}`}${values.chatId ? `, '${values.chatId}'` : ""})`,
  [randomUUID(), values.number, values.companyId, values.sellerId]);

test("migration keeps existing orders valid and the number sequence continues", async () => {
  expect(firstCatalogMigration).toBeGreaterThan(0);
  await withScratchDatabase(async (db, migrate) => {
    migrate(migrations.slice(0, firstCatalogMigration));
    const companyId = randomUUID();
    const sellerId = randomUUID();
    await db.query(`INSERT INTO "Company" (id, name, country, "nextOrderNumber") VALUES ($1, 'Store', 'PE', 1004)`, [companyId]);
    await db.query(`INSERT INTO "user" (id, name, email, "companyId", "updatedAt") VALUES ($1, 'Seller', $2, $3, now())`, [sellerId, `${sellerId}@example.test`, companyId]);
    for (const number of [1001, 1002, 1003]) await insertOrder(db, { companyId, number, sellerId });
    const before = (await db.query(`SELECT * FROM "Order" ORDER BY number`)).rows;

    migrate(migrations.slice(firstCatalogMigration));

    expect((await db.query(`SELECT * FROM "Order" ORDER BY number`)).rows).toEqual(before.map((row) => ({ ...row, cancelledAt: null, stockDeductedAt: null, fromCatalog: false, checkoutEnabledAt: row.createdAt })));
    const next = await db.query(`UPDATE "Company" SET "nextOrderNumber" = "nextOrderNumber" + 1 WHERE id = $1 RETURNING "nextOrderNumber" - 1 AS number`, [companyId]);
    expect(next.rows[0].number).toBe("1004");
    expect((await db.query(`SELECT "catalogPublished" FROM "Company" WHERE id = $1`, [companyId])).rows[0].catalogPublished).toBe(false);
  });
});

test("database rejects an order without seller that is not from the catalog, and a catalog order with a chat", async () => {
  await withScratchDatabase(async (db, migrate) => {
    migrate(migrations);
    const companyId = randomUUID();
    await db.query(`INSERT INTO "Company" (id, name, country) VALUES ($1, 'Store', 'PE')`, [companyId]);
    await expect(insertOrder(db, { companyId, number: 1001, sellerId: null })).rejects.toMatchObject({ code: "23514", constraint: "Order_seller_present" });
    await expect(insertOrder(db, { companyId, number: 1001, sellerId: null, fromCatalog: true, chatId: randomUUID() }))
      .rejects.toMatchObject({ code: "23514", constraint: "Order_catalog_without_chat" });
    await insertOrder(db, { companyId, number: 1001, sellerId: null, fromCatalog: true });
    expect((await db.query(`SELECT count(*)::int AS count FROM "Order"`)).rows[0].count).toBe(1);
  });
});

test("checkout enabling migration enables every order without one, keeping existing enable timestamps", async () => {
  const name = migrations.findIndex((entry) => entry.endsWith("_enable_checkout_on_existing_orders"));
  expect(name).toBeGreaterThan(0);
  await withScratchDatabase(async (db, migrate) => {
    migrate(migrations.slice(0, name));
    const companyId = randomUUID();
    const sellerId = randomUUID();
    await db.query(`INSERT INTO "Company" (id, name, country, "nextOrderNumber") VALUES ($1, 'Store', 'PE', 1005)`, [companyId]);
    await db.query(`INSERT INTO "user" (id, name, email, "companyId", "updatedAt") VALUES ($1, 'Seller', $2, $3, now())`, [sellerId, `${sellerId}@example.test`, companyId]);
    for (const number of [1001, 1002, 1003, 1004]) await insertOrder(db, { companyId, number, sellerId });
    await db.query(`UPDATE "Order" SET "createdAt" = '2026-01-01T10:00:00Z' WHERE number IN (1001, 1002, 1003)`);
    await db.query(`UPDATE "Order" SET cancelled = true WHERE number = 1002`);
    await db.query(`UPDATE "Order" SET "completedAt" = '2026-01-05T10:00:00Z' WHERE number = 1003`);
    await db.query(`UPDATE "Order" SET "checkoutEnabledAt" = '2026-01-02T10:00:00' WHERE number = 1004`);
    const existing = (await db.query(`SELECT "checkoutEnabledAt" FROM "Order" WHERE number = 1004`)).rows[0].checkoutEnabledAt;

    migrate(migrations.slice(name));

    const rows = (await db.query(`SELECT number, "createdAt", "checkoutEnabledAt" FROM "Order" ORDER BY number`)).rows;
    expect(rows.map((row) => row.checkoutEnabledAt)).toEqual([rows[0].createdAt, rows[1].createdAt, rows[2].createdAt, existing]);
  });
});
