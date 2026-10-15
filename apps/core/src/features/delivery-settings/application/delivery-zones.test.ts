import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { initialDeliverySettings, type CourierCatalogId, type CourierCode, type CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone, type DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { getDeliveryZones, saveDeliveryZones, type SaveDeliveryZonesDependencies } from "@core/src/features/delivery-settings/application/delivery-zones";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import type { DeliveryConfiguration } from "@core/src/features/delivery-settings/domain/quotation";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const context = { companyId: id(1), userId: "seller" };
const price = (amount: number) => ({ amount, currency: "PEN" as const });
const fields = { name: " Nearby ", enabled: true, districtCodes: ["150122"] };
const newOption = { kind: "new" as const, method: "home" as const, name: "Standard", enabled: true, price: price(8) };
function zone(value: number): DeliveryZone {
  const result = parseDeliveryZone({ id: id(value), name: "Nearby", enabled: true, districtCodes: ["150122"],
    options: [{ id: id(value + 100), method: "home", name: "Standard", enabled: true, price: price(8) }] }, "PEN");
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}
const initial = (): DeliveryConfiguration => ({ country: "PE", currency: "PEN", settings: initialDeliverySettings(), zones: [], agencies: [] });
function repository(configuration = initial()) {
  let stored = configuration;
  let sequence = 10;
  const deps: SaveDeliveryZonesDependencies = {
    transaction: async (_companyId, work) => work(), readForUpdate: async () => ok(stored),
    generateZoneId: () => id(sequence++), generateOptionId: () => id(sequence++), generateCourierId: () => id(sequence++) as CourierId,
    readCourierCatalog: async () => ok([{ id: id(500) as CourierCatalogId, code: "shalom" as CourierCode, name: "Shalom" }]),
    saveSettings: async (_companyId, settings) => { stored = { ...stored, settings }; return ok(null); },
    saveZones: async (_companyId, zones) => { stored = { ...stored, zones }; return ok(null); },
    readAgencies: async ids => ok(stored.agencies.filter(agency => ids.includes(agency.id))),
  };
  return { deps, read: () => stored };
}

test("initial zones are prepared with disabled methods, server identities and one shared version increment", async () => {
  const repo = repository();
  const result = await saveDeliveryZones({ expectedVersion: 0, zones: [{ kind: "new", ...fields, options: [newOption] }] }, context, repo.deps);
  expect(result).toMatchObject({ success: true, data: { version: 1, home: { enabled: false }, agency: { enabled: false }, currency: "PEN",
    zones: [{ id: id(10), name: "Nearby", options: [{ id: id(11), zoneId: id(10), method: "home", name: "Standard", price: { amount: 8, currency: "PEN" } }] }] } });
  expect(repo.read().settings).toEqual({ ...initialDeliverySettings(), version: 1 });
});

test("editing zones preserves couriers and pickup point while returning every zone in one write", async () => {
  const config: DeliveryConfiguration = { ...initial(), zones: [zone(2), zone(3)], settings: { ...initialDeliverySettings(), version: 5,
    home: { enabled: true }, store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } } };
  const repo = repository(config);
  const retained = (value: number, enabled: boolean) => ({ kind: "existing" as const, id: id(value), ...fields, enabled, options: [
    { kind: "existing" as const, id: id(value + 100), method: "home" as const, name: "Standard", enabled: true, price: price(8) }] });
  const result = await saveDeliveryZones({ expectedVersion: 5, zones: [retained(2, false), retained(3, true)] }, context, repo.deps);
  expect(result).toMatchObject({ success: true, data: { version: 6, zones: [{ id: id(2), enabled: false }, { id: id(3), enabled: true }] } });
  expect(repo.read().settings).toEqual({ ...config.settings, version: 6 });
});

test("stale versions, omitted zones or options and invalid prices reject without changing the configuration", async () => {
  const config = { ...initial(), settings: { ...initialDeliverySettings(), version: 2 }, zones: [zone(2)] };
  const existing = (options: unknown[]) => ({ kind: "existing" as const, id: id(2), ...fields, options: options as never });
  const option = { kind: "existing" as const, id: id(102), method: "home" as const, name: "Standard", enabled: true, price: price(8) };
  for (const input of [
    { expectedVersion: 1, zones: [existing([option])] },
    { expectedVersion: 2, zones: [] },
    { expectedVersion: 2, zones: [existing([])] },
    { expectedVersion: 2, zones: [existing([{ ...option, price: price(-1) }])] },
  ]) {
    const repo = repository(config);
    expect((await saveDeliveryZones(input, context, repo.deps)).success).toBe(false);
    expect(repo.read()).toEqual(config);
  }
  for (const expectedVersion of [-1, NaN, 1.5, 2147483647]) {
    const repo = repository();
    expect((await saveDeliveryZones({ expectedVersion, zones: [] }, context, repo.deps)).success).toBe(false);
    expect(repo.read()).toEqual(initial());
  }
});

