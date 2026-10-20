import { expect, test } from "vitest";
import type { Courier } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import { parseDeliveryZone, prepareDeliveryZones, type DeliveryZone, type DeliveryZoneInput, type PrepareDeliveryZonesContext } from "@core/src/features/delivery-settings/domain/delivery-zone";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const price = (amount: number) => ({ amount, currency: "PEN" as const });
const homeOption = (value: number, name = "Standard", amount = 8) => ({ id: id(value), method: "home" as const, name, enabled: true, price: price(amount) });
const zoneValue = (value: number, options: readonly unknown[] = [homeOption(value + 100)]) =>
  ({ id: id(value), name: " Nearby ", enabled: true, districtCodes: ["150122"], options });
const zone = (value: number, options?: readonly unknown[]) => {
  const parsed = parseDeliveryZone(zoneValue(value, options), "PEN");
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
const courier = { id: id(60), catalogId: id(61), name: "Shalom", enabled: true, catalogEnabled: true } as unknown as Courier;
const agency = (courierId = courier.catalogId) => ({ id: id(70), courierId, name: "Agency", address: "Street", districtCode: "150122",
  enabled: true, courierEnabled: true }) as unknown as DeliveryAgency;
let sequence = 200;
const context = (overrides: Partial<PrepareDeliveryZonesContext> = {}): PrepareDeliveryZonesContext => ({
  current: [], agencies: [], currency: "PEN",
  generateZoneId: () => id(sequence++), generateOptionId: () => id(sequence++), ...overrides,
});
const fields = { name: "Nearby", enabled: true, districtCodes: ["150122"] };
const newHome = { kind: "new" as const, method: "home" as const, name: "Standard", enabled: true, price: price(8) };

test("zones normalize names and allow districts across provinces; options carry method, name and explicit zero prices", () => {
  expect(parseDeliveryZone({ ...zoneValue(1, [homeOption(2, " Free ", 0)]), districtCodes: ["150122", "040110"] }, "PEN"))
    .toMatchObject({ success: true, data: { name: "Nearby", districtCodes: ["150122", "040110"],
      options: [{ id: id(2), zoneId: id(1), method: "home", name: "Free", price: { amount: 0, currency: "PEN" } }] } });
  expect(parseDeliveryZone({ ...zoneValue(1, [{ ...homeOption(2), method: "agency", agencyIds: [id(70)] }]) }, "PEN"))
    .toMatchObject({ success: true, data: { options: [{ method: "agency", agencyIds: [id(70)] }] } });
});

test("zone and option parsing rejects invalid names, districts, methods, prices and agency lists", () => {
  for (const change of [{ id: "bad" }, { name: " " }, { name: "n".repeat(121) }, { districtCodes: [] }, { districtCodes: ["999999"] },
    { districtCodes: ["150122", "150122"] }, { enabled: "true" }, { companyId: id(1) }, { price: price(8) }, { method: "home" }]) {
    expect(parseDeliveryZone({ ...zoneValue(1), ...change }, "PEN")).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE" } });
  }
  for (const change of [{ method: "store" }, { name: " " }, { enabled: "yes" }, { agencyIds: [id(70)] }, { id: "bad" }]) {
    expect(parseDeliveryZone(zoneValue(1, [{ ...homeOption(2), ...change }]), "PEN"))
      .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", optionIndex: 0 } });
  }
  expect(parseDeliveryZone(zoneValue(1, [{ ...homeOption(2), method: "agency", agencyIds: [id(70), id(70)] }]), "PEN").success).toBe(false);
  for (const value of [null, { amount: 8.001, currency: "PEN" }, { amount: 8, currency: "USD" }, { amount: -1, currency: "PEN" }]) {
    expect(parseDeliveryZone(zoneValue(1, [{ ...homeOption(2), price: value }]), "PEN"))
      .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "price", optionIndex: 0 } });
  }
});

