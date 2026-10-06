import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test } from "vitest";

const migrations = fileURLToPath(new URL("../../../../prisma/migrations/", import.meta.url));
const provision = fileURLToPath(new URL("../../../../scripts/provision-role.sql", import.meta.url));
const currentMigration = "20261001004253_split_order_payment_delivery";
const finalMigration = "20261001022053_remove_order_payment_method";

test("migrates historical sales to paid delivered orders without changing stock", async () => {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) throw new Error("Migration test requires admin and application test URLs");
  const database = `yoyos_order_migration_${randomUUID().replaceAll("-", "")}`;
  const isolatedAdminUrl = new URL(adminUrl);
  isolatedAdminUrl.pathname = `/${database}`;
  const isolatedAppUrl = new URL(appUrl);
  isolatedAppUrl.pathname = `/${database}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  let isolated;
  let app;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    // Prisma stores UTC clock values in timestamp columns; mirror that behavior in this raw-pg fixture.
    const utcTypes = { getTypeParser: (oid, format) => oid === 1114
      ? (value) => new Date(`${value}Z`) : pg.types.getTypeParser(oid, format) };
    isolated = new pg.Client({ connectionString: isolatedAdminUrl.toString(), types: utcTypes });
    await isolated.connect();
    const dirs = (await readdir(migrations, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name < currentMigration)
      .map((entry) => entry.name).sort();
    for (const dir of dirs) await isolated.query(await readFile(`${migrations}${dir}/migration.sql`, "utf8"));

    const company = randomUUID();
    const otherCompany = randomUUID();
    const seller = randomUUID();
    const product = randomUUID();
    const variant = randomUUID();
    const order = randomUUID();
    const item = randomUUID();
    const completedAt = new Date("2026-09-27T12:00:00.000Z");
    const storedAt = completedAt.toISOString();
    await isolated.query('INSERT INTO "Company" ("id", "name", "country") VALUES ($1, $2, $3), ($4, $5, $6)',
      [company, "Historical", "PE", otherCompany, "Other", "CL"]);
    await isolated.query('INSERT INTO "user" ("id", "name", "email", "companyId", "updatedAt") VALUES ($1, $2, $3, $4, $5)',
      [seller, "Seller", `${seller}@example.test`, company, storedAt]);
    await isolated.query('INSERT INTO "Product" ("id", "companyId", "name", "currency", "qrCode", "status", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [product, company, "Old product", "PEN", product, "active", storedAt, storedAt]);
    await isolated.query('INSERT INTO "ProductVariant" ("id", "companyId", "productId", "attributes", "salePrice", "qrCode", "status") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [variant, company, product, { Size: "M" }, "7.50", variant, "active"]);
    await isolated.query('INSERT INTO "ProductStock" ("variantId", "companyId", "quantity") VALUES ($1, $2, $3)', [variant, company, "7"]);
    await isolated.query('INSERT INTO "Order" ("id", "companyId", "sellerId", "currency", "total", "paymentMethod", "completedAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [order, company, seller, "PEN", "15.00", "digital_wallet", storedAt]);
    await isolated.query('INSERT INTO "OrderItem" ("id", "companyId", "orderId", "variantId", "productName", "variantAttributes", "quantity", "unitPrice", "subtotal") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [item, company, order, variant, "Old product", { Size: "M" }, "2", "7.50", "15.00"]);

    await isolated.query(await readFile(`${migrations}${currentMigration}/migration.sql`, "utf8"));
    await isolated.query('UPDATE "Payment" SET "amount" = 14 WHERE "orderId" = $1', [order]);
    await expect(isolated.query(await readFile(`${migrations}${finalMigration}/migration.sql`, "utf8")))
      .rejects.toThrow(/Historical order payment method has not been transferred/);
    await isolated.query("ROLLBACK");
    await isolated.query('UPDATE "Payment" SET "amount" = 15 WHERE "orderId" = $1', [order]);
    await isolated.query(await readFile(`${migrations}${finalMigration}/migration.sql`, "utf8"));
    const subsequent = (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name > finalMigration && entry.name < "20261005060015_company_payment_settings").map((entry) => entry.name).sort();
    for (const dir of subsequent) await isolated.query(await readFile(`${migrations}${dir}/migration.sql`, "utf8"));
    expect((await isolated.query('SELECT * FROM "CompanyDeliverySettings"')).rows).toEqual([]);
    const saved = await isolated.query('SELECT o.*, p."id" AS "paymentId", p."amount" AS "paidAmount", p."method" AS "paidMethod", p."recordedAt" AS "paidAt" FROM "Order" o JOIN "Payment" p ON p."companyId" = o."companyId" AND p."orderId" = o."id" WHERE o."id" = $1', [order]);
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]).toMatchObject({ id: order, companyId: company, delivery: null, deliveryStatus: "delivered",
      stockDeducted: true, cancelled: false, paidMethod: "digital_wallet" });
    expect(saved.rows[0]).not.toHaveProperty("paymentMethod");
    expect(saved.rows[0].createdAt).toEqual(completedAt);
    expect(saved.rows[0].completedAt).toEqual(completedAt);
    expect(saved.rows[0].paidAt).toEqual(completedAt);
    expect(saved.rows[0].itemsTotal).toBe("15.00");
    expect(saved.rows[0].deliveryCost).toBe("0.00");
    expect(saved.rows[0].deliveryCharge).toBe("0.00");
    expect(saved.rows[0].paidAmount).toBe("15.00");
    expect((await isolated.query('SELECT "productName", "variantAttributes", "quantity", "unitPrice", "subtotal" FROM "OrderItem" WHERE "orderId" = $1', [order])).rows)
      .toEqual([{ productName: "Old product", variantAttributes: { Size: "M" }, quantity: "2", unitPrice: "7.50", subtotal: "15.00" }]);
    expect((await isolated.query('SELECT "quantity" FROM "ProductStock" WHERE "variantId" = $1', [variant])).rows[0].quantity).toBe("7");

    for (const name of (await readdir(migrations)).filter((name) => name >= "20261005060015_company_payment_settings" && /^\d/.test(name)).sort())
      execFileSync("psql", [isolatedAdminUrl.toString(), "-v", "ON_ERROR_STOP=1", "-f", `${migrations}${name}/migration.sql`], { stdio: "pipe" });
    expect((await isolated.query('SELECT "deliveredAt" FROM "Order" WHERE "id" = $1', [order])).rows[0].deliveredAt).toEqual(completedAt);
    const migrated = (await isolated.query('SELECT "id", "amount", "currency", "method", "status", "data" FROM "Payment" WHERE "orderId" = $1', [order])).rows[0];
    expect(migrated).toMatchObject({ id: saved.rows[0].paymentId, amount: "15.00", currency: "PEN", method: "digital_wallet", status: "confirmed",
      data: { confirmedBy: { kind: "legacy" }, evidence: { kind: "manual" } } });
    expect(new Date(migrated.data.confirmedAt)).toEqual(completedAt);

    execFileSync("psql", [isolatedAdminUrl.toString(), "-v", "ON_ERROR_STOP=1", "-v", "app_password=core_app_local", "-v", `dbname=${database}`, "-f", provision]);
    app = new pg.Client({ connectionString: isolatedAppUrl.toString() });
    await app.connect();
    expect((await app.query('SELECT public.resolve_buyer_order_company($1::uuid) AS company', [order])).rows)
      .toEqual([{ company }]);
    expect((await app.query('SELECT public.resolve_buyer_order_company($1::uuid) AS company', [randomUUID()])).rows)
      .toEqual([{ company: null }]);
    await app.query("SELECT set_config('app.company_id', $1, false)", [company]);
    await app.query('INSERT INTO "CompanyDeliverySettings" ("storeEnabled", "pickupName", "pickupAddress", "version") VALUES (true, $1, $2, 1)',
      ["Historical business pickup", "Av. Lima 123"]);
    expect((await app.query('SELECT "companyId", "version" FROM "CompanyDeliverySettings"')).rows).toEqual([{ companyId: company, version: 1 }]);
    expect((await app.query('SELECT "id" FROM "Payment"')).rows).toEqual([{ id: saved.rows[0].paymentId }]);
    await app.query("SELECT set_config('app.company_id', $1, false)", [otherCompany]);
    expect((await app.query('SELECT * FROM "CompanyDeliverySettings"')).rows).toEqual([]);
    expect((await app.query('SELECT "id" FROM "Payment"')).rows).toEqual([]);
    await expect(app.query('INSERT INTO "Payment" ("id", "orderId", "status", "amount", "currency", "method", "data") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [randomUUID(), order, "confirmed", "1.00", "PEN", "digital_wallet", migrated.data])).rejects.toThrow();
  } finally {
    await app?.end();
    await isolated?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
