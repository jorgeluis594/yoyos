import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import {
  defaultStoreAppearance, parseStoreAppearance,
  type StoreAppearance, type StoreAppearanceError, type CompanyId, type ImageId,
} from "@core/src/features/store-appearance/domain/store-appearance";
import type { StoreThemeId } from "@shared/store-themes";

export type StoreAppearanceFailure = StoreAppearanceError
  | Readonly<{ code: "INVALID_IMAGE" | "INVALID_STORED_DATA" | "UNKNOWN_STORED_THEME" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

type StorageFailure = Exclude<StoreAppearanceFailure, StoreAppearanceError>;

export type PublicAppearance = Readonly<{
  logoUrl: string | null;
  theme: StoreThemeId;
}>;

export type PublicAppearanceResult =
  | Readonly<{ kind: "default" }>
  | Readonly<{ kind: "custom"; appearance: PublicAppearance }>
  | Readonly<{ kind: "fallback" }>;

/** `unknown_theme` lets the editors start from Clásico without logo instead of failing to load. */
export type SellerStoreAppearance =
  | Readonly<{ kind: "readable"; appearance: StoreAppearance; logoUrl: string | null }>
  | Readonly<{ kind: "unknown_theme" }>;

export type SavedStoreAppearance = Readonly<{ appearance: StoreAppearance; logoUrl: string | null }>;

export type PreviewPaymentMethod =
  | Readonly<{ method: "digital_wallet"; provider: string; holder: string; imageUrl: string | null }>
  | Readonly<{ method: "bank_transfer"; bank: string; holder: string; accountNumber: string | null; cci: string | null; imageUrl: string | null }>;

export type StorePreview = Readonly<{
  companyName: string;
  /** The company's real payment methods, or `null` when it has none or they cannot be read. */
  paymentMethods: readonly PreviewPaymentMethod[] | null;
}>;

type ImageUrlResolver = (imageId: ImageId) => Promise<Result<string | null, Readonly<{ message: string }>>>;

export type AppearanceDependencies = Readonly<{
  load: (companyId: CompanyId) => Promise<Result<StoreAppearance | null, StorageFailure>>;
  save: (companyId: CompanyId, appearance: StoreAppearance) => Promise<Result<null, StorageFailure>>;
  /** A database read only: whether the logo is an available image of the company. */
  logoOwned: (companyId: CompanyId, imageId: ImageId) => Promise<Result<boolean, StorageFailure>>;
  /** Never fails: a missing image or a storage failure gives `null`. */
  logoUrl: (imageId: ImageId) => Promise<string | null>;
  /** The public buyer read keeps this adapter, which does not log. */
  imageUrl: ImageUrlResolver;
}>;

export type PreviewDependencies = Readonly<{
  companyName: (companyId: CompanyId) => Promise<Result<string, StorageFailure>>;
  paymentMethods: (companyId: CompanyId) => Promise<Result<readonly PreviewPaymentMethod[], StorageFailure>>;
}>;

export async function getStoreAppearance(
  companyId: CompanyId, deps: Pick<AppearanceDependencies, "load" | "logoUrl">,
): Promise<Result<SellerStoreAppearance, StorageFailure>> {
  const loaded = await deps.load(companyId);
  if (!loaded.success) return loaded.error.code === "UNKNOWN_STORED_THEME" ? ok({ kind: "unknown_theme" }) : loaded;
  const appearance = loaded.data ?? defaultStoreAppearance;
  return ok({ kind: "readable", appearance, logoUrl: appearance.logoImageId ? await deps.logoUrl(appearance.logoImageId) : null });
}

export async function saveStoreAppearance(
  companyId: CompanyId, value: unknown, deps: Pick<AppearanceDependencies, "save" | "logoOwned" | "logoUrl">,
): Promise<Result<SavedStoreAppearance, StoreAppearanceFailure>> {
  const parsed = parseStoreAppearance(value);
  if (!parsed.success) return parsed;
  if (parsed.data.logoImageId) {
    const owned = await deps.logoOwned(companyId, parsed.data.logoImageId);
    if (!owned.success) return owned;
    if (!owned.data) return err({ code: "INVALID_IMAGE", message: "Logo image is unavailable" });
  }
  const saved = await deps.save(companyId, parsed.data);
  if (!saved.success) return saved;
  // The write has committed: a URL that cannot be built is part of the success, never a failed save.
  return ok({ appearance: parsed.data, logoUrl: parsed.data.logoImageId ? await deps.logoUrl(parsed.data.logoImageId) : null });
}

/** A missing or unreadable logo must never hide the rest of the appearance. */
async function logoUrlOf(appearance: StoreAppearance, imageUrl: ImageUrlResolver): Promise<string | null> {
  if (!appearance.logoImageId) return null;
  const resolved = await imageUrl(appearance.logoImageId);
  return resolved.success ? resolved.data : null;
}

export async function getPublicStoreAppearance(
  companyId: CompanyId, deps: Pick<AppearanceDependencies, "load" | "imageUrl">,
): Promise<PublicAppearanceResult> {
  const loaded = await deps.load(companyId);
  if (!loaded.success) return { kind: "fallback" };
  if (!loaded.data) return { kind: "default" };
  return { kind: "custom", appearance: { logoUrl: await logoUrlOf(loaded.data, deps.imageUrl), theme: loaded.data.theme } };
}

/** The iframe paints only the draft the editor sends, so the appearance is not read here. */
export async function getStorePreview(companyId: CompanyId, deps: PreviewDependencies): Promise<Result<StorePreview, StorageFailure>> {
  const [companyName, methods] = await Promise.all([deps.companyName(companyId), deps.paymentMethods(companyId)]);
  if (!companyName.success) return companyName;
  return ok({ companyName: companyName.data, paymentMethods: methods.success && methods.data.length ? methods.data : null });
}
