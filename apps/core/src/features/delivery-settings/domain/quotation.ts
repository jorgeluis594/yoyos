import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { compare, type Currency, type Money } from "@shared/money";
import { parsePeruDistrictCode, type PeruDistrictCode } from "@shared/peru-geography";
import type { Result } from "@shared/result";
import { parseDeliverySettings, type Courier, type DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone, type AgencyDeliveryOption, type DeliveryMethodWithRate, type DeliveryOptionId, type DeliveryZone,
  type HomeDeliveryOption } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import { parseDeliveryPrice } from "@core/src/features/delivery-settings/domain/delivery-price";

export type QuotationId = string & { readonly __brand: "QuotationId" };
export type DeliveryRateId = string & { readonly __brand: "DeliveryRateId" };
export type DeliverySettingsVersion = number & { readonly __brand: "DeliverySettingsVersion" };
export type QuotationDestination = Readonly<{ country: "PE"; districtCode: PeruDistrictCode; address: string | null; instructions: string | null }>;
export type Quotation = Readonly<{ id: QuotationId; companyId: CompanyId; destination: QuotationDestination; createdAt: Date }>;
export type DeliveryRate = Readonly<{
  id: DeliveryRateId; companyId: CompanyId; quotationId: QuotationId; price: Money;
  settingsVersion: DeliverySettingsVersion; createdAt: Date; method: DeliveryMethodWithRate;
  optionId: DeliveryOptionId; districtCode: PeruDistrictCode;
}>;
type NonEmpty<T> = readonly [T, ...T[]];
export type DeliveryConfiguration = Readonly<{
  country: string; currency: Currency; settings: DeliverySettings; zones: readonly DeliveryZone[];
  agencies: readonly DeliveryAgency[]; // catalog agencies associated with any option of the company
}>;
export type EligibleAgency = Readonly<{ agency: DeliveryAgency; courier: Courier }>;
export type ApplicableDeliveryOption =
  | Readonly<{ zone: DeliveryZone; option: HomeDeliveryOption }>
  | Readonly<{ zone: DeliveryZone; option: AgencyDeliveryOption; agencies: NonEmpty<EligibleAgency> }>;
export type QuotedDeliveryRate =
  | Readonly<{ rate: DeliveryRate & Readonly<{ method: "home" }>; name: string; zoneName: string }>
  | Readonly<{ rate: DeliveryRate & Readonly<{ method: "agency" }>; name: string; zoneName: string; agencies: NonEmpty<EligibleAgency> }>;
export type QuotationWithRates = Readonly<{ quotation: Quotation; rates: readonly QuotedDeliveryRate[] }>;
export type RateWithQuotation = Readonly<{ quotation: Quotation; rate: DeliveryRate }>;
export type QuotationDestinationError =
  | Readonly<{ code: "INVALID_DESTINATION"; message: string; field: "destination" | "address" | "instructions" }>
  | Readonly<{ code: "INVALID_DISTRICT"; message: string; districtCode?: string }>
  | Readonly<{ code: "UNSUPPORTED_COUNTRY"; message: string }>;
export type QuotationError = QuotationDestinationError | Readonly<{
  code: "INVALID_INPUT" | "INVALID_DELIVERY_SETTINGS" | "INVALID_DELIVERY_RATE";
  message: string;
}>;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform(value => value || null);
const destinationSchema = z.strictObject({
  country: z.string(), districtCode: z.string(), address: optionalText(500), instructions: optionalText(1000),
});
const companyIdSchema = z.uuid().transform(value => value as CompanyId);
const districtCodeSchema = z.string().refine(value => parsePeruDistrictCode(value).success).transform(value => value as PeruDistrictCode);
const storedDestinationSchema = z.strictObject({ country: z.literal("PE"), districtCode: districtCodeSchema,
  address: z.string().min(1).max(500).nullable(), instructions: z.string().min(1).max(1000).nullable() });

export function parseQuotation(value: unknown): Result<Quotation, QuotationError> {
  const parsed = z.strictObject({ id: z.uuid().transform(value => value as QuotationId), companyId: companyIdSchema,
    destination: storedDestinationSchema, createdAt: z.date() }).safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_DESTINATION", field: "destination", message: "Invalid persisted quotation" });
}

export function parseDeliveryRate(value: unknown, currency: Currency): Result<DeliveryRate, QuotationError> {
  const parsed = z.strictObject({ id: z.uuid().transform(value => value as DeliveryRateId), companyId: companyIdSchema,
    quotationId: z.uuid().transform(value => value as QuotationId), method: z.enum(["home", "agency"]),
    optionId: z.uuid().transform(value => value as DeliveryOptionId), districtCode: districtCodeSchema, price: z.unknown(),
    settingsVersion: z.number().int().min(0).max(2147483647).transform(value => value as DeliverySettingsVersion), createdAt: z.date() }).safeParse(value);
  if (!parsed.success) return err({ code: "INVALID_DELIVERY_RATE", message: "Invalid persisted delivery rate" });
  const price = parseDeliveryPrice(parsed.data.price, currency);
  return price.success ? ok({ ...parsed.data, price: price.data }) : price;
}

export function parseRateWithQuotation(value: Readonly<{ quotation: unknown; rate: unknown }>, currency: Currency): Result<RateWithQuotation, QuotationError> {
  const quotation = parseQuotation(value.quotation);
  if (!quotation.success) return quotation;
  const rate = parseDeliveryRate(value.rate, currency);
  if (!rate.success) return rate;
  if (rate.data.companyId !== quotation.data.companyId || rate.data.quotationId !== quotation.data.id || rate.data.districtCode !== quotation.data.destination.districtCode)
    return err({ code: "INVALID_DELIVERY_RATE", message: "Rate does not belong to the quotation tenant and destination" });
  return ok({ quotation: quotation.data, rate: rate.data });
}

