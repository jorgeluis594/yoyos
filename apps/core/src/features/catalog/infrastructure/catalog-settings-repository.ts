import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";

export type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** Under RLS an unknown company reads as unpublished, the same as a hidden catalog. */
export async function readPublished(companyId: CompanyId): Promise<Result<boolean, PersistenceError>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { catalogPublished: true } });
    return ok(company?.catalogPublished ?? false);
  } catch (cause) {
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_published", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read catalog setting" });
  }
}
