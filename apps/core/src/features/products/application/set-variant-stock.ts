import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId } from "@shared/identity";
import type { StockCount } from "@core/src/features/products/domain/stock-level";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";

export type { StockCount };
export type SetVariantStockDependencies = Readonly<{
  /** One statement for all counts; `PERSISTENCE_UNAVAILABLE` when the written rows differ from the counts. */
  writeStock: (companyId: CompanyId, counts: readonly StockCount[]) => Promise<Result<void, ProductReadError>>;
}>;

/**
 * The only write of a seller's stock count. Runs inside the caller's transaction, after the caller locked the product row
 * and validated the counts; it opens no transaction and publishes nothing.
 */
export async function setVariantStock(input: Readonly<{ counts: readonly StockCount[] }>, access: ProductAccess, deps: SetVariantStockDependencies): Promise<Result<void, ProductReadError>> {
  if (!input.counts.length) return ok(undefined);
  const sorted = [...input.counts].sort((a, b) => a.variantId < b.variantId ? -1 : 1);
  return deps.writeStock(access.companyId, sorted);
}