export function parseQuotationCompanyId(value: string): Result<CompanyId, QuotationError> {
  const parsed = companyIdSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_INPUT", message: "Invalid quotation company identity" });
}

export function parseQuotationDestination(value: unknown): Result<QuotationDestination, QuotationDestinationError> {
  const parsed = destinationSchema.safeParse(value);
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    return err({ code: "INVALID_DESTINATION", message: "Invalid quotation destination",
      field: field === "address" || field === "instructions" ? field : "destination" });
  }
  if (parsed.data.country !== "PE") return err({ code: "UNSUPPORTED_COUNTRY", message: "Delivery zones are available only in Peru" });
  const district = parsePeruDistrictCode(parsed.data.districtCode);
  return district.success ? ok({ ...parsed.data, country: "PE", districtCode: district.data })
    : err({ ...district.error, districtCode: parsed.data.districtCode });
}

function eligibleAgencies(configuration: DeliveryConfiguration, option: AgencyDeliveryOption): readonly EligibleAgency[] {
  const agencies = new Map(configuration.agencies.map(agency => [agency.id as string, agency]));
  return option.agencyIds.flatMap(id => {
    const agency = agencies.get(id);
    const courier = agency && configuration.settings.couriers.find(value => value.catalogId === agency.courierId);
    return agency?.enabled && agency.courierEnabled && courier?.enabled ? [{ agency, courier }] : [];
  });
}

export function applicableDeliveryOptions(configuration: DeliveryConfiguration, districtCode: PeruDistrictCode): readonly ApplicableDeliveryOption[] {
  const { settings } = configuration;
  const applicable = configuration.zones.filter(zone => zone.enabled && zone.districtCodes.includes(districtCode)).flatMap((zone): ApplicableDeliveryOption[] =>
    zone.options.flatMap((option): ApplicableDeliveryOption[] => {
      if (!option.enabled) return [];
      if (option.method === "home") return settings.home.enabled ? [{ zone, option }] : [];
      const [first, ...rest] = settings.agency.enabled ? eligibleAgencies(configuration, option) : [];
      return first ? [{ zone, option, agencies: [first, ...rest] }] : [];
    }));
  return applicable.sort((left, right) => {
    const price = compare(right.option.price)(left.option.price);
    return (left.option.method === right.option.method ? 0 : left.option.method === "home" ? -1 : 1) ||
      (price.success ? price.data : 0) || left.option.id.localeCompare(right.option.id);
  });
}

export type BuildQuotationInput = Readonly<{
  id: string; companyId: string; createdAt: Date; destination: unknown; configuration: DeliveryConfiguration; rateIds: readonly string[];
}>;

export function buildQuotationWithRates(input: BuildQuotationInput): Result<QuotationWithRates, QuotationError> {
  const destination = parseQuotationDestination(input.destination);
  if (!destination.success) return destination;
  const header = z.strictObject({ id: z.uuid(), companyId: companyIdSchema, createdAt: z.date(), rateIds: z.array(z.uuid()) }).safeParse({
    id: input.id, companyId: input.companyId, createdAt: input.createdAt, rateIds: input.rateIds,
  });
  if (!header.success) return err({ code: "INVALID_INPUT", message: "Quotation identities and timestamp must be valid" });
  const settings = parseDeliverySettings(input.configuration.settings);
  if (!settings.success) return err({ code: "INVALID_DELIVERY_SETTINGS", message: settings.error.message });
  const zones: DeliveryZone[] = [];
  for (const value of input.configuration.zones) {
    const zone = parseDeliveryZone(value, input.configuration.currency);
    if (!zone.success) return err({ code: zone.error.field === "price" ? "INVALID_DELIVERY_RATE" : "INVALID_DELIVERY_SETTINGS", message: zone.error.message });
    zones.push(zone.data);
  }
  const options = zones.flatMap(zone => zone.options);
  if (new Set(zones.map(zone => zone.id)).size !== zones.length || new Set(options.map(option => option.id)).size !== options.length)
    return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Zone and option identities must be unique" });
  const applicable = applicableDeliveryOptions({ ...input.configuration, settings: settings.data, zones }, destination.data.districtCode);
  if (input.rateIds.length !== applicable.length || new Set(input.rateIds).size !== input.rateIds.length)
    return err({ code: "INVALID_INPUT", message: "Provide exactly one unique rate identity per applicable option" });
  const quotation: Quotation = { id: header.data.id as QuotationId, companyId: header.data.companyId as CompanyId,
    destination: destination.data, createdAt: new Date(header.data.createdAt) };
  return ok({ quotation, rates: applicable.map((entry, index): QuotedDeliveryRate => {
    const rate = {
      id: header.data.rateIds[index] as DeliveryRateId, companyId: quotation.companyId, quotationId: quotation.id,
      price: { ...entry.option.price }, settingsVersion: settings.data.version as DeliverySettingsVersion,
      createdAt: new Date(quotation.createdAt), optionId: entry.option.id, districtCode: destination.data.districtCode,
    };
    return "agencies" in entry ? { rate: { ...rate, method: "agency" }, name: entry.option.name, zoneName: entry.zone.name, agencies: entry.agencies }
      : { rate: { ...rate, method: "home" }, name: entry.option.name, zoneName: entry.zone.name };
  }) });
}