test("configuration reads propagate storage errors and reject businesses outside the Peru pilot", async () => {
  expect(await getDeliveryZones(context, async () => ok(initial())))
    .toEqual(ok({ home: { enabled: false }, agency: { enabled: false }, version: 0, currency: "PEN", zones: [], agencies: [] }));
  const failure = err({ code: "SERVICE_UNAVAILABLE" as const, message: "Database unavailable" });
  expect(await getDeliveryZones(context, async () => failure)).toEqual(failure);
  expect(await getDeliveryZones(context, async () => ok({ ...initial(), country: "US" })))
    .toMatchObject({ success: false, error: { code: "UNSUPPORTED_COUNTRY" } });
  const repo = repository({ ...initial(), country: "US" });
  expect(await saveDeliveryZones({ expectedVersion: 0, zones: [] }, context, repo.deps))
    .toMatchObject({ success: false, error: { code: "UNSUPPORTED_COUNTRY" } });
  expect(repo.read().settings.version).toBe(0);
});

test("agency options reference catalog agencies read for the request, including disabled ones, and the response returns them", async () => {
  const catalogId = id(500);
  const agency = (value: number, enabled: boolean) => ({ id: id(value), courierId: catalogId, name: `Agency ${value}`, address: "Street", districtCode: "150122",
    enabled, courierEnabled: true }) as unknown as DeliveryAgency;
  const settings = { ...initialDeliverySettings(), agency: { enabled: true }, couriers: [{ id: id(501), catalogId, name: "Courier", enabled: true, catalogEnabled: true }] } as never;
  const repo = repository({ ...initial(), settings, agencies: [agency(60, true), agency(61, false), agency(62, true)] });
  const option = (agencyIds: string[]) => ({ kind: "new" as const, method: "agency" as const, name: "Agency", enabled: true, price: price(5), agencyIds });
  const saved = await saveDeliveryZones({ expectedVersion: 0, zones: [{ kind: "new", ...fields, options: [option([id(60), id(61)])] }] }, context, repo.deps);
  expect(saved).toMatchObject({ success: true, data: { agencies: [{ id: id(60) }, { id: id(61), enabled: false }] } });
  expect(repo.read().zones[0].options[0]).toMatchObject({ method: "agency", agencyIds: [id(60), id(61)] });
  const rejected = await saveDeliveryZones({ expectedVersion: 1, zones: [{ kind: "existing", id: id(10), ...fields, options: [
    { kind: "existing", id: id(11), method: "agency", name: "Agency", enabled: true, price: price(5), agencyIds: [id(99)] }] }] }, context, repo.deps);
  expect(rejected).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "agencyIds" } });
  expect(repo.read().zones[0].options[0]).toMatchObject({ agencyIds: [id(60), id(61)] });
});

test("the company couriers follow the agencies of the enabled options in the same versioned write", async () => {
  const catalogId = id(500) as CourierCatalogId;
  const agency = { id: id(60), courierId: catalogId, name: "Agency", address: "Street", districtCode: "150122", enabled: true, courierEnabled: true } as unknown as DeliveryAgency;
  const option = { kind: "new" as const, method: "agency" as const, name: "Shalom", enabled: true, price: price(5), agencyIds: [id(60)] };
  const repo = repository({ ...initial(), agencies: [agency] });
  expect(await saveDeliveryZones({ expectedVersion: 0, zones: [{ kind: "new", ...fields, options: [option] }] }, context, repo.deps)).toMatchObject({ success: true });
  expect(repo.read().settings).toMatchObject({ version: 1, agency: { enabled: false }, couriers: [{ id: id(10), catalogId, name: "Shalom", enabled: true }] });
  const disabled = { ...initialDeliverySettings(), version: 3, couriers: [{ id: id(501) as CourierId, catalogId, name: "Shalom", enabled: false, catalogEnabled: true }] };
  const again = repository({ ...initial(), settings: disabled, agencies: [agency] });
  expect(await saveDeliveryZones({ expectedVersion: 3, zones: [{ kind: "new", ...fields, options: [option] }] }, context, again.deps)).toMatchObject({ success: true });
  expect(again.read().settings.couriers).toEqual([{ ...disabled.couriers[0], enabled: true }]);
  const enabled = { ...initialDeliverySettings(), version: 1, couriers: [{ id: id(501), catalogId, name: "Shalom", enabled: true, catalogEnabled: true }] } as never;
  const off = repository({ ...initial(), settings: enabled, agencies: [agency] });
  expect(await saveDeliveryZones({ expectedVersion: 1, zones: [{ kind: "new", ...fields, options: [{ ...option, enabled: false }] }] }, context, off.deps)).toMatchObject({ success: true });
  expect(off.read().settings.couriers).toMatchObject([{ catalogId, enabled: false }]);
  const delisted = id(599);
  const retired = { ...initialDeliverySettings(), couriers: [{ id: id(502), catalogId: delisted, name: "Olva", enabled: false, catalogEnabled: false }] } as never;
  const retiredRepo = repository({ ...initial(), settings: retired, agencies: [{ ...agency, courierId: delisted } as unknown as DeliveryAgency] });
  expect(await saveDeliveryZones({ expectedVersion: 0, zones: [{ kind: "new", ...fields, options: [option] }] }, context, retiredRepo.deps)).toMatchObject({ success: true });
  expect(retiredRepo.read().settings.couriers).toMatchObject([{ catalogId: delisted, enabled: false }]);
});
