import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import {
  defaultStoreAppearance, parseStoreAppearance,
  type StoreAppearance, type StoreAppearanceError, type CompanyId, type ImageId,
} from "@core/src/features/store-appearance/domain/store-appearance";
import type { StoreThemeId } from "@shared/store-themes";

export type StoreAppearanceFailure = StoreAppearanceError
  | Readonly<{ code: "INVALID_IMAGE" | "INVALID_STORED_DATA" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

type StorageFailure = Exclude<StoreAppearanceFailure, StoreAppearanceError>;

export type PublicAppearance = Readonly<{
  logoUrl: string | null;
  theme: StoreThemeId;
}>;

export type PublicAppearanceResult =
  | Readonly<{ kind: "default" }>
  | Readonly<{ kind: "custom"; appearance: PublicAppearance }>
  | Readonly<{ kind: "fallback" }>;

export type PreviewPaymentMethod =
  | Readonly<{ method: "digital_wallet"; provider: string; holder: string; imageUrl: string | null }>
  | Readonly<{ method: "bank_transfer"; bank: string; holder: string; accountNumber: string | null; cci: string | null; imageUrl: string | null }>;

export type StoreAppearancePreview = Readonly<{
  companyName: string;
  appearance: StoreAppearance;
  logoUrl: string | null;
  /** The company's real payment methods, or `null` when it has none. */
  paymentSettings: readonly PreviewPaymentMethod[] | null;
}>;

type ImageUrlResolver = (imageId: ImageId) => Promise<Result<string | null, Readonly<{ message: string }>>>;

export type AppearanceDependencies = Readonly<{
  load: (companyId: CompanyId) => Promise<Result<StoreAppearance | null, StorageFailure>>;
  save: (companyId: CompanyId, appearance: StoreAppearance) => Promise<Result<null, StorageFailure>>;
  imageAvailable: (companyId: CompanyId, imageId: ImageId) => Promise<Result<boolean, StorageFailure>>;
  imageUrl: ImageUrlResolver;
}>;

export type PreviewDependencies = Pick<AppearanceDependencies, "load" | "imageUrl"> & Readonly<{
  companyName: (companyId: CompanyId) => Promise<Result<string, StorageFailure>>;
  paymentMethods: (companyId: CompanyId) => Promise<Result<readonly PreviewPaymentMethod[], StorageFailure>>;
}>;

export function getStoreAppearance(companyId: CompanyId, deps: Pick<AppearanceDependencies, "load">) {
  return deps.load(companyId);
}

export async function saveStoreAppearance(
  companyId: CompanyId, value: unknown, deps: Pick<AppearanceDependencies, "save" | "imageAvailable">,
): Promise<Result<StoreAppearance, StoreAppearanceFailure>> {
  const parsed = parseStoreAppearance(value);
  if (!parsed.success) return parsed;
  if (parsed.data.logoImageId) {
    const available = await deps.imageAvailable(companyId, parsed.data.logoImageId);
    if (!available.success) return available;
    if (!available.data) return err({ code: "INVALID_IMAGE", message: "Logo image is unavailable" });
  }
  const saved = await deps.save(companyId, parsed.data);
  return saved.success ? ok(parsed.data) : saved;
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

export async function getStoreAppearancePreview(
  companyId: CompanyId, deps: PreviewDependencies,
): Promise<Result<StoreAppearancePreview, StorageFailure>> {
  const [loaded, companyName, methods] = await Promise.all([deps.load(companyId), deps.companyName(companyId), deps.paymentMethods(companyId)]);
  if (!loaded.success) return loaded;
  if (!companyName.success) return companyName;
  if (!methods.success) return methods;
  const appearance = loaded.data ?? defaultStoreAppearance;
  return ok({ companyName: companyName.data, appearance, logoUrl: await logoUrlOf(appearance, deps.imageUrl),
    paymentSettings: methods.data.length ? methods.data : null });
}
