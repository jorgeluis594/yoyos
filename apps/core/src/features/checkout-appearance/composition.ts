import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findAvailablePublicImage, resolvePublicImage } from "@core/src/shared/images";
import { companyPaymentSettings } from "@core/src/features/companies";
import {
  getCheckoutAppearance, getCheckoutAppearancePreview, getPublicCheckoutAppearance, saveCheckoutAppearance,
  type AppearanceDependencies, type PreviewPaymentMethod,
} from "@core/src/features/checkout-appearance/application/checkout-appearance";
import {
  isDefaultCheckoutAppearance, type CompanyId, type ImageId, type UserId,
} from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import {
  loadCheckoutAppearance, loadCompanyName, persistCheckoutAppearance,
} from "@core/src/features/checkout-appearance/infrastructure/checkout-appearance-repository";

async function imageUrl(imageId: string): ReturnType<AppearanceDependencies["imageUrl"]> {
  const resolved = await resolvePublicImage(imageId);
  return resolved.success ? { success: true, data: resolved.data?.url ?? null } : { success: false, error: { message: resolved.error.message } };
}

const dependencies: AppearanceDependencies = {
  load: loadCheckoutAppearance,
  save: persistCheckoutAppearance,
  imageAvailable: async (companyId: CompanyId, imageId: ImageId) => {
    if (getCompanyId() !== companyId) throw new Error("Checkout appearance company differs from tenant context");
    const found = await findAvailablePublicImage(imageId);
    return found.success ? { success: true, data: found.data !== null }
      : { success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "Unable to verify logo image" } };
  },
  imageUrl,
};

async function paymentMethods(companyId: CompanyId) {
  const settings = await companyPaymentSettings.get(companyId);
  if (!settings.success) return { success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "Payment settings unavailable" } };
  const methods: PreviewPaymentMethod[] = [];
  for (const item of settings.data) {
    // Payment image URLs are decorative in the preview; a missing one must not hide the method.
    const resolved = item.imageId ? await imageUrl(item.imageId) : null;
    const url = resolved?.success ? resolved.data : null;
    methods.push(item.method === "digital_wallet"
      ? { method: item.method, provider: item.provider, holder: item.holder, imageUrl: url }
      : { method: item.method, bank: item.bank, holder: item.holder, accountNumber: item.accountNumber, cci: item.cci, imageUrl: url });
  }
  return { success: true as const, data: methods };
}

export const checkoutAppearance = {
  get: (companyId: CompanyId) => getCheckoutAppearance(companyId, dependencies),
  save: async (companyId: CompanyId, userId: UserId, value: unknown) => {
    const result = await saveCheckoutAppearance(companyId, value, dependencies);
    if (result.success) log.info({ event: "checkout_appearance_saved", companyId, userId,
      ...(result.data.logoImageId ? { logoImageId: result.data.logoImageId } : {}), hasLogo: result.data.logoImageId !== null,
      brandColor: result.data.brandColor, background: result.data.background, isDefault: isDefaultCheckoutAppearance(result.data) },
    "checkout_appearance_saved");
    return result;
  },
  getPublic: (companyId: CompanyId) => withTenantIsolation(companyId, () => getPublicCheckoutAppearance(companyId, dependencies)),
  getPreview: (companyId: CompanyId) => getCheckoutAppearancePreview(companyId, { ...dependencies, companyName: loadCompanyName, paymentMethods }),
};
