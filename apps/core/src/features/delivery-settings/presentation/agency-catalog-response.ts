import { agencyCatalogSchema } from "@shared/contracts/delivery-settings";
import { peruDeliveryDistrict } from "@shared/peru-geography";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";

export function parseAgencyCatalogResponse(agencies: readonly DeliveryAgency[]) {
  return agencyCatalogSchema.safeParse({ agencies: agencies.map(agency => ({ id: agency.id, courierId: agency.courierId, name: agency.name,
    address: agency.address, location: peruDeliveryDistrict(agency.districtCode), enabled: agency.enabled })) });
}
