import express, { type Response } from "express";
import { paymentSettingsSchema } from "@shared/contracts/payment-settings";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { companyPaymentSettings } from "@core/src/features/companies/composition";

export const paymentSettingsRoutes = express.Router();

paymentSettingsRoutes.get("/", async (_request, response: Response<unknown, PrivateLocals>) => {
  const result = await companyPaymentSettings.get(response.locals.auth.company.id);
  if (!result.success) return apiError(response, 503, "SERVICE_UNAVAILABLE", "Payment settings unavailable");
  const output = paymentSettingsSchema.safeParse({ settings: result.data });
  return output.success ? response.json(output.data) : apiError(response, 500, "INTERNAL_ERROR", "Invalid payment settings");
});

paymentSettingsRoutes.put("/", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const input = paymentSettingsSchema.safeParse(request.body);
  if (!input.success) return apiError(response, 400, "INVALID_INPUT", "Invalid payment settings");
  const result = await companyPaymentSettings.save(response.locals.auth.company.id, response.locals.auth.user.id, input.data.settings);
  if (!result.success) return result.error.code === "INVALID_PAYMENT_SETTINGS" || result.error.code === "INVALID_IMAGE"
    ? apiError(response, 400, "INVALID_INPUT", "Invalid payment settings")
    : apiError(response, 503, "SERVICE_UNAVAILABLE", "Payment settings unavailable");
  const output = paymentSettingsSchema.safeParse({ settings: result.data });
  return output.success ? response.json(output.data) : apiError(response, 500, "INTERNAL_ERROR", "Invalid payment settings");
});
