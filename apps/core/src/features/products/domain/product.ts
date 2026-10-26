import type { Currency, Money } from "@shared/money";

export type ProductId = string & { readonly __brand: "ProductId" };
export type VariantId = string & { readonly __brand: "VariantId" };
export type ImageId = string & { readonly __brand: "ImageId" };

export type OptionId = string & { readonly __brand: "OptionId" };
export type OptionValueId = string & { readonly __brand: "OptionValueId" };
export type OptionText = string & { readonly __brand: "OptionText" };
export type VariantStatus = "active" | "inactive";

export type ProductOptionValue = Readonly<{ id: OptionValueId; name: OptionText }>;
export type ProductOption = Readonly<{ id: OptionId; name: OptionText; values: readonly [ProductOptionValue, ...ProductOptionValue[]] }>;
export type ProductStock = Readonly<{ variantId: VariantId; quantity: number }>;
export type ProductVariant = Readonly<{
  id: VariantId;
  productId: ProductId;
  combination: Readonly<Record<OptionId, OptionValueId>>;
  sku?: string;
  salePrice: Money;
  purchasePrice?: Money;
  qrCode: string;
  status: VariantStatus;
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
  structureVersion: number;
  options: readonly ProductOption[];
  variants: readonly [ProductVariant, ...ProductVariant[]];
}>;
