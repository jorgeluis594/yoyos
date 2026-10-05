import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { saveDeliverySettingsSchema, type DeliverySettingsResponse, type SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type DeliverySettingsError = Readonly<{
  code: TransportError["code"] | "INVALID_INPUT" | "INVALID_DELIVERY_SETTINGS" | "DELIVERY_SETTINGS_CONFLICT" | "PAYLOAD_TOO_LARGE";
  message: string;
}>;
export type CourierDraft = Extract<SaveDeliverySettingsRequest["couriers"][number], { kind: "existing" }>
  | (Extract<SaveDeliverySettingsRequest["couriers"][number], { kind: "new" }> & { localKey: number });
export type DeliverySettingsDraft = Readonly<{ expectedVersion: number; homeEnabled: boolean; agencyEnabled: boolean; couriers: readonly CourierDraft[]; storeEnabled: boolean; pickupName: string; pickupAddress: string; pickupInstructions: string }>;
export type SaveDeliverySettings = (input: SaveDeliverySettingsRequest) => Promise<Result<DeliverySettingsResponse, DeliverySettingsError>>;

export async function saveDeliverySettings(draft: DeliverySettingsDraft, save: SaveDeliverySettings): Promise<Result<DeliverySettingsResponse, DeliverySettingsError>> {
  const configured = draft.storeEnabled || [draft.pickupName, draft.pickupAddress, draft.pickupInstructions].some(value => value.trim() !== "");
  const input = saveDeliverySettingsSchema.safeParse({ expectedVersion: draft.expectedVersion, agency: { enabled: draft.agencyEnabled }, couriers: draft.couriers.map(courier => courier.kind === "new" ? { kind: courier.kind, name: courier.name, enabled: courier.enabled } : courier), home: { enabled: draft.homeEnabled }, store: { enabled: draft.storeEnabled,
    pickupPoint: configured ? { name: draft.pickupName, address: draft.pickupAddress, instructions: draft.pickupInstructions.trim() || null } : null } });
  return input.success ? save(input.data) : err({ code: "INVALID_DELIVERY_SETTINGS", message: "Invalid delivery settings" });
}
