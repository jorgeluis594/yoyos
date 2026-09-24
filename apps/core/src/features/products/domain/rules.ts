import { isCurrency, type Currency } from "@shared/money";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";
import type { Product } from "@core/src/features/products/domain/product";

export type RawVariant = Readonly<{ attributes: Readonly<Record<string, string>>; sku?: string; salePrice: number; purchasePrice?: number; initialStock?: number }>;
export type RawProduct = Readonly<{ name: string; description?: string; currency: Currency; variants: readonly RawVariant[] }>;
export type ValidVariant = Readonly<{ attributes: Readonly<Record<string, string>>; sku?: string; salePrice: number; purchasePrice?: number; initialStock: number }>;
export type ValidProduct = Readonly<{ name: string; description?: string; currency: Currency; variants: readonly [ValidVariant, ...ValidVariant[]] }>;

const length = (value: string) => [...value].length;
const normalize = (value: string) => value.trim().toLowerCase();

export function summarizeProduct(product: Product) {
  const amounts = product.variants.map((variant) => variant.salePrice.amount);
  const totalStock = product.variants.reduce((sum, variant) => sum + variant.stock.quantity, 0);
  if (!Number.isSafeInteger(totalStock)) throw new Error("Stored total stock is outside the supported range");
  return {
    id: product.id, name: product.name, variantCount: product.variants.length,
    ...(product.variants.length === 1 && product.variants[0].sku ? { sku: product.variants[0].sku } : {}),
    minSalePrice: { amount: amounts.reduce((lowest, amount) => Math.min(lowest, amount)), currency: product.currency },
    hasDifferentPrices: amounts.some((amount) => amount !== amounts[0]), totalStock,
  };
}

export function validateCreate(input: RawProduct): { readonly value?: ValidProduct; readonly issues: readonly ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) issues.push({ scope: "product", field: "name", reason: "REQUIRED", message: "Name is required" });
  if (length(name) > 200) issues.push({ scope: "product", field: "name", reason: "TOO_LONG", maxLength: 200, message: "Name exceeds maximum length" });
  if (input.description !== undefined && typeof input.description !== "string") issues.push({ scope: "product", field: "description", reason: "INVALID_TYPE", message: "Description must be text" });
  else if (typeof input.description === "string" && length(input.description) > 5000) issues.push({ scope: "product", field: "description", reason: "TOO_LONG", maxLength: 5000, message: "Description exceeds maximum length" });
  if (!isCurrency(input.currency)) issues.push({ scope: "product", field: "currency", reason: "INVALID_CURRENCY", message: "Unsupported currency" });
  if (!Array.isArray(input.variants) || !input.variants.length) {
    issues.push({ scope: "product", field: "variants", reason: "REQUIRED", message: "At least one variant is required" });
    return { issues };
  }
  const skus = new Set<string>();
  const combinations = new Set<string>();
  const variants = input.variants.map((variant, index): ValidVariant | null => {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      issues.push({ scope: "variant", index, field: "attributes", reason: "INVALID_TYPE", message: "Invalid variant" });
      return null;
    }
    let attributes: Record<string, string> = {};
    if (!variant.attributes || typeof variant.attributes !== "object" || Array.isArray(variant.attributes)) {
      issues.push({ scope: "variant", index, field: "attributes", reason: "INVALID_ATTRIBUTES", message: "Invalid attributes" });
    } else {
      const keys = new Set<string>();
      let valid = true;
      for (const [key, value] of Object.entries(variant.attributes)) {
        const normalizedKey = normalize(key);
        if (!normalizedKey || typeof value !== "string" || !value.trim() || keys.has(normalizedKey)) valid = false;
        keys.add(normalizedKey);
      }
      if (!valid) issues.push({ scope: "variant", index, field: "attributes", reason: "INVALID_ATTRIBUTES", message: "Invalid attributes" });
      else {
        attributes = { ...variant.attributes };
        const signature = JSON.stringify(Object.entries(attributes).map(([key, value]) => [normalize(key), normalize(value)]).sort(([a], [b]) => a.localeCompare(b)));
        if (combinations.has(signature)) issues.push({ scope: "variant", index, field: "attributes", reason: "DUPLICATE_ATTRIBUTES", message: "Repeated attributes" });
        combinations.add(signature);
      }
    }
    const sku = typeof variant.sku === "string" ? variant.sku.trim() : undefined;
    if (variant.sku !== undefined && typeof variant.sku !== "string") issues.push({ scope: "variant", index, field: "sku", reason: "INVALID_TYPE", message: "SKU must be text" });
    if (sku && length(sku) > 100) issues.push({ scope: "variant", index, field: "sku", reason: "TOO_LONG", maxLength: 100, message: "SKU exceeds maximum length" });
    if (sku) {
      const normalizedSku = normalize(sku);
      if (skus.has(normalizedSku)) issues.push({ scope: "variant", index, field: "sku", reason: "DUPLICATE_SKU", message: "Repeated SKU" });
      skus.add(normalizedSku);
    }
    for (const field of ["salePrice", "purchasePrice"] as const) {
      const price = variant[field];
      if (price === undefined && field === "purchasePrice") continue;
      if (typeof price !== "number" || !Number.isFinite(price) || price < (field === "salePrice" ? 0.01 : 0) || price > 999999999.99) {
        issues.push({ scope: "variant", index, field, reason: "INVALID_PRICE", minimum: field === "salePrice" ? 0.01 : 0, maximum: 999999999.99, message: "Invalid price" });
      } else if (!/^\d+(?:\.\d{1,2})?$/.test(price.toString())) {
        issues.push({ scope: "variant", index, field, reason: "INVALID_PRECISION", maxDecimals: 2, message: "Price has too many decimals" });
      }
    }
    const initialStock = variant.initialStock ?? 0;
    if (!Number.isSafeInteger(initialStock) || initialStock < 0) issues.push({ scope: "variant", index, field: "initialStock", reason: "INVALID_STOCK", message: "Invalid stock" });
    return { attributes, ...(sku ? { sku } : {}), salePrice: variant.salePrice, ...(variant.purchasePrice === undefined ? {} : { purchasePrice: variant.purchasePrice }), initialStock };
  });
  if (issues.length || variants.some((variant) => !variant)) return { issues };
  return { issues, value: { name, ...(input.description === undefined ? {} : { description: input.description }), currency: input.currency, variants: variants as [ValidVariant, ...ValidVariant[]] } };
}
