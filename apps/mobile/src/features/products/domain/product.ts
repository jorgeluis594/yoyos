import type { Currency, Money } from "@shared/money";

export type ProductId = string & { readonly __brand: "ProductId" };
export type VariantId = string & { readonly __brand: "VariantId" };
export type VariantQrCode = string & { readonly __brand: "VariantQrCode" };
export type ImageId = string & { readonly __brand: "ImageId" };

export type OptionId = string & { readonly __brand: "OptionId" };
export type OptionValueId = string & { readonly __brand: "OptionValueId" };

export type ProductOptionValue = Readonly<{ id: OptionValueId; name: string }>;
export type ProductOption = Readonly<{ id: OptionId; name: string; values: readonly ProductOptionValue[] }>;
/** Core sends any string; only "active" is on sale, so every other value reads as deactivated. */
export type VariantStatus = "active" | "inactive";

export type ProductVariant = Readonly<{
  id: VariantId;
  qrCode: VariantQrCode;
  /** One entry per option, in saved option order. Empty for a product without options. */
  combination: readonly Readonly<{ optionId: OptionId; valueId: OptionValueId }>[];
  sku?: string;
  salePrice: Money;
  purchasePrice?: Money;
  stock: number;
  status: VariantStatus;
  hasOrders: boolean;
}>;

export type Product = Readonly<{
  id: ProductId;
  name: string;
  description?: string;
  currency: Currency;
  /** Saved photos in order; the first is the primary. */
  photos: readonly Readonly<{ id: ImageId; url: string }>[];
  structureVersion: number;
  /** The seller keeps it out of the public catalog and out of chat orders; she still sells it by hand. */
  hidden: boolean;
  options: readonly ProductOption[];
  variants: readonly ProductVariant[];
}>;

export type ProductListItem = Readonly<{
  id: ProductId;
  name: string;
  variantCount: number;
  activeVariantCount: number;
  sku?: string;
  /** Lowest price among active variants; null when none is active. */
  price: Money | null;
  priceFrom: boolean;
  stock: number;
  hidden: boolean;
  photo?: Readonly<{ id: ImageId; url: string }>;
}>;

export type ProductPage = Readonly<{
  items: readonly ProductListItem[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type StockFilter = "in_stock" | "sold_out";
export type ProductSort = "recent" | "name";
export type ProductListCriteria = Readonly<{ search?: string; stock?: StockFilter; sort?: ProductSort; page: number; pageSize: 20 }>;
