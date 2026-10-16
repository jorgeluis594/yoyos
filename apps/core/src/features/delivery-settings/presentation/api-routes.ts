import express, { type Response } from "express";
import { parseDeliveryZonesResponse } from "@core/src/features/delivery-settings/presentation/zones-response";
import { agencyCatalogRequestSchema, courierCatalogSchema, saveDeliverySettingsSchema, saveDeliveryZonesSchema, deliveryZonesApiErrorSchema } from "@shared/contracts/delivery-settings";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { log } from "@core/src/shared/infrastructure/logger";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { parseAgencyCatalogResponse } from "@core/src/features/delivery-settings/presentation/agency-catalog-response";
import type { AgencyCatalogError } from "@core/src/features/delivery-settings/application/agency-catalog";
import type { CourierCatalogId } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { toDeliverySettingsResponse } from "@core/src/features/delivery-settings/presentation/settings-response";
import type { DeliverySettingsError } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryZonesError, DeliveryZonesState } from "@core/src/features/delivery-settings/application/delivery-zones";

function deliveryZonesHttpError(response: Response, error: DeliveryZonesError) {
  switch (error.code) {
    case "INVALID_DELIVERY_ZONE":
    case "INVALID_DELIVERY_OPTION": return response.status(422).json(deliveryZonesApiErrorSchema.parse({ code: error.code,
      error: error.code === "INVALID_DELIVERY_ZONE" ? "Invalid delivery zone" : "Invalid delivery option",
      field: error.field, index: error.index, optionIndex: error.optionIndex }));
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
  const parsed = parseDeliveryZonesResponse(state);
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

function agencyCatalogHttpError(response: Response, error: AgencyCatalogError) {
  switch (error.code) {
    case "NOT_FOUND": return apiError(response, 404, "NOT_FOUND", "Courier not found");
    case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    case "INVALID_STORED_DATA": return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
}

export const deliverySettingsRoutes = express.Router();
deliverySettingsRoutes.get("/courier-catalog", async (_request, response: Response<unknown, PrivateLocals>) => {
  const context = { companyId: response.locals.auth.company.id, userId: response.locals.auth.user.id };
  try {
    const result = await deliverySettings.getCourierCatalog(context);
    return result.success ? response.json(courierCatalogSchema.parse({ couriers: result.data })) : deliverySettingsHttpError(response, result.error);
  } catch (cause) {
    log.error({ event: "delivery_settings_request_failed", operation: "get_courier_catalog", entryPoint: "api", userId: context.userId,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle courier catalog request");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
deliverySettingsRoutes.get("/agency-catalog", async (request, response: Response<unknown, PrivateLocals>) => {
  const parsed = agencyCatalogRequestSchema.safeParse(request.query);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid agency catalog request");
  const context = { companyId: response.locals.auth.company.id, userId: response.locals.auth.user.id };
  try {
    const result = await deliverySettings.getAgencyCatalog(parsed.data.courierId as CourierCatalogId, context);
    if (!result.success) return agencyCatalogHttpError(response, result.error);
    const body = parseAgencyCatalogResponse(result.data);
    if (body.success) return response.json(body.data);
    log.error({ event: "agency_catalog_response_invalid", operation: "get_agency_catalog", entryPoint: "api", userId: context.userId, errorCode: "INTERNAL_ERROR" }, "Agency catalog response is invalid");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  } catch (cause) {
    log.error({ event: "delivery_settings_request_failed", operation: "get_agency_catalog", entryPoint: "api", userId: context.userId,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle agency catalog request");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
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
    return result.success ? response.json(toDeliverySettingsResponse(result.data)) : deliverySettingsHttpError(response, result.error);
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
    const result = await deliverySettings.save(parsed.data, context);
    return result.success ? response.json(toDeliverySettingsResponse(result.data)) : deliverySettingsHttpError(response, result.error);
  } catch (cause) {
    log.error({ event: "delivery_settings_request_failed", operation: "save_delivery_settings", entryPoint: "api", userId: context.userId,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle delivery settings request");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
});
