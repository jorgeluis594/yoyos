import type { Currency } from "@shared/money";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";
import type { OptionId, OptionValueId, Product, ProductOption, VariantId } from "@core/src/features/products/domain/product";
import { parseProductStructure, type RawOption } from "@core/src/features/products/domain/product-structure";
import { createProductSchema, toValidationIssues, variantPatchSchema } from "@core/src/features/products/domain/validation";

export type RawVariant = Readonly<{ values: readonly string[]; sku?: string | null; salePrice: number; purchasePrice?: number | null; initialStock?: number }>;
export type RawProduct = Readonly<{ name: string; description?: string | null; currency: Currency; options: readonly RawOption[]; variants: readonly RawVariant[] }>;
export type ValidVariant = Readonly<{ combination: Readonly<Record<OptionId, OptionValueId>>; sku?: string; salePrice: number; purchasePrice?: number; initialStock: number }>;
export type ValidProduct = Readonly<{ name: string; description?: string; currency: Currency; options: readonly ProductOption[]; variants: readonly [ValidVariant, ...ValidVariant[]] }>;
export type RawUpdateVariant = Readonly<{ id: string; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
export type RawVariantPatch = Readonly<{ variants?: readonly RawUpdateVariant[] }>;
export type ValidUpdateVariant = Readonly<{ id: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
export type ValidVariantPatch = Readonly<{ variants: readonly ValidUpdateVariant[] }>;
export type VariantChange = Readonly<{ id: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>;
export type VariantPatchPlan = Readonly<{ variants: readonly VariantChange[] }>;

const normalize = (value: string) => value.trim().toLowerCase();

export function validateCreate(input: RawProduct): { readonly value?: ValidProduct; readonly issues: readonly ValidationIssue[] } {
  const result = createProductSchema.safeParse(input);
  const fields: ValidationIssue[] = result.success ? [] : [...toValidationIssues(result.error, { variantFallback: "values", missingVariantsReason: "REQUIRED", variantRef: (index) => ({ scope: "newVariant", index }) })];
  const structure = parseProductStructure({
    options: Array.isArray(input.options) ? input.options : [],
    variants: Array.isArray(input.variants) ? input.variants.map((variant) => ({ values: Array.isArray(variant?.values) ? variant.values : [] })) : [],
  });
  const issues = [...fields, ...structure.issues];
  if (issues.length || !result.success || !structure.value) return { issues };
  const variants = result.data.variants.map((variant, index): ValidVariant => ({
    combination: structure.value!.combinations[index], salePrice: variant.salePrice, initialStock: variant.initialStock,
    ...(variant.sku === undefined ? {} : { sku: variant.sku }),
    ...(variant.purchasePrice === undefined ? {} : { purchasePrice: variant.purchasePrice }),
  })) as [ValidVariant, ...ValidVariant[]];
  return { issues: [], value: {
    name: result.data.name, currency: result.data.currency, options: structure.value.options, variants,
    ...(result.data.description == null ? {} : { description: result.data.description }),
  } };
}

export function validateVariantPatch(product: Product, input: RawVariantPatch): { readonly value?: ValidVariantPatch; readonly issues: readonly ValidationIssue[] } {
  const supplied = new Set(product.variants.map((variant) => variant.id as string));
  const result = variantPatchSchema(supplied).safeParse(input);
  if (!result.success) return { issues: toValidationIssues(result.error, { variantFallback: "id", missingVariantsReason: "INVALID_TYPE", variantRef: (index) => ({ scope: "variant", variantId: String(input.variants?.[index]?.id ?? "") }) }) };
  return { issues: [], value: result.data as ValidVariantPatch };
}

export function planVariantPatch(product: Product, value: ValidVariantPatch): VariantPatchPlan | null {
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
  return variants.length ? { variants } : null;
}
