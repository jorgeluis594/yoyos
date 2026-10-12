import { expect, test } from "vitest";
import { agencyLabel, rateLabel } from "@core/app/rate-label";

test("zone name disambiguates only repeated option names", () => {
  const rates = [{ name: "Express", zoneName: "Lima" }, { name: "Express", zoneName: "Callao" }, { name: "Standard", zoneName: "Lima" }];
  expect(rateLabel(rates[0], rates)).toBe("Express · Lima");
  expect(rateLabel(rates[2], rates)).toBe("Standard");
});

test("agency choices name the branch, its courier, district and address", () => {
  expect(agencyLabel({ name: "Branch", address: "Av. Test 123", courier: { name: "Shalom" }, location: { district: "Miraflores" } })).toBe("Branch · Shalom · Miraflores · Av. Test 123");
});
