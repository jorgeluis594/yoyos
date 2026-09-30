import express from "express";
import { toNodeHandler } from "better-auth/node";
import { createCompanyRequestSchema, createCompanyResponseSchema, currentAccessDtoSchema } from "@shared/contracts/registration";
import { createCompanyForUser } from "@core/src/features/companies";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";
import { auth } from "@core/src/shared/infrastructure/auth";
import { apiError, loadApiAccess, requireApiCompany, type AuthenticatedLocals, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import type { Response } from "express";
import { imageRoutes } from "@core/src/shared/images/presentation/routes";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import { loadWhatsAppConnections } from "@core/src/features/chats/infrastructure/whatsapp-connections";
import { whatsappWebhook } from "@core/src/features/chats/presentation/whatsapp-webhook";
import { productRoutes } from "@core/src/features/products/presentation/api-routes";
import { hasDuplicateJsonKeys, orderRoutes } from "@core/src/features/orders/presentation/api-routes";
import { currentLogger, requestLogging } from "@core/src/shared/infrastructure/logger";

export const app = express();
app.use(requestLogging);

app.all("/api/auth/{*splat}", toNodeHandler(auth));

app.use("/api/products", (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});
app.use("/api/orders", (_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});
app.use("/api/orders", express.json({ limit: "100kb", verify: (_request, _response, body) => {
  if (hasDuplicateJsonKeys(body.toString("utf8"))) throw new Error("Duplicate JSON key");
} }));
app.use("/api", express.json({ limit: "100kb" }));
app.use("/api", loadApiAccess);

app.get("/api/me", (_request, response: Response<unknown, AuthenticatedLocals>) => {
  const parsed = currentAccessDtoSchema.safeParse(response.locals.auth);
  if (!parsed.success) {
    currentLogger().error({ event: "access_projection_invalid", errorCode: "INVALID_STORED_DATA" }, "Invalid access projection");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
  return response.set("Cache-Control", "no-store").json(parsed.data);
});

app.post("/api/company", async (request, response: Response<unknown, AuthenticatedLocals>) => {
  const parsed = createCompanyRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_COMPANY", "Invalid company");
  const result = await createCompanyForUser({ userId: response.locals.auth.user.id, ...parsed.data }, companyRepository);
  if (!result.success) {
    switch (result.error.code) {
      case "INVALID_COMPANY": return apiError(response, 400, "INVALID_COMPANY", "Invalid company");
      case "USER_NOT_FOUND": return apiError(response, 401, "UNAUTHENTICATED", "Unauthorized");
      case "EMAIL_VERIFICATION_REQUIRED": return apiError(response, 403, "EMAIL_VERIFICATION_REQUIRED", "Email verification required");
      case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
      default: return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
  }
  const output = createCompanyResponseSchema.safeParse({ companyId: result.data.companyId });
  if (!output.success) {
    currentLogger().error({ event: "company_response_invalid", errorCode: "INVALID_STORED_DATA" }, "Invalid company response");
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
  return response.status(result.data.created ? 201 : 200).json(output.data);
});

app.use("/api", requireApiCompany);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/images", imageRoutes(createR2ImageStorage({
  endpoint: process.env.R2_ENDPOINT ?? "",
  bucket: process.env.R2_BUCKET ?? "",
  privateBucket: process.env.R2_PRIVATE_BUCKET ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "",
}), imageRepository));

app.use("/api", (_request, response: Response<unknown, PrivateLocals>) => {
  apiError(response, 404, "NOT_FOUND", "Not found");
});

app.use("/api", (error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  void _next;
  const pathname = _request.originalUrl.split("?", 1)[0];
  const isFeatureRequest = ["/api/products", "/api/orders"].some((base) => pathname === base || pathname.startsWith(`${base}/`));
  if (pathname.startsWith("/api/orders") && typeof error === "object" && error !== null && "type" in error && error.type === "entity.verify.failed")
    return apiError(response, 400, "INVALID_INPUT", "Duplicate JSON key");
  if (error instanceof SyntaxError && "body" in error) return apiError(response, 400, isFeatureRequest ? "INVALID_INPUT" : "INVALID_COMPANY", "Invalid JSON", isFeatureRequest ? [{ field: "body", reason: "INVALID_JSON" }] : undefined);
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    return apiError(response, 413, "PAYLOAD_TOO_LARGE", "Request exceeds 100 kB");
  }
  currentLogger().error({ event: "api_unhandled_error", err: error }, "Unhandled API error");
  return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
});

app.use("/webhooks/whatsapp", express.raw({ type: "*/*", limit: "2mb" }), whatsappWebhook(
  loadWhatsAppConnections(), process.env.WHATSAPP_APP_SECRET ?? "", process.env.WHATSAPP_VERIFY_TOKEN ?? "",
));
app.use("/webhooks", express.raw({ type: "*/*" }), (_request, response) => {
  response.sendStatus(404);
});
