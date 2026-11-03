import type { Product } from "@core/src/features/products/domain/product";

/** Offered = sellable (active product with an active variant) and not hidden: the rule of every buyer-facing read. */
export function isOffered(product: Pick<Product, "status" | "hidden" | "variants">): boolean {
  return product.status === "active" && !product.hidden && product.variants.some((variant) => variant.status === "active");
}
