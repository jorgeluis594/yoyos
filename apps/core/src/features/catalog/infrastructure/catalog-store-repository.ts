import { err, ok } from "@shared/functional";
import { countryCurrencies, isCountry } from "@shared/country";
import type { CompanyId } from "@shared/identity";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { CatalogStore } from "@core/src/features/catalog/application/browse-catalog";
import type { PersistenceError } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";

/** Null when hidden or unknown (RLS reads both the same). The currency is the business's: products in another one are not shown. */
export async function readStore(companyId: CompanyId): Promise<Result<CatalogStore | null, PersistenceError>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { catalogPublished: true, name: true, country: true } });
    if (!company?.catalogPublished) return ok(null);
    if (isCountry(company.country)) return ok({ name: company.name, currency: countryCurrencies[company.country] });
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_store", errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
  } catch (cause) {
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_store", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
  }
  return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read catalog store" });
}

/** The currency of the seller's own company, hidden catalog included, for the editor preview. */
export async function readStoreCurrency(companyId: CompanyId): Promise<Result<Currency, PersistenceError>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { country: true } });
    if (company && isCountry(company.country)) return ok(countryCurrencies[company.country]);
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_preview_store", errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
  } catch (cause) {
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_preview_store", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
  }
  return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read catalog store" });
}
