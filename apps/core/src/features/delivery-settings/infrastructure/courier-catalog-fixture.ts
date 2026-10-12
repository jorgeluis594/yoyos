import { randomUUID } from "node:crypto";
import pg from "pg";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";
import type { CourierCatalogId } from "@core/src/features/delivery-settings/domain/delivery-settings";

/** Seeded catalog courier (`scripts/seed-courier-catalog.ts`), looked up by code and never by a fixed UUID. */
export async function seededCourier(code: "shalom" | "olva" = "shalom") {
  const courier = await systemPrisma.courier.findUnique({ where: { code } });
  if (!courier) throw new Error(`Courier ${code} missing: run sh scripts/run-tests.sh integration`);
  return courier;
}

export async function seededCatalogId(code: "shalom" | "olva" = "shalom") {
  return (await seededCourier(code)).id as CourierCatalogId;
}

/** The app role cannot write the catalog, so tests change it as the migration role (what the seed does). */
export async function withCatalogAdmin<T>(work: (query: pg.Client["query"]) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  await admin.connect();
  try { return await work(admin.query.bind(admin) as pg.Client["query"]); } finally { await admin.end(); }
}

/** Inserts a catalog agency as the migration role (the app role cannot write it) and returns its id. */
export async function insertAgency(fields: { courierId: string; name: string; districtCode?: string; enabled?: boolean }): Promise<string> {
  const id = randomUUID();
  await withCatalogAdmin(query => query('INSERT INTO "DeliveryAgency" (id, "courierId", name, address, "districtCode", enabled) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, fields.courierId, fields.name, "Av. Test 123", fields.districtCode ?? "150122", fields.enabled ?? true]));
  return id;
}

export const deleteAgencies = (ids: readonly string[]) => withCatalogAdmin(query => query('DELETE FROM "DeliveryAgency" WHERE id = ANY($1::uuid[])', [[...ids]]));
