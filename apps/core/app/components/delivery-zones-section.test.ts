import { expect, test } from "vitest";
import { courierOptionName, lacksCoverage, uniqueOptionName, zoneDraftSchema } from "@core/app/components/delivery-zones-section";
import { zoneEntries, zoneOverlaps } from "@core/app/components/zone-entries";
import type { DeliveryZonesResponse } from "@shared/contracts/delivery-settings";

const option = { method: "home", name: "Standard", amount: "0", enabled: true, agencyIds: [] };

test("zone draft requires unique official districts, options with explicit prices and agency options with agencies, while accepting free delivery", () => {
  const agency = { ...option, method: "agency", name: "Agency", agencyIds: ["00000000-0000-4000-8000-000000000001"] };
  const valid = { name: "Lima", departmentCodes: [], provinceCodes: [], districtCodes: ["150122", "040110"], enabled: true, options: [option, agency] };
  expect(zoneDraftSchema.safeParse(valid).success).toBe(true);
  expect(zoneDraftSchema.safeParse({ ...valid, options: [{ ...option, amount: "8,50" }] }).success).toBe(true);
  for (const invalid of [{ ...valid, options: [{ ...option, amount: "" }] }, { ...valid, options: [{ ...option, amount: "-1" }] },
    { ...valid, options: [{ ...option, amount: "8.123" }] }, { ...valid, options: [{ ...option, amount: "1e2" }] },
    { ...valid, options: [{ ...option, amount: "9999999999999999999999999999999999999999999999999999" }] },
    { ...valid, options: [{ ...option, name: " " }] }, { ...valid, options: [option, { ...option, name: " standard " }] },
    { ...valid, name: " " }, { ...valid, districtCodes: ["000000"] },
    { ...valid, districtCodes: ["150122", "150122"] }, { ...valid, options: [option, { ...agency, agencyIds: [] }] }]) {
    expect(zoneDraftSchema.safeParse(invalid).success).toBe(false);
  }
});

test("only new agency options require agencies, so saved legacy options without agencies stay editable", () => {
  const legacy = { ...option, id: "00000000-0000-4000-8000-000000000002", method: "agency", name: "Agency", agencyIds: [] };
  const zone = { name: "Lima", departmentCodes: [], provinceCodes: [], districtCodes: ["150122"], enabled: true, options: [legacy] };
  expect(zoneDraftSchema.safeParse(zone).success).toBe(true);
  expect(zoneDraftSchema.safeParse({ ...zone, options: [{ ...legacy, id: undefined }] }).success).toBe(false);
});

test("a prefilled agency option name is unique in the zone and follows the courier only while the seller has not changed it", () => {
  expect(uniqueOptionName("Olva", [])).toBe("Olva");
  expect(uniqueOptionName("Olva", ["olva", "Olva 2", "Shalom"])).toBe("Olva 3");
  expect(courierOptionName("", undefined, "Shalom", [])).toBe("Shalom");
  expect(courierOptionName("Olva", "Olva", "Shalom", ["Shalom"])).toBe("Shalom 2");
  expect(courierOptionName("Olva 2", "Olva", "Shalom", ["Olva"])).toBe("Shalom");
  expect(courierOptionName("Olva 24", "Olva", "Shalom", [])).toBe("Olva 24");
  expect(courierOptionName("Olva 2", "Olva", "Shalom", [])).toBe("Olva 2");
  expect(courierOptionName("Recojo", "Olva", "Shalom", [])).toBe("Recojo");
});

