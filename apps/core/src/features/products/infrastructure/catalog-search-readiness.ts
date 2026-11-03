import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";

/**
 * Whether the company (RLS) has products with an active variant, and whether some is offered (not hidden).
 * Two short-circuit EXISTS in one statement: a store with visible products answers at the first row, never an aggregate over every product.
 */
export async function productPresence() {
  try {
    const rows = await prisma.$queryRaw<Array<{ any: boolean; offered: boolean }>>(presenceQuery);
    return ok(rows[0]?.offered ? ("offered" as const) : rows[0]?.any ? ("hidden_only" as const) : ("none" as const));
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    log.error({ event: "unable_to_check_active_products", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_check_active_products");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read catalog" });
  }
}

/** The one presence statement; exported so the benchmark can explain exactly what runs. */
export const presenceQuery = Prisma.sql`
  SELECT EXISTS (SELECT 1 FROM "Product" p WHERE p.status = 'active'
           AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')) AS "any",
         EXISTS (SELECT 1 FROM "Product" p WHERE p.status = 'active' AND NOT p.hidden
           AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."companyId" = p."companyId" AND v."productId" = p.id AND v.status = 'active')) AS offered`;
