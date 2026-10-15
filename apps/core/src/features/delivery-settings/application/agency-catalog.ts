import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import type { CourierCatalogEntry, CourierCatalogId, DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";

export type AgencyCatalogError = DeliverySettingsReadError | Readonly<{ code: "NOT_FOUND"; message: string }>;
export type AgencyCatalogDependencies = Readonly<{
  readCourierCatalog: () => Promise<Result<readonly CourierCatalogEntry[], DeliverySettingsReadError>>;
  readAgencyCatalog: (courierId: CourierCatalogId) => Promise<Result<readonly DeliveryAgency[], DeliverySettingsReadError>>;
}>;

/** Agencies of an enabled catalog courier: a company browses them before it ships with that courier, and choosing one enables it. */
export async function getAgencyCatalog(courierId: CourierCatalogId, deps: AgencyCatalogDependencies): Promise<Result<readonly DeliveryAgency[], AgencyCatalogError>> {
  const catalog = await deps.readCourierCatalog();
  if (!catalog.success) return catalog;
  if (!catalog.data.some(courier => courier.id === courierId)) return err({ code: "NOT_FOUND", message: "Courier not found" });
  return deps.readAgencyCatalog(courierId);
}
