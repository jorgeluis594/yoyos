import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { getAgencyCatalog } from "@core/src/features/delivery-settings/application/agency-catalog";
import type { CourierCatalogId, CourierCode } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";

const listed = "00000000-0000-4000-8000-000000000101" as CourierCatalogId;
const unlisted = "00000000-0000-4000-8000-000000000102" as CourierCatalogId;
const agencies: readonly DeliveryAgency[] = [];
const deps = (read = vi.fn(async () => ok(agencies))) => ({ readCourierCatalog: async () => ok([{ id: listed, code: "shalom" as CourierCode, name: "Shalom", enabled: true }]), readAgencyCatalog: read });

test("a company lists the agencies of any enabled catalog courier, before shipping with it", async () => {
  const read = vi.fn(async () => ok(agencies));
  expect(await getAgencyCatalog(listed, deps(read))).toEqual(ok(agencies));
  expect(read).toHaveBeenCalledWith(listed);
});

test("a courier outside the enabled catalog is not found and reads no agencies", async () => {
  const read = vi.fn(async () => ok(agencies));
  expect(await getAgencyCatalog(unlisted, deps(read))).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  expect(read).not.toHaveBeenCalled();
});

test("catalog read failures are returned", async () => {
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
  expect(await getAgencyCatalog(listed, { ...deps(), readCourierCatalog: async () => failure })).toEqual(failure);
});
