import { z } from "zod";

export const pickupPointSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(1000).nullable(),
});
export const storeDeliverySettingsSchema = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false), pickupPoint: pickupPointSchema.nullable() }),
  z.strictObject({ enabled: z.literal(true), pickupPoint: pickupPointSchema }),
]);
export const deliverySettingsSchema = z.strictObject({
  version: z.number().int().min(0).max(2147483647),
  home: z.strictObject({ enabled: z.boolean() }),
  store: storeDeliverySettingsSchema,
});
export type DeliverySettingsResponse = z.infer<typeof deliverySettingsSchema>;
export const saveDeliverySettingsSchema = z.strictObject({
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
