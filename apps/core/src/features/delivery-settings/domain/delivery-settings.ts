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
export type CourierInput =
  | Readonly<{ kind: "new"; catalogId: CourierCatalogId; enabled: boolean }>
  | Readonly<{ kind: "existing"; id: CourierId; enabled: boolean }>;

const courierInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), catalogId: courierCatalogId, enabled: z.boolean() }),
  z.strictObject({ kind: z.literal("existing"), id: courierId, enabled: z.boolean() }),
]);

export function parseCourierInputs(value: unknown): Result<readonly CourierInput[], DeliverySettingsError> {
  const parsed = z.array(courierInput).safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid couriers" });
}

export function parseCourierCatalogEntry(value: unknown): Result<CourierCatalogEntry, DeliverySettingsReadError> {
  const parsed = z.strictObject({ id: courierCatalogId, code: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/).max(40).transform(code => code as CourierCode), name: courierName }).safeParse(value);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_STORED_DATA", message: "Stored courier catalog is invalid" });
}

export function prepareCouriers(input: Readonly<{ couriers: readonly CourierInput[] }>,
  current: readonly Courier[], catalog: readonly CourierCatalogEntry[], generateId: () => CourierId): Result<readonly Courier[], DeliverySettingsError> {
  const parsed = z.strictObject({ couriers: z.array(courierInput) }).safeParse(input);
  if (!parsed.success) return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid couriers" });
  const existing = new Map(current.map(courier => [courier.id, courier]));
  const retained = new Set<string>();
  for (const courier of parsed.data.couriers) {
    if (courier.kind === "new") continue;
    if (!existing.has(courier.id) || retained.has(courier.id))
      return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Courier identity does not match the current configuration" });
    retained.add(courier.id);
  }
  if (retained.size !== existing.size) return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Existing couriers must be retained" });
  const catalogById = new Map(catalog.map(entry => [entry.id, entry]));
  const couriers: Courier[] = [];
  for (const courier of parsed.data.couriers) {
    if (courier.kind === "existing") { couriers.push({ ...existing.get(courier.id)!, enabled: courier.enabled }); continue; }
    const entry = catalogById.get(courier.catalogId);
    if (!entry) return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Courier is not available in the catalog" });
    couriers.push({ id: generateId(), catalogId: entry.id, name: entry.name, enabled: courier.enabled, catalogEnabled: true });
  }
  if (new Set(couriers.map(courier => courier.catalogId)).size !== couriers.length)
    return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Couriers cannot be duplicated" });
  if (new Set(couriers.map(courier => courier.id)).size !== couriers.length || couriers.some(courier => !z.uuid().safeParse(courier.id).success))
    return err({ code: "INVALID_DELIVERY_SETTINGS", message: "Generated courier identities must be unique UUIDs" });
  return ok(couriers);
}

/** Derives the company couriers from the catalog couriers the company ships with, adding the ones it lacks; a courier missing from the catalog is never enabled. */
export function syncCouriers(current: readonly Courier[], catalogIds: readonly CourierCatalogId[], catalog: readonly CourierCatalogEntry[],
  generateId: () => CourierId): readonly Courier[] {
  const wanted = new Set(catalog.filter(entry => catalogIds.includes(entry.id)).map(entry => entry.id));
  const added = catalog.filter(entry => wanted.has(entry.id) && !current.some(courier => courier.catalogId === entry.id))
    .map(entry => ({ id: generateId(), catalogId: entry.id, name: entry.name, enabled: true, catalogEnabled: true }));
  return [...current.map(courier => ({ ...courier, enabled: wanted.has(courier.catalogId) })), ...added];
}
