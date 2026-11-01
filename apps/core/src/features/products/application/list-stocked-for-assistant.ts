import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { StockLevel } from "@core/src/features/products/domain/stock-level";
import type { ProductReadError } from "@core/src/features/products/application/repository";

export type StockedProduct = Readonly<{
  id: ProductId; name: string; createdAt: Date;
  stock: Readonly<{ total: number; soldOut: number; low: number; onlyLevel: StockLevel | null }>;   // active variants only, as the search's product line
  variantIds: readonly string[];                                                                   // every variant, deactivated included
}>;
export type StockedProducts = Readonly<{
  storeHasProducts: boolean; matching: number; withStock: number;   // matching = products matching text (all when none); withStock = matching with active stock > 0 today
  checked: readonly StockedProduct[];                               // withStock and created before `createdBefore`
}>;
export type ListStockedInput = Readonly<{ createdBefore: Date; text?: string }>;
/** What the repository reads: one row per product matching the text; `variantIds` is filled only for a product with stock created before `createdBefore`. */
export type StockedRows = Readonly<{ storeHasProducts: boolean; products: readonly StockedProduct[] }>;
export type ListStockedDependencies = Readonly<{
  readStocked: (input: ListStockedInput) => Promise<Result<StockedRows, ProductReadError>>;
}>;

/**
 * The products the unsold-products tool checks: matching `text`, with active stock today and created before the cutoff, with their variants.
 * The counts that tell the empty answers apart come from the same single read; `checked` is complete because its order depends on sale dates only orders knows.
 */
export async function listStockedForAssistant(input: ListStockedInput, deps: ListStockedDependencies): Promise<Result<StockedProducts, ProductReadError>> {
  const text = input.text?.trim();
  const rows = await deps.readStocked({ createdBefore: input.createdBefore, ...text ? { text } : {} });
  if (!rows.success) return rows;
  const stocked = rows.data.products.filter((product) => product.stock.total > 0);
  return ok({
    storeHasProducts: rows.data.storeHasProducts, matching: rows.data.products.length, withStock: stocked.length,
    checked: stocked.filter((product) => product.createdAt < input.createdBefore),
  });
}
