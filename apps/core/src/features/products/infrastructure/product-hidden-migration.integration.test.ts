import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import pg from "pg";
import { expect, test } from "vitest";

const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const hiddenMigration = migrations.findIndex((name) => name.endsWith("_add_product_hidden"));

function migrate(url: string, names: readonly string[]) {
  execFileSync("psql", [url, "-q", "-v", "ON_ERROR_STOP=1", ...names.flatMap((migration) => ["-f", `prisma/migrations/${migration}/migration.sql`])], { stdio: "pipe" });
}

test("the migration adds hidden false to existing products", async () => {
  expect(hiddenMigration).toBeGreaterThan(0);
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Migration tests require administrative test credentials");
  const name = `product_hidden_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    await db.connect();
    migrate(url.toString(), migrations.slice(0, hiddenMigration));
    const companyId = randomUUID();
    const productId = randomUUID();
    await db.query(`INSERT INTO "Company" (id, name, country) VALUES ($1, 'Store', 'PE')`, [companyId]);
    await db.query(`INSERT INTO "Product" (id, "companyId", name, currency, "qrCode", status, "createdAt", "updatedAt") VALUES ($1, $2, 'Casaca', 'PEN', $3, 'active', now(), now())`, [productId, companyId, randomUUID()]);

    migrate(url.toString(), migrations.slice(hiddenMigration));

    expect((await db.query(`SELECT hidden FROM "Product" WHERE id = $1`, [productId])).rows).toEqual([{ hidden: false }]);
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
