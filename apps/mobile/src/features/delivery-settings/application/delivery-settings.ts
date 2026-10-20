import type { DeliverySettingsResponse, SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type DeliverySettingsError = Readonly<{
  code: TransportError["code"] | "INVALID_INPUT" | "INVALID_DELIVERY_SETTINGS" | "DELIVERY_SETTINGS_CONFLICT" | "PAYLOAD_TOO_LARGE";
  message: string;
}>;
export type DeliveryZonesError = Readonly<{
  code: DeliverySettingsError["code"] | "INVALID_DELIVERY_ZONE" | "INVALID_DELIVERY_OPTION" | "UNSUPPORTED_COUNTRY" | "UNSUPPORTED_MEDIA_TYPE";
  message: string;
  currentVersion?: number;
  reason?: "stale_version" | "concurrent_creation";
  field?: "id" | "name" | "enabled" | "departmentCodes" | "provinceCodes" | "districtCodes" | "zones" | "options" | "method" | "price" | "agencyIds";
  index?: number;
  optionIndex?: number;
}>;
export type DeliveryOptionDraft = Readonly<{ name: string; amount: string; enabled: boolean }>
  & ({ kind: "existing"; id: string } | { kind: "new"; localKey: number })
  & ({ method: "home" } | { method: "agency"; agencyIds: readonly string[] });
export type Confirmed = Pick<DeliverySettingsResponse, "version" | "home" | "agency" | "store">;
type Store = SaveDeliverySettingsRequest["store"];
export type SaveTarget = "store" | "home" | "agency";
export type PickupField = "name" | "address" | "instructions";
export type PickupDraft = Readonly<Record<PickupField, string>>;
export type SettingsChange = Readonly<{ method: "home" | "agency"; enabled: boolean }> | Readonly<{ method: "store"; store: Store }>;
// Mobile has no in-doubt state: `fetch` cannot tell a lost response from an unsent request, and both retry with the same version.
export type RowSaveState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "saving"; attempt: number }>
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "failed"; reason: "not_sent"; retry: SaveDeliverySettingsRequest }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "conflict" }>;
export type PickupCommit =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "save"; store: Store }>
  | Readonly<{ kind: "invalid"; fields: readonly ("name" | "address")[] }>;

/** The confirmed settings with exactly one change applied: the server replaces the whole settings, guarded by the version. */
export function settingsRequest(confirmed: Confirmed, change: SettingsChange): SaveDeliverySettingsRequest {
  const request = { expectedVersion: confirmed.version, home: confirmed.home, agency: confirmed.agency, store: confirmed.store };
  return change.method === "store" ? { ...request, store: change.store } : { ...request, [change.method]: { enabled: change.enabled } };
}

export const pickupOf = (point: Confirmed["store"]["pickupPoint"]): PickupDraft =>
  ({ name: point?.name ?? "", address: point?.address ?? "", instructions: point?.instructions ?? "" });
const trimmed = (draft: PickupDraft): PickupDraft => ({ name: draft.name.trim(), address: draft.address.trim(), instructions: draft.instructions.trim() });
export const samePickup = (a: PickupDraft, b: PickupDraft) => {
  const [x, y] = [trimmed(a), trimmed(b)];
  return x.name === y.name && x.address === y.address && x.instructions === y.instructions;
};

/** What saving the pickup text means for the confirmed settings; an incomplete point is never sent. */
export function pickupCommit(confirmed: Confirmed, draft: PickupDraft, activating: boolean): PickupCommit {
  const point = trimmed(draft);
  if (!activating && samePickup(draft, pickupOf(confirmed.store.pickupPoint))) return { kind: "none" };
  if (point.name && point.address) {
    return { kind: "save", store: { enabled: confirmed.store.enabled || activating, pickupPoint: { name: point.name, address: point.address, instructions: point.instructions || null } } };
  }
  if (!confirmed.store.enabled && !activating && !point.name && !point.address && !point.instructions) return { kind: "save", store: { enabled: false, pickupPoint: null } };
  return { kind: "invalid", fields: (["name", "address"] as const).filter(field => !point[field]) };
}
