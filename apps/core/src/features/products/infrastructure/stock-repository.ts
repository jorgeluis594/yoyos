import { Prisma } from "@prisma/client";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { StockCount } from "@core/src/features/products/domain/stock-level";
import type { ProductReadError } from "@core/src/features/products/application/repository";

/**
 * Replaces the stock counts with one UPDATE, in the order given (variant order), next to the RLS tenant predicate.
 * Call it inside the editing transaction; thrown failures are logged by the caller's transaction boundary.
 */
export async function writeStock(companyId: CompanyId, counts: readonly StockCount[]): Promise<Result<void, ProductReadError>> {
  const started = performance.now();
  const rows = Prisma.join(counts.map((item) => Prisma.sql`(${item.variantId}::uuid, ${BigInt(item.stock)}::bigint)`));
  const written = await prisma.$executeRaw(Prisma.sql`UPDATE "ProductStock" s SET quantity = v.quantity
    FROM (VALUES ${rows}) AS v(id, quantity)
    WHERE s."variantId" = v.id AND s."companyId" = ${companyId}::uuid`);
  if (written === counts.length) return ok(undefined);
  log.error({ event: "product_stock_write_failed", companyId, stage: "write", errorCode: "UNEXPECTED_ROW_COUNT", durationMs: Math.round(performance.now() - started) }, "product_stock_write_failed");
  return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to write stock" });
}
