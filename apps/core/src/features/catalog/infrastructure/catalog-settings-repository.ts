import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { CatalogSettingsError, CompanyId } from "@core/src/features/catalog/application/catalog-settings";

const unavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });

export async function readPublished(companyId: CompanyId): Promise<Result<boolean, CatalogSettingsError>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { catalogPublished: true } });
    if (company) return ok(company.catalogPublished);
    return unavailable("Company not found");
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_catalog_settings", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
    return unavailable("Unable to read catalog settings");
  }
}

export async function savePublished(companyId: CompanyId, published: boolean): Promise<Result<null, CatalogSettingsError>> {
  try {
    await prisma.company.update({ where: { id: companyId }, data: { catalogPublished: published } });
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_catalog_settings", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_catalog_settings");
    return unavailable("Unable to save catalog settings");
  }
}
