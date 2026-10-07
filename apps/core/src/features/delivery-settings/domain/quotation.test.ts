import { expect, test } from "vitest";
import { initialDeliverySettings, type DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone, type DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { buildQuotationWithRates, parseQuotationDestination } from "@core/src/features/delivery-settings/domain/quotation";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const settings: DeliverySettings = { ...initialDeliverySettings(), version: 3, home: { enabled: true } };
const zone = (value: number, amount: number, method: "home" | "agency" = "home", districtCode = "150122", enabled = true): DeliveryZone => {
  const parsed = parseDeliveryZone({ id: id(value), method, name: "Zone", enabled, districtCodes: [districtCode], price: { amount, currency: "PEN" } }, "PEN");
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
const input = (zones: readonly DeliveryZone[], rateIds: readonly string[]) => ({
  id: id(20), companyId: id(21), createdAt: new Date("2026-10-07T16:00:00.000Z"),
  destination: { country: "PE", districtCode: "150122" }, settings, zones, rateIds,
});

test("every overlapping zone generates its own rate, even with equal prices, without exposing internal names", () => {
  const original = input([zone(3, 12), zone(2, 8), zone(1, 8)], [id(30), id(31), id(32)]);
  const result = buildQuotationWithRates(original, "PEN");
  expect(result).toMatchObject({ success: true, data: { quotation: { id: id(20), companyId: id(21),
    destination: { country: "PE", districtCode: "150122", address: null, instructions: null } }, rates: [
    { id: id(30), zoneId: id(1), price: { amount: 8, currency: "PEN" } },
    { id: id(31), zoneId: id(2), price: { amount: 8, currency: "PEN" } },
    { id: id(32), zoneId: id(3), price: { amount: 12, currency: "PEN" } },
  ] } });
  if (!result.success) return;
  for (const rate of result.data.rates) {
    expect(rate).toMatchObject({ quotationId: id(20), companyId: id(21), districtCode: "150122", settingsVersion: 3, createdAt: original.createdAt });
    expect(rate).not.toHaveProperty("name");
  }
  expect(original.zones.map(value => value.id)).toEqual([id(3), id(2), id(1)]);
  expect(result.data.quotation.createdAt).not.toBe(original.createdAt);
});

test("only active covered zones of enabled shipping methods apply; pickup is not a rate", () => {
  const zones = [zone(1, 0), zone(2, 5, "agency"), zone(3, 8, "home", "040110"), zone(4, 8, "home", "150122", false)];
  const result = buildQuotationWithRates(input(zones, [id(30)]), "PEN");
  expect(result).toMatchObject({ success: true, data: { rates: [{ method: "home", price: { amount: 0, currency: "PEN" } }] } });
  const courierSettings: DeliverySettings = { ...settings, agency: { enabled: true },
    couriers: [{ id: id(50) as DeliverySettings["couriers"][number]["id"], name: "Courier", enabled: true }] };
  expect(buildQuotationWithRates({ ...input(zones, [id(30), id(31)]), settings: courierSettings }, "PEN"))
    .toMatchObject({ success: true, data: { rates: [{ method: "home" }, { method: "agency" }] } });
});

test("valid uncovered destination creates a quotation with no rates rather than a zero rate", () => {
  const result = buildQuotationWithRates(input([zone(1, 8, "home", "040110")], []), "PEN");
  expect(result).toMatchObject({ success: true, data: { quotation: { id: id(20) }, rates: [] } });
});

test("destination allows district without street, normalizes optional text and rejects absent or unknown destinations", () => {
  expect(parseQuotationDestination({ country: "PE", districtCode: "150122", address: "  Street  ", instructions: " " }))
    .toMatchObject({ success: true, data: { address: "Street", instructions: null } });
  for (const destination of [null, undefined, {}, { country: "PE" }, { country: "PE", districtCode: "150122", kind: "home" },
    { country: "PE", districtCode: "150122", address: "a".repeat(501) }, { country: "PE", districtCode: "150122", instructions: "a".repeat(1001) }]) {
    expect(parseQuotationDestination(destination)).toMatchObject({ success: false, error: { code: "INVALID_DESTINATION" } });
  }
  expect(parseQuotationDestination({ country: "US", districtCode: "150122" })).toMatchObject({ success: false, error: { code: "UNSUPPORTED_COUNTRY" } });
  expect(parseQuotationDestination({ country: "PE", districtCode: "999999" })).toMatchObject({ success: false, error: { code: "INVALID_DISTRICT" } });
});

test("invalid timestamps, IDs, repeated zones or rates and inconsistent generated identity counts are rejected", () => {
  const valid = input([zone(1, 8)], [id(30)]);
  for (const change of [{ id: "bad" }, { companyId: "bad" }, { createdAt: new Date(NaN) }, { rateIds: [] },
    { rateIds: ["bad"] }, { rateIds: [id(30), id(30)] }, { zones: [zone(1, 8), zone(1, 8)] }]) {
    expect(buildQuotationWithRates({ ...valid, ...change }, "PEN").success).toBe(false);
  }
  expect(buildQuotationWithRates({ ...valid, settings: { ...settings, version: -1 } }, "PEN"))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  expect(buildQuotationWithRates(valid, "USD")).toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_RATE" } });
});
