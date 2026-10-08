import { z } from "zod";
import { currencies } from "@shared/money";
import { moneySchema } from "@shared/contracts/money";

export const pickupPointSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(1000).nullable(),
});
export const storeDeliverySettingsSchema = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false), pickupPoint: pickupPointSchema.nullable() }),
  z.strictObject({ enabled: z.literal(true), pickupPoint: pickupPointSchema }),
]);
const courierNameSchema = z.string().trim().min(1).max(120);
const courierSchema = z.strictObject({ id: z.uuid(), name: courierNameSchema, enabled: z.boolean() });
export const courierInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), name: courierNameSchema, enabled: z.boolean() }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), name: courierNameSchema, enabled: z.boolean() }),
]);
export const deliverySettingsSchema = z.strictObject({
  version: z.number().int().min(0).max(2147483647),
  agency: z.strictObject({ enabled: z.boolean() }),
  couriers: z.array(courierSchema),
  home: z.strictObject({ enabled: z.boolean() }),
  store: storeDeliverySettingsSchema,
}).refine(value => new Set(value.couriers.map(courier => courier.id)).size === value.couriers.length && (!value.agency.enabled || value.couriers.some(courier => courier.enabled)));
export type DeliverySettingsResponse = z.infer<typeof deliverySettingsSchema>;
export const saveDeliverySettingsSchema = z.strictObject({
  agency: z.strictObject({ enabled: z.boolean() }),
  couriers: z.array(courierInputSchema),
  expectedVersion: z.number().int().min(0).max(2147483646),
  home: z.strictObject({ enabled: z.boolean() }),
  store: storeDeliverySettingsSchema,
});
export type SaveDeliverySettingsRequest = z.infer<typeof saveDeliverySettingsSchema>;
export const deliverySettingsApiErrorSchema = z.strictObject({
  code: z.enum(["INVALID_INPUT", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE", "INVALID_DELIVERY_SETTINGS",
    "DELIVERY_SETTINGS_CONFLICT", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]),
  error: z.string(),
  issues: z.array(z.strictObject({ field: z.string(), reason: z.string() })).optional(),
});

const zonedMethodSchema = z.enum(["home", "agency"]);
export const deliveryZoneSchema = z.strictObject({
  id: z.uuid(), method: zonedMethodSchema, name: z.string().min(1).max(120), enabled: z.boolean(),
  districtCodes: z.array(z.string().regex(/^\d{6}$/)).min(1), price: moneySchema,
});
export const deliveryZonesSchema = z.strictObject({
  home: z.strictObject({ enabled: z.boolean() }), agency: z.strictObject({ enabled: z.boolean() }),
  version: z.number().int().min(0).max(2147483647), currency: z.enum(currencies), zones: z.array(deliveryZoneSchema),
});
const zoneWriteFields = { name: z.string(), enabled: z.boolean(), districtCodes: z.array(z.string().regex(/^\d{6}$/)), price: moneySchema };
export const deliveryZoneInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), ...zoneWriteFields }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), ...zoneWriteFields }),
]);
export const saveDeliveryZonesSchema = z.strictObject({
  method: zonedMethodSchema, expectedVersion: z.number().int().min(0).max(2147483646), zones: z.array(deliveryZoneInputSchema),
});
export type DeliveryZonesResponse = z.infer<typeof deliveryZonesSchema>;
export type SaveDeliveryZonesRequest = z.infer<typeof saveDeliveryZonesSchema>;
export const deliveryZonesApiErrorSchema = z.strictObject({
  code: z.enum(["INVALID_INPUT", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE", "INVALID_DELIVERY_ZONE", "INVALID_DELIVERY_SETTINGS",
    "DELIVERY_SETTINGS_CONFLICT", "UNSUPPORTED_COUNTRY", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]),
  error: z.string(), currentVersion: z.number().int().min(0).max(2147483647).optional(),
  reason: z.enum(["stale_version", "concurrent_creation"]).optional(),
  field: z.enum(["id", "method", "name", "enabled", "districtCodes", "price", "zones"]).optional(),
  index: z.number().int().nonnegative().safe().optional(),
});
