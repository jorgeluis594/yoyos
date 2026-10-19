import type { CatalogProduct, CatalogVariant } from "@core/src/features/products/domain/catalog-product";

export type VariantSelection = Readonly<Record<string, string>>;
export type OptionState = "available" | "sold_out" | "missing";

const matches = (variant: CatalogVariant, selection: VariantSelection) =>
  Object.entries(selection).every(([name, value]) => variant.attributes[name] === value);

/** An option is judged together with the other chosen attributes: a combination that does not exist is not selectable. */
export function optionState(product: CatalogProduct, selection: VariantSelection, name: string, value: string): OptionState {
  const candidates = product.variants.filter((variant) => matches(variant, { ...selection, [name]: value }));
  if (!candidates.length) return "missing";
  return candidates.some((variant) => variant.maxQuantity > 0) ? "available" : "sold_out";
}

export function selectedVariant(product: CatalogProduct, selection: VariantSelection): CatalogVariant | null {
  if (product.variants.length === 1) return product.variants[0];
  if (product.attributes.some(({ name }) => selection[name] === undefined)) return null;
  // Variants without attributes all match: prefer one in stock over a sold-out one.
  return product.variants.find((variant) => matches(variant, selection) && variant.maxQuantity > 0)
    ?? product.variants.find((variant) => matches(variant, selection)) ?? null;
}
