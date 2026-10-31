import { expect, test } from "vitest";
import { initialDeliverySettings, type Courier, type DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import { parseDeliveryZone, type DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { applicableDeliveryOptions, buildQuotationWithRates, checkoutCoverage, parseQuotationDestination, parseRateWithQuotation, type DeliveryConfiguration } from "@core/src/features/delivery-settings/domain/quotation";
import type { PeruDistrictCode } from "@shared/peru-geography";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const settings: DeliverySettings = { ...initialDeliverySettings(), version: 3, home: { enabled: true } };
type OptionSpec = Readonly<{ id: number; amount: number; method?: "home" | "agency"; enabled?: boolean; name?: string; agencyIds?: string[] }>;
const zone = (value: number, options: readonly OptionSpec[], districtCode = "150122", enabled = true, name = "Zone"): DeliveryZone => {
  const parsed = parseDeliveryZone({ id: id(value), name, enabled, districtCodes: [districtCode], options: options.map(option => ({
    id: id(option.id), method: option.method ?? "home", name: option.name ?? `Option ${option.id}`, enabled: option.enabled ?? true,
    price: { amount: option.amount, currency: "PEN" }, ...(option.method === "agency" ? { agencyIds: option.agencyIds ?? [] } : {}) })) }, "PEN");
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
const configuration = (zones: readonly DeliveryZone[], overrides: Partial<DeliveryConfiguration> = {}): DeliveryConfiguration =>
  ({ country: "PE", currency: "PEN", settings, zones, agencies: [], ...overrides });
const input = (zones: readonly DeliveryZone[], rateIds: readonly string[], overrides: Partial<DeliveryConfiguration> = {}) => ({
  id: id(20), companyId: id(21), createdAt: new Date("2026-10-07T16:00:00.000Z"),
  destination: { country: "PE", districtCode: "150122" }, configuration: configuration(zones, overrides), rateIds,
});
const courier = { id: id(50), catalogId: id(51), name: "Courier", enabled: true, catalogEnabled: true } as unknown as Courier;
const catalogAgency = (enabled = true, courierEnabled = true) => ({ id: id(60), courierId: courier.catalogId, name: "Agency", address: "Street",
  districtCode: "150122" as PeruDistrictCode, enabled, courierEnabled }) as DeliveryAgency;
const agencySettings = (overrides: Partial<Courier> = {}): DeliverySettings => ({ ...settings, agency: { enabled: true }, couriers: [{ ...courier, ...overrides }] });

test("every applicable option generates its own rate named after the option, even with equal prices", () => {
  const original = input([zone(1, [{ id: 13, amount: 12 }, { id: 12, amount: 8, name: "Standard" }], "150122", true, "Lima"), zone(2, [{ id: 11, amount: 8 }])], [id(30), id(31), id(32)]);
  const result = buildQuotationWithRates(original);
  expect(result).toMatchObject({ success: true, data: { quotation: { id: id(20), companyId: id(21),
    destination: { country: "PE", districtCode: "150122", address: null, instructions: null } }, rates: [
    { rate: { id: id(30), optionId: id(11), method: "home", price: { amount: 8, currency: "PEN" } }, name: "Option 11", zoneName: "Zone" },
    { rate: { id: id(31), optionId: id(12), price: { amount: 8, currency: "PEN" } }, name: "Standard", zoneName: "Lima" },
    { rate: { id: id(32), optionId: id(13), price: { amount: 12, currency: "PEN" } }, name: "Option 13", zoneName: "Lima" },
  ] } });
  if (!result.success) return;
  for (const { rate } of result.data.rates) {
    expect(rate).toMatchObject({ quotationId: id(20), companyId: id(21), districtCode: "150122", settingsVersion: 3, createdAt: original.createdAt });
    expect(rate).not.toHaveProperty("name");
  }
  expect(result.data.quotation.createdAt).not.toBe(original.createdAt);
});

test("home options apply only when home delivery, the zone, the option and the district are all active", () => {
  const district = "150122" as PeruDistrictCode;
  const zones = [zone(1, [{ id: 11, amount: 0 }, { id: 12, amount: 5, enabled: false }]), zone(2, [{ id: 13, amount: 8 }], "040110"), zone(3, [{ id: 14, amount: 8 }], "150122", false)];
  expect(applicableDeliveryOptions(configuration(zones), district).map(value => value.option.id)).toEqual([id(11)]);
  expect(applicableDeliveryOptions(configuration(zones, { settings: { ...settings, home: { enabled: false } } }), district)).toEqual([]);
});

test("agency options require agency delivery and at least one eligible agency whose courier is enabled in the catalog and the company", () => {
  const district = "150122" as PeruDistrictCode;
  const zones = [zone(1, [{ id: 11, amount: 5, method: "agency", agencyIds: [id(60)] }, { id: 12, amount: 8 }])];
  const base = { settings: agencySettings(), agencies: [catalogAgency()] };
  const options = applicableDeliveryOptions(configuration(zones, base), district);
  expect(options.map(value => [value.option.method, value.option.id])).toEqual([["home", id(12)], ["agency", id(11)]]);
  expect(options[1]).toMatchObject({ agencies: [{ agency: { id: id(60) }, courier: { id: id(50) } }] });
  for (const change of [{ settings: { ...agencySettings(), agency: { enabled: false } } }, { agencies: [] }, { agencies: [catalogAgency(false)] },
    { agencies: [catalogAgency(true, false)] }, { settings: agencySettings({ enabled: false }) }, { settings: agencySettings({ catalogEnabled: false }) },
    { settings: { ...settings, agency: { enabled: true }, couriers: [{ ...courier, catalogId: id(99) } as unknown as Courier] } }]) {
    expect(applicableDeliveryOptions(configuration(zones, { ...base, ...change }), district).map(value => value.option.method)).toEqual(["home"]);
  }
  expect(applicableDeliveryOptions(configuration([zone(1, [{ id: 11, amount: 5, method: "agency", agencyIds: [] }])], base), district)).toEqual([]);
});

test("valid uncovered destination creates a quotation with no rates rather than a zero rate", () => {
  const result = buildQuotationWithRates(input([zone(1, [{ id: 11, amount: 8 }], "040110")], []));
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

test("invalid timestamps, IDs, repeated zones or options and inconsistent generated identity counts are rejected", () => {
  const valid = input([zone(1, [{ id: 11, amount: 8 }])], [id(30)]);
  for (const change of [{ id: "bad" }, { companyId: "bad" }, { createdAt: new Date(NaN) }, { rateIds: [] },
    { rateIds: ["bad"] }, { rateIds: [id(30), id(30)] }, { configuration: configuration([zone(1, [{ id: 11, amount: 8 }]), zone(1, [{ id: 12, amount: 8 }])]) },
    { configuration: configuration([zone(1, [{ id: 11, amount: 8 }]), zone(2, [{ id: 11, amount: 8 }])]) }]) {
    expect(buildQuotationWithRates({ ...valid, ...change }).success).toBe(false);
  }
  expect(buildQuotationWithRates({ ...valid, configuration: { ...valid.configuration, settings: { ...settings, version: -1 } } }))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_SETTINGS" } });
  expect(buildQuotationWithRates({ ...valid, configuration: { ...valid.configuration, currency: "USD" } }))
    .toMatchObject({ success: false, error: { code: "INVALID_DELIVERY_RATE" } });
});

test("stored rates validate the immutable destination and quotation relationship", () => {
  const built = buildQuotationWithRates(input([zone(1, [{ id: 11, amount: 8 }])], [id(30)]));
  if (!built.success) throw new Error(built.error.message);
  const value = { quotation: built.data.quotation, rate: built.data.rates[0].rate };
  expect(parseRateWithQuotation(value, "PEN")).toEqual({ success: true, data: value });
  for (const change of [{ companyId: id(99) }, { quotationId: id(99) }, { districtCode: "040110" }, { optionId: "bad" },
    { price: { amount: 8.001, currency: "PEN" } }, { settingsVersion: -1 }, { createdAt: "2026-10-07" }]) {
    expect(parseRateWithQuotation({ ...value, rate: { ...value.rate, ...change } }, "PEN").success).toBe(false);
  }
  for (const destination of [{ country: "PE", districtCode: "150122" },
    { ...value.quotation.destination, districtCode: "999999" }, { ...value.quotation.destination, kind: "home" }]) {
    expect(parseRateWithQuotation({ ...value, quotation: { ...value.quotation, destination } }, "PEN").success).toBe(false);
  }
});

const unitZone = (value: number, units: object, name = "Zona sur") => {
  const parsed = parseDeliveryZone({ id: id(value), name, enabled: true, departmentCodes: [], provinceCodes: [], districtCodes: [], ...units,
    options: [{ id: id(value + 100), method: "home", name: `Option ${value}`, enabled: true, price: { amount: 15, currency: "PEN" } }] }, "PEN");
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
const applicableIds = (zones: readonly DeliveryZone[], district: string) =>
  applicableDeliveryOptions(configuration(zones), district as PeruDistrictCode).map(value => value.option.id);

test("applicableDeliveryOptions applies a zone to a district of its complete department", () => {
  const zones = [unitZone(1, { departmentCodes: ["04", "08"] })];
  expect(applicableIds(zones, "040103")).toEqual([id(101)]);
  expect(applicableIds(zones, "080101")).toEqual([id(101)]);
  expect(applicableIds(zones, "150122")).toEqual([]);
});

test("applicableDeliveryOptions applies a zone to a district of its complete province and not to another province of the department", () => {
  const zones = [unitZone(1, { provinceCodes: ["1501"] })];
  expect(applicableIds(zones, "150122")).toEqual([id(101)]);
  expect(applicableIds(zones, "150601")).toEqual([]);
});

test("applicableDeliveryOptions keeps applying district-by-district zones", () => {
  expect(applicableIds([unitZone(1, { districtCodes: ["150122"] })], "150122")).toEqual([id(101)]);
});

test("applicableDeliveryOptions yields one rate per zone when a whole department overlaps a loose district", () => {
  const zones = [unitZone(1, { departmentCodes: ["04"] }), unitZone(2, { districtCodes: ["040103"] }, "Cayma")];
  expect(applicableIds(zones, "040103")).toEqual([id(101), id(102)]);
});

const agencyOption = (amount = 5, enabled = true): OptionSpec => ({ id: 11, amount, method: "agency", agencyIds: [id(60)], enabled });
const covered = { settings: agencySettings(), agencies: [catalogAgency()] };

const homeOnly = { settings: settings, agencies: [] };
const empty = { departmentCodes: [], provinceCodes: [], districtCodes: [] };

test("checkout coverage is null for a method whose switch is off even with covered zones", () => {
  const zones = [zone(1, [{ id: 12, amount: 8 }, agencyOption()])];
  expect(checkoutCoverage(configuration(zones, { settings: { ...agencySettings(), home: { enabled: false } }, agencies: [catalogAgency()] })))
    .toEqual({ home: null, agency: { ...empty, districtCodes: ["150122"] } });
  expect(checkoutCoverage(configuration(zones, { settings: { ...agencySettings(), home: { enabled: true }, agency: { enabled: false } }, agencies: [catalogAgency()] })))
    .toEqual({ home: { ...empty, districtCodes: ["150122"] }, agency: null });
});

test("checkout coverage returns the districts of enabled zones for each enabled method", () => {
  const config = configuration([zone(1, [{ id: 12, amount: 8 }]), zone(2, [agencyOption()], "040103")], { settings: { ...agencySettings(), home: { enabled: true } }, agencies: [catalogAgency()] });
  expect(checkoutCoverage(config)).toEqual({ home: { ...empty, districtCodes: ["150122"] }, agency: null });
  expect(checkoutCoverage(configuration([zone(1, [agencyOption()], "150101")], covered))).toEqual({ home: null, agency: { ...empty, districtCodes: ["150101"] } });
});

test("checkout coverage excludes agencies disabled in the catalog, retired catalog couriers and disabled company couriers", () => {
  for (const config of [configuration([zone(1, [agencyOption()])], { ...covered, agencies: [catalogAgency(false)] }),
    configuration([zone(1, [agencyOption()])], { ...covered, agencies: [catalogAgency(true, false)] }),
    configuration([zone(1, [agencyOption()])], { ...covered, settings: agencySettings({ enabled: false }) }),
    configuration([zone(1, [agencyOption()])], { ...covered, settings: agencySettings({ catalogEnabled: false }) }),
    configuration([zone(1, [agencyOption(5, false)])], covered), configuration([zone(1, [agencyOption()], "150122", false)], covered),
    configuration([zone(1, [{ id: 11, amount: 5, method: "agency", agencyIds: [] }])], covered)]) expect(checkoutCoverage(config).agency).toBeNull();
});

test("checkout coverage bounds agency to the departments of the eligible agencies", () => {
  const cusco = zone(1, [agencyOption()], "080101");
  expect(checkoutCoverage(configuration([cusco], covered)).agency).toBeNull();
  const near = { ...catalogAgency(), districtCode: "080101" as PeruDistrictCode };
  expect(checkoutCoverage(configuration([cusco], { ...covered, agencies: [near] })).agency).toEqual({ ...empty, districtCodes: ["080101"] });
  expect(checkoutCoverage(configuration([], homeOnly)).home).toBeNull();
});
