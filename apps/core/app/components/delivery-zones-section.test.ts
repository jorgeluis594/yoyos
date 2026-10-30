// @vitest-environment jsdom
import { createInstance } from "i18next";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import resources from "@core/app/locales";
import { courierOptionName, coverageWarnings, uniqueOptionName, useZonesCoverage, zoneDraftSchema, zonesCoverage } from "@core/app/components/delivery-zones-section";
import { zoneEntries, zoneOverlaps } from "@core/app/components/zone-entries";
import type { DeliveryZonesResponse } from "@shared/contracts/delivery-settings";

const i18n = createInstance();
await i18n.init({ lng: "es", resources });
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

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const arequipaDistrict = "040101";
const cuscoDistrict = "080101";
const price = { amount: 5, currency: "PEN" as const };
const agencyIn = (value: number, districtCode: string, enabled = true): DeliveryZonesResponse["agencies"][number] => ({ id: id(value), courierId: id(4), name: `Agencia ${value}`, address: "Av. 1", enabled,
  location: { country: "PE", districtCode, district: "D", province: "P", department: "X" } });
const viaAgencies = (...agencyIds: string[]) => ({ id: id(6), method: "agency" as const, name: "Shalom", enabled: true, price, agencyIds });
const homeOption = { id: id(5), method: "home" as const, name: "Moto", enabled: true, price };
const zoneOf = (area: Partial<Pick<DeliveryZonesResponse["zones"][number], "departmentCodes" | "provinceCodes" | "districtCodes">>, options: DeliveryZonesResponse["zones"][number]["options"], enabled = true) =>
  ({ id: id(7), name: "Zona", enabled, departmentCodes: [], provinceCodes: [], districtCodes: [], options, ...area });
const couriers = [{ id: id(4), courierId: id(4), name: "Shalom", enabled: true }] as const;
const warnings = (zones: DeliveryZonesResponse["zones"], agencies: DeliveryZonesResponse["agencies"], list: typeof couriers | readonly { id: string; courierId: string; name: string; enabled: boolean }[] = couriers) =>
  coverageWarnings(zonesCoverage(zones, agencies, list as never), { home: true, agency: true });

test("web coverage warning flags agency when every eligible agency is outside the departments the zone covers", () => {
  const zones = [zoneOf({ departmentCodes: ["08"] }, [viaAgencies(id(1))])];
  expect(warnings(zones, [agencyIn(1, arequipaDistrict)])).toEqual({ home: true, agency: true });
});

test("web coverage warning clears when the option gets an eligible agency in a covered department", () => {
  const agencies = [agencyIn(1, arequipaDistrict), agencyIn(2, cuscoDistrict)];
  expect(warnings([zoneOf({ departmentCodes: ["08"] }, [viaAgencies(id(1), id(2))])], agencies).agency).toBe(false);
});

test("web coverage warning flags agency when its only agency or courier is retired from the catalog", () => {
  const zones = [zoneOf({ districtCodes: [arequipaDistrict] }, [viaAgencies(id(1))])];
  expect(warnings(zones, [agencyIn(1, arequipaDistrict, false)]).agency).toBe(true);
  expect(warnings(zones, [agencyIn(1, arequipaDistrict)], [{ ...couriers[0], enabled: false }]).agency).toBe(true);
  expect(warnings(zones, [agencyIn(1, arequipaDistrict)]).agency).toBe(false);
});

test("web coverage warning stays silent for a zone over Arequipa, Cusco and Puno with agencies in Arequipa", () => {
  const zones = [zoneOf({ departmentCodes: ["04", "08", "21"] }, [viaAgencies(id(1))])];
  expect(warnings(zones, [agencyIn(1, arequipaDistrict)]).agency).toBe(false);
});

test("web home warning follows home options of enabled zones, and nothing warns while zones are not loaded or the switch is off", () => {
  const area = { districtCodes: [arequipaDistrict] };
  expect(warnings([zoneOf(area, [homeOption])], []).home).toBe(false);
  expect(warnings([zoneOf(area, [homeOption], false)], []).home).toBe(true);
  expect(warnings([zoneOf(area, [])], []).home).toBe(true);
  expect(coverageWarnings(null, { home: true, agency: true })).toEqual({ home: false, agency: false });
  expect(coverageWarnings(zonesCoverage([], [], []), { home: false, agency: false })).toEqual({ home: false, agency: false });
});

test("zones coverage hook returns the same object while zones and couriers keep their identity, and a new one when couriers change after a confirmed save", () => {
  const zones = [zoneOf({ districtCodes: [arequipaDistrict] }, [homeOption])];
  const agencies: DeliveryZonesResponse["agencies"] = [];
  const seen: (ReturnType<typeof useZonesCoverage>)[] = [];
  const Probe = ({ list, loaded }: { list: typeof couriers; loaded: boolean }) => { seen.push(useZonesCoverage(loaded ? zones : null, loaded ? agencies : null, list)); return null; };
  const host = document.createElement("div");
  const root = createRoot(host);
  const run = (element: React.ReactElement) => act(() => root.render(element));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  run(createElement(Probe, { list: couriers, loaded: false }));
  expect(seen.at(-1)).toBeNull();
  run(createElement(Probe, { list: couriers, loaded: true }));
  const first = seen.at(-1);
  expect(first).not.toBeNull();
  run(createElement(Probe, { list: couriers, loaded: true }));
  expect(seen.at(-1)).toBe(first);
  run(createElement(Probe, { list: [...couriers] as unknown as typeof couriers, loaded: true }));
  expect(seen.at(-1)).not.toBe(first);
  act(() => root.unmount());
});

const selection = (departmentCodes: string[], provinceCodes: string[], districtCodes: string[]) => ({ departmentCodes, provinceCodes, districtCodes }) as never;

test("delivery zones section lists whole departments as one entry separated by semicolons", () => {
  expect(zoneEntries(selection(["04", "08"], [], []), i18n.t)).toBe("Arequipa, todos los distritos; Cusco, todos los distritos");
  expect(zoneEntries(selection([], ["1501"], []), i18n.t)).toBe("Lima (provincia), todos los distritos");
  expect(zoneEntries(selection(["04"], ["1501"], ["150201", "080102"]), i18n.t)).toBe("Arequipa, todos los distritos; Lima (provincia), todos los distritos; Barranca · 150201; Ccorca · 080102");
  expect(zoneEntries(selection([], [], ["150122", "150131"]), i18n.t)).toBe("Miraflores · 150122; San Isidro · 150131");
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
