import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { resolveSelectedDeliveryRate } from "@core/src/features/delivery-settings/application/resolve-selected-delivery-rate";
import { initialDeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { buildQuotationWithRates, parseQuotationCompanyId } from "@core/src/features/delivery-settings/domain/quotation";

function fixture() {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const other = parseQuotationCompanyId(id(99));
  if (!other.success) throw new Error(other.error.message);
  const parsed = parseDeliveryZone({ id: id(1), method: "home", name: "Zone", enabled: true,
    districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } }, "PEN");
  if (!parsed.success) throw new Error(parsed.error.message);
  const zone = parsed.data;
  const settings = { ...initialDeliverySettings(), home: { enabled: true }, version: 2 };
  const built = buildQuotationWithRates({ id: id(2), companyId: id(3), createdAt: new Date(), destination: { country: "PE", districtCode: "150122" },
    settings, zones: [zone], rateIds: [id(4)] }, "PEN");
  if (!built.success) throw new Error(built.error.message);
  const value = { quotation: built.data.quotation, rate: built.data.rates[0] };
  const input = { companyId: value.rate.companyId, rateId: value.rate.id, districtCode: value.rate.districtCode, method: value.rate.method };
  const configuration = { country: "PE", currency: "PEN" as const, settings, zones: [zone] };
  const deps = { readConfigurationForShare: vi.fn(async () => ok(configuration)), findRateWithQuotation: vi.fn(async () => ok(value)) };
  return { input, value, zone, configuration, deps, otherCompany: other.data };
}

test("selected rate preserves its snapshot version across unrelated configuration changes", async () => {
  const f = fixture();
  f.configuration.settings.version = 9;
  expect(await resolveSelectedDeliveryRate(f.input, f.deps)).toEqual(ok({ quotationId: f.value.quotation.id, rateId: f.input.rateId,
    price: { amount: 8, currency: "PEN" }, settingsVersion: 2, method: "home", zoneId: f.zone.id }));
});

test("price changes return currentPrice without modifying the generated rate", async () => {
  const f = fixture();
  f.configuration.zones = [{ ...f.zone, price: { amount: 10, currency: "PEN" } }];
  expect(await resolveSelectedDeliveryRate(f.input, f.deps)).toMatchObject({ success: false, error: { code: "TOTAL_CHANGED", currentPrice: { amount: 10, currency: "PEN" } } });
  expect(f.value.rate.price.amount).toBe(8);
});

test("missing or incompatible rates and disabled coverage have the same private error", async () => {
  const f = fixture();
  const unavailable = { success: false, error: { code: "RATE_UNAVAILABLE" } };
  expect(await resolveSelectedDeliveryRate(f.input, { ...f.deps, findRateWithQuotation: async () => ok(null) })).toMatchObject(unavailable);
  for (const rate of [{ ...f.value.rate, companyId: f.otherCompany }, { ...f.value.rate, method: "agency" as const },
    { ...f.value.rate, districtCode: "040110" as typeof f.input.districtCode }, { ...f.value.rate, price: { amount: 8, currency: "USD" as const } }]) {
    expect(await resolveSelectedDeliveryRate(f.input, { ...f.deps, findRateWithQuotation: async () => ok({ ...f.value, rate }) })).toMatchObject(unavailable);
  }
  for (const zones of [[], [{ ...f.zone, enabled: false }], [{ ...f.zone, districtCodes: ["040110" as typeof f.input.districtCode] as const }]]) {
    expect(await resolveSelectedDeliveryRate(f.input, { ...f.deps, readConfigurationForShare: async () => ok({ ...f.configuration, zones }) })).toMatchObject(unavailable);
  }
  expect(await resolveSelectedDeliveryRate(f.input, { ...f.deps, readConfigurationForShare: async () => ok({ ...f.configuration,
    settings: { ...f.configuration.settings, home: { enabled: false } } }) })).toMatchObject(unavailable);
  expect(await resolveSelectedDeliveryRate(f.input, { ...f.deps, findRateWithQuotation: async () => ok({ ...f.value,
    quotation: { ...f.value.quotation, companyId: f.otherCompany } }) })).toMatchObject(unavailable);
});

test("storage failures remain technical failures and stop subsequent reads", async () => {
  const f = fixture();
  const failure = err({ code: "SERVICE_UNAVAILABLE" as const, message: "Unavailable" });
  expect(await resolveSelectedDeliveryRate(f.input, { ...f.deps, readConfigurationForShare: async () => failure })).toEqual(failure);
  expect(f.deps.findRateWithQuotation).not.toHaveBeenCalled();
  expect(await resolveSelectedDeliveryRate(f.input, { ...f.deps, findRateWithQuotation: async () => failure })).toEqual(failure);
});

test("agency rates require an enabled courier in addition to active agency coverage", async () => {
  const f = fixture();
  const input = { ...f.input, method: "agency" as const };
  const value = { ...f.value, rate: { ...f.value.rate, method: "agency" as const } };
  const configuration = { ...f.configuration, zones: [{ ...f.zone, method: "agency" as const }],
    settings: { ...f.configuration.settings, agency: { enabled: true } } };
  const deps = { readConfigurationForShare: async () => ok(configuration), findRateWithQuotation: async () => ok(value) };
  expect(await resolveSelectedDeliveryRate(input, deps)).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  const courier = { id: f.zone.id as unknown as typeof configuration.settings.couriers[number]["id"], name: "Courier", enabled: false };
  expect(await resolveSelectedDeliveryRate(input, { ...deps, readConfigurationForShare: async () => ok({ ...configuration,
    settings: { ...configuration.settings, couriers: [courier] } }) })).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  expect(await resolveSelectedDeliveryRate(input, { ...deps, readConfigurationForShare: async () => ok({ ...configuration,
    settings: { ...configuration.settings, couriers: [{ ...courier, enabled: true }] } }) })).toMatchObject({ success: true, data: { method: "agency" } });
});
