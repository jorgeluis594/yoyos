import { readFile } from "node:fs/promises";
import pg from "pg";
import { log } from "@core/src/shared/infrastructure/logger";
import { parseAgencyCatalog, parseCourierCatalog } from "@core/src/features/delivery-settings/infrastructure/catalog-files";

// Run by hand (never on deploy) with the migration role: `DATABASE_URL=<core role URL> pnpm catalog:load`. See prisma/catalog/README.md.
const courierFile = process.env.COURIER_CATALOG_FILE ?? new URL("../prisma/catalog/couriers.json", import.meta.url);
const agencyFile = process.env.AGENCY_CATALOG_FILE ?? new URL("../prisma/catalog/agencies.csv", import.meta.url);

const couriers = parseCourierCatalog(await readFile(courierFile, "utf8"));
const agencies = couriers.success ? parseAgencyCatalog(await readFile(agencyFile, "utf8"), new Set(couriers.data.map((courier) => courier.code))) : couriers;
if (!agencies.success) {
  // The logger hides error messages; file problems carry no personal data and must reach whoever runs the load.
  log.error({ event: "catalog_load_failed", problems: agencies.error.message.split("\n") }, "Catalog files are invalid; nothing was loaded");
  process.exit(1);
}
const courierRows = couriers.success ? couriers.data : [];

let connected = false;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
try {
  await db.connect();
  connected = true;
  await db.query("BEGIN");
  for (const { code, name, enabled } of courierRows) {
    await db.query(`INSERT INTO "Courier" ("id", "code", "name", "enabled") VALUES (gen_random_uuid(), $1, $2, $3)
      ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "enabled" = EXCLUDED."enabled"`, [code, name, enabled]);
  }
  const { rows } = await db.query<{ inserted: number; changed: number }>(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(id uuid, courier text, name text, address text, "districtCode" text, enabled boolean)
    ), upserted AS (
      INSERT INTO "DeliveryAgency" (id, "courierId", name, address, "districtCode", enabled)
      SELECT input.id, courier.id, input.name, input.address, input."districtCode", input.enabled FROM input JOIN "Courier" courier ON courier.code = input.courier
      ON CONFLICT (id) DO UPDATE SET "courierId" = EXCLUDED."courierId", name = EXCLUDED.name, address = EXCLUDED.address,
        "districtCode" = EXCLUDED."districtCode", enabled = EXCLUDED.enabled
      WHERE ("DeliveryAgency"."courierId", "DeliveryAgency".name, "DeliveryAgency".address, "DeliveryAgency"."districtCode", "DeliveryAgency".enabled)
        IS DISTINCT FROM (EXCLUDED."courierId", EXCLUDED.name, EXCLUDED.address, EXCLUDED."districtCode", EXCLUDED.enabled)
      RETURNING (xmax = 0) AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted)::int AS inserted, count(*) FILTER (WHERE NOT inserted)::int AS changed FROM upserted`,
  [JSON.stringify(agencies.data)]);
  // Agencies missing from the file are left untouched: retiring one is an explicit enabled=false row, never a deletion.
  const missing = await db.query<{ id: string }>('SELECT id FROM "DeliveryAgency" WHERE NOT (id = ANY($1::uuid[])) ORDER BY id',
    [agencies.data.map((agency) => agency.id)]);
  await db.query("COMMIT");
  if (missing.rows.length > 0) log.warn({ event: "catalog_agencies_not_in_file", agencyIds: missing.rows.map((row) => row.id) }, "Catalog agencies not in agencies.csv were left unchanged");
  log.info({ event: "catalog_loaded", couriers: courierRows.length, agencies: agencies.data.length, inserted: rows[0].inserted, updated: rows[0].changed },
    "Courier and agency catalog loaded");
} catch (error) {
  if (connected) await db.query("ROLLBACK").catch(() => undefined);
  log.error({ event: "catalog_load_failed", err: error }, "Catalog load failed");
  process.exitCode = 1;
} finally {
  if (connected) await db.end();
}
