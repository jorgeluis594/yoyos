import { err, ok } from "@shared/functional";
import { countryCurrencies, isCountry } from "@shared/country";
import type { Result } from "@shared/result";
import { initialDeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone, type DeliveryZone, type ZonedDeliveryMethod } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { DeliveryConfiguration, QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";
import { readDeliverySettings } from "@core/src/features/delivery-settings/infrastructure/delivery-settings-repository";
import { prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { log } from "@core/src/shared/infrastructure/logger";

export async function readDeliveryConfiguration(companyId: string, lockMode: "shared" | "exclusive"): Promise<Result<DeliveryConfiguration, QuotationStorageError>> {
  requireActiveTransaction(companyId);
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { country: true } });
    if (!company || !isCountry(company.country)) return err({ code: "INTERNAL_ERROR", message: "Invalid stored company country" });
    const settings = await readDeliverySettings(companyId, lockMode);
    if (!settings.success) return err({ code: settings.error.code === "PERSISTENCE_UNAVAILABLE" ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR", message: settings.error.message });
    const currency = countryCurrencies[company.country];
    // An absent settings row is the initial snapshot, even if another transaction creates it later.
    if (!settings.data) return ok({ country: company.country, currency, settings: initialDeliverySettings(), zones: [] });
    const rows = await prisma.deliveryZone.findMany({ where: { companyId }, include: { districts: { where: { companyId }, orderBy: { districtCode: "asc" } } }, orderBy: [{ method: "asc" }, { id: "asc" }] });
    const zones: DeliveryZone[] = [];
    for (const row of rows) {
      const parsed = parseDeliveryZone({ id: row.id, method: row.method, name: row.name, enabled: row.enabled,
        districtCodes: row.districts.map(district => district.districtCode), price: { amount: row.priceAmount.toNumber(), currency: row.priceCurrency } }, currency);
      if (!parsed.success) {
        log.error({ event: "delivery_zones_stored_data_invalid", companyId, zoneId: row.id }, "Invalid stored delivery zone");
        return err({ code: "INTERNAL_ERROR", message: "Invalid stored delivery zones" });
      }
      zones.push(parsed.data);
    }
    return ok({ country: company.country, currency, settings: settings.data, zones });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "delivery_zones_read_failed", companyId, err: cause }, "Unable to read delivery zones");
    return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to read delivery zones" });
  }
}

export async function writeDeliveryZones(companyId: string, method: ZonedDeliveryMethod, zones: readonly DeliveryZone[]): Promise<Result<null, QuotationStorageError>> {
  requireActiveTransaction(companyId);
  try {
    for (const zone of zones) {
      if (zone.method !== method) return err({ code: "INTERNAL_ERROR", message: "Zone method differs from the persistence scope" });
      const data = { name: zone.name, enabled: zone.enabled, priceAmount: zone.price.amount, priceCurrency: zone.price.currency };
      const updated = await prisma.deliveryZone.updateMany({ where: { companyId, method, id: zone.id }, data });
      if (updated.count === 0) await prisma.deliveryZone.create({ data: { companyId, method, id: zone.id, ...data } });
      await prisma.deliveryZoneDistrict.deleteMany({ where: { companyId, method, zoneId: zone.id } });
      await prisma.deliveryZoneDistrict.createMany({ data: zone.districtCodes.map(districtCode => ({ companyId, method, zoneId: zone.id, districtCode })) });
    }
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "delivery_zones_write_failed", companyId, err: cause }, "Unable to save delivery zones");
    return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to save delivery zones" });
  }
}
