import { getPeruDistrict } from "@shared/peru-geography";
import { agencyCatalogSchema, courierCatalogSchema, deliveryZonesApiErrorSchema, deliveryZonesSchema, saveDeliveryZonesSchema, type DeliveryZonesResponse, type SaveDeliveryZonesRequest, deliverySettingsApiErrorSchema, deliverySettingsSchema, saveDeliverySettingsSchema,
  type AgencyCatalogResponse, type CourierCatalogResponse, type DeliverySettingsResponse, type SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { DeliverySettingsError, DeliveryZonesError } from "@mobile/features/delivery-settings/application/delivery-settings";

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

function catalogResponse(raw: Result<unknown, TransportError>): Result<CourierCatalogResponse, DeliverySettingsError> {
  if (raw.success) {
    const parsed = courierCatalogSchema.safeParse(raw.data);
    return parsed.success ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Invalid courier catalog response" });
  }
  const failed = response(raw, false);
  return failed.success ? err({ code: "INVALID_RESPONSE", message: "Unexpected courier catalog error" }) : failed;
}

function agencyCatalogResponse(raw: Result<unknown, TransportError>, courierId: string): Result<AgencyCatalogResponse, DeliverySettingsError> {
  if (raw.success) {
    const parsed = agencyCatalogSchema.safeParse(raw.data);
    return parsed.success && parsed.data.agencies.every(agency => agency.courierId === courierId && agency.enabled && getPeruDistrict(agency.location.districtCode))
      ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Invalid agency catalog response" });
  }
  if (raw.error.http?.status === 404) return err({ code: "NOT_FOUND", message: "Courier not found" });
  const failed = response(raw, false);
  return failed.success ? err({ code: "INVALID_RESPONSE", message: "Unexpected agency catalog error" }) : failed;
}

const zoneStatusByCode = { ...statusByCode, INVALID_DELIVERY_ZONE: 422, INVALID_DELIVERY_OPTION: 422, UNSUPPORTED_COUNTRY: 422 };

function zonesResponse(raw: Result<unknown, TransportError>, saving: boolean): Result<DeliveryZonesResponse, DeliveryZonesError> {
  if (raw.success) {
    const parsed = deliveryZonesSchema.safeParse(raw.data);
    if (!parsed.success || parsed.data.currency !== "PEN" ||
      new Set(parsed.data.zones.map(zone => zone.id)).size !== parsed.data.zones.length ||
      parsed.data.zones.some(zone => zone.options.some(option => option.price.currency !== parsed.data.currency || option.price.amount < 0 ||
        option.price.amount > 9999999999999.99 || !/^\d+(?:\.\d{1,2})?$/.test(String(option.price.amount))) ||
        new Set(zone.options.map(option => option.id)).size !== zone.options.length ||
        new Set(zone.districtCodes).size !== zone.districtCodes.length || zone.districtCodes.some(code => !getPeruDistrict(code))))
      return err({ code: "INVALID_RESPONSE", message: "Invalid delivery zones response" });
    return ok(parsed.data);
  }
  const error = raw.error;
  if (!error.http || ["UNAUTHENTICATED", "COMPANY_REQUIRED", "RATE_LIMITED"].includes(error.code))
    return err({ code: error.code, message: error.message });
  const parsed = deliveryZonesApiErrorSchema.safeParse(error.http.body);
  if (!parsed.success || zoneStatusByCode[parsed.data.code] !== error.http.status ||
    (!saving && !["SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "UNSUPPORTED_COUNTRY", "INVALID_DELIVERY_SETTINGS"].includes(parsed.data.code)))
    return err({ code: "INVALID_RESPONSE", message: "Unexpected delivery zones error" });
  const { code, error: message, ...details } = parsed.data;
  return err({ code: code === "INTERNAL_ERROR" ? "SERVER_ERROR" : code, message, ...details });
}

export function createDeliverySettingsApi(request: Request) {
  return {
    getZones: async (): Promise<Result<DeliveryZonesResponse, DeliveryZonesError>> =>
      zonesResponse(await request("/api/delivery-settings/zones"), false),
    saveZones: async (input: SaveDeliveryZonesRequest): Promise<Result<DeliveryZonesResponse, DeliveryZonesError>> => {
      const parsed = saveDeliveryZonesSchema.safeParse(input);
      if (!parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid delivery zones input" });
      const result = zonesResponse(await request("/api/delivery-settings/zones", { method: "PUT",
        headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) }), true);
      return result.success && result.data.version !== parsed.data.expectedVersion + 1
        ? err({ code: "INVALID_RESPONSE", message: "Unexpected saved zones version" }) : result;
    },
    getCourierCatalog: async (): Promise<Result<CourierCatalogResponse, DeliverySettingsError>> => catalogResponse(await request("/api/delivery-settings/courier-catalog")),
    getAgencyCatalog: async (courierId: string): Promise<Result<AgencyCatalogResponse, DeliverySettingsError>> =>
      agencyCatalogResponse(await request(`/api/delivery-settings/agency-catalog?courierId=${encodeURIComponent(courierId)}`), courierId),
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
