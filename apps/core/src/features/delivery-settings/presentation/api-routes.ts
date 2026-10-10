import { parseCourierInputs } from "@core/src/features/delivery-settings/domain/delivery-settings";
import express, { type Response } from "express";
import { deliverySettingsSchema, saveDeliverySettingsSchema, deliveryZonesSchema, saveDeliveryZonesSchema, deliveryZonesApiErrorSchema } from "@shared/contracts/delivery-settings";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { log } from "@core/src/shared/infrastructure/logger";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import type { DeliverySettingsError } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryZonesError, DeliveryZonesState } from "@core/src/features/delivery-settings/application/delivery-zones";

function deliveryZonesHttpError(response: Response, error: DeliveryZonesError) {
  switch (error.code) {
    case "INVALID_DELIVERY_ZONE": return response.status(422).json(deliveryZonesApiErrorSchema.parse({ code: error.code,
      error: "Invalid delivery zone", field: error.field, index: error.index }));
    case "DELIVERY_SETTINGS_CONFLICT": return response.status(409).json(deliveryZonesApiErrorSchema.parse({ code: error.code,
      error: "Delivery settings changed; reload before saving again", currentVersion: error.currentVersion, reason: error.reason }));
    case "UNSUPPORTED_COUNTRY": return apiError(response, 422, error.code, "Delivery zones are available only in Peru");
    case "INVALID_DELIVERY_SETTINGS": return apiError(response, 422, error.code, "Invalid delivery settings");
    case "PERSISTENCE_UNAVAILABLE":
    case "SERVICE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    case "INVALID_STORED_DATA":
    case "INTERNAL_ERROR": return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
}

function deliveryZonesJson(response: Response, state: DeliveryZonesState) {
  const parsed = deliveryZonesSchema.safeParse(state);
  return parsed.success ? response.json(parsed.data) : apiError(response, 500, "INTERNAL_ERROR", "Internal error");
}

function deliverySettingsHttpError(response: Response, error: DeliverySettingsError) {
  switch (error.code) {
    case "INVALID_DELIVERY_SETTINGS": return apiError(response, 422, error.code, "Invalid delivery settings");
    case "DELIVERY_SETTINGS_CONFLICT": return apiError(response, 409, error.code, "Delivery settings changed; reload before saving again");
    case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    case "INVALID_STORED_DATA": return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
}

export const deliverySettingsRoutes = express.Router();
deliverySettingsRoutes.get("/zones", async (_request, response: Response<unknown, PrivateLocals>) => {
  const context = { companyId: response.locals.auth.company.id, userId: response.locals.auth.user.id };
  try {
    const result = await deliverySettings.getZones(context);
    return result.success ? deliveryZonesJson(response, result.data) : deliveryZonesHttpError(response, result.error);
  } catch (cause) {
    log.error({ event: "delivery_zones_request_failed", operation: "get_delivery_zones", entryPoint: "api", userId: context.userId,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle delivery zones request");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
deliverySettingsRoutes.put("/zones", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = saveDeliveryZonesSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid delivery zones input");
  const context = { companyId: response.locals.auth.company.id, userId: response.locals.auth.user.id };
  try {
    const result = await deliverySettings.saveZones(parsed.data, context);
    return result.success ? deliveryZonesJson(response, result.data) : deliveryZonesHttpError(response, result.error);
  } catch (cause) {
    log.error({ event: "delivery_zones_request_failed", operation: "save_delivery_zones", entryPoint: "api", userId: context.userId,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle delivery zones request");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
deliverySettingsRoutes.get("/", async (_request, response: Response<unknown, PrivateLocals>) => {
  const context = { companyId: response.locals.auth.company.id, userId: response.locals.auth.user.id };
  try {
    const result = await deliverySettings.get(context);
    return result.success ? response.json(deliverySettingsSchema.parse(result.data)) : deliverySettingsHttpError(response, result.error);
  } catch (cause) {
    log.error({ event: "delivery_settings_request_failed", operation: "get_delivery_settings", entryPoint: "api", userId: context.userId,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle delivery settings request");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
deliverySettingsRoutes.put("/", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = saveDeliverySettingsSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid delivery settings input");
  const context = { companyId: response.locals.auth.company.id, userId: response.locals.auth.user.id };
  try {
    const couriers = parseCourierInputs(parsed.data.couriers);
    if (!couriers.success) return deliverySettingsHttpError(response, couriers.error);
    const result = await deliverySettings.save({ ...parsed.data, couriers: couriers.data }, context);
    return result.success ? response.json(deliverySettingsSchema.parse(result.data)) : deliverySettingsHttpError(response, result.error);
  } catch (cause) {
    log.error({ event: "delivery_settings_request_failed", operation: "save_delivery_settings", entryPoint: "api", userId: context.userId,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle delivery settings request");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
