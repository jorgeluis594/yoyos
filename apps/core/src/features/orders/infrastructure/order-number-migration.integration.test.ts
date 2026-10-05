import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test } from "vitest";

const migration = "20261005060640_add_order_numbers";
const migrations = fileURLToPath(new URL("../../../../prisma/migrations/", import.meta.url));

test("backfills historical numbers and buyer snapshots without changing order data", async () => {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Migration test requires isolated administrative credentials");
  const database = `checkout_numbers_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    await db.connect();
    for (const name of (await readdir(migrations)).filter((name) => name < migration && /^\d/.test(name)).sort())
      await db.query(await readFile(`${migrations}${name}/migration.sql`, "utf8"));
    const companies = [randomUUID(), randomUUID(), randomUUID()];
    const at = new Date("2026-01-01T12:00:00Z");
    for (const company of companies) {
      await db.query('INSERT INTO "Company" (id, name, country) VALUES ($1, $2, $3)', [company, "Historical", "PE"]);
      await db.query('INSERT INTO "user" (id, name, email, "companyId", "updatedAt") VALUES ($1, $2, $3, $4, $5)', [company, "Seller", `${company}@example.test`, company, at]);
    }
    for (const company of companies.slice(0, 2)) for (let index = 0; index < 3; index++) {
      await db.query('INSERT INTO "Order" (id, "companyId", "sellerId", currency, total, "itemsTotal", "createdAt", cancelled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [randomUUID(), company, company, "PEN", "10.00", "10.00", index === 2 ? new Date("2025-01-01") : at, index === 1]);
    }
    for (const company of companies.slice(0, 2)) {
      const contact = randomUUID();
      await db.query('INSERT INTO "Contact" (id, "companyId", phone, name, "updatedAt") VALUES ($1,$2,$3,$4,$5)', [contact, company, "+51987654321", "Current contact", at]);
      const ids = (await db.query('SELECT id FROM "Order" WHERE "companyId" = $1 ORDER BY id', [company])).rows;
      for (const [index, row] of ids.slice(0, 2).entries()) await db.query('UPDATE "Order" SET "contactId"=$1, "contactName"=$2, "contactPhone"=$3 WHERE "companyId"=$4 AND id=$5',
        [contact, index ? "Historical buyer" : null, "+14155552671", company, row.id]);
    }
    const before = (await db.query('SELECT * FROM "Order" ORDER BY "companyId", "createdAt", id')).rows;
    execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-f", `${migrations}${migration}/migration.sql`], { stdio: "pipe" });
    const after = (await db.query('SELECT * FROM "Order" ORDER BY "companyId", "createdAt", id')).rows;
    expect(after.map((order) => Object.fromEntries(Object.entries(order).filter(([key]) => key !== "number")))).toEqual(before);
    for (const company of companies.slice(0, 2)) expect(after.filter((order) => order.companyId === company).map((order) => order.number)).toEqual(["1001", "1002", "1003"]);
    expect((await db.query('SELECT "nextOrderNumber" FROM "Company" WHERE id = $1', [companies[0]])).rows[0].nextOrderNumber).toBe("1004");
    expect((await db.query('SELECT "nextOrderNumber" FROM "Company" WHERE id = $1', [companies[2]])).rows[0].nextOrderNumber).toBe("1001");
    execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-f", `${migrations}20261005061438_separate_order_buyer/migration.sql`], { stdio: "pipe" });
    const buyers = (await db.query('SELECT * FROM "OrderBuyer"')).rows;
    expect(buyers).toHaveLength(4);
    for (const original of before) {
      const buyer = buyers.find((row) => row.orderId === original.id);
      if (original.contactId) expect(buyer).toEqual({ orderId: original.id, companyId: original.companyId, contactId: original.contactId, name: original.contactName, phone: original.contactPhone });
      else expect(buyer).toBeUndefined();
    }
    const migrated = (await db.query('SELECT * FROM "Order" ORDER BY "companyId", "createdAt", id')).rows;
    expect(migrated.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["number", "checkoutEnabledAt", "checkoutConfirmedAt"].includes(key)))))
      .toEqual(before.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["contactId", "contactName", "contactPhone"].includes(key)))));
    expect(migrated.every((row) => row.checkoutEnabledAt === null && row.checkoutConfirmedAt === null)).toBe(true);
    await expect(db.query('UPDATE "Order" SET "checkoutConfirmedAt" = now() WHERE id = $1', [before[0].id])).rejects.toThrow();
    await expect(db.query('UPDATE "Order" SET number = 1001 WHERE "companyId" = $1', [companies[0]])).rejects.toThrow();
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
