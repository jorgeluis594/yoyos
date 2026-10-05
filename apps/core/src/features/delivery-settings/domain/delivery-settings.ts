import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type PickupPoint = Readonly<{ name: string; address: string; instructions: string | null }>;
export type CourierId = string & { readonly __brand: "CourierId" };
export type StoreDeliverySettings =
  | Readonly<{ enabled: false; pickupPoint: PickupPoint | null }>
  | Readonly<{ enabled: true; pickupPoint: PickupPoint }>;
export type DeliverySettings = Readonly<{ version: number; home: Readonly<{ enabled: boolean }>; agency: Readonly<{ enabled: boolean }>; couriers: readonly Courier[]; store: StoreDeliverySettings }>;
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
const courierName = z.string().trim().min(1).max(120);
const courierId = z.uuid().transform(value => value as CourierId);
const settings = z.strictObject({
  version: z.number().int().min(0).max(2147483647),
  home: z.strictObject({ enabled: z.boolean() }),
  agency: z.strictObject({ enabled: z.boolean() }),
  couriers: z.array(z.strictObject({ id: courierId, name: courierName, enabled: z.boolean() })),
  store,
}).refine(value => new Set(value.couriers.map(courier => courier.id)).size === value.couriers.length && (!value.agency.enabled || value.couriers.some(courier => courier.enabled)));

export function parseDeliverySettings(value: unknown): Result<DeliverySettings, DeliverySettingsError> {
  const parsed = settings.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid delivery settings" });
}

export function initialDeliverySettings(): DeliverySettings {
  return { version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } };
}

export type Courier = Readonly<{ id: CourierId; name: string; enabled: boolean }>;
export type CourierInput =
  | Readonly<{ kind: "new"; name: string; enabled: boolean }>
  | Readonly<{ kind: "existing"; id: CourierId; name: string; enabled: boolean }>;

const courierInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), name: courierName, enabled: z.boolean() }),
  z.strictObject({ kind: z.literal("existing"), id: courierId, name: courierName, enabled: z.boolean() }),
]);

export function parseCourierInputs(value: unknown): Result<readonly CourierInput[], DeliverySettingsError> {
  const parsed = z.array(courierInput).safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid couriers" });
}

export function prepareCouriers(input: Readonly<{ agencyEnabled: boolean; couriers: readonly CourierInput[] }>,
  current: readonly Courier[], generateId: () => CourierId): Result<readonly Courier[], DeliverySettingsError> {
  const parsed = z.strictObject({ agencyEnabled: z.boolean(), couriers: z.array(courierInput) }).safeParse(input);
  if (!parsed.success) return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid couriers" });
  const existing = new Set(current.map(courier => courier.id));
  const retained = new Set<string>();
  for (const courier of parsed.data.couriers) {
    if (courier.kind === "new") continue;
    if (!existing.has(courier.id) || retained.has(courier.id))
      return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Courier identity does not match the current configuration" });
    retained.add(courier.id);
  }
  if (retained.size !== existing.size) return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Existing couriers must be retained" });
  if (parsed.data.agencyEnabled && !parsed.data.couriers.some(courier => courier.enabled))
    return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Agency delivery requires an enabled courier" });
  const couriers = parsed.data.couriers.map(courier => ({ id: courier.kind === "existing" ? courier.id : generateId(), name: courier.name, enabled: courier.enabled }));
  if (new Set(couriers.map(courier => courier.id)).size !== couriers.length || couriers.some(courier => !z.uuid().safeParse(courier.id).success))
    return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Generated courier identities must be unique UUIDs" });
  return ok(couriers);
}
