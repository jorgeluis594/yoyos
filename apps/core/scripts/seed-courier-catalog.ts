import { readFile } from "node:fs/promises";
import pg from "pg";
import { log } from "@core/src/shared/infrastructure/logger";
import { parseCourierCatalog } from "@core/src/features/delivery-settings/infrastructure/catalog-files";

const catalogPath = process.env.COURIER_CATALOG_FILE ?? new URL("../prisma/catalog/couriers.json", import.meta.url);
let connected = false;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
try {
  const parsed = parseCourierCatalog(await readFile(catalogPath, "utf8"));
  if (!parsed.success) throw new Error(parsed.error.message);
  const couriers = parsed.data;
  await db.connect();
  connected = true;
  await db.query("BEGIN");
  for (const { code, name, enabled } of couriers) {
    await db.query(`INSERT INTO "Courier" ("id", "code", "name", "enabled") VALUES (gen_random_uuid(), $1, $2, $3)
      ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "enabled" = EXCLUDED."enabled"`, [code, name, enabled]);
  }
  await db.query("COMMIT");
  log.info({ event: "courier_catalog_seeded", couriers: couriers.length }, "Courier catalog seeded");
} catch (error) {
  if (connected) await db.query("ROLLBACK").catch(() => undefined);
  log.error({ event: "courier_catalog_seed_failed", err: error }, "Courier catalog seed failed");
  process.exitCode = 1;
} finally {
  if (connected) await db.end();
}
