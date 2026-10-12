import { err, ok } from "@shared/functional";
import { peruDeliveryDistrict } from "@shared/peru-geography";
import type { Result } from "@shared/result";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { log } from "@core/src/shared/infrastructure/logger";
import { parseDeliveryAgency, type DeliveryAgency } from "@core/src/features/delivery-settings/domain/delivery-agency";
import type { CourierCatalogId, DeliverySettingsReadError } from "@core/src/features/delivery-settings/domain/delivery-settings";

type AgencyRow = { id: string; courierId: string; name: string; address: string; districtCode: string; enabled: boolean; courier: { enabled: boolean } };

function parseRows(rows: readonly AgencyRow[], event: string): Result<readonly DeliveryAgency[], DeliverySettingsReadError> {
  const agencies: DeliveryAgency[] = [];
  for (const { courier, ...row } of rows) {
    const parsed = parseDeliveryAgency({ ...row, courierEnabled: courier.enabled });
    if (!parsed.success) {
      log.error({ event, agencyId: row.id }, "Stored delivery agency is invalid");
      return parsed;
    }
    agencies.push(parsed.data);
  }
  return ok(agencies);
}

function persistenceError(cause: unknown, event: string): Result<never, DeliverySettingsReadError> {
  if (!isPersistenceFailure(cause)) throw cause;
  log.error({ event, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "Unable to read delivery agencies");
  return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read delivery agencies" });
}

export async function readAgencies(ids: readonly string[]): Promise<Result<readonly DeliveryAgency[], DeliverySettingsReadError>> {
  try {
    const rows = await prisma.deliveryAgency.findMany({ where: { id: { in: [...ids] } }, orderBy: { id: "asc" }, include: { courier: { select: { enabled: true } } } });
    return parseRows(rows, "delivery_agencies_stored_data_invalid");
  } catch (cause) { return persistenceError(cause, "delivery_agencies_read_failed"); }
}

// Sorted in memory: department and district order is by catalog name, not by the numeric code the database sorts by.
const byLocation = (a: DeliveryAgency, b: DeliveryAgency) => {
  const left = peruDeliveryDistrict(a.districtCode), right = peruDeliveryDistrict(b.districtCode);
  return (left?.department ?? "").localeCompare(right?.department ?? "", "es") || (left?.district ?? "").localeCompare(right?.district ?? "", "es")
    || a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id);
};

export async function readAgencyCatalog(courierId: CourierCatalogId): Promise<Result<readonly DeliveryAgency[], DeliverySettingsReadError>> {
  try {
    const rows = await prisma.deliveryAgency.findMany({ where: { courierId, enabled: true }, include: { courier: { select: { enabled: true } } } });
    const parsed = parseRows(rows, "agency_catalog_stored_data_invalid");
    return parsed.success ? ok([...parsed.data].sort(byLocation)) : parsed;
  } catch (cause) { return persistenceError(cause, "agency_catalog_read_failed"); }
}
