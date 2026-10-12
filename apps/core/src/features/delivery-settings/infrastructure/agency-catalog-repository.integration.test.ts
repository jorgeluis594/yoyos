import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { withCatalogAdmin } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { CourierCatalogId } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { readAgencies, readAgencyCatalog } from "@core/src/features/delivery-settings/infrastructure/agency-catalog-repository";

const companyId = randomUUID();
const catalogId = randomUUID();
// The adapter runs inside a request transaction, so tests give it a tenant context.
const inCompany = <T>(work: () => Promise<T>) => withTenantIsolation(companyId, async () => await work());
await withCatalogAdmin(query => query('INSERT INTO "Courier" (id, code, name, enabled) VALUES ($1, $2, $3, true)', [catalogId, `t4_${catalogId.replaceAll("-", "")}`, "Agency repository courier"]));

// The app role cannot write the catalog, so rows are inserted as the migration role, like the SQL scripts do.
async function agency(fields: { name: string; districtCode: string; enabled?: boolean; courierId?: string }) {
  const id = randomUUID();
  await withCatalogAdmin(query => query('INSERT INTO "DeliveryAgency" (id, "courierId", name, address, "districtCode", enabled) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, fields.courierId ?? catalogId, fields.name, "Av. Test 123", fields.districtCode, fields.enabled ?? true]));
  return id;
}

beforeAll(() => inCompany(() => prisma.company.create({ data: { id: companyId, name: "Agency catalog test", country: "PE" } })));
afterAll(async () => {
  await inCompany(() => prisma.company.delete({ where: { id: companyId } }));
  await withCatalogAdmin(async query => {
  await query('DELETE FROM "DeliveryAgency" WHERE "courierId" = $1', [catalogId]);
  await query('DELETE FROM "Courier" WHERE id = $1', [catalogId]);
  });
});

test("the catalog lists enabled agencies of the courier by department, district and name", async () => {
  const tag = "T4";
  // Lambayeque sorts before Lima by department name; within Lima, Lima before Miraflores, then by agency name.
  const [lambayeque, miraflores, lima, limaB] = [await agency({ name: `${tag} A`, districtCode: "140101" }), await agency({ name: `${tag} B`, districtCode: "150122" }),
    await agency({ name: `${tag} C`, districtCode: "150101" }), await agency({ name: `${tag} A2`, districtCode: "150101" })];
  await agency({ name: `${tag} disabled`, districtCode: "150101", enabled: false });
  const result = await inCompany(() => readAgencyCatalog(catalogId as CourierCatalogId));
  if (!result.success) throw new Error(result.error.message);
  expect(result.data.filter(value => value.name.startsWith(tag)).map(value => value.id)).toEqual([lambayeque, limaB, lima, miraflores]);
  expect(result.data.every(value => value.enabled && value.courierId === catalogId)).toBe(true);
});

test("a stored district outside the Peru catalog fails the whole read instead of returning a partial list", async () => {
  const valid = await agency({ name: "Valid", districtCode: "150101" });
  const invalid = await agency({ name: "Invalid", districtCode: "999999" });
  expect(await inCompany(() => readAgencyCatalog(catalogId as CourierCatalogId))).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(await inCompany(() => readAgencies([valid, invalid]))).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  await withCatalogAdmin(query => query('DELETE FROM "DeliveryAgency" WHERE id = $1', [invalid]));
  expect(await inCompany(() => readAgencies([valid]))).toMatchObject({ success: true, data: [{ id: valid, courierEnabled: true }] });
});
