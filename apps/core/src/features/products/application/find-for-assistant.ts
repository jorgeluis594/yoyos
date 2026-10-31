import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { Product, ProductId, VariantId } from "@core/src/features/products/domain/product";
import { sortVariants } from "@core/src/features/products/domain/product-structure";
import type { AssistantReadError, AssistantSnapshot } from "@core/src/features/products/application/assistant-read";
import type { ProductReadError } from "@core/src/features/products/application/repository";

export type AssistantProductReference = Readonly<{ by: "id"; id: ProductId }> | Readonly<{ by: "sku"; sku: string }>;
export type FoundProduct = Readonly<{ product: Product; searchedVariantId: VariantId | null }>; // product.variants in saved order
export type FindForAssistantDependencies = Readonly<{
  snapshot: AssistantSnapshot;
  findSkuOwner: (normalizedSku: string) => Promise<Result<Readonly<{ variantId: VariantId; productId: ProductId }> | null, AssistantReadError>>;
  readProduct: (id: ProductId) => Promise<Result<Product | null, ProductReadError>>;
}>;

/** The SKU the way the unique index stores it, `lower(btrim(sku))`: lower case, surrounding spaces (and only spaces) removed. */
export const normalizeSku = (sku: string) => sku.replace(/^ +| +$/g, "").toLowerCase();

/** Opens one product by identifier or SKU; both lookups answer `null` when nothing matches. */
export async function findForAssistant(reference: AssistantProductReference, deps: FindForAssistantDependencies): Promise<Result<FoundProduct | null, AssistantReadError>> {
  return deps.snapshot(async () => {
    let productId: ProductId;
    let searchedVariantId: VariantId | null = null;
    if (reference.by === "sku") {
      const owner = await deps.findSkuOwner(normalizeSku(reference.sku));
      if (!owner.success) return owner;
      if (!owner.data) return ok(null);
      productId = owner.data.productId;
      searchedVariantId = owner.data.variantId;
    } else {
      productId = reference.id;
    }
    const read = await deps.readProduct(productId);
    if (!read.success) return read;
    if (!read.data) return ok(null);
    return ok({ product: { ...read.data, variants: sortVariants(read.data) }, searchedVariantId });
  });
}
