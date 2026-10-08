import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Currency, Money } from "@shared/money";
import type { PeruDistrictCode } from "@shared/peru-geography";
import type { Result } from "@shared/result";
import type { DeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import type { DeliveryZone, DeliveryZoneId, ZonedDeliveryMethod } from "@core/src/features/delivery-settings/domain/delivery-zone";
import { applicableDeliveryZones, type DeliveryRateId, type DeliverySettingsVersion, type QuotationId, type RateWithQuotation } from "@core/src/features/delivery-settings/domain/quotation";

export type ResolveSelectedRateInput = Readonly<{
  companyId: CompanyId; rateId: DeliveryRateId; method: ZonedDeliveryMethod; districtCode: PeruDistrictCode;
}>;
export type ResolvedDeliveryRate = Readonly<{
  quotationId: QuotationId; rateId: DeliveryRateId; price: Money; settingsVersion: DeliverySettingsVersion;
  method: ZonedDeliveryMethod; zoneId: DeliveryZoneId;
}>;
export type SelectedRateError = Readonly<{ code: "RATE_UNAVAILABLE"; message: string }>
  | Readonly<{ code: "TOTAL_CHANGED"; message: string; currentPrice: Money }>;

export function validateSelectedDeliveryRate(input: ResolveSelectedRateInput, value: RateWithQuotation | null,
  settings: DeliverySettings, zones: readonly DeliveryZone[], currency: Currency): Result<ResolvedDeliveryRate, SelectedRateError> {
  const unavailable = () => err<SelectedRateError>({ code: "RATE_UNAVAILABLE", message: "Selected delivery rate is unavailable" });
  if (!value) return unavailable();
  const { quotation, rate } = value;
  if (rate.id !== input.rateId || rate.companyId !== input.companyId || quotation.companyId !== input.companyId ||
    rate.quotationId !== quotation.id || rate.method !== input.method || rate.districtCode !== input.districtCode ||
    quotation.destination.districtCode !== input.districtCode || quotation.destination.country !== "PE" || rate.price.currency !== currency)
    return unavailable();
  const zone = applicableDeliveryZones(settings, zones, input.districtCode).find(zone => zone.id === rate.zoneId && zone.method === input.method);
  if (!zone || zone.price.currency !== currency) return unavailable();
  if (zone.price.amount !== rate.price.amount)
    return err({ code: "TOTAL_CHANGED", message: "Delivery price changed", currentPrice: { ...zone.price } });
  return ok({ quotationId: quotation.id, rateId: rate.id, price: { ...rate.price }, settingsVersion: rate.settingsVersion,
    method: rate.method, zoneId: rate.zoneId });
}
