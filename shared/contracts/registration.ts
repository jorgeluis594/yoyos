import { z } from "zod";
import { countries } from "@shared/country";

export const countrySchema = z.enum(countries);
export const companyDtoSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  country: countrySchema,
}).readonly();

const accessUserFields = { id: z.string().min(1), name: z.string() };
export const currentAccessDtoSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("verification_required"),
    user: z.object({ ...accessUserFields, companyId: z.null() }).readonly(),
    company: z.null(),
  }),
  z.object({
    status: z.literal("company_required"),
    user: z.object({ ...accessUserFields, companyId: z.null() }).readonly(),
    company: z.null(),
  }),
  z.object({
    status: z.literal("ready"),
    user: z.object({ ...accessUserFields, companyId: z.uuid() }).readonly(),
    company: companyDtoSchema,
  }),
]).refine(
  (value) => value.status !== "ready" || value.user.companyId === value.company.id,
  { message: "Company must match the user link", path: ["company", "id"] },
).readonly();

export const createCompanyRequestSchema = z.object({
  name: z.string(),
  country: countrySchema,
}).readonly();
export const createCompanyResponseSchema = z.object({ companyId: z.uuid() }).readonly();
export const apiErrorCodeSchema = z.enum([
  "UNAUTHENTICATED", "COMPANY_REQUIRED", "INVALID_COMPANY", "NOT_FOUND",
  "EMAIL_VERIFICATION_REQUIRED",
  "SERVICE_UNAVAILABLE", "INTERNAL_ERROR",
  "INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "IMAGE_STORAGE_UNAVAILABLE",
  "INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "PRODUCT_ID_CONFLICT",
  "PRODUCT_NOT_FOUND", "IMAGE_NOT_FOUND", "PAYLOAD_TOO_LARGE",
  "INVALID_ORDER", "CURRENCY_MISMATCH", "CONTACT_NOT_FOUND",
  "VARIANT_NOT_FOUND", "INSUFFICIENT_STOCK", "ORDER_ALREADY_EXISTS", "ORDER_NOT_FOUND",
  "INVALID_PAYMENT", "PAYMENT_CONFLICT", "PAYMENT_NOT_FOUND", "RECEIPT_NOT_FOUND", "INVALID_TRANSITION", "DELIVERY_LOCKED", "PAYMENT_REQUIRED",
  "STOCK_NOT_DEDUCTED", "ORDER_CANCELLED", "DELIVERY_UNAVAILABLE",
  "INVALID_DELIVERY_SETTINGS", "DELIVERY_SETTINGS_CONFLICT",
  "DELIVERY_METHOD_DISABLED", "COURIER_UNAVAILABLE",
]);
export const apiErrorResponseSchema = z.object({
  error: z.string(),
  code: apiErrorCodeSchema,
  issues: z.array(z.object({ field: z.string(), reason: z.string() }).loose()).optional(),
}).readonly();

export type CompanyDto = z.infer<typeof companyDtoSchema>;
export type CurrentAccessDto = z.infer<typeof currentAccessDtoSchema>;
export type CreateCompanyRequest = z.infer<typeof createCompanyRequestSchema>;
export type CreateCompanyResponse = z.infer<typeof createCompanyResponseSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
