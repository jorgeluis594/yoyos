import { readFile } from "node:fs/promises";
import pg from "pg";
import { z } from "zod";
import { log } from "@core/src/shared/infrastructure/logger";

const catalogPath = process.env.COURIER_CATALOG_FILE ?? new URL("../prisma/catalog/couriers.json", import.meta.url);
const courierCatalogFileSchema = z.array(z.strictObject({
  code: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/).max(40),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
})).refine((values) => new Set(values.map((value) => value.code)).size === values.length);

let connected = false;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
try {
  const couriers = courierCatalogFileSchema.parse(JSON.parse(await readFile(catalogPath, "utf8")));
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
