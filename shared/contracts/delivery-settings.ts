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
export const courierCatalogSchema = z.strictObject({
  couriers: z.array(z.strictObject({ id: z.uuid(), code: z.string().min(1).max(40), name: z.string().trim().min(1).max(120) })),
});
export type CourierCatalogResponse = z.infer<typeof courierCatalogSchema>;
export const companyCourierSchema = z.strictObject({
  id: z.uuid(), courierId: z.uuid(), name: z.string().trim().min(1).max(120), enabled: z.boolean(),
});
export const courierInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), courierId: z.uuid(), enabled: z.boolean() }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), enabled: z.boolean() }),
]);
export const deliverySettingsSchema = z.strictObject({
  version: z.number().int().min(0).max(2147483647),
  agency: z.strictObject({ enabled: z.boolean() }),
  couriers: z.array(companyCourierSchema),
  home: z.strictObject({ enabled: z.boolean() }),
  store: storeDeliverySettingsSchema,
}).refine(value => new Set(value.couriers.map(courier => courier.id)).size === value.couriers.length
  && new Set(value.couriers.map(courier => courier.courierId)).size === value.couriers.length && (!value.agency.enabled || value.couriers.some(courier => courier.enabled)));
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

const peruDistrictCodeSchema = z.string().regex(/^\d{6}$/);
const optionFields = { name: z.string().trim().min(1).max(120), enabled: z.boolean(), price: moneySchema };
export const deliveryOptionSchema = z.discriminatedUnion("method", [
  z.strictObject({ id: z.uuid(), method: z.literal("home"), ...optionFields }),
  z.strictObject({ id: z.uuid(), method: z.literal("agency"), ...optionFields, agencyIds: z.array(z.uuid()) }),
]);
export const deliveryZoneSchema = z.strictObject({
  id: z.uuid(), name: z.string().min(1).max(120), enabled: z.boolean(),
  districtCodes: z.array(peruDistrictCodeSchema).min(1), options: z.array(deliveryOptionSchema),
});
export const deliveryZonesSchema = z.strictObject({
  home: z.strictObject({ enabled: z.boolean() }), agency: z.strictObject({ enabled: z.boolean() }),
  version: z.number().int().min(0).max(2147483647), currency: z.enum(currencies), zones: z.array(deliveryZoneSchema),
});
const optionInputFields = { name: z.string(), enabled: z.boolean(), price: moneySchema };
const homeOptionInput = { method: z.literal("home"), ...optionInputFields };
const agencyOptionInput = { method: z.literal("agency"), ...optionInputFields, agencyIds: z.array(z.uuid()) };
export const deliveryOptionInputSchema = z.union([
  z.strictObject({ kind: z.literal("new"), ...homeOptionInput }),
  z.strictObject({ kind: z.literal("new"), ...agencyOptionInput }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), ...homeOptionInput }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), ...agencyOptionInput }),
]);
const zoneInputFields = { name: z.string(), enabled: z.boolean(), districtCodes: z.array(peruDistrictCodeSchema), options: z.array(deliveryOptionInputSchema) };
export const deliveryZoneInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), ...zoneInputFields }),
  z.strictObject({ kind: z.literal("existing"), id: z.uuid(), ...zoneInputFields }),
]);
export const saveDeliveryZonesSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483646), zones: z.array(deliveryZoneInputSchema),
});
export type DeliveryOptionContract = z.infer<typeof deliveryOptionSchema>;
export type DeliveryOptionInputContract = z.infer<typeof deliveryOptionInputSchema>;
export type DeliveryZonesResponse = z.infer<typeof deliveryZonesSchema>;
export type SaveDeliveryZonesRequest = z.infer<typeof saveDeliveryZonesSchema>;
export const deliveryZonesApiErrorSchema = z.strictObject({
  code: z.enum(["INVALID_INPUT", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE", "INVALID_DELIVERY_ZONE", "INVALID_DELIVERY_OPTION", "INVALID_DELIVERY_SETTINGS",
    "DELIVERY_SETTINGS_CONFLICT", "UNSUPPORTED_COUNTRY", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]),
  error: z.string(), currentVersion: z.number().int().min(0).max(2147483647).optional(),
  reason: z.enum(["stale_version", "concurrent_creation"]).optional(),
  field: z.enum(["id", "name", "enabled", "districtCodes", "zones", "options", "method", "price", "agencyIds"]).optional(),
  index: z.number().int().nonnegative().safe().optional(),
  optionIndex: z.number().int().nonnegative().safe().optional(),
});