test("saving retains every zone and option, generates server identities and keeps input order", () => {
  const current = [zone(1, [homeOption(2)]), zone(3, [homeOption(4)])];
  const input: DeliveryZoneInput[] = [
    { kind: "existing", id: id(3), ...fields, enabled: false, options: [{ kind: "existing", id: id(4), method: "home", name: "Renamed", enabled: false, price: price(9) }] },
    { kind: "existing", id: id(1), ...fields, options: [{ kind: "existing", id: id(2), method: "home", name: "Standard", enabled: true, price: price(8) }, { ...newHome, name: "Express" }] },
    { kind: "new", ...fields, options: [] },
  ];
  const result = prepareDeliveryZones(input, context({ current, generateZoneId: () => id(90), generateOptionId: () => id(91) }));
  expect(result).toMatchObject({ success: true, data: [
    { id: id(3), enabled: false, options: [{ id: id(4), zoneId: id(3), name: "Renamed", enabled: false, price: { amount: 9, currency: "PEN" } }] },
    { id: id(1), options: [{ id: id(2) }, { id: id(91), zoneId: id(1), method: "home", name: "Express" }] },
    { id: id(90), options: [] },
  ] });
});

test("existing zones and options cannot be omitted, repeated or referenced by a foreign identity", () => {
  const current = [zone(1, [homeOption(2)])];
  const keep = { kind: "existing" as const, id: id(2), method: "home" as const, name: "Standard", enabled: true, price: price(8) };
  const existing = (options: readonly (typeof keep)[]) => ({ kind: "existing" as const, id: id(1), ...fields, options });
  expect(prepareDeliveryZones([], context({ current }))).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE", field: "zones" } });
  expect(prepareDeliveryZones([existing([])], context({ current }))).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "options" } });
  expect(prepareDeliveryZones([existing([keep, keep])], context({ current })))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "id", index: 0, optionIndex: 1 } });
  expect(prepareDeliveryZones([existing([{ ...keep, id: id(9) }])], context({ current })))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "id", index: 0, optionIndex: 0 } });
  expect(prepareDeliveryZones([existing([keep]), existing([])], context({ current })))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE", field: "id", index: 1 } });
});

test("an existing option cannot move to another zone or change its method", () => {
  const current = [zone(1, [homeOption(2)]), zone(3, [])];
  const moved = { kind: "existing" as const, id: id(2), method: "home" as const, name: "Standard", enabled: true, price: price(8) };
  expect(prepareDeliveryZones([{ kind: "existing", id: id(1), ...fields, options: [] },
    { kind: "existing", id: id(3), ...fields, options: [moved] }], context({ current })))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "id", index: 1, optionIndex: 0 } });
  expect(prepareDeliveryZones([{ kind: "existing", id: id(1), ...fields, options: [{ ...moved, method: "agency", agencyIds: [] }] },
    { kind: "existing", id: id(3), ...fields, options: [] }], context({ current })))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "method", index: 0, optionIndex: 0 } });
});

test("option names are unique per zone ignoring case, but may repeat across zones", () => {
  const duplicated = prepareDeliveryZones([{ kind: "new", ...fields, options: [newHome, { ...newHome, name: " STANDARD " }] }], context());
  expect(duplicated).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "name", index: 0, optionIndex: 1 } });
  expect(prepareDeliveryZones([{ kind: "new", ...fields, options: [newHome] }, { kind: "new", ...fields, options: [newHome] }], context()).success).toBe(true);
});

test("prices must use the business currency and report their option row", () => {
  expect(prepareDeliveryZones([{ kind: "new", ...fields, options: [newHome, { ...newHome, name: "Other", price: { amount: 8, currency: "USD" } }] }], context()))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "price", index: 0, optionIndex: 1 } });
  expect(prepareDeliveryZones([{ kind: "new", ...fields, districtCodes: ["150122", "150122"], options: [] }], context()))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE", field: "districtCodes", index: 0 } });
});

test("agency options accept only catalog agencies of a single courier, including disabled ones, and new ones require agencies", () => {
  const input = (agencyIds: string[]): DeliveryZoneInput[] => [{ kind: "new", ...fields,
    options: [{ kind: "new", method: "agency", name: "Agency", enabled: true, price: price(10), agencyIds }] }];
  expect(prepareDeliveryZones(input([]), context())).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "agencyIds", optionIndex: 0 } });
  expect(prepareDeliveryZones(input([id(70)]), context())).toMatchObject({ success: false, error: { field: "agencyIds", optionIndex: 0 } });
  expect(prepareDeliveryZones(input([id(70)]), context({ agencies: [agency()] })).success).toBe(true);
  expect(prepareDeliveryZones(input([id(70)]), context({ agencies: [{ ...agency(), enabled: false }] })).success).toBe(true);
  expect(prepareDeliveryZones(input([id(70), id(70)]), context({ agencies: [agency()] })).success).toBe(false);
  const other = { ...agency(id(62) as typeof courier.catalogId), id: id(71) } as unknown as DeliveryAgency;
  expect(prepareDeliveryZones(input([id(70), id(71)]), context({ agencies: [agency(), other] })))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "agencyIds", optionIndex: 0 } });
});

