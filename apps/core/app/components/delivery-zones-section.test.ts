import { expect, test } from "vitest";
import { zoneDraftSchema } from "@core/app/components/delivery-zones-section";

const option = { method: "home", name: "Standard", amount: "0", enabled: true, agencyIds: [] };

test("zone draft requires unique official districts and options with explicit prices while accepting free delivery", () => {
  const valid = { name: "Lima", districtCodes: ["150122", "040110"], enabled: true, options: [option, { ...option, method: "agency", name: "Agency" }] };
  expect(zoneDraftSchema.safeParse(valid).success).toBe(true);
  expect(zoneDraftSchema.safeParse({ ...valid, options: [{ ...option, amount: "8,50" }] }).success).toBe(true);
  for (const invalid of [{ ...valid, options: [{ ...option, amount: "" }] }, { ...valid, options: [{ ...option, amount: "-1" }] },
    { ...valid, options: [{ ...option, amount: "8.123" }] }, { ...valid, options: [{ ...option, amount: "1e2" }] },
    { ...valid, options: [{ ...option, amount: "9999999999999999999999999999999999999999999999999999" }] },
    { ...valid, options: [{ ...option, name: " " }] }, { ...valid, options: [option, { ...option, name: " standard " }] },
    { ...valid, name: " " }, { ...valid, districtCodes: [] }, { ...valid, districtCodes: ["000000"] },
    { ...valid, districtCodes: ["150122", "150122"] }]) {
    expect(zoneDraftSchema.safeParse(invalid).success).toBe(false);
  }
});
