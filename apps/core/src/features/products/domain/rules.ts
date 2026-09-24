import { isCurrency, type Currency } from "@shared/money";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ImageId, Product, VariantId } from "@core/src/features/products/domain/product";

export type RawVariant = Readonly<{ attributes: Readonly<Record<string, string>>; sku?: string; salePrice: number; purchasePrice?: number; initialStock?: number }>;
export type RawProduct = Readonly<{ name: string; description?: string; currency: Currency; variants: readonly RawVariant[] }>;
export type ValidVariant = Readonly<{ attributes: Readonly<Record<string, string>>; sku?: string; salePrice: number; purchasePrice?: number; initialStock: number }>;
export type ValidProduct = Readonly<{ name: string; description?: string; currency: Currency; variants: readonly [ValidVariant, ...ValidVariant[]] }>;
export type RawUpdateVariant = Readonly<{ id: string; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
export type RawUpdate = Readonly<{ name?: string; description?: string | null; imageId?: string | null; variants?: readonly RawUpdateVariant[] }>;
export type ValidUpdateVariant = Readonly<{ id: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
export type ValidUpdate = Readonly<{ name?: string; description?: string | null; imageId?: ImageId | null; variants: readonly ValidUpdateVariant[] }>;
export type ProductChange = Readonly<{ name?: string; description?: string | null; imageId?: ImageId | null }>;
export type VariantChange = Readonly<{ id: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
export type UpdatePlan = Readonly<{ product: ProductChange; variants: readonly VariantChange[] }>;

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

function priceIssues(issues: ValidationIssue[], index: number, field: "salePrice" | "purchasePrice", value: number): boolean {
  const minimum = field === "salePrice" ? 0.01 : 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > 999999999.99) {
    issues.push({ scope: "variant", index, field, reason: "INVALID_PRICE", minimum, maximum: 999999999.99, message: "Invalid price" });
    return false;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.toString())) {
    issues.push({ scope: "variant", index, field, reason: "INVALID_PRECISION", maxDecimals: 2, message: "Price has too many decimals" });
    return false;
  }
  return true;
}

export function validateUpdate(product: Product, input: RawUpdate): { readonly value?: ValidUpdate; readonly issues: readonly ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const value: { name?: string; description?: string | null; imageId?: ImageId | null; variants: ValidUpdateVariant[] } = { variants: [] };
  if (input.name !== undefined) {
    if (typeof input.name !== "string") issues.push({ scope: "product", field: "name", reason: "INVALID_TYPE", message: "Name must be text" });
    else {
      const name = input.name.trim();
      if (!name) issues.push({ scope: "product", field: "name", reason: "REQUIRED", message: "Name is required" });
      else if (length(name) > 200) issues.push({ scope: "product", field: "name", reason: "TOO_LONG", maxLength: 200, message: "Name exceeds maximum length" });
      else value.name = name;
    }
  }
  if (input.description !== undefined) {
    if (input.description === null) value.description = null;
    else if (typeof input.description !== "string") issues.push({ scope: "product", field: "description", reason: "INVALID_TYPE", message: "Description must be text" });
    else if (length(input.description) > 5000) issues.push({ scope: "product", field: "description", reason: "TOO_LONG", maxLength: 5000, message: "Description exceeds maximum length" });
    else value.description = input.description;
  }
  if (input.imageId !== undefined) {
    if (input.imageId === null) value.imageId = null;
    else if (typeof input.imageId !== "string") issues.push({ scope: "product", field: "imageId", reason: "INVALID_TYPE", message: "Image must be an identifier" });
    else value.imageId = input.imageId as ImageId;
  }
  const supplied = new Map(product.variants.map((variant) => [variant.id as string, variant]));
  if (input.variants !== undefined) {
    if (!Array.isArray(input.variants)) issues.push({ scope: "product", field: "variants", reason: "INVALID_TYPE", message: "Variants must be a list" });
    else {
      const seenIds = new Set<string>();
      const seenSkus = new Set<string>();
      input.variants.forEach((variant, index) => {
        if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
          issues.push({ scope: "variant", index, field: "id", reason: "INVALID_TYPE", message: "Invalid variant" });
          return;
        }
        if (typeof variant.id !== "string" || !variant.id) {
          issues.push({ scope: "variant", index, field: "id", reason: "REQUIRED", message: "Variant ID is required" });
          return;
        }
        if (seenIds.has(variant.id)) issues.push({ scope: "variant", index, field: "id", reason: "DUPLICATE_VARIANT", message: "Repeated variant" });
        else if (!supplied.has(variant.id)) issues.push({ scope: "variant", index, field: "id", reason: "VARIANT_NOT_FOUND", message: "Variant does not belong to the product" });
        seenIds.add(variant.id);
        let sku: string | null | undefined;
        if (variant.sku !== undefined) {
          if (variant.sku === null) sku = null;
          else if (typeof variant.sku !== "string") issues.push({ scope: "variant", index, field: "sku", reason: "INVALID_TYPE", message: "SKU must be text" });
          else {
            const trimmed = variant.sku.trim();
            if (length(trimmed) > 100) { sku = trimmed; issues.push({ scope: "variant", index, field: "sku", reason: "TOO_LONG", maxLength: 100, message: "SKU exceeds maximum length" }); }
            else sku = trimmed === "" ? null : trimmed;
          }
        }
        if (sku) {
          const normalizedSku = normalize(sku);
          if (seenSkus.has(normalizedSku)) issues.push({ scope: "variant", index, field: "sku", reason: "DUPLICATE_SKU", message: "Repeated SKU" });
          seenSkus.add(normalizedSku);
        }
        let salePrice: number | undefined;
        if (variant.salePrice !== undefined && priceIssues(issues, index, "salePrice", variant.salePrice)) salePrice = variant.salePrice;
        let purchasePrice: number | null | undefined;
        if (variant.purchasePrice !== undefined) {
          if (variant.purchasePrice === null) purchasePrice = null;
          else if (priceIssues(issues, index, "purchasePrice", variant.purchasePrice)) purchasePrice = variant.purchasePrice;
        }
        value.variants.push({
          id: variant.id as VariantId,
          ...(sku === undefined ? {} : { sku }),
          ...(salePrice === undefined ? {} : { salePrice }),
          ...(purchasePrice === undefined ? {} : { purchasePrice }),
        });
      });
    }
  }
  if (issues.length) return { issues };
  return { issues, value };
}

