import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductBusinessError } from "@core/src/features/products/domain/errors";
import type { Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { ProductAccess, ProductReadError } from "@core/src/features/products/application/repository";

export type VariantActionName = "update" | "change_combination" | "change_status" | "delete";
type PersistenceFailure = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type NotFound = Extract<ProductBusinessError, { code: "PRODUCT_NOT_FOUND" }>;

/** Shared by every per-variant action. Logging stays in the composition: the application only reports what happened. */
export type VariantActionObserver<Done> = Readonly<{
  /** After the commit, only when something was written. */
  completed?: (summary: Done) => void;
  /** On a business rejection; technical failures are logged by their adapters. */
  rejected?: (event: Readonly<{ productId: ProductId; variantId: VariantId; action: VariantActionName; errorCode: string }>) => void;
}>;

export type VariantActionDependencies<Done> = Readonly<{
  transaction: <T, E extends { code: string; message: string }>(companyId: ProductAccess["companyId"], work: () => Promise<Result<T, E>>) => Promise<Result<T, E | PersistenceFailure>>;
  /** `SELECT … FOR UPDATE` on the product row; `false` when the product does not exist for this company. */
  lockProduct: (id: ProductId) => Promise<Result<boolean, ProductReadError>>;
  loadProduct: (id: ProductId) => Promise<Result<Product | null, ProductReadError>>;
  clock: () => Date;
  observe?: VariantActionObserver<Done>;
}>;

const businessCodes = new Set(["VALIDATION_ERROR", "PRODUCT_NOT_FOUND", "VARIANT_NOT_FOUND", "DUPLICATE_SKU", "DUPLICATE_COMBINATION", "ID_CONFLICT",
  "VARIANT_HAS_ORDERS", "VARIANT_HAS_STOCK", "LAST_VARIANT", "PRODUCT_WITHOUT_OPTIONS"]);

/**
 * Locks and loads the product inside the editing transaction, runs the action and reports a business rejection once.
 * The work returns what it wants announced after the commit, or `null` when nothing was written.
 */
export async function runVariantAction<Done, E extends { code: string; message: string }>(
  ids: Readonly<{ productId: ProductId; variantId: VariantId }>, access: ProductAccess, action: VariantActionName,
  deps: VariantActionDependencies<Done>,
  work: (product: Product) => Promise<Result<Done | null, E>>,
): Promise<Result<ProductId, E | NotFound | ProductReadError | PersistenceFailure>> {
  const result = await deps.transaction<Done | null, E | NotFound | ProductReadError>(access.companyId, async () => {
    const locked = await deps.lockProduct(ids.productId);
    if (!locked.success) return locked;
    if (!locked.data) return err({ code: "PRODUCT_NOT_FOUND", message: "Product does not exist" });
    const loaded = await deps.loadProduct(ids.productId);
    if (!loaded.success) return loaded;
    if (!loaded.data) return err({ code: "PRODUCT_NOT_FOUND", message: "Product does not exist" });
    return work(loaded.data);
  });
  if (!result.success) {
    if (businessCodes.has(result.error.code)) deps.observe?.rejected?.({ ...ids, action, errorCode: result.error.code });
    return result;
  }
  if (result.data !== null) deps.observe?.completed?.(result.data);
  return ok(ids.productId);
}
