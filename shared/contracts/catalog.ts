import { z } from "zod";
import type { SubdomainFormatReason } from "../catalog-subdomain.js";

export const subdomainFormatReasonSchema = z.enum(["contains_domain", "contains_space", "invalid_character", "too_long", "hyphen_edge", "double_hyphen", "too_short"]);

export const catalogSettingsSchema = z.strictObject({
  published: z.boolean(),
  subdomain: z.string().nullable(),
  /** Brand URL of the saved subdomain, e.g. https://fantasio.yoyos.lat/; null without a subdomain. */
  url: z.url().nullable(),
  /** Host the subdomain goes under in this environment, e.g. "yoyos.lat"; the UI shows "." + domain. */
  domain: z.string().min(1),
  /** Available suggestion from the company name; only when subdomain is null. */
  suggestion: z.string().nullable(),
});
export type CatalogSettingsResponse = z.infer<typeof catalogSettingsSchema>;

export const setCatalogPublicationSchema = z.strictObject({ published: z.boolean() });
export type SetCatalogPublicationRequest = z.infer<typeof setCatalogPublicationSchema>;

export const subdomainAvailabilityQuerySchema = z.strictObject({ value: z.string().max(200) });
export const subdomainAvailabilitySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available"), subdomain: z.string() }),
  z.strictObject({ status: z.literal("current"), subdomain: z.string() }),
  z.strictObject({ status: z.literal("in_use"), subdomain: z.string() }),
  z.strictObject({ status: z.literal("reserved") }),
  z.strictObject({ status: z.literal("invalid"), reason: subdomainFormatReasonSchema }),
]);
export type SubdomainAvailabilityResponse = z.infer<typeof subdomainAvailabilitySchema>;

export const saveCatalogSubdomainSchema = z.strictObject({ subdomain: z.string().max(200) });
export type SaveCatalogSubdomainRequest = z.infer<typeof saveCatalogSubdomainSchema>;

/** The repository's API error envelope ({ code, error, issues? } sent by apiError), narrowed to the catalog routes. */
const subdomainIssueSchema = z.object({ field: z.literal("subdomain"), reason: subdomainFormatReasonSchema }).loose();
export const catalogSettingsErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("INVALID_SUBDOMAIN"), error: z.string(), issues: z.tuple([subdomainIssueSchema]) }),
  z.object({
    code: z.enum(["SUBDOMAIN_RESERVED", "SUBDOMAIN_TAKEN", "SUBDOMAIN_REQUIRED", "INVALID_CATALOG_SETTINGS", "UNSUPPORTED_MEDIA_TYPE", "RATE_LIMITED", "SERVICE_UNAVAILABLE", "UNAUTHENTICATED", "COMPANY_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "INTERNAL_ERROR"]),
    error: z.string(),
    issues: z.array(z.object({ field: z.string(), reason: z.string() }).loose()).optional(),
  }),
]).readonly();
export type CatalogSettingsErrorResponse = z.infer<typeof catalogSettingsErrorSchema>;

/** The format reason of an INVALID_SUBDOMAIN error, so neither client reads `issues[0]` itself. */
export function subdomainErrorReason(error: CatalogSettingsErrorResponse): SubdomainFormatReason | null {
  return error.code === "INVALID_SUBDOMAIN" ? error.issues[0].reason : null;
}
