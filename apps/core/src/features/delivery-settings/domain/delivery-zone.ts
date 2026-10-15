import { z } from "zod";
import { err, ok } from "@shared/functional";
import { getPeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import { parseDeliveryPrice } from "@core/src/features/delivery-settings/domain/delivery-price";
import type { DeliveryAgency, DeliveryAgencyId } from "@core/src/features/delivery-settings/domain/delivery-agency";

export type DeliveryZoneId = string & { readonly __brand: "DeliveryZoneId" };
export type DeliveryOptionId = string & { readonly __brand: "DeliveryOptionId" };
export type DeliveryMethodWithRate = "home" | "agency";
type DeliveryOptionBase = Readonly<{ id: DeliveryOptionId; zoneId: DeliveryZoneId; name: string; enabled: boolean; price: Money }>;
export type HomeDeliveryOption = DeliveryOptionBase & Readonly<{ method: "home" }>;
export type AgencyDeliveryOption = DeliveryOptionBase & Readonly<{ method: "agency"; agencyIds: readonly DeliveryAgencyId[] }>;
export type DeliveryOption = HomeDeliveryOption | AgencyDeliveryOption;
export type DeliveryZone = Readonly<{
  id: DeliveryZoneId;
  name: string;
  enabled: boolean;
  districtCodes: readonly [PeruDistrictCode, ...PeruDistrictCode[]];
  options: readonly DeliveryOption[];
}>;
type OptionInputFields = Readonly<{ name: string; enabled: boolean; price: Money }>;
export type DeliveryOptionInput = (Readonly<{ kind: "new" }> | Readonly<{ kind: "existing"; id: string }>) & OptionInputFields
  & (Readonly<{ method: "home" }> | Readonly<{ method: "agency"; agencyIds: readonly string[] }>);
export type DeliveryZoneInput = (Readonly<{ kind: "new" }> | Readonly<{ kind: "existing"; id: string }>)
  & Readonly<{ name: string; enabled: boolean; districtCodes: readonly string[]; options: readonly DeliveryOptionInput[] }>;
export type DeliveryZoneError = Readonly<{
  code: "INVALID_DELIVERY_ZONE" | "INVALID_DELIVERY_OPTION";
  message: string;
  field?: "id" | "name" | "enabled" | "districtCodes" | "zones" | "options" | "method" | "price" | "agencyIds";
  index?: number;
  optionIndex?: number;
}>;

const zoneId = z.uuid().transform(value => value as DeliveryZoneId);
const optionId = z.uuid().transform(value => value as DeliveryOptionId);
const agencyId = z.uuid().transform(value => value as DeliveryAgencyId);
const optionFields = { name: z.string().trim().min(1).max(120), enabled: z.boolean(), price: z.unknown() };
const optionSchema = z.discriminatedUnion("method", [
  z.strictObject({ id: optionId, zoneId, method: z.literal("home"), ...optionFields }),
  z.strictObject({ id: optionId, zoneId, method: z.literal("agency"), ...optionFields,
    agencyIds: z.array(agencyId).refine(values => new Set(values).size === values.length) }),
]);
const zoneFields = {
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  districtCodes: z.array(z.string().refine(value => getPeruDistrict(value) !== null)
    .transform(value => value as PeruDistrictCode)).min(1)
    .refine(values => new Set(values).size === values.length)
    .transform(([first, ...rest]): readonly [PeruDistrictCode, ...PeruDistrictCode[]] => [first, ...rest]),
};
const zoneSchema = z.strictObject({ id: zoneId, ...zoneFields, options: z.array(z.unknown()) });
const inputFields = { name: z.string(), enabled: z.boolean(), price: z.unknown() };
const optionInputSchema = z.union([
  z.strictObject({ kind: z.literal("new"), method: z.literal("home"), ...inputFields }),
  z.strictObject({ kind: z.literal("new"), method: z.literal("agency"), ...inputFields, agencyIds: z.array(z.string()) }),
  z.strictObject({ kind: z.literal("existing"), id: z.string(), method: z.literal("home"), ...inputFields }),
  z.strictObject({ kind: z.literal("existing"), id: z.string(), method: z.literal("agency"), ...inputFields, agencyIds: z.array(z.string()) }),
]);
const zoneInputFields = { name: z.string(), enabled: z.boolean(), districtCodes: z.array(z.string()), options: z.array(optionInputSchema) };
const inputSchema = z.array(z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), ...zoneInputFields }),
  z.strictObject({ kind: z.literal("existing"), id: z.string(), ...zoneInputFields }),
]));

export function parseDeliveryZone(value: unknown, currency: Currency): Result<DeliveryZone, DeliveryZoneError> {
  const parsed = zoneSchema.safeParse(value);
  if (!parsed.success) {
    const field = (["id", "name", "enabled", "districtCodes"] as const).find(field => field === parsed.error.issues[0].path[0]);
    return err({ code: "INVALID_DELIVERY_ZONE", field, message: "A zone requires an identity, name and unique Peru districts" });
  }
  const options: DeliveryOption[] = [];
  for (const [optionIndex, raw] of parsed.data.options.entries()) {
    const option = optionSchema.safeParse(typeof raw === "object" && raw !== null ? { ...raw, zoneId: parsed.data.id } : raw);
    if (!option.success) return err({ code: "INVALID_DELIVERY_OPTION", optionIndex, message: "An option requires an identity, method, name and unique agencies" });
    const price = parseDeliveryPrice(option.data.price, currency);
    if (!price.success) return err({ code: "INVALID_DELIVERY_OPTION", field: "price", optionIndex, message: price.error.message });
    options.push({ ...option.data, price: price.data });
  }
  return ok({ ...parsed.data, options });
}

