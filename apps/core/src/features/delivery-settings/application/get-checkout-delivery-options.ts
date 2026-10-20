import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import type { QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";
import type { DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { hasAgencyCoverage, type DeliveryConfiguration } from "@core/src/features/delivery-settings/domain/quotation";

export type GetCheckoutDeliveryOptionsInput = Readonly<{ companyId: CompanyId }>;
export type CheckoutDeliveryOptionsView = Readonly<{ settings: DeliverySettings; agencyCovered: boolean }>;
export type GetCheckoutDeliveryOptionsDependencies = Readonly<{
  readConfigurationForShare: (companyId: CompanyId) => Promise<Result<DeliveryConfiguration, QuotationStorageError>>;
}>;

export async function getCheckoutDeliveryOptions(input: GetCheckoutDeliveryOptionsInput, deps: GetCheckoutDeliveryOptionsDependencies)
  : Promise<Result<CheckoutDeliveryOptionsView, QuotationStorageError>> {
  const loaded = await deps.readConfigurationForShare(input.companyId);
  return loaded.success ? { success: true, data: { settings: loaded.data.settings, agencyCovered: hasAgencyCoverage(loaded.data) } } : loaded;
}