test("stored agency options stay saveable without agencies or with mixed couriers until their agencies change", () => {
  const other = { ...agency(id(62) as typeof courier.catalogId), id: id(71) } as unknown as DeliveryAgency;
  const stored = (agencyIds: string[]) => [zone(1, [{ ...homeOption(2), method: "agency", agencyIds }])];
  const input = (agencyIds: string[]): DeliveryZoneInput[] => [{ kind: "existing", id: id(1), ...fields,
    options: [{ kind: "existing", id: id(2), method: "agency", name: "Agency", enabled: true, price: price(10), agencyIds }] }];
  const agencies = [agency(), other, { ...agency(), id: id(72) } as unknown as DeliveryAgency];
  expect(prepareDeliveryZones(input([]), context({ current: stored([]) })).success).toBe(true);
  expect(prepareDeliveryZones(input([id(71), id(70)]), context({ current: stored([id(70), id(71)]), agencies })).success).toBe(true);
  expect(prepareDeliveryZones(input([id(70), id(71), id(72)]), context({ current: stored([id(70), id(71)]), agencies })))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "agencyIds", index: 0, optionIndex: 0 } });
  expect(prepareDeliveryZones(input([id(70), id(71)]), context({ current: stored([]), agencies })))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_OPTION", field: "agencyIds" } });
  expect(prepareDeliveryZones(input([id(70), id(72)]), context({ current: stored([id(70), id(71)]), agencies })).success).toBe(true);
});

test("generated identities must be valid and unique across the configuration", () => {
  const current: DeliveryZone[] = [zone(1, [homeOption(2)])];
  const retained = { kind: "existing" as const, id: id(1), ...fields, options: [{ kind: "existing" as const, id: id(2), method: "home" as const, name: "Standard", enabled: true, price: price(8) }] };
  for (const generated of ["bad", id(1)]) {
    expect(prepareDeliveryZones([retained, { kind: "new", ...fields, options: [] }], context({ current, generateZoneId: () => generated })).success).toBe(false);
  }
  for (const generated of ["bad", id(2)]) {
    expect(prepareDeliveryZones([{ ...retained, options: [...retained.options, { ...newHome, name: "Express" }] }], context({ current, generateOptionId: () => generated })).success).toBe(false);
  }
  expect(prepareDeliveryZones([{ kind: "new", ...fields, options: [newHome, { ...newHome, name: "Other" }] }], context({ generateOptionId: () => id(300) })).success).toBe(false);
});

test("parseDeliveryZone accepts a zone with only whole departments", () => {
  expect(parseDeliveryZone({ ...zoneValue(1), departmentCodes: ["04", "08"], provinceCodes: [], districtCodes: [] }, "PEN"))
    .toMatchObject({ success: true, data: { departmentCodes: ["04", "08"], provinceCodes: [], districtCodes: [] } });
});

test("prepareDeliveryZones reports the index and field of a non-canonical selection", () => {
  const zones = (extra: object) => [{ kind: "new" as const, ...fields, options: [newHome] }, { kind: "new" as const, ...fields, ...extra, options: [newHome] }];
  expect(prepareDeliveryZones(zones({ departmentCodes: ["04"], districtCodes: ["040103"] }), context()))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_ZONE", field: "districtCodes", index: 1 } });
  expect(prepareDeliveryZones(zones({ departmentCodes: ["04"], provinceCodes: ["0401"], districtCodes: [] }), context()))
    .toMatchObject({ success: false, error: { field: "provinceCodes", index: 1 } });
  expect(prepareDeliveryZones(zones({ departmentCodes: ["99"], districtCodes: [] }), context()))
    .toMatchObject({ success: false, error: { field: "departmentCodes", index: 1 } });
  expect(prepareDeliveryZones(zones({ districtCodes: [] }), context()))
    .toMatchObject({ success: false, error: { field: "districtCodes", index: 1 } });
});
