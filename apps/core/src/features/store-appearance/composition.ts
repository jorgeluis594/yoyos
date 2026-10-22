import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findAvailablePublicImage, resolvePublicImage } from "@core/src/shared/images";
import { companyPaymentSettings } from "@core/src/features/companies";
import {
  getStoreAppearance, getStorePreview, getPublicStoreAppearance, saveStoreAppearance,
  type AppearanceDependencies, type PreviewPaymentMethod,
} from "@core/src/features/store-appearance/application/store-appearance";
import {
  isDefaultStoreAppearance, parseImageId, type CompanyId, type ImageId, type UserId,
} from "@core/src/features/store-appearance/domain/store-appearance";
import {
  loadStoreAppearance, loadCompanyName, persistStoreAppearance,
} from "@core/src/features/store-appearance/infrastructure/store-appearance-repository";

const imageUrl: AppearanceDependencies["imageUrl"] = async (imageId) => {
  const resolved = await resolvePublicImage(imageId);
  return resolved.success ? { success: true, data: resolved.data?.url ?? null } : { success: false, error: { message: resolved.error.message } };
};

const dependencies: Omit<AppearanceDependencies, "logoUrl"> = {
  load: loadStoreAppearance,
  save: persistStoreAppearance,
  logoOwned: async (companyId: CompanyId, imageId: ImageId) => {
    if (getCompanyId() !== companyId) throw new Error("Store appearance company differs from tenant context");
    const found = await findAvailablePublicImage(imageId);
    return found.success ? { success: true, data: found.data !== null }
      : { success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "Unable to verify logo image" } };
  },
  imageUrl,
};

/** The seller read and the save never fail because of the logo URL; the failure is logged once per call. */
function logoUrlFor(companyId: CompanyId, operation: "get_store_appearance" | "save_store_appearance"): AppearanceDependencies["logoUrl"] {
  return async (imageId) => {
    const resolved = await resolvePublicImage(imageId);
    if (resolved.success) return resolved.data?.url ?? null;
    log.warn({ event: "store_logo_url_unavailable", companyId, operation, errorCode: resolved.error.code ?? "IMAGE_STORAGE_UNAVAILABLE", err: resolved.error },
      "store_logo_url_unavailable");
    return null;
  };
}

/** Payment image URLs are decorative in the preview; a missing or unresolvable one must not hide the method. */
async function paymentImageUrl(imageId: string | null): Promise<string | null> {
  const id = imageId ? parseImageId(imageId) : null;
  if (!id?.success) return null;
  const resolved = await imageUrl(id.data);
  return resolved.success ? resolved.data : null;
}

async function paymentMethods(companyId: CompanyId) {
  const settings = await companyPaymentSettings.get(companyId);
  // The payment settings repository already logs its own failures, so none is logged here.
  if (!settings.success) return { success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "Payment settings unavailable" } };
  const methods = await Promise.all(settings.data.map(async (item): Promise<PreviewPaymentMethod> => {
    const url = await paymentImageUrl(item.imageId);
    return item.method === "digital_wallet"
      ? { method: item.method, provider: item.provider, holder: item.holder, imageUrl: url }
      : { method: item.method, bank: item.bank, holder: item.holder, accountNumber: item.accountNumber, cci: item.cci, imageUrl: url };
  }));
  return { success: true as const, data: methods };
}

export const storeAppearance = {
  get: (companyId: CompanyId) => getStoreAppearance(companyId, { ...dependencies, logoUrl: logoUrlFor(companyId, "get_store_appearance") }),
  save: async (companyId: CompanyId, userId: UserId, value: unknown) => {
    const result = await saveStoreAppearance(companyId, value, { ...dependencies, logoUrl: logoUrlFor(companyId, "save_store_appearance") });
    if (result.success) log.info({ event: "store_appearance_saved", companyId, userId,
      ...(result.data.appearance.logoImageId ? { logoImageId: result.data.appearance.logoImageId } : {}), hasLogo: result.data.appearance.logoImageId !== null,
      theme: result.data.appearance.theme, isDefault: isDefaultStoreAppearance(result.data.appearance) },
    "store_appearance_saved");
    return result;
  },
  getPublic: (companyId: CompanyId) => withTenantIsolation(companyId, () => getPublicStoreAppearance(companyId, { ...dependencies })),
  getPreview: (companyId: CompanyId) => getStorePreview(companyId, { companyName: loadCompanyName, paymentMethods }),
};
