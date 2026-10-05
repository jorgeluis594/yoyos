import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type PickupPoint = Readonly<{ name: string; address: string; instructions: string | null }>;
export type CourierId = string & { readonly __brand: "CourierId" };
export type StoreDeliverySettings =
  | Readonly<{ enabled: false; pickupPoint: PickupPoint | null }>
  | Readonly<{ enabled: true; pickupPoint: PickupPoint }>;
export type DeliverySettings = Readonly<{ version: number; home: Readonly<{ enabled: boolean }>; store: StoreDeliverySettings }>;
export type DeliverySettingsReadError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type DeliverySettingsError = DeliverySettingsReadError | Readonly<{
  code: "INVALID_DELIVERY_SETTINGS" | "DELIVERY_SETTINGS_CONFLICT";
  message: string;
  currentVersion?: number;
  reason?: "stale_version" | "concurrent_creation";
}>;

const pickupPoint = z.strictObject({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(1000).nullable(),
});
const store = z.discriminatedUnion("enabled", [
  z.strictObject({ enabled: z.literal(false), pickupPoint: pickupPoint.nullable() }),
  z.strictObject({ enabled: z.literal(true), pickupPoint }),
]);
const settings = z.strictObject({ version: z.number().int().min(0).max(2147483647), home: z.strictObject({ enabled: z.boolean() }), store });

export function parseDeliverySettings(value: unknown): Result<DeliverySettings, DeliverySettingsError> {
  const parsed = settings.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid delivery settings" });
}

export function initialDeliverySettings(): DeliverySettings {
  return { version: 0, home: { enabled: false }, store: { enabled: false, pickupPoint: null } };
}
