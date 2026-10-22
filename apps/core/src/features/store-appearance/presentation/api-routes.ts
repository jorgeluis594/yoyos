import express, { type Response } from "express";
import { saveStoreAppearanceSchema, storeAppearanceResponseSchema } from "@shared/contracts/store-appearance";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { bindRequestOperation, log } from "@core/src/shared/infrastructure/logger";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { parseCompanyId, parseUserId, type StoreAppearance } from "@core/src/features/store-appearance/domain/store-appearance";
import type { SellerStoreAppearance, StoreAppearanceFailure } from "@core/src/features/store-appearance/application/store-appearance";

type Operation = "get_store_appearance" | "save_store_appearance";

type Readable = Readonly<{ appearance: StoreAppearance; logoUrl: string | null }>;

function toResponseBody(value: SellerStoreAppearance | Readable) {
  if ("kind" in value) {
    if (value.kind === "unknown_theme") return { kind: "unknown_theme" };
    return toResponseBody({ appearance: value.appearance, logoUrl: value.logoUrl });
  }
  const { appearance, logoUrl } = value;
  return { kind: "readable", appearance: { theme: appearance.theme, logo: appearance.logoImageId ? { id: appearance.logoImageId, url: logoUrl } : null } };
}

function send(response: Response, operation: Operation, value: SellerStoreAppearance | Readable) {
  const body = storeAppearanceResponseSchema.safeParse(toResponseBody(value));
  if (!body.success) {
    log.error({ event: "store_appearance_response_invalid", operation, errorCode: "INTERNAL_ERROR" }, "Store appearance response is invalid");
    bindRequestOperation({ operation, outcome: "technical_failure" });
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
  bindRequestOperation({ operation, outcome: operation === "save_store_appearance" ? "saved" : "loaded" });
  return response.set("Cache-Control", "no-store").json(body.data);
}

function failure(response: Response, operation: Operation, error: StoreAppearanceFailure) {
  switch (error.code) {
    case "INVALID_IMAGE":
      bindRequestOperation({ operation, outcome: "invalid_input" });
      return apiError(response, 422, "INVALID_IMAGE", "Logo image is unavailable");
    case "INVALID_STORE_APPEARANCE":
      bindRequestOperation({ operation, outcome: "invalid_input" });
      return apiError(response, 400, "INVALID_STORE_APPEARANCE", "Invalid store appearance");
    case "INVALID_STORED_DATA":
    case "UNKNOWN_STORED_THEME":
      bindRequestOperation({ operation, outcome: "technical_failure" });
      return operation === "get_store_appearance"
        ? apiError(response, 503, "INVALID_STORED_DATA", "Stored store appearance is invalid")
        : apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    case "PERSISTENCE_UNAVAILABLE":
      bindRequestOperation({ operation, outcome: "technical_failure" });
      return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
  }
}

function unexpected(response: Response, operation: Operation, cause: unknown) {
  bindRequestOperation({ operation, outcome: "technical_failure" });
  log.error({ event: "store_appearance_request_failed", operation, entryPoint: "api", errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle store appearance request");
  return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
}

export function storeAppearanceRoutes() {
  const routes = express.Router();
  routes.get("/", async (_request, response: Response<unknown, PrivateLocals>) => {
    try {
      const companyId = parseCompanyId(response.locals.auth.company.id);
      if (!companyId.success) return unexpected(response, "get_store_appearance", new Error("Invalid company id"));
      const result = await storeAppearance.get(companyId.data);
      return result.success ? send(response, "get_store_appearance", result.data) : failure(response, "get_store_appearance", result.error);
    } catch (cause) { return unexpected(response, "get_store_appearance", cause); }
  });
  routes.put("/", async (request, response: Response<unknown, PrivateLocals>) => {
    if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
    const parsed = saveStoreAppearanceSchema.safeParse(request.body);
    if (!parsed.success) {
      bindRequestOperation({ operation: "save_store_appearance", outcome: "invalid_input" });
      return apiError(response, 400, "INVALID_STORE_APPEARANCE", "Invalid store appearance");
    }
    try {
      const companyId = parseCompanyId(response.locals.auth.company.id);
      const userId = parseUserId(response.locals.auth.user.id);
      if (!companyId.success || !userId.success) return unexpected(response, "save_store_appearance", new Error("Invalid access ids"));
      const result = await storeAppearance.save(companyId.data, userId.data, parsed.data);
      return result.success ? send(response, "save_store_appearance", result.data) : failure(response, "save_store_appearance", result.error);
    } catch (cause) { return unexpected(response, "save_store_appearance", cause); }
  });
  return routes;
}
