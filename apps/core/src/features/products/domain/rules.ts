import type { Currency } from "@shared/money";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ImageId, Product, VariantId } from "@core/src/features/products/domain/product";
import { createProductSchema, toValidationIssues, updateProductSchema } from "@core/src/features/products/domain/validation";

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
  const result = createProductSchema.safeParse(input);
  if (!result.success) return { issues: toValidationIssues(result.error, { variantFallback: "attributes", missingVariantsReason: "REQUIRED" }) };
  const variants = result.data.variants as [ValidVariant, ...ValidVariant[]];
  return { issues: [], value: { name: result.data.name, ...(result.data.description === undefined ? {} : { description: result.data.description }), currency: result.data.currency, variants } };
}

export function validateUpdate(product: Product, input: RawUpdate): { readonly value?: ValidUpdate; readonly issues: readonly ValidationIssue[] } {
  const supplied = new Set(product.variants.map((variant) => variant.id as string));
  const result = updateProductSchema(supplied).safeParse(input);
  if (!result.success) return { issues: toValidationIssues(result.error, { variantFallback: "id", missingVariantsReason: "INVALID_TYPE" }) };
  return { issues: [], value: result.data as ValidUpdate };
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
