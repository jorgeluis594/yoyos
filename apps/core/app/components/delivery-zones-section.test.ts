import { expect, test } from "vitest";
import { courierOptionName, lacksCoverage, uniqueOptionName, zoneDraftSchema } from "@core/app/components/delivery-zones-section";
import type { DeliveryZonesResponse } from "@shared/contracts/delivery-settings";

const option = { method: "home", name: "Standard", amount: "0", enabled: true, agencyIds: [] };

test("zone draft requires unique official districts, options with explicit prices and agency options with agencies, while accepting free delivery", () => {
  const agency = { ...option, method: "agency", name: "Agency", agencyIds: ["00000000-0000-4000-8000-000000000001"] };
  const valid = { name: "Lima", districtCodes: ["150122", "040110"], enabled: true, options: [option, agency] };
  expect(zoneDraftSchema.safeParse(valid).success).toBe(true);
  expect(zoneDraftSchema.safeParse({ ...valid, options: [{ ...option, amount: "8,50" }] }).success).toBe(true);
  for (const invalid of [{ ...valid, options: [{ ...option, amount: "" }] }, { ...valid, options: [{ ...option, amount: "-1" }] },
    { ...valid, options: [{ ...option, amount: "8.123" }] }, { ...valid, options: [{ ...option, amount: "1e2" }] },
    { ...valid, options: [{ ...option, amount: "9999999999999999999999999999999999999999999999999999" }] },
    { ...valid, options: [{ ...option, name: " " }] }, { ...valid, options: [option, { ...option, name: " standard " }] },
    { ...valid, name: " " }, { ...valid, districtCodes: [] }, { ...valid, districtCodes: ["000000"] },
    { ...valid, districtCodes: ["150122", "150122"] }, { ...valid, options: [option, { ...agency, agencyIds: [] }] }]) {
    expect(zoneDraftSchema.safeParse(invalid).success).toBe(false);
  }
});

test("only new agency options require agencies, so saved legacy options without agencies stay editable", () => {
  const legacy = { ...option, id: "00000000-0000-4000-8000-000000000002", method: "agency", name: "Agency", agencyIds: [] };
  const zone = { name: "Lima", districtCodes: ["150122"], enabled: true, options: [legacy] };
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
