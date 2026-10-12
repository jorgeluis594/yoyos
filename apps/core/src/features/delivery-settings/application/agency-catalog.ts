import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import type { CourierCatalogId, DeliverySettings, DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";

export type AgencyCatalogError = DeliverySettingsReadError | Readonly<{ code: "NOT_FOUND"; message: string }>;
export type AgencyCatalogDependencies = Readonly<{
  readSettings: (companyId: string) => Promise<Result<DeliverySettings | null, DeliverySettingsReadError>>;
  readAgencyCatalog: (courierId: CourierCatalogId) => Promise<Result<readonly DeliveryAgency[], DeliverySettingsReadError>>;
}>;

/** Agencies of a catalog courier, only for companies that have that courier configured (enabled or not). */
export async function getAgencyCatalog(courierId: CourierCatalogId, context: Readonly<{ companyId: string }>,
  deps: AgencyCatalogDependencies): Promise<Result<readonly DeliveryAgency[], AgencyCatalogError>> {
  const settings = await deps.readSettings(context.companyId);
  if (!settings.success) return settings;
  if (!settings.data?.couriers.some(courier => courier.catalogId === courierId)) return err({ code: "NOT_FOUND", message: "Courier not found" });
  return deps.readAgencyCatalog(courierId);
}
