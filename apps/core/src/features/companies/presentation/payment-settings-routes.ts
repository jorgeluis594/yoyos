import express, { type Response } from "express";
import { paymentQrCheckResponseSchema, paymentQrCheckSchema, paymentSettingsInputSchema, paymentSettingsResponseSchema } from "@shared/contracts/payment-settings";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { companyPaymentSettings } from "@core/src/features/companies/composition";

export const paymentSettingsRoutes = express.Router();

paymentSettingsRoutes.get("/", async (_request, response: Response<unknown, PrivateLocals>) => {
  const result = await companyPaymentSettings.getConfiguration(response.locals.auth.company.id);
  if (!result.success) return apiError(response, 503, "SERVICE_UNAVAILABLE", "Payment settings unavailable");
  const output = paymentSettingsResponseSchema.safeParse({ settings: result.data });
  return output.success ? response.json(output.data) : apiError(response, 500, "INTERNAL_ERROR", "Invalid payment settings");
});

paymentSettingsRoutes.put("/", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const input = paymentSettingsInputSchema.safeParse(request.body);
  if (!input.success) return apiError(response, 400, "INVALID_INPUT", "Invalid payment settings");
  const result = await companyPaymentSettings.save(response.locals.auth.company.id, response.locals.auth.user.id, input.data.settings);
  if (!result.success) {
    switch (result.error.code) {
      case "INVALID_PAYMENT_SETTINGS":
      case "INVALID_IMAGE": return apiError(response, 400, "INVALID_INPUT", "Invalid payment settings");
      case "INVALID_PAYMENT_QR": return apiError(response, 400, "INVALID_PAYMENT_QR", "The wallet image does not hold a readable QR code");
      case "QR_CHECK_UNAVAILABLE": return apiError(response, 503, "QR_CHECK_UNAVAILABLE", "The QR code could not be checked");
      default: return apiError(response, 503, "SERVICE_UNAVAILABLE", "Payment settings unavailable");
    }
  }
  const output = paymentSettingsResponseSchema.safeParse({ settings: result.data });
  return output.success ? response.json(output.data) : apiError(response, 500, "INTERNAL_ERROR", "Invalid payment settings");
});

paymentSettingsRoutes.post("/qr-checks", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const input = paymentQrCheckSchema.safeParse(request.body);
  if (!input.success) return apiError(response, 400, "INVALID_INPUT", "Invalid QR check");
  const result = await companyPaymentSettings.checkQr(response.locals.auth.company.id, input.data.imageId);
  if (!result.success) {
    switch (result.error.code) {
      case "INVALID_IMAGE": return apiError(response, 400, "INVALID_INPUT", "Invalid QR check");
      case "QR_CHECK_UNAVAILABLE": return apiError(response, 503, "QR_CHECK_UNAVAILABLE", "The QR code could not be checked");
      default: return apiError(response, 503, "SERVICE_UNAVAILABLE", "Payment settings unavailable");
    }
  }
  return response.json(paymentQrCheckResponseSchema.parse({ status: result.data }));
});