export function planUpdate(product: Product, value: ValidUpdate): UpdatePlan | null {
  const productChange: { name?: string; description?: string | null; imageId?: ImageId | null } = {};
  if (value.name !== undefined && value.name !== product.name) productChange.name = value.name;
  if (value.description !== undefined) {
    const next = value.description === null ? undefined : value.description;
    if (product.description !== next) productChange.description = value.description;
  }
  if (value.imageId !== undefined) {
    const next = value.imageId === null ? undefined : value.imageId;
    if (product.imageId !== next) productChange.imageId = value.imageId;
  }
  const supplied = new Map(product.variants.map((variant) => [variant.id as string, variant]));
  const variants: VariantChange[] = [];
  for (const variant of value.variants) {
    const current = supplied.get(variant.id);
    if (!current) continue;
    const change: { id: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null } = { id: variant.id };
    let changed = false;
    if (variant.sku !== undefined) {
      const next = variant.sku === null ? undefined : normalize(variant.sku);
      const currentSku = current.sku === undefined ? undefined : normalize(current.sku);
      if (next !== currentSku) { change.sku = variant.sku; changed = true; }
    }
    if (variant.salePrice !== undefined && variant.salePrice !== current.salePrice.amount) { change.salePrice = variant.salePrice; changed = true; }
    if (variant.purchasePrice !== undefined) {
      const next = variant.purchasePrice === null ? undefined : variant.purchasePrice;
      if (next !== current.purchasePrice?.amount) { change.purchasePrice = variant.purchasePrice; changed = true; }
    }
    if (changed) variants.push(change);
  }
  if (!Object.keys(productChange).length && !variants.length) return null;
  return { product: productChange, variants };
}
