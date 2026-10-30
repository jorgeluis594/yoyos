import type { ProductId } from "@core/src/features/products/domain/product";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";

/** A catalog product as the chat reader sees it: every sellable variant and every attribute value, with no search ranking. */
export type ProductForReading = Readonly<{
  productId: ProductId;
  name: string;
  /** `productNameKey(name)`: two products with the same key have the same name (products owns the meaning). */
  nameKey: string;
  /** Product active with at least one active variant. */
  sellable: boolean;
  /** Values of active variants, in stored option order. */
  attributes: readonly Readonly<{ name: string; values: readonly string[] }>[];
  /** Active variants only. */
  variants: readonly CatalogItem[];
}>;
