import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { checkoutThemeIds, defaultCheckoutTheme, type CheckoutThemeId } from "@core/src/features/checkout-appearance/domain/checkout-themes";

export type CompanyId = string & { readonly __brand: "CompanyId" };
export type UserId = string & { readonly __brand: "UserId" };
export type ImageId = string & { readonly __brand: "ImageId" };

export type CheckoutAppearance = Readonly<{
  logoImageId: ImageId | null;
  theme: CheckoutThemeId;
}>;

export type CheckoutAppearanceError = Readonly<{
  code: "INVALID_CHECKOUT_APPEARANCE";
  message: string;
  /** Names of the rejected fields only, never their values. */
  invalidFields: readonly string[];
}>;

export const defaultCheckoutAppearance: CheckoutAppearance = { logoImageId: null, theme: defaultCheckoutTheme };

const uuid = z.uuid();
const appearanceSchema = z.strictObject({
  logoImageId: uuid.nullable(),
  theme: z.enum(checkoutThemeIds),
});

export function parseCompanyId(value: unknown): Result<CompanyId, CheckoutAppearanceError> {
  const parsed = uuid.safeParse(value);
  return parsed.success
    ? ok(parsed.data as CompanyId)
    : err({ code: "INVALID_CHECKOUT_APPEARANCE", message: "Invalid company id", invalidFields: ["companyId"] });
}

export function parseImageId(value: unknown): Result<ImageId, CheckoutAppearanceError> {
  const parsed = uuid.safeParse(value);
  return parsed.success
    ? ok(parsed.data as ImageId)
    : err({ code: "INVALID_CHECKOUT_APPEARANCE", message: "Invalid image id", invalidFields: ["imageId"] });
}

export function parseUserId(value: unknown): Result<UserId, CheckoutAppearanceError> {
  const parsed = z.string().min(1).safeParse(value);
  return parsed.success
    ? ok(parsed.data as UserId)
    : err({ code: "INVALID_CHECKOUT_APPEARANCE", message: "Invalid user id", invalidFields: ["userId"] });
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
    && appearance.theme === defaultCheckoutAppearance.theme;
}