test("a method without an active option in an active zone lacks coverage, and an agency option needs an eligible agency", () => {
  const agencyId = "00000000-0000-4000-8000-000000000003";
  const courierId = "00000000-0000-4000-8000-000000000004";
  const agency = { id: agencyId, courierId, enabled: true } as DeliveryZonesResponse["agencies"][number];
  const home = { id: "00000000-0000-4000-8000-000000000005", method: "home", name: "Moto", enabled: true, price: { amount: 5, currency: "PEN" } } as const;
  const viaAgency = { id: "00000000-0000-4000-8000-000000000006", method: "agency", name: "Olva", enabled: true, price: { amount: 5, currency: "PEN" }, agencyIds: [agencyId] } as const;
  const state = (zoneEnabled: boolean, agencies = [agency]) => ({ home: { enabled: true }, agency: { enabled: true }, version: 1, currency: "PEN", agencies,
    zones: [{ id: "00000000-0000-4000-8000-000000000007", name: "Zona", enabled: zoneEnabled, departmentCodes: [], provinceCodes: [], districtCodes: ["150122"], options: [home, viaAgency] }] }) as unknown as DeliveryZonesResponse;
  const couriers = [{ id: courierId, courierId, name: "Olva", enabled: true }];
  expect(lacksCoverage("home", state(true), couriers)).toBe(false);
  expect(lacksCoverage("home", state(false), couriers)).toBe(true);
  expect(lacksCoverage("agency", state(true), couriers)).toBe(false);
  expect(lacksCoverage("agency", state(true, [{ ...agency, enabled: false }]), couriers)).toBe(true);
  expect(lacksCoverage("agency", state(true), [{ ...couriers[0]!, enabled: false }])).toBe(true);
});

const selection = (departmentCodes: string[], provinceCodes: string[], districtCodes: string[]) => ({ departmentCodes, provinceCodes, districtCodes }) as never;

test("delivery zones section lists whole departments as one entry separated by semicolons", () => {
  expect(zoneEntries(selection(["04", "08"], [], []))).toBe("Arequipa, todos los distritos; Cusco, todos los distritos");
  expect(zoneEntries(selection([], ["1501"], []))).toBe("Lima (provincia), todos los distritos");
  expect(zoneEntries(selection(["04"], ["1501"], ["150122", "150131"]))).toBe("Arequipa, todos los distritos; Lima (provincia), todos los distritos; Miraflores · 150122; San Isidro · 150131");
  expect(zoneEntries(selection([], [], ["150122", "150131"]))).toBe("Miraflores · 150122; San Isidro · 150131");
});

test("zone overlap counts shared districts with each other enabled zone and ignores disabled ones", () => {
  const zone = (id: string, name: string, enabled: boolean, districtCodes: string[]) => ({ id, name, enabled, departmentCodes: [], provinceCodes: [], districtCodes }) as never;
  const zones = [zone("a", "Arequipa ciudad", true, ["040103"]), zone("b", "Apagada", false, ["040103"]), zone("c", "Lima", true, ["150122"]), zone("d", "Editada", true, ["040103"])];
  expect(zoneOverlaps(selection(["04"], [], []), zones, "d")).toEqual([{ name: "Arequipa ciudad", count: 1 }]);
  expect(zoneOverlaps(selection(["08"], [], []), zones, null)).toEqual([]);
  expect(zoneOverlaps(selection([], ["1501"], ["040103"]), zones, null)).toEqual([{ name: "Arequipa ciudad", count: 1 }, { name: "Lima", count: 1 }, { name: "Editada", count: 1 }]);
});

test("zone draft rejects an empty selection with the department, province or district message", () => {
  const draft = { name: "Zona", enabled: true, options: [], departmentCodes: [], provinceCodes: [], districtCodes: [] };
  const empty = zoneDraftSchema.safeParse(draft);
  expect(empty.success).toBe(false);
  expect(!empty.success && empty.error.issues[0]?.path).toEqual(["districtCodes"]);
  for (const complete of [{ departmentCodes: ["04"] }, { provinceCodes: ["1501"] }, { districtCodes: ["150122"] }]) expect(zoneDraftSchema.safeParse({ ...draft, ...complete }).success).toBe(true);
  expect(zoneDraftSchema.safeParse({ ...draft, departmentCodes: ["04"], districtCodes: ["040103"] }).success).toBe(false);
});
