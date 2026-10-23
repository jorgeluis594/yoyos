import express, { type Response } from "express";
import {
  saveCatalogSubdomainSchema, setCatalogPublicationSchema, subdomainAvailabilityQuerySchema, subdomainAvailabilitySchema,
} from "@shared/contracts/catalog";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { catalogSettings } from "@core/src/features/catalog/composition";
import type { CatalogSettingsAccess } from "@core/src/features/catalog/application/catalog-settings";
import { allowSubdomainCheck } from "@core/src/features/catalog/presentation/rate-limit";
import { toCatalogSettingsResponse } from "@core/src/features/catalog/presentation/settings-response";

const accessOf = (response: Response<unknown, PrivateLocals>) =>
  ({ companyId: response.locals.auth.company.id, userId: response.locals.auth.user.id }) as CatalogSettingsAccess;
const unavailable = (response: Response<unknown, PrivateLocals>) => apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");

export const catalogRoutes = express.Router();

catalogRoutes.get("/settings", async (_request, response: Response<unknown, PrivateLocals>) => {
  const result = await catalogSettings.get(accessOf(response));
  return result.success ? response.json(toCatalogSettingsResponse(result.data)) : unavailable(response);
});

catalogRoutes.put("/settings", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = setCatalogPublicationSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_CATALOG_SETTINGS", "Invalid catalog settings");
  const result = await catalogSettings.setPublication(parsed.data.published, accessOf(response));
  if (result.success) return response.json(toCatalogSettingsResponse(result.data));
  return result.error.code === "SUBDOMAIN_REQUIRED" ? apiError(response, 409, "SUBDOMAIN_REQUIRED", "Choose the catalog link before publishing") : unavailable(response);
});

catalogRoutes.get("/subdomain-availability", async (request, response: Response<unknown, PrivateLocals>) => {
  const access = accessOf(response);
  if (!allowSubdomainCheck(access.userId)) return apiError(response, 429, "RATE_LIMITED", "Too many checks");
  const query = subdomainAvailabilityQuerySchema.safeParse({ value: request.query.value });
  if (!query.success) return apiError(response, 400, "INVALID_CATALOG_SETTINGS", "Invalid catalog settings");
  const result = await catalogSettings.checkSubdomain(query.data.value, access);
  return result.success ? response.json(subdomainAvailabilitySchema.parse(result.data)) : unavailable(response);
});

catalogRoutes.put("/subdomain", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = saveCatalogSubdomainSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_CATALOG_SETTINGS", "Invalid catalog settings");
  const result = await catalogSettings.saveSubdomain(parsed.data.subdomain, accessOf(response));
  if (result.success) return response.json(toCatalogSettingsResponse(result.data.settings));
  switch (result.error.code) {
    case "INVALID_SUBDOMAIN": return apiError(response, 422, "INVALID_SUBDOMAIN", "Invalid subdomain", [{ field: "subdomain", reason: result.error.reason }]);
    case "SUBDOMAIN_RESERVED": return apiError(response, 422, "SUBDOMAIN_RESERVED", "Subdomain is reserved");
    case "SUBDOMAIN_TAKEN": return apiError(response, 409, "SUBDOMAIN_TAKEN", "Subdomain is already in use");
    default: return unavailable(response);
  }
});
