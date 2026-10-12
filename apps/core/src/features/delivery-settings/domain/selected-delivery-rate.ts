import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { compare, type Money } from "@shared/money";
import type { PeruDistrictCode } from "@shared/peru-geography";
import type { Result } from "@shared/result";
import type { DeliveryAgencyId } from "@core/src/features/delivery-settings/domain/delivery-agency";
import type { DeliveryOptionId } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { applicableDeliveryOptions, type DeliveryConfiguration, type DeliveryRateId, type DeliverySettingsVersion, type QuotationId, type RateWithQuotation } from "@core/src/features/delivery-settings/domain/quotation";

export type ResolveSelectedRateInput =
  | Readonly<{ companyId: CompanyId; rateId: DeliveryRateId; method: "home"; districtCode: PeruDistrictCode }>
  | Readonly<{ companyId: CompanyId; rateId: DeliveryRateId; method: "agency"; districtCode: PeruDistrictCode; agencyId: DeliveryAgencyId }>;
type ResolvedRateBase = Readonly<{
  quotationId: QuotationId; rateId: DeliveryRateId; optionId: DeliveryOptionId; price: Money; settingsVersion: DeliverySettingsVersion;
}>;
export type ResolvedDeliveryRate =
  | ResolvedRateBase & Readonly<{ method: "home" }>
  | ResolvedRateBase & Readonly<{
      method: "agency";
      courier: Readonly<{ id: CourierId; name: string }>;
      agency: Readonly<{ id: DeliveryAgencyId; name: string; address: string; districtCode: PeruDistrictCode }>;
    }>;
export type SelectedRateError = Readonly<{ code: "RATE_UNAVAILABLE"; message: string }>
  | Readonly<{ code: "TOTAL_CHANGED"; message: string; currentPrice: Money }>;

export function validateSelectedDeliveryRate(input: ResolveSelectedRateInput, value: RateWithQuotation | null,
  configuration: DeliveryConfiguration): Result<ResolvedDeliveryRate, SelectedRateError> {
  const unavailable = () => err<SelectedRateError>({ code: "RATE_UNAVAILABLE", message: "Selected delivery rate is unavailable" });
  if (!value) return unavailable();
  const { quotation, rate } = value;
  if (rate.id !== input.rateId || rate.companyId !== input.companyId || quotation.companyId !== input.companyId ||
    rate.quotationId !== quotation.id || rate.method !== input.method || rate.districtCode !== input.districtCode ||
    quotation.destination.districtCode !== input.districtCode || quotation.destination.country !== "PE" || rate.price.currency !== configuration.currency)
    return unavailable();
  const applicable = applicableDeliveryOptions(configuration, input.districtCode).find(entry => entry.option.id === rate.optionId && entry.option.method === input.method);
  if (!applicable || applicable.option.price.currency !== configuration.currency) return unavailable();
  // The agency is checked before the price: a vanished agency is unavailable even when the price also changed.
  const eligible = "agencies" in applicable && input.method === "agency" ? applicable.agencies.find(value => value.agency.id === input.agencyId) : undefined;
  if (input.method === "agency" && !eligible) return unavailable();
  const price = compare(rate.price)(applicable.option.price);
  if (!price.success) return unavailable();
  if (price.data !== 0)
    return err({ code: "TOTAL_CHANGED", message: "Delivery price changed", currentPrice: { ...applicable.option.price } });
  const base = { quotationId: quotation.id, rateId: rate.id, optionId: rate.optionId, price: { ...rate.price }, settingsVersion: rate.settingsVersion };
  if (!eligible) return ok({ ...base, method: "home" });
  const { agency, courier } = eligible;
  return ok({ ...base, method: "agency", courier: { id: courier.id, name: courier.name },
    agency: { id: agency.id, name: agency.name, address: agency.address, districtCode: agency.districtCode } });
}
