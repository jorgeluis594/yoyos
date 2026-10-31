import type { CompanyId } from "@shared/identity";
import type { DeliveryCoverage } from "@shared/delivery-coverage";
import type { Result } from "@shared/result";
import type { QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";
import type { DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { checkoutCoverage, type DeliveryConfiguration } from "@core/src/features/delivery-settings/domain/quotation";

export type GetCheckoutDeliveryOptionsInput = Readonly<{ companyId: CompanyId }>;
export type CheckoutDeliveryOptionsView = Readonly<{ settings: DeliverySettings; coverage: DeliveryCoverage }>;
export type GetCheckoutDeliveryOptionsDependencies = Readonly<{
  readConfigurationForShare: (companyId: CompanyId) => Promise<Result<DeliveryConfiguration, QuotationStorageError>>;
}>;

export async function getCheckoutDeliveryOptions(input: GetCheckoutDeliveryOptionsInput, deps: GetCheckoutDeliveryOptionsDependencies)
  : Promise<Result<CheckoutDeliveryOptionsView, QuotationStorageError>> {
  const loaded = await deps.readConfigurationForShare(input.companyId);
  return loaded.success ? { success: true, data: { settings: loaded.data.settings, coverage: checkoutCoverage(loaded.data) } } : loaded;
}
