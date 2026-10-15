import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type PickupPoint = Readonly<{ name: string; address: string; instructions: string | null }>;
export type CourierId = string & { readonly __brand: "CourierId" };
export type CourierCatalogId = string & { readonly __brand: "CourierCatalogId" };
export type CourierCode = string & { readonly __brand: "CourierCode" };
export type CourierCatalogEntry = Readonly<{ id: CourierCatalogId; code: CourierCode; name: string }>;
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
const courierCatalogId = z.uuid().transform(value => value as CourierCatalogId);
const settings = z.strictObject({
  version: z.number().int().min(0).max(2147483647),
  home: z.strictObject({ enabled: z.boolean() }),
  agency: z.strictObject({ enabled: z.boolean() }),
  couriers: z.array(z.strictObject({ id: courierId, catalogId: courierCatalogId, name: courierName, enabled: z.boolean(), catalogEnabled: z.boolean() })),
  store,
}).refine(value => new Set(value.couriers.map(courier => courier.id)).size === value.couriers.length
  && new Set(value.couriers.map(courier => courier.catalogId)).size === value.couriers.length);

export function parseDeliverySettings(value: unknown): Result<DeliverySettings, DeliverySettingsError> {
  const parsed = settings.safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid delivery settings" });
}

export function initialDeliverySettings(): DeliverySettings {
  return { version: 0, agency: { enabled: false }, couriers: [], home: { enabled: false }, store: { enabled: false, pickupPoint: null } };
}

export type Courier = Readonly<{ id: CourierId; catalogId: CourierCatalogId; name: string; enabled: boolean; catalogEnabled: boolean }>;

export function parseCourierCatalogEntry(value: unknown): Result<CourierCatalogEntry, DeliverySettingsReadError> {
  const parsed = z.strictObject({ id: courierCatalogId, code: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/).max(40).transform(code => code as CourierCode), name: courierName }).safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_STORED_DATA", message: "Stored courier catalog is invalid" });
}

/** Derives the company couriers from the agency options: every referenced courier gets one, enabled only when an enabled option in an enabled zone ships with it; a courier missing from the catalog is never enabled. */
export function syncCouriers(current: readonly Courier[], referenced: readonly CourierCatalogId[], shipping: readonly CourierCatalogId[],
  catalog: readonly CourierCatalogEntry[], generateId: () => CourierId): readonly Courier[] {
  const wanted = new Set(catalog.filter(entry => shipping.includes(entry.id)).map(entry => entry.id));
  const added = catalog.filter(entry => referenced.includes(entry.id) && !current.some(courier => courier.catalogId === entry.id))
    .map(entry => ({ id: generateId(), catalogId: entry.id, name: entry.name, enabled: wanted.has(entry.id), catalogEnabled: true }));
  return [...current.map(courier => ({ ...courier, enabled: wanted.has(courier.catalogId) })), ...added];
}
