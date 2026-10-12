import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { saveDeliverySettingsSchema, type DeliverySettingsResponse, type SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type DeliverySettingsError = Readonly<{
  code: TransportError["code"] | "INVALID_INPUT" | "INVALID_DELIVERY_SETTINGS" | "DELIVERY_SETTINGS_CONFLICT" | "PAYLOAD_TOO_LARGE";
  message: string;
}>;
export type DeliveryZonesError = Readonly<{
  code: DeliverySettingsError["code"] | "INVALID_DELIVERY_ZONE" | "UNSUPPORTED_COUNTRY" | "UNSUPPORTED_MEDIA_TYPE";
  message: string;
  currentVersion?: number;
  reason?: "stale_version" | "concurrent_creation";
  field?: "id" | "method" | "name" | "enabled" | "districtCodes" | "price" | "zones";
  index?: number;
}>;
type CourierName = Readonly<{ name: string }>;
export type CourierDraft = (Extract<SaveDeliverySettingsRequest["couriers"][number], { kind: "existing" }> & CourierName & Readonly<{ courierId: string }>)
  | (Extract<SaveDeliverySettingsRequest["couriers"][number], { kind: "new" }> & CourierName & Readonly<{ localKey: number }>);
export type DeliverySettingsDraft = Readonly<{ expectedVersion: number; homeEnabled: boolean; agencyEnabled: boolean; couriers: readonly CourierDraft[]; storeEnabled: boolean; pickupName: string; pickupAddress: string; pickupInstructions: string }>;
export type SaveDeliverySettings = (input: SaveDeliverySettingsRequest) => Promise<Result<DeliverySettingsResponse, DeliverySettingsError>>;

export async function saveDeliverySettings(draft: DeliverySettingsDraft, save: SaveDeliverySettings): Promise<Result<DeliverySettingsResponse, DeliverySettingsError>> {
  const configured = draft.storeEnabled || [draft.pickupName, draft.pickupAddress, draft.pickupInstructions].some(value => value.trim() !== "");
  const input = saveDeliverySettingsSchema.safeParse({ expectedVersion: draft.expectedVersion, agency: { enabled: draft.agencyEnabled }, couriers: draft.couriers.map(courier => courier.kind === "new" ? { kind: courier.kind, courierId: courier.courierId, enabled: courier.enabled } : { kind: courier.kind, id: courier.id, enabled: courier.enabled }), home: { enabled: draft.homeEnabled }, store: { enabled: draft.storeEnabled,
    pickupPoint: configured ? { name: draft.pickupName, address: draft.pickupAddress, instructions: draft.pickupInstructions.trim() || null } : null } });
  return input.success ? save(input.data) : err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid delivery settings" });
}
