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

export type StoredCatalogVariant = Readonly<{ id: VariantId; attributes: Readonly<Record<string, string>>; salePrice: number; stock: number }>;
export type StoredCatalogProduct = Readonly<{
  id: ProductId; name: string; description: string | null; imageId: ImageId | null; currency: Currency;
  variants: readonly [StoredCatalogVariant, ...StoredCatalogVariant[]];
}>;

export const maxCartQuantity = 99;

export function toCatalogProduct(product: StoredCatalogProduct, imageUrl: string | null): CatalogProduct {
  const { currency } = product;
  const amounts = product.variants.map((variant) => variant.salePrice);
  const lowest = Math.min(...amounts);
  const variants = product.variants.map((variant) => ({ id: variant.id, attributes: variant.attributes,
    price: { amount: variant.salePrice, currency }, maxQuantity: Math.min(variant.stock, maxCartQuantity) }));
  const names = [...new Set(product.variants.flatMap((variant) => Object.keys(variant.attributes)))];
  return {
    id: product.id, name: product.name, description: product.description, imageUrl,
    price: { kind: amounts.every((amount) => amount === lowest) ? "single" : "from", amount: { amount: lowest, currency } },
    soldOut: variants.every((variant) => variant.maxQuantity === 0),
    attributes: names.map((name) => ({ name, values: [...new Set(product.variants.flatMap((variant) => variant.attributes[name] ?? []))] })),
    variants,
  };
}

export const toCatalogCard = ({ id, name, imageUrl, price, soldOut }: CatalogProduct): CatalogCard => ({ id, name, imageUrl, price, soldOut });
