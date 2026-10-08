import { err } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import type { DeliveryConfiguration, QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";
import type { DeliveryRateId, RateWithQuotation } from "@core/src/features/delivery-settings/domain/quotation";
import { validateSelectedDeliveryRate, type ResolvedDeliveryRate, type ResolveSelectedRateInput, type SelectedRateError } from "@core/src/features/delivery-settings/domain/selected-delivery-rate";

export type ResolveRateError = SelectedRateError | QuotationStorageError;
export type ResolveSelectedRateDependencies = Readonly<{
  readConfigurationForShare: (companyId: CompanyId) => Promise<Result<DeliveryConfiguration, QuotationStorageError>>;
  findRateWithQuotation: (companyId: CompanyId, rateId: DeliveryRateId) => Promise<Result<RateWithQuotation | null, QuotationStorageError>>;
}>;

// The caller keeps the configuration lock through the order's atomic write.
export async function resolveSelectedDeliveryRate(input: ResolveSelectedRateInput, deps: ResolveSelectedRateDependencies): Promise<Result<ResolvedDeliveryRate, ResolveRateError>> {
  const loaded = await deps.readConfigurationForShare(input.companyId);
  if (!loaded.success) return loaded;
  const configuration = loaded.data;
  if (configuration.country !== "PE" || configuration.currency !== "PEN")
    return err({ code: "RATE_UNAVAILABLE", message: "Selected delivery rate is unavailable" });
  const found = await deps.findRateWithQuotation(input.companyId, input.rateId);
  return found.success ? validateSelectedDeliveryRate(input, found.data, configuration.settings, configuration.zones, configuration.currency) : found;
}
