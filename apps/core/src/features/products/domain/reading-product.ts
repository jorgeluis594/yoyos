import type { ProductId } from "@core/src/features/products/domain/product";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";

/** A catalog product as the chat reader sees it: every sellable variant and every attribute value, with no search ranking. */
export type ProductForReading = Readonly<{
  productId: ProductId;
  name: string;
  /** The seller hid the product from buyers: a hidden product is never sellable here and has no variants or attributes. */
  hidden: boolean;
  /** Product active, not hidden, with at least one active variant. */
  sellable: boolean;
  /** Values of active variants, in stored option order. */
  attributes: readonly Readonly<{ name: string; values: readonly string[] }>[];
  /** Active variants only. */
  variants: readonly CatalogItem[];
}>;
