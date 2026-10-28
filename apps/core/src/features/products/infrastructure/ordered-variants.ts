import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, inActiveTransaction, prisma } from "@core/src/shared/infrastructure/persistance";
import { transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import type { VariantId } from "@core/src/features/products/domain/product";

function knownFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError || cause instanceof Prisma.PrismaClientInitializationError;
}

/** Ids of the variants referenced by any order of the company, confirmed or not: a semi-join that probes the (companyId, variantId) index once per id. */
export async function findOrderedVariantIds(variantIds: readonly VariantId[]) {
  if (!variantIds.length) return ok<ReadonlySet<VariantId>>(new Set());
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT ids.variant_id AS id FROM unnest(${[...variantIds]}::uuid[]) AS ids(variant_id)
      WHERE EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."companyId" = ${getCompanyId()}::uuid AND oi."variantId" = ids.variant_id)`);
    return ok<ReadonlySet<VariantId>>(new Set(rows.map((row) => row.id as VariantId)));
  } catch (cause) {
    if (!knownFailure(cause) || (inActiveTransaction() && transactionFailureStage(cause))) throw cause;
    log.error({ event: "unable_to_find_ordered_variants", companyId: getCompanyId(), errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_find_ordered_variants");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read orders" });
  }
}
