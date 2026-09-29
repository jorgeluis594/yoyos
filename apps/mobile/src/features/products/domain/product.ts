import type { Currency, Money } from "@shared/money";

export type ProductId = string & { readonly __brand: "ProductId" };
export type VariantId = string & { readonly __brand: "VariantId" };
export type VariantQrCode = string & { readonly __brand: "VariantQrCode" };
export type ImageId = string & { readonly __brand: "ImageId" };

export type ProductVariant = Readonly<{
  id: VariantId;
  attributes: Readonly<Record<string, string>>;
  sku?: string;
  qrCode: VariantQrCode;
  salePrice: Money;
  purchasePrice?: Money;
  stock: number;
}>;

export type Product = Readonly<{
  id: ProductId;
  name: string;
  description?: string;
  currency: Currency;
  photo?: Readonly<{ id: ImageId; url: string }>;
  variants: readonly ProductVariant[];
}>;

export type ProductListItem = Readonly<{
  id: ProductId;
  name: string;
  variantCount: number;
  sku?: string;
  price: Money;
  priceFrom: boolean;
  stock: number;
}>;

export type ProductPage = Readonly<{
  items: readonly ProductListItem[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type ProductListCriteria = Readonly<{ search?: string; page: number; pageSize: 20 }>;
export type PhotoSelection = Readonly<{ kind: "keep" }> | Readonly<{ kind: "set"; imageId: ImageId; previewUrl?: string }>
  | Readonly<{ kind: "remove" }>;
