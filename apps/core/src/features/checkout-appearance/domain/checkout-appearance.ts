import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type CompanyId = string & { readonly __brand: "CompanyId" };
export type ImageId = string & { readonly __brand: "ImageId" };
export type HexColor = string & { readonly __brand: "HexColor" };

export const checkoutBrandColors = ["yoyos", "forest", "petrol", "ocean", "plum", "raspberry", "terracotta", "mustard", "graphite"] as const;
export const checkoutBackgrounds = ["white", "neutral", "brand_tint"] as const;
export type CheckoutBrandColor = (typeof checkoutBrandColors)[number];
export type CheckoutBackground = (typeof checkoutBackgrounds)[number];

export type CheckoutAppearance = Readonly<{
  logoImageId: ImageId | null;
  brandColor: CheckoutBrandColor;
  background: CheckoutBackground;
}>;

export type CheckoutAppearanceError = Readonly<{
  code: "INVALID_CHECKOUT_APPEARANCE";
  message: string;
  /** Names of the rejected fields only, never their values. */
  invalidFields: readonly string[];
}>;

export const defaultCheckoutAppearance: CheckoutAppearance = { logoImageId: null, brandColor: "yoyos", background: "neutral" };

const uuid = z.uuid();
const appearanceSchema = z.strictObject({
  logoImageId: uuid.nullable(),
  brandColor: z.enum(checkoutBrandColors),
  background: z.enum(checkoutBackgrounds),
});

export function parseCompanyId(value: unknown): Result<CompanyId, CheckoutAppearanceError> {
  const parsed = uuid.safeParse(value);
  return parsed.success
    ? ok(parsed.data as CompanyId)
    : err({ code: "INVALID_CHECKOUT_APPEARANCE", message: "Invalid company id", invalidFields: ["companyId"] });
}

export function parseCheckoutAppearance(value: unknown): Result<CheckoutAppearance, CheckoutAppearanceError> {
  const parsed = appearanceSchema.safeParse(value);
  if (parsed.success) return ok({ ...parsed.data, logoImageId: parsed.data.logoImageId as ImageId | null });
  const invalidFields = [...new Set(parsed.error.issues.flatMap((issue) => issue.code === "unrecognized_keys"
    ? issue.keys : [String(issue.path[0] ?? "appearance")]))];
  return err({ code: "INVALID_CHECKOUT_APPEARANCE", message: "Invalid checkout appearance", invalidFields });
}

export function isDefaultCheckoutAppearance(appearance: CheckoutAppearance): boolean {
  return appearance.logoImageId === defaultCheckoutAppearance.logoImageId
    && appearance.brandColor === defaultCheckoutAppearance.brandColor
    && appearance.background === defaultCheckoutAppearance.background;
}
