import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { storeThemeIds, defaultStoreTheme, type StoreThemeId } from "@shared/store-themes";

export type CompanyId = string & { readonly __brand: "CompanyId" };
export type UserId = string & { readonly __brand: "UserId" };
export type ImageId = string & { readonly __brand: "ImageId" };

export type StoreAppearance = Readonly<{
  logoImageId: ImageId | null;
  theme: StoreThemeId;
}>;

export type StoreAppearanceError = Readonly<{
  code: "INVALID_STORE_APPEARANCE";
  message: string;
  /** Names of the rejected fields only, never their values. */
  invalidFields: readonly string[];
}>;

export const defaultStoreAppearance: StoreAppearance = { logoImageId: null, theme: defaultStoreTheme };

const uuid = z.uuid();
const appearanceSchema = z.strictObject({
  logoImageId: uuid.nullable(),
  theme: z.enum(storeThemeIds),
});

export function parseCompanyId(value: unknown): Result<CompanyId, StoreAppearanceError> {
  const parsed = uuid.safeParse(value);
  return parsed.success
    ? ok(parsed.data as CompanyId)
    : err({ code: "INVALID_STORE_APPEARANCE", message: "Invalid company id", invalidFields: ["companyId"] });
}

export function parseImageId(value: unknown): Result<ImageId, StoreAppearanceError> {
  const parsed = uuid.safeParse(value);
  return parsed.success
    ? ok(parsed.data as ImageId)
    : err({ code: "INVALID_STORE_APPEARANCE", message: "Invalid image id", invalidFields: ["imageId"] });
}

export function parseUserId(value: unknown): Result<UserId, StoreAppearanceError> {
  const parsed = z.string().min(1).safeParse(value);
  return parsed.success
    ? ok(parsed.data as UserId)
    : err({ code: "INVALID_STORE_APPEARANCE", message: "Invalid user id", invalidFields: ["userId"] });
}

export function parseStoreAppearance(value: unknown): Result<StoreAppearance, StoreAppearanceError> {
  const parsed = appearanceSchema.safeParse(value);
  if (parsed.success) return ok({ ...parsed.data, logoImageId: parsed.data.logoImageId as ImageId | null });
  const invalidFields = [...new Set(parsed.error.issues.flatMap((issue) => issue.code === "unrecognized_keys"
    ? issue.keys : [String(issue.path[0] ?? "appearance")]))];
  return err({ code: "INVALID_STORE_APPEARANCE", message: "Invalid store appearance", invalidFields });
}

export function isDefaultStoreAppearance(appearance: StoreAppearance): boolean {
  return appearance.logoImageId === defaultStoreAppearance.logoImageId
    && appearance.theme === defaultStoreAppearance.theme;
}
