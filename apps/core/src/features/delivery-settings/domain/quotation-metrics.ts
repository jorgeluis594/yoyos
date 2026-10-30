import type { PeruDistrictCode } from "@shared/peru-geography";
import { getPeruDistrict } from "@shared/peru-geography";
import type { QuotedDeliveryRate } from "@core/src/features/delivery-settings/domain/quotation";

/** Counts the agency rates with at least one agency in the department of the destination. */
export function agencyRatesInDestinationDepartment(rates: readonly QuotedDeliveryRate[], destination: PeruDistrictCode): number {
  const department = getPeruDistrict(destination)?.departmentCode;
  if (department === undefined) return 0;
  return rates.filter(quoted => "agencies" in quoted
    && quoted.agencies.some(({ agency }) => getPeruDistrict(agency.districtCode)?.departmentCode === department)).length;
}
