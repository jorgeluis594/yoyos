import express from "express";
import { toNodeHandler } from "better-auth/node";
import { createCompanyRequestSchema, createCompanyResponseSchema, currentAccessDtoSchema } from "@shared/contracts/registration";
import { createCompanyForUser } from "@core/src/features/companies";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";
import { auth } from "@core/src/shared/infrastructure/auth";
import { apiError, loadApiAccess, requireApiCompany, type AuthenticatedLocals, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import type { Response } from "express";

export const app = express();

app.all("/api/auth/{*splat}", toNodeHandler(auth));

app.use("/api", express.json());
app.use("/api", loadApiAccess);

app.get("/api/me", (_request, response: Response<unknown, AuthenticatedLocals>) => {
  const parsed = currentAccessDtoSchema.safeParse(response.locals.auth);
  if (!parsed.success) {
    console.error("Invalid access projection", parsed.error);
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
      case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
      default: return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    }
  }
  const output = createCompanyResponseSchema.safeParse({ companyId: result.data.companyId });
  if (!output.success) {
    console.error("Invalid company response", output.error);
    return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
  return response.status(result.data.created ? 201 : 200).json(output.data);
});

app.use("/api", requireApiCompany);
app.use("/api", (_request, response: Response<unknown, PrivateLocals>) => {
  apiError(response, 404, "NOT_FOUND", "Not found");
});

app.use("/api", (error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  void _next;
  if (error instanceof SyntaxError && "body" in error) return apiError(response, 400, "INVALID_COMPANY", "Invalid JSON");
  console.error("Unhandled API error", error);
  return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
});

app.use("/webhooks", express.raw({ type: "*/*" }), (_request, response) => {
  response.sendStatus(404);
});
