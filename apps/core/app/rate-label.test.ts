import { expect, test } from "vitest";
import { rateLabel } from "@core/app/rate-label";

test("zone name disambiguates only repeated option names", () => {
  const rates = [{ name: "Express", zoneName: "Lima" }, { name: "Express", zoneName: "Callao" }, { name: "Standard", zoneName: "Lima" }];
  expect(rateLabel(rates[0], rates)).toBe("Express · Lima");
  expect(rateLabel(rates[2], rates)).toBe("Standard");
});
