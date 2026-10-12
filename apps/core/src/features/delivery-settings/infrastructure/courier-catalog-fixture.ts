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
