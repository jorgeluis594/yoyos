import { z } from "zod";
import { err, ok } from "@shared/functional";
import { getPeruDistrict, type PeruDistrictCode } from "@shared/peru-geography";
import type { Currency, Money } from "@shared/money";
import type { Result } from "@shared/result";
import { parseDeliveryPrice } from "@core/src/features/delivery-settings/domain/delivery-price";

export type DeliveryZoneId = string & { readonly __brand: "DeliveryZoneId" };
export type ZonedDeliveryMethod = "home" | "agency";
export type DeliveryZone = Readonly<{
  id: DeliveryZoneId;
  method: ZonedDeliveryMethod;
  name: string;
  enabled: boolean;
  districtCodes: readonly [PeruDistrictCode, ...PeruDistrictCode[]];
  price: Money;
}>;
export type DeliveryZoneInput =
  | Readonly<{ kind: "new"; name: string; enabled: boolean; districtCodes: readonly string[]; price: Money }>
  | Readonly<{ kind: "existing"; id: string; name: string; enabled: boolean; districtCodes: readonly string[]; price: Money }>;
export type DeliveryZoneError = Readonly<{
  code: "INVALID_DELIVERY_ZONE";
  message: string;
  field?: "id" | "method" | "name" | "enabled" | "districtCodes" | "price" | "zones";
  index?: number;
}>;

const idSchema = z.uuid().transform(value => value as DeliveryZoneId);
const methodSchema = z.enum(["home", "agency"]);
const fields = {
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  districtCodes: z.array(z.string().refine(value => getPeruDistrict(value) !== null)
    .transform(value => value as PeruDistrictCode)).min(1)
    .refine(values => new Set(values).size === values.length)
    .transform(([first, ...rest]): readonly [PeruDistrictCode, ...PeruDistrictCode[]] => [first, ...rest]),
  price: z.unknown(),
};
const zoneSchema = z.strictObject({ id: idSchema, method: methodSchema, ...fields });
const inputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), ...fields }),
  z.strictObject({ kind: z.literal("existing"), id: idSchema, ...fields }),
]);

export function parseDeliveryZone(value: unknown, currency: Currency): Result<DeliveryZone, DeliveryZoneError> {
  const parsed = zoneSchema.safeParse(value);
  if (!parsed.success) return err({ code: "INVALID_DELIVERY_ZONE", message: "A zone requires an identity, shipping method, name and unique Peru districts" });
  const price = parseDeliveryPrice(parsed.data.price, currency);
  return price.success ? ok({ ...parsed.data, price: price.data })
    : err({ code: "INVALID_DELIVERY_ZONE", field: "price", message: price.error.message });
}

export function prepareDeliveryZones(input: Readonly<{ method: ZonedDeliveryMethod; zones: readonly DeliveryZoneInput[] }>,
  current: readonly DeliveryZone[], currency: Currency, generateId: () => string): Result<readonly DeliveryZone[], DeliveryZoneError> {
  const parsed = z.strictObject({ method: methodSchema, zones: z.array(inputSchema) }).safeParse(input);
  if (!parsed.success) {
    const path = parsed.error.issues[0].path;
    const index = path[0] === "zones" && typeof path[1] === "number" ? path[1] : undefined;
    const field = (["id", "method", "name", "enabled", "districtCodes", "price", "zones"] as const)
      .find(field => field === path[index === undefined ? 0 : 2]);
    return err({ code: "INVALID_DELIVERY_ZONE", message: "Invalid delivery zones", field, index });
  }
  const existing = new Set(current.filter(zone => zone.method === parsed.data.method).map(zone => zone.id));
  const retained = new Set<string>();
  for (const [index, zone] of parsed.data.zones.entries()) {
    if (zone.kind === "new") continue;
    if (!existing.has(zone.id) || retained.has(zone.id))
      return err({ code: "INVALID_DELIVERY_ZONE", field: "id", index, message: "Zone identity does not match the edited method's current configuration" });
    retained.add(zone.id);
  }
  if (retained.size !== existing.size)
    return err({ code: "INVALID_DELIVERY_ZONE", field: "zones", message: "Existing zones must be retained; disable a zone to remove its rate" });
  const zones: DeliveryZone[] = [];
  const seen = new Set(current.filter(zone => zone.method !== parsed.data.method).map(zone => zone.id));
  for (const [index, zone] of parsed.data.zones.entries()) {
    const result = parseDeliveryZone({ id: zone.kind === "existing" ? zone.id : generateId(), method: parsed.data.method,
      name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes, price: zone.price }, currency);
    if (!result.success) return err({ ...result.error, index });
    if (seen.has(result.data.id)) return err({ code: "INVALID_DELIVERY_ZONE", field: "id", index, message: "Zone identities must be unique" });
    seen.add(result.data.id);
    zones.push(result.data);
  }
  return ok([...current.filter(zone => zone.method !== parsed.data.method), ...zones]);
}
