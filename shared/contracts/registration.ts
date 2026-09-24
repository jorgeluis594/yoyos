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
  "SERVICE_UNAVAILABLE", "INTERNAL_ERROR",
]);
export const apiErrorResponseSchema = z.object({
  error: z.string(),
  code: apiErrorCodeSchema,
}).readonly();

export type CompanyDto = z.infer<typeof companyDtoSchema>;
export type CurrentAccessDto = z.infer<typeof currentAccessDtoSchema>;
export type CreateCompanyRequest = z.infer<typeof createCompanyRequestSchema>;
export type CreateCompanyResponse = z.infer<typeof createCompanyResponseSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