export type PrepareDeliveryZonesContext = Readonly<{
  current: readonly DeliveryZone[]; agencies: readonly DeliveryAgency[]; currency: Currency;
  generateZoneId: () => string; generateOptionId: () => string;
}>;

function invalidInput(issuePath: readonly PropertyKey[]): DeliveryZoneError {
  const index = typeof issuePath[0] === "number" ? issuePath[0] : undefined;
  if (issuePath[1] !== "options") {
    const field = (["id", "name", "enabled", "districtCodes"] as const).find(field => field === issuePath[1]);
    return { code: "INVALID_DELIVERY_ZONE", message: "Invalid delivery zones", field, index };
  }
  const optionIndex = typeof issuePath[2] === "number" ? issuePath[2] : undefined;
  const field = (["id", "name", "enabled", "price", "method", "agencyIds"] as const).find(field => field === issuePath[3]);
  return { code: "INVALID_DELIVERY_OPTION", message: "Invalid delivery option", field, index, optionIndex };
}

export function prepareDeliveryZones(input: readonly DeliveryZoneInput[], context: PrepareDeliveryZonesContext): Result<readonly DeliveryZone[], DeliveryZoneError> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return err(invalidInput(parsed.error.issues[0].path));
  const currentOptions = new Map(context.current.flatMap(zone => zone.options.map(option => [option.id as string, option] as const)));
  const zoneIds = new Set<string>();
  const optionIds = new Set<string>();
  for (const [index, zone] of parsed.data.entries()) {
    if (zone.kind === "existing") {
      if (!context.current.some(value => value.id === zone.id) || zoneIds.has(zone.id))
        return err({ code: "INVALID_DELIVERY_ZONE", field: "id", index, message: "Zone identity does not match the current configuration" });
      zoneIds.add(zone.id);
    }
    for (const [optionIndex, option] of zone.options.entries()) {
      if (option.kind === "new") continue;
      if (!currentOptions.has(option.id) || optionIds.has(option.id))
        return err({ code: "INVALID_DELIVERY_OPTION", field: "id", index, optionIndex, message: "Option identity does not match the current configuration" });
      optionIds.add(option.id);
    }
  }
  if (context.current.some(zone => !zoneIds.has(zone.id)))
    return err({ code: "INVALID_DELIVERY_ZONE", field: "zones", message: "Existing zones must be retained; disable a zone instead" });
  if ([...currentOptions.keys()].some(id => !optionIds.has(id)))
    return err({ code: "INVALID_DELIVERY_OPTION", field: "options", message: "Existing options must be retained; disable an option instead" });
  const agencies = new Map(context.agencies.map(agency => [agency.id as string, agency]));
  const seenZones = new Set<string>();
  const seenOptions = new Set<string>();
  const zones: DeliveryZone[] = [];
  for (const [index, zone] of parsed.data.entries()) {
    const id = zone.kind === "existing" ? zone.id : context.generateZoneId();
    const options = zone.options.map(option => ({ id: option.kind === "existing" ? option.id : context.generateOptionId(), zoneId: id,
      method: option.method, name: option.name, enabled: option.enabled, price: option.price,
      ...(option.method === "agency" ? { agencyIds: option.agencyIds } : {}) }));
    const result = parseDeliveryZone({ id, name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes, options }, context.currency);
    if (!result.success) return err({ ...result.error, index });
    if (seenZones.has(result.data.id)) return err({ code: "INVALID_DELIVERY_ZONE", field: "id", index, message: "Zone identities must be unique" });
    seenZones.add(result.data.id);
    const names = new Set<string>();
    for (const [optionIndex, option] of result.data.options.entries()) {
      const original = zone.options[optionIndex];
      const stored = original.kind === "existing" ? currentOptions.get(original.id) : undefined;
      if (stored && (stored.zoneId !== result.data.id || stored.method !== option.method))
        return err({ code: "INVALID_DELIVERY_OPTION", field: stored.zoneId !== result.data.id ? "id" : "method", index, optionIndex, message: "An existing option cannot change its zone or method" });
      if (seenOptions.has(option.id)) return err({ code: "INVALID_DELIVERY_OPTION", field: "id", index, optionIndex, message: "Option identities must be unique" });
      seenOptions.add(option.id);
      const key = option.name.toLowerCase();
      if (names.has(key)) return err({ code: "INVALID_DELIVERY_OPTION", field: "name", index, optionIndex, message: "Option names must be unique within a zone" });
      names.add(key);
      if (option.method !== "agency") continue;
      const couriersOf = new Set(option.agencyIds.map(id => agencies.get(id)?.courierId));
      if (couriersOf.has(undefined)) return err({ code: "INVALID_DELIVERY_OPTION", field: "agencyIds", index, optionIndex, message: "An option's agencies must exist" });
      const previous = stored?.method === "agency" ? stored.agencyIds : undefined;
      if (!previous && option.agencyIds.length === 0)
        return err({ code: "INVALID_DELIVERY_OPTION", field: "agencyIds", index, optionIndex, message: "A new agency option requires agencies" });
      // Options stored before the single-courier rule may mix couriers: they stay saveable until their agencies change.
      const changed = !previous || previous.length !== option.agencyIds.length || option.agencyIds.some(id => !previous.includes(id));
      if (changed && couriersOf.size > 1)
        return err({ code: "INVALID_DELIVERY_OPTION", field: "agencyIds", index, optionIndex, message: "An option's agencies must belong to a single courier" });
    }
    zones.push(result.data);
  }
  return ok(zones);
}
