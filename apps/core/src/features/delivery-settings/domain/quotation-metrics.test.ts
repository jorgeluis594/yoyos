import { expect, test } from "vitest";
import type { PeruDistrictCode } from "@shared/peru-geography";
import type { QuotedDeliveryRate } from "@core/src/features/delivery-settings/domain/quotation";
import { agencyRatesInDestinationDepartment } from "@core/src/features/delivery-settings/domain/quotation-metrics";

const agencyRate = (...districts: string[]) => ({ rate: { method: "agency" }, name: "A", zoneName: "Z",
  agencies: districts.map(districtCode => ({ agency: { districtCode }, courier: {} })) }) as unknown as QuotedDeliveryRate;
const homeRate = { rate: { method: "home" }, name: "H", zoneName: "Z" } as unknown as QuotedDeliveryRate;

test("agency rates in the destination department count rates with at least one agency in that department", () => {
  const cusco = "080101" as PeruDistrictCode;
  expect(agencyRatesInDestinationDepartment([], cusco)).toBe(0);
  expect(agencyRatesInDestinationDepartment([homeRate, agencyRate("040101")], cusco)).toBe(0);
  expect(agencyRatesInDestinationDepartment([homeRate, agencyRate("040101", "080201"), agencyRate("080101"), agencyRate("040101")], cusco)).toBe(2);
});
