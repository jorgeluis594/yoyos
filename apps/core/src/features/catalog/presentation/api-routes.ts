import express, { type Response } from "express";
import { setCatalogPublicationSchema } from "@shared/contracts/catalog";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { catalogSettings } from "@core/src/features/catalog/composition";
import type { CatalogSettingsAccess } from "@core/src/features/catalog/application/catalog-settings";
import { toCatalogSettingsResponse } from "@core/src/features/catalog/presentation/settings-response";

const accessOf = (response: Response<unknown, PrivateLocals>) =>
  ({ companyId: response.locals.auth.company.id, userId: response.locals.auth.user.id }) as CatalogSettingsAccess;

export const catalogRoutes = express.Router();

catalogRoutes.get("/settings", async (_request, response: Response<unknown, PrivateLocals>) => {
  const access = accessOf(response);
  const result = await catalogSettings.get(access);
  return result.success ? response.json(toCatalogSettingsResponse(result.data, access.companyId))
    : apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
});

catalogRoutes.put("/settings", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = setCatalogPublicationSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_CATALOG_SETTINGS", "Invalid catalog settings");
  const access = accessOf(response);
  const result = await catalogSettings.setPublication(parsed.data.published, access);
  return result.success ? response.json(toCatalogSettingsResponse(result.data, access.companyId))
    : apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
});
