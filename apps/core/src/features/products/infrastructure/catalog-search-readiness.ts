import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";

/** Active product with at least one active variant (the company is the RLS one). */
export async function hasActiveProducts() {
  try {
    const rows = await prisma.$queryRaw<Array<{ active: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM "Product" p WHERE p.status = 'active'
        AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')) AS active`;
    return ok(rows[0]?.active === true);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    log.error({ event: "unable_to_check_active_products", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_check_active_products");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}
