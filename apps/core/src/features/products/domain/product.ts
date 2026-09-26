import type { Currency, Money } from "@shared/money";

export type ProductId = string & { readonly __brand: "ProductId" };
export type VariantId = string & { readonly __brand: "VariantId" };
export type ImageId = string & { readonly __brand: "ImageId" };

export type ProductStock = Readonly<{ variantId: VariantId; quantity: number }>;
export type ProductVariant = Readonly<{
  id: VariantId;
  productId: ProductId;
  attributes: Readonly<Record<string, string>>;
  sku?: string;
  salePrice: Money;
  purchasePrice?: Money;
  qrCode: string;
  status: "active";
  stock: ProductStock;
}>;
export type Product = Readonly<{
  id: ProductId;
  name: string;
  description?: string;
  imageId?: ImageId;
  currency: Currency;
  qrCode: string;
  status: "active";
  createdAt: Date;
  updatedAt: Date;
  variants: readonly [ProductVariant, ...ProductVariant[]];
}>;
