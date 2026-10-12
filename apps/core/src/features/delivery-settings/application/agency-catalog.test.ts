import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { getAgencyCatalog } from "@core/src/features/delivery-settings/application/agency-catalog";
import { initialDeliverySettings, type CourierCatalogId, type CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";

const owned = "00000000-0000-4000-8000-000000000101" as CourierCatalogId;
const foreign = "00000000-0000-4000-8000-000000000102" as CourierCatalogId;
const settings = { ...initialDeliverySettings(), version: 1,
  couriers: [{ id: "00000000-0000-4000-8000-000000000001" as CourierId, catalogId: owned, name: "Shalom", enabled: false, catalogEnabled: true }] };
const agencies: readonly DeliveryAgency[] = [];
const deps = (read = vi.fn(async () => ok(agencies))) => ({ readSettings: async () => ok(settings), readAgencyCatalog: read });

test("a company lists the agencies of a courier it has configured, even if disabled", async () => {
  const read = vi.fn(async () => ok(agencies));
  expect(await getAgencyCatalog(owned, { companyId: "c" }, deps(read))).toEqual(ok(agencies));
  expect(read).toHaveBeenCalledWith(owned);
});

test("a courier the company lacks, or a company without settings, is not found and reads no agencies", async () => {
  const read = vi.fn(async () => ok(agencies));
  expect(await getAgencyCatalog(foreign, { companyId: "c" }, deps(read))).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  expect(await getAgencyCatalog(owned, { companyId: "c" }, { ...deps(read), readSettings: async () => ok(null) })).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  expect(read).not.toHaveBeenCalled();
});

test("settings read failures are returned", async () => {
  const failure = err({ code: "INVALID_STORED_DATA" as const, message: "bad" });
  expect(await getAgencyCatalog(owned, { companyId: "c" }, { ...deps(), readSettings: async () => failure })).toEqual(failure);
});
