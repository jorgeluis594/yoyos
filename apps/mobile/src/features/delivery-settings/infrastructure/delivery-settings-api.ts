import { deliverySettingsApiErrorSchema, deliverySettingsSchema, saveDeliverySettingsSchema,
  type DeliverySettingsResponse, type SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { DeliverySettingsError } from "@mobile/features/delivery-settings/application/delivery-settings";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
const statusByCode = { INVALID_INPUT: 400, UNSUPPORTED_MEDIA_TYPE: 415, PAYLOAD_TOO_LARGE: 413,
  INVALID_DELIVERY_SETTINGS: 422, DELIVERY_SETTINGS_CONFLICT: 409, SERVICE_UNAVAILABLE: 503, INTERNAL_ERROR: 500 };

function response(raw: Result<unknown, TransportError>, saving: boolean): Result<DeliverySettingsResponse, DeliverySettingsError> {
  if (raw.success) {
    const parsed = deliverySettingsSchema.safeParse(raw.data);
    return parsed.success ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Invalid delivery settings response" });
  }
  const error = raw.error;
  if (!error.http || ["UNAUTHENTICATED", "COMPANY_REQUIRED", "RATE_LIMITED"].includes(error.code)) return err({ code: error.code, message: error.message });
  const parsed = deliverySettingsApiErrorSchema.safeParse(error.http.body);
  if (!parsed.success || statusByCode[parsed.data.code] !== error.http.status ||
      (!saving && !["SERVICE_UNAVAILABLE", "INTERNAL_ERROR"].includes(parsed.data.code)))
    return err({ code: "INVALID_RESPONSE", message: "Unexpected delivery settings error" });
  return err({ code: parsed.data.code === "INTERNAL_ERROR" ? "SERVER_ERROR" : parsed.data.code, message: parsed.data.error });
}

export function createDeliverySettingsApi(request: Request) {
  return {
    get: async (): Promise<Result<DeliverySettingsResponse, DeliverySettingsError>> => response(await request("/api/delivery-settings"), false),
    save: async (input: SaveDeliverySettingsRequest): Promise<Result<DeliverySettingsResponse, DeliverySettingsError>> => {
      const parsed = saveDeliverySettingsSchema.safeParse(input);
      if (!parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid delivery settings input" });
      const result = response(await request("/api/delivery-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) }), true);
      return result.success && result.data.version !== parsed.data.expectedVersion + 1
        ? err({ code: "INVALID_RESPONSE", message: "Unexpected saved settings version" }) : result;
    },
  };
}
