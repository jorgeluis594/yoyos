import { expect, test } from "vitest";
import { zoneDraftSchema } from "@core/app/components/delivery-zones-section";

test("zone draft requires explicit price and unique official districts while accepting free delivery", () => {
  const valid = { name: "Lima", amount: "0", districtCodes: ["150122", "040110"], enabled: true };
  expect(zoneDraftSchema.safeParse(valid).success).toBe(true);
  expect(zoneDraftSchema.safeParse({ ...valid, amount: "8,50" }).success).toBe(true);
  for (const invalid of [{ ...valid, amount: "" }, { ...valid, amount: "-1" }, { ...valid, amount: "8.123" },
    { ...valid, amount: "1e2" }, { ...valid, amount: "9999999999999999999999999999999999999999999999999999" },
    { ...valid, name: " " }, { ...valid, districtCodes: [] }, { ...valid, districtCodes: ["000000"] },
    { ...valid, districtCodes: ["150122", "150122"] }]) {
    expect(zoneDraftSchema.safeParse(invalid).success).toBe(false);
  }
});
