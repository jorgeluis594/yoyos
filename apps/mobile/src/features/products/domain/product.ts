import { compare } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import type { Result } from "@shared/result";

export type ProductStock = { variantId: string; quantity: number };

export type ProductVariant = {
  id: string;
  productId: string;
  attributes: Record<string, string>;
  sku: string;
  qrCode: string;
  salePrice: Money;
  purchasePrice?: Money;
  status: "active";
};

export type Product = {
  id: string;
  companyId: string;
  name: string;
  photo?: string;
  category?: string;
  description?: string;
  currency: string;
  qrCode: string;
  status: "active";
  variants: ProductVariant[];
  stocks: ProductStock[];
};

export type ProductInput = {
  id?: string;
  companyId: string;
  name: string;
  photo?: string;
  category?: string;
  description?: string;
  currency: string;
  variants: {
    id?: string;
    attributes: Record<string, string>;
    sku: string;
    salePrice: number;
    purchasePrice?: number;
    initialQuantity?: number;
  }[];
};

export type ProductError = {
  message: string;
  code: "INVALID_PRODUCT" | "INVALID_VARIANT" | "INVALID_PRICE" | "INVALID_STOCK" | "DUPLICATE_SKU" | "DUPLICATE_ATTRIBUTES";
};

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function validPrice(amount: number, currency: string, allowZero: boolean): boolean {
  return typeof amount === "number" && Number.isFinite(amount) &&
    (allowZero ? amount >= 0 : amount > 0) &&
    Math.round(amount * 100) / 100 === amount &&
    compare({ amount: 0, currency })({ amount, currency }).success;
}

export function validateProduct(input: ProductInput): Result<null, ProductError> {
  if (!input || (input.id !== undefined && !nonempty(input.id)) || !nonempty(input.companyId) ||
      !nonempty(input.name) || !nonempty(input.currency) ||
      !Array.isArray(input.variants) || input.variants.length === 0 ||
      !compare({ amount: 0, currency: input.currency })({ amount: 0, currency: input.currency }).success) {
    return err({ message: "Product requires an owner, name, currency and variants", code: "INVALID_PRODUCT" });
  }

  const skus = new Set<string>();
  const combinations = new Set<string>();
  for (const variant of input.variants) {
    if (!variant || (variant.id !== undefined && !nonempty(variant.id)) || !nonempty(variant.sku) ||
        !variant.attributes || typeof variant.attributes !== "object" || Array.isArray(variant.attributes)) {
      return err({ message: "Variant requires a SKU and attributes", code: "INVALID_VARIANT" });
    }
    const attributes = Object.entries(variant.attributes);
    if (attributes.some(([key, value]) => !nonempty(key) || !nonempty(value))) {
      return err({ message: "Variant attributes cannot be empty", code: "INVALID_VARIANT" });
    }
    if (new Set(attributes.map(([key]) => key.trim().toLowerCase())).size !== attributes.length) {
      return err({ message: "Variant attribute names must be unique", code: "INVALID_VARIANT" });
    }
    const sku = variant.sku.trim().toLowerCase();
    if (skus.has(sku)) return err({ message: "Duplicate SKU", code: "DUPLICATE_SKU" });
    skus.add(sku);

    const combination = JSON.stringify(attributes.map(([key, value]) =>
      [key.trim().toLowerCase(), value.trim().toLowerCase()]).sort(([a], [b]) => a.localeCompare(b)));
    if (combinations.has(combination)) {
      return err({ message: "Duplicate attribute combination", code: "DUPLICATE_ATTRIBUTES" });
    }
    combinations.add(combination);

    if (!validPrice(variant.salePrice, input.currency, false) ||
        (variant.purchasePrice !== undefined && !validPrice(variant.purchasePrice, input.currency, true))) {
      return err({ message: "Invalid variant price", code: "INVALID_PRICE" });
    }
    if (variant.initialQuantity !== undefined &&
        (!Number.isSafeInteger(variant.initialQuantity) || variant.initialQuantity < 0)) {
      return err({ message: "Stock must be a nonnegative whole number", code: "INVALID_STOCK" });
    }
  }
  return ok(null);
}
