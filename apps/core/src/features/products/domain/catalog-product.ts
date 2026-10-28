import type { Currency, Money } from "@shared/money";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

/** Public read model: never carries SKU, purchase price, stock quantity or QR. */
export type CatalogVariant = Readonly<{ id: VariantId; attributes: Readonly<Record<string, string>>; price: Money; maxQuantity: number }>;
export type CatalogAttribute = Readonly<{ name: string; values: readonly string[] }>;
export type CatalogProduct = Readonly<{
  id: ProductId;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: Readonly<{ kind: "single" | "from"; amount: Money }>;
  soldOut: boolean;
  attributes: readonly CatalogAttribute[];
  variants: readonly CatalogVariant[];
}>;
/** List card: the list never sends variants, so no stock-derived quantity reaches it. */
export type CatalogCard = Pick<CatalogProduct, "id" | "name" | "imageUrl" | "price" | "soldOut">;

export type StoredCatalogOption = Readonly<{ name: string; values: readonly string[] }>;
export type StoredCatalogVariant = Readonly<{ id: VariantId; attributes: Readonly<Record<string, string>>; salePrice: number; stock: number }>;
export type StoredCatalogProduct = Readonly<{
  id: ProductId; name: string; description: string | null; imageId: ImageId | null; currency: Currency;
  /** Options in saved order with their values in saved order, including values no active variant uses. */
  options: readonly StoredCatalogOption[];
  /** Active variants only. */
  variants: readonly [StoredCatalogVariant, ...StoredCatalogVariant[]];
}>;
/** List card computed in SQL over active variants, so the list never loads variant rows. */
export type StoredCatalogCard = Readonly<{
  id: ProductId; name: string; imageId: ImageId | null; currency: Currency; minPrice: number; maxPrice: number; soldOut: boolean;
}>;

export const maxCartQuantity = 99;

export function toCatalogProduct(product: StoredCatalogProduct, imageUrl: string | null): CatalogProduct {
  const { currency } = product;
  const amounts = product.variants.map((variant) => variant.salePrice);
  const lowest = Math.min(...amounts);
  const variants = product.variants.map((variant) => ({ id: variant.id, attributes: variant.attributes,
    price: { amount: variant.salePrice, currency }, maxQuantity: Math.min(variant.stock, maxCartQuantity) }));
  const attributes = product.options
    .map(({ name, values }) => ({ name, values: values.filter((value) => product.variants.some((variant) => variant.attributes[name] === value)) }))
    .filter(({ values }) => values.length > 0);
  return {
    id: product.id, name: product.name, description: product.description, imageUrl,
    price: { kind: amounts.every((amount) => amount === lowest) ? "single" : "from", amount: { amount: lowest, currency } },
    soldOut: variants.every((variant) => variant.maxQuantity === 0),
    attributes,
    variants,
  };
}

export const toCatalogCard = (card: StoredCatalogCard, imageUrl: string | null): CatalogCard => ({ id: card.id, name: card.name, imageUrl, soldOut: card.soldOut,
  price: { kind: card.minPrice === card.maxPrice ? "single" : "from", amount: { amount: card.minPrice, currency: card.currency } } });
