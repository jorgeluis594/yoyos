import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId } from "@core/src/shared/infrastructure/persistance";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { getPaymentSettings, savePaymentSettings } from "@core/src/features/companies/application/payment-settings";
import { loadPaymentSettings, persistPaymentSettings } from "@core/src/features/companies/infrastructure/payment-settings-repository";

const dependencies = { load: loadPaymentSettings, save: persistPaymentSettings,
  imageAvailable: async (companyId: string, imageId: string) => {
    if (getCompanyId() !== companyId) throw new Error("Payment settings company differs from tenant context");
    const found = await imageRepository.find(imageId);
    return found.success ? { success: true as const, data: found.data?.visibility === "public" } : found;
  } };

export const companyPaymentSettings = {
  get: (companyId: string) => getPaymentSettings(companyId, dependencies),
  save: async (companyId: string, userId: string, value: unknown) => {
    const result = await savePaymentSettings(companyId, value, dependencies);
    if (result.success) log.info({ event: "company_payment_settings_saved", companyId, userId,
      methodsCount: result.data.length }, "company_payment_settings_saved");
    return result;
  },
};
