import { err, ok } from "@shared/functional";
import { countryCurrencies, isCountry } from "@shared/country";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { CatalogStore } from "@core/src/features/catalog/application/browse-catalog";
import type { PersistenceError } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";

/** Name for the header and the business currency: products in another currency are not shown. */
export async function readStore(companyId: CompanyId): Promise<Result<CatalogStore | null, PersistenceError>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true, country: true } });
    if (!company) return ok(null);
    if (isCountry(company.country)) return ok({ name: company.name, currency: countryCurrencies[company.country] });
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_store", errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
  } catch (cause) {
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_store", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
  }
  return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read catalog store" });
}
