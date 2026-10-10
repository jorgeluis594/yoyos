import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { initialDeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone, type DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { getDeliveryZones, saveDeliveryZones, type SaveDeliveryZonesDependencies } from "@core/src/features/delivery-settings/application/delivery-zones";
import type { DeliveryConfiguration } from "@core/src/features/delivery-settings/application/create-quotation";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const context = { companyId: id(1), userId: "seller" };
const fields = { name: " Nearby ", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" as const } };
function zone(method: "home" | "agency", value: number): DeliveryZone {
  const result = parseDeliveryZone({ id: id(value), method, ...fields }, "PEN");
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}
const initial = (): DeliveryConfiguration => ({ country: "PE", currency: "PEN", settings: initialDeliverySettings(), zones: [] });
function repository(configuration = initial()) {
  let stored = configuration;
  let sequence = 10;
  const deps: SaveDeliveryZonesDependencies = {
    transaction: async (_companyId, work) => work(), readForUpdate: async () => ok(stored), generateZoneId: () => id(sequence++),
    saveSettings: async (_companyId, settings) => { stored = { ...stored, settings }; return ok(null); },
    saveZones: async (_companyId, method, zones) => { stored = { ...stored, zones: [...stored.zones.filter(zone => zone.method !== method), ...zones] }; return ok(null); },
  };
  return { deps, read: () => stored };
}

test("initial zones are prepared with disabled methods, server identities and one shared version increment", async () => {
  const repo = repository();
  const result = await saveDeliveryZones({ method: "home", expectedVersion: 0, zones: [{ kind: "new", ...fields }] }, context, repo.deps);
  expect(result).toMatchObject({ success: true, data: { version: 1, home: { enabled: false }, agency: { enabled: false }, currency: "PEN",
    zones: [{ id: id(10), method: "home", name: "Nearby", price: { amount: 8, currency: "PEN" } }] } });
  expect(repo.read().settings).toEqual({ ...initialDeliverySettings(), version: 1 });
});

test("editing one method preserves the other method, couriers and pickup point while returning all zones", async () => {
  const config: DeliveryConfiguration = { ...initial(), zones: [zone("home", 2), zone("agency", 3)], settings: { ...initialDeliverySettings(), version: 5,
    home: { enabled: true }, store: { enabled: true, pickupPoint: { name: "Shop", address: "Street", instructions: null } } } };
  const repo = repository(config);
  const result = await saveDeliveryZones({ method: "home", expectedVersion: 5, zones: [{ kind: "existing", id: id(2), ...fields, enabled: false }] }, context, repo.deps);
  expect(result).toMatchObject({ success: true, data: { version: 6, zones: [zone("agency", 3), { id: id(2), method: "home", enabled: false, districtCodes: ["150122"] }] } });
  expect(repo.read().settings).toEqual({ ...config.settings, version: 6 });
});

test("stale versions, omitted zones and invalid prices reject without changing the configuration", async () => {
  const config = { ...initial(), settings: { ...initialDeliverySettings(), version: 2 }, zones: [zone("home", 2)] };
  for (const input of [
    { method: "home" as const, expectedVersion: 1, zones: [{ kind: "existing" as const, id: id(2), ...fields }] },
    { method: "home" as const, expectedVersion: 2, zones: [] },
    { method: "home" as const, expectedVersion: 2, zones: [{ kind: "existing" as const, id: id(2), ...fields, price: { amount: -1, currency: "PEN" as const } }] },
  ]) {
    const repo = repository(config);
    expect((await saveDeliveryZones(input, context, repo.deps)).success).toBe(false);
    expect(repo.read()).toEqual(config);
  }
  for (const expectedVersion of [-1, NaN, 1.5, 2147483647]) {
    const repo = repository();
    expect((await saveDeliveryZones({ method: "home", expectedVersion, zones: [] }, context, repo.deps)).success).toBe(false);
    expect(repo.read()).toEqual(initial());
  }
});

test("configuration reads propagate storage errors and reject businesses outside the Peru pilot", async () => {
  expect(await getDeliveryZones(context, async () => ok(initial())))
    .toEqual(ok({ home: { enabled: false }, agency: { enabled: false }, version: 0, currency: "PEN", zones: [] }));
  const failure = err({ code: "SERVICE_UNAVAILABLE" as const, message: "Database unavailable" });
  expect(await getDeliveryZones(context, async () => failure)).toEqual(failure);
  expect(await getDeliveryZones(context, async () => ok({ ...initial(), country: "US" })))
    .toMatchObject({ success: false, error: { code: "UNSUPPORTED_COUNTRY" } });
  const repo = repository({ ...initial(), country: "US" });
  expect(await saveDeliveryZones({ method: "home", expectedVersion: 0, zones: [] }, context, repo.deps))
    .toMatchObject({ success: false, error: { code: "UNSUPPORTED_COUNTRY" } });
  expect(repo.read().settings.version).toBe(0);
});
