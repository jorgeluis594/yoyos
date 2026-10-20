import { err, ok } from "@shared/functional";
import { countryCurrencies, isCountry } from "@shared/country";
import type { Result } from "@shared/result";
import { initialDeliverySettings } from "@core/src/features/delivery-settings/domain/delivery-settings";
import { parseDeliveryZone, type DeliveryZone } from "@core/src/features/delivery-settings/domain/delivery-zone";
import type { DeliveryConfiguration } from "@core/src/features/delivery-settings/domain/quotation";
import type { QuotationStorageError } from "@core/src/features/delivery-settings/application/create-quotation";
import { readDeliverySettings } from "@core/src/features/delivery-settings/infrastructure/delivery-settings-repository";
import { readAgencies } from "@core/src/features/delivery-settings/infrastructure/agency-catalog-repository";
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
    if (!settings.data) return ok({ country: company.country, currency, settings: initialDeliverySettings(), zones: [], agencies: [] });
    const rows = await prisma.deliveryZone.findMany({ where: { companyId }, orderBy: { id: "asc" }, include: {
      departments: { where: { companyId }, orderBy: { departmentCode: "asc" } },
      provinces: { where: { companyId }, orderBy: { provinceCode: "asc" } },
      districts: { where: { companyId }, orderBy: { districtCode: "asc" } },
      options: { where: { companyId }, orderBy: { id: "asc" }, include: { agencies: { where: { companyId }, orderBy: { agencyId: "asc" } } } } } });
    const zones: DeliveryZone[] = [];
    for (const row of rows) {
      const parsed = parseDeliveryZone({ id: row.id, name: row.name, enabled: row.enabled, departmentCodes: row.departments.map(department => department.departmentCode),
        provinceCodes: row.provinces.map(province => province.provinceCode), districtCodes: row.districts.map(district => district.districtCode),
        options: row.options.map(option => ({ id: option.id, method: option.method, name: option.name, enabled: option.enabled,
          price: { amount: option.priceAmount.toNumber(), currency: option.priceCurrency },
          ...(option.method === "agency" ? { agencyIds: option.agencies.map(agency => agency.agencyId) } : {}) })) }, currency);
      if (!parsed.success) {
        log.error({ event: "delivery_zones_stored_data_invalid", companyId, zoneId: row.id }, "Invalid stored delivery zone");
        return err({ code: "INTERNAL_ERROR", message: "Invalid stored delivery zones" });
      }
      zones.push(parsed.data);
    }
    const agencyIds = [...new Set(zones.flatMap(zone => zone.options.flatMap(option => option.method === "agency" ? option.agencyIds : [])))];
    const agencies = await readAgencies(agencyIds);
    if (!agencies.success) return err({ code: agencies.error.code === "PERSISTENCE_UNAVAILABLE" ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR", message: agencies.error.message });
    return ok({ country: company.country, currency, settings: settings.data, zones, agencies: agencies.data });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "delivery_zones_read_failed", companyId, err: cause }, "Unable to read delivery zones");
    return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to read delivery zones" });
  }
}

export async function writeDeliveryZones(companyId: string, zones: readonly DeliveryZone[]): Promise<Result<null, QuotationStorageError>> {
  requireActiveTransaction(companyId);
  try {
    for (const zone of zones) {
      const data = { name: zone.name, enabled: zone.enabled };
      const updated = await prisma.deliveryZone.updateMany({ where: { companyId, id: zone.id }, data });
      if (updated.count === 0) await prisma.deliveryZone.create({ data: { companyId, id: zone.id, ...data } });
      await prisma.deliveryZoneDistrict.deleteMany({ where: { companyId, zoneId: zone.id } });
      await prisma.deliveryZoneDepartment.deleteMany({ where: { companyId, zoneId: zone.id } });
      await prisma.deliveryZoneProvince.deleteMany({ where: { companyId, zoneId: zone.id } });
      if (zone.departmentCodes.length > 0)
        await prisma.deliveryZoneDepartment.createMany({ data: zone.departmentCodes.map(departmentCode => ({ companyId, zoneId: zone.id, departmentCode })) });
      if (zone.provinceCodes.length > 0)
        await prisma.deliveryZoneProvince.createMany({ data: zone.provinceCodes.map(provinceCode => ({ companyId, zoneId: zone.id, provinceCode })) });
      if (zone.districtCodes.length > 0)
        await prisma.deliveryZoneDistrict.createMany({ data: zone.districtCodes.map(districtCode => ({ companyId, zoneId: zone.id, districtCode })) });
      for (const option of zone.options) {
        const fields = { name: option.name, enabled: option.enabled, priceAmount: option.price.amount, priceCurrency: option.price.currency };
        const changed = await prisma.deliveryOption.updateMany({ where: { companyId, id: option.id }, data: fields });
        if (changed.count === 0) await prisma.deliveryOption.create({ data: { companyId, id: option.id, zoneId: zone.id, method: option.method, ...fields } });
        await prisma.deliveryOptionAgency.deleteMany({ where: { companyId, optionId: option.id } });
        if (option.method === "agency")
          await prisma.deliveryOptionAgency.createMany({ data: option.agencyIds.map(agencyId => ({ companyId, optionId: option.id, agencyId })) });
      }
    }
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "delivery_zones_write_failed", companyId, err: cause }, "Unable to save delivery zones");
    return err({ code: "SERVICE_UNAVAILABLE", message: "Unable to save delivery zones" });
  }
}
