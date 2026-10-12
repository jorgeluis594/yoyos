import type { PeruDistrictCode } from "@shared/peru-geography";
import type { CourierCatalogId } from "@core/src/features/delivery-settings/domain/delivery-settings";

export type DeliveryAgencyId = string & { readonly __brand: "DeliveryAgencyId" };
// System catalog row; T4 adds its reader and parser.
export type DeliveryAgency = Readonly<{
  id: DeliveryAgencyId; courierId: CourierCatalogId; name: string; address: string; districtCode: PeruDistrictCode;
  enabled: boolean; courierEnabled: boolean;
}>;
