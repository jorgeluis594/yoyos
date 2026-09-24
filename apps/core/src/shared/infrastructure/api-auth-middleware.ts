import type { NextFunction, Request, Response } from "express";
import { apiErrorResponseSchema, type ApiErrorCode } from "@shared/contracts/registration";
import { requireCompany, type ReadyAccess, type UserAccess } from "@core/src/features/users";
import { resolveCurrentAccess } from "@core/src/shared/infrastructure/current-user";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

export type AuthenticatedLocals = { auth: UserAccess };
export type PrivateLocals = { auth: ReadyAccess };

export function apiError(response: Response, status: number, code: ApiErrorCode, message: string) {
  return response.status(status).json(apiErrorResponseSchema.parse({ code, error: message }));
}

export async function loadApiAccess(request: Request, response: Response<unknown, AuthenticatedLocals>, next: NextFunction) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  const result = await resolveCurrentAccess(headers);
  if (!result.success) {
    switch (result.error.code) {
      case "UNAUTHENTICATED": return apiError(response, 401, "UNAUTHENTICATED", "Unauthorized");
      case "AUTH_SERVICE_UNAVAILABLE":
      case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
      default: return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
  }
  response.locals.auth = result.data;
  if (result.data.status === "ready") return withTenantIsolation(result.data.company.id, next);
  return next();
}

export function requireApiCompany(_request: Request, response: Response<unknown, AuthenticatedLocals>, next: NextFunction) {
  const result = requireCompany(response.locals.auth);
  if (!result.success) return apiError(response, 409, "COMPANY_REQUIRED", "Company required");
  response.locals.auth = result.data;
  return next();
}
