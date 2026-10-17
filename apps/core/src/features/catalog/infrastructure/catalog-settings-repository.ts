import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";

export type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

const unavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });

/** Under RLS an unknown company reads as unpublished, the same as a hidden catalog. */
export async function readPublished(companyId: CompanyId): Promise<Result<boolean, PersistenceError>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { catalogPublished: true } });
    return ok(company?.catalogPublished ?? false);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_published", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
    return unavailable("Unable to read catalog setting");
  }
}

export async function savePublished(companyId: CompanyId, published: boolean): Promise<Result<null, PersistenceError>> {
  try {
    await prisma.company.update({ where: { id: companyId }, data: { catalogPublished: published } });
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_catalog_settings", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_catalog_settings");
    return unavailable("Unable to save catalog settings");
  }
}
