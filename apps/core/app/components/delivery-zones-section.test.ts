import { expect, test } from "vitest";
import { isCourierName, uniqueOptionName, zoneDraftSchema } from "@core/app/components/delivery-zones-section";

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

test("a prefilled agency option name is unique in the zone and still counts as generated from a courier", () => {
  expect(uniqueOptionName("Olva", [])).toBe("Olva");
  expect(uniqueOptionName("Olva", ["olva", "Olva 2", "Shalom"])).toBe("Olva 3");
  const catalog = [{ name: "Olva" }, { name: "Shalom" }];
  expect(isCourierName("Olva", catalog)).toBe(true);
  expect(isCourierName("Olva 2", catalog)).toBe(true);
  expect(isCourierName("Olva Express", catalog)).toBe(false);
  expect(isCourierName("Recojo 2", catalog)).toBe(false);
});
