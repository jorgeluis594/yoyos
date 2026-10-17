import { err, ok } from "@shared/functional";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { log } from "@core/src/shared/infrastructure/logger";
import type { CompanyId } from "@core/src/features/orders";

/** Under RLS an unknown company reads as not published, the same as a hidden catalog. */
export async function readPublished(companyId: CompanyId) {
  try {
    const row = await prisma.company.findFirst({ where: { id: companyId }, select: { catalogPublished: true } });
    return ok(row?.catalogPublished ?? false);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_published", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}
