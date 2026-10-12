import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { resolveSelectedDeliveryRate } from "@core/src/features/delivery-settings/application/resolve-selected-delivery-rate";
import { initialDeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryAgencyId } from "@core/src/features/delivery-settings/domain/delivery-agency";
import type { Courier } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { buildQuotationWithRates, parseQuotationCompanyId, type DeliveryConfiguration } from "@core/src/features/delivery-settings/domain/quotation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fixture() {
  const other = parseQuotationCompanyId(id(99));
  if (!other.success) throw new Error(other.error.message);
  const parsed = parseDeliveryZone({ id: id(1), name: "Zone", enabled: true, districtCodes: ["150122"],
    options: [{ id: id(5), method: "home", name: "Standard", enabled: true, price: { amount: 8, currency: "PEN" } }] }, "PEN");
  if (!parsed.success) throw new Error(parsed.error.message);
  const zone = parsed.data;
  const settings = { ...initialDeliverySettings(), home: { enabled: true }, version: 2 };
  const configuration: { -readonly [K in keyof DeliveryConfiguration]: DeliveryConfiguration[K] } = { country: "PE", currency: "PEN" as const, settings, zones: [zone], agencies: [] };
  const built = buildQuotationWithRates({ id: id(2), companyId: id(3), createdAt: new Date(), destination: { country: "PE", districtCode: "150122" },
    configuration, rateIds: [id(4)] });
  if (!built.success) throw new Error(built.error.message);
  const value = { quotation: built.data.quotation, rate: built.data.rates[0].rate };
  const input = { companyId: value.rate.companyId, rateId: value.rate.id, districtCode: value.rate.districtCode, method: "home" as const };
  const deps = { readConfigurationForShare: vi.fn(async () => ok(configuration)), findRateWithQuotation: vi.fn(async () => ok(value)) };
  return { input, value, zone, configuration, deps, otherCompany: other.data };
}

test("selected rate preserves its snapshot version across unrelated configuration changes", async () => {
  const f = fixture();
  f.configuration.settings = { ...f.configuration.settings, version: 9 };
  expect(await resolveSelectedDeliveryRate(f.input, f.deps)).toEqual(ok({ quotationId: f.value.quotation.id, rateId: f.input.rateId,
    price: { amount: 8, currency: "PEN" }, settingsVersion: 2, method: "home", optionId: f.zone.options[0].id }));
});

test("price changes return currentPrice without modifying the generated rate", async () => {
  const f = fixture();
  f.configuration.zones = [{ ...f.zone, options: [{ ...f.zone.options[0], price: { amount: 10, currency: "PEN" } }] }];
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
  for (const zones of [[], [{ ...f.zone, enabled: false }], [{ ...f.zone, options: [{ ...f.zone.options[0], enabled: false }] }], [{ ...f.zone, districtCodes: ["040110" as typeof f.input.districtCode] as const }]]) {
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

test("agency rates require agency delivery, an enabled courier and an eligible associated agency", async () => {
  const f = fixture();
  const agencyId = id(70);
  const catalogId = id(61) as unknown as Courier["catalogId"];
  const option = { ...f.zone.options[0], method: "agency" as const, agencyIds: [agencyId as unknown as DeliveryAgencyId] };
  const agency = { id: agencyId as unknown as DeliveryAgencyId, courierId: catalogId, name: "Agency", address: "Street",
    districtCode: "150122" as typeof f.input.districtCode, enabled: true, courierEnabled: true };
  const courier: Courier = { id: id(60) as Courier["id"], catalogId, name: "Courier", enabled: true, catalogEnabled: true };
  const input = { ...f.input, method: "agency" as const, agencyId: agencyId as unknown as DeliveryAgencyId };
  const value = { ...f.value, rate: { ...f.value.rate, method: "agency" as const } };
  const configuration: DeliveryConfiguration = { ...f.configuration, zones: [{ ...f.zone, options: [option] }], agencies: [agency],
    settings: { ...f.configuration.settings, agency: { enabled: true }, couriers: [courier] } };
  const deps = { readConfigurationForShare: async () => ok(configuration), findRateWithQuotation: async () => ok(value) };
  expect(await resolveSelectedDeliveryRate(input, deps)).toEqual(ok({ quotationId: f.value.quotation.id, rateId: f.input.rateId, optionId: option.id,
    price: { amount: 8, currency: "PEN" }, settingsVersion: 2, method: "agency", courier: { id: courier.id, name: "Courier" },
    agency: { id: agency.id, name: "Agency", address: "Street", districtCode: "150122" } }));
  // An agency outside the option's associations is unavailable, even when it exists in the catalog.
  expect(await resolveSelectedDeliveryRate({ ...input, agencyId: id(71) as unknown as DeliveryAgencyId }, deps)).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  // A vanished agency wins over a price change: the buyer must pick again, not just accept a new total.
  expect(await resolveSelectedDeliveryRate(input, { ...deps, readConfigurationForShare: async () => ok({ ...configuration, agencies: [],
    zones: [{ ...configuration.zones[0], options: [{ ...option, price: { amount: 9, currency: "PEN" } }] }] }) })).toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  for (const change of [{ settings: { ...configuration.settings, couriers: [{ ...courier, catalogEnabled: false }] } },{ agencies: [] }, { agencies: [{ ...agency, enabled: false }] }, { agencies: [{ ...agency, courierEnabled: false }] },
    { settings: { ...configuration.settings, couriers: [{ ...courier, enabled: false }] } }, { settings: { ...configuration.settings, agency: { enabled: false } } }]) {
    expect(await resolveSelectedDeliveryRate(input, { ...deps, readConfigurationForShare: async () => ok({ ...configuration, ...change }) }))
      .toMatchObject({ success: false, error: { code: "RATE_UNAVAILABLE" } });
  }
});
