import { z } from "zod";
import { currencies } from "@shared/money";
import type { ProductField, ProductValidationReason, ValidationIssue, VariantField } from "@core/src/features/products/domain/errors";
import type { VariantId } from "@core/src/features/products/domain/product";

const MAX_PRICE = 999999999.99;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 5000;
const MAX_SKU = 100;

type DomainIssue = ProductValidationReason & { readonly message: string };
type VariantRef = Readonly<{ scope: "newVariant"; index: number }> | Readonly<{ scope: "variant"; variantId: string }>;
type TranslationOptions = Readonly<{ variantFallback: VariantField; missingVariantsReason: "REQUIRED" | "INVALID_TYPE"; variantRef: (index: number) => VariantRef }>;

const productFields: readonly ProductField[] = ["name", "description", "imageId", "currency", "options", "variants"];
const variantFields: readonly VariantField[] = ["id", "values", "sku", "salePrice", "purchasePrice", "initialStock"];

const codePoints = (value: string) => [...value].length;
const normalize = (value: string) => value.trim().toLowerCase();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue<T>(ctx: z.core.$RefinementCtx<T>, issue: DomainIssue, path?: PropertyKey[]): void {
  ctx.addIssue({ code: "custom", message: issue.message, params: issue, ...(path ? { path } : {}) });
}

const name = z.string().trim().superRefine((value, ctx) => {
  if (!value) addIssue(ctx, { reason: "REQUIRED", message: "Name is required" });
  else if (codePoints(value) > MAX_NAME) addIssue(ctx, { reason: "TOO_LONG", maxLength: MAX_NAME, message: "Name exceeds maximum length" });
});

const description = z.string().superRefine((value, ctx) => {
  if (codePoints(value) > MAX_DESCRIPTION) addIssue(ctx, { reason: "TOO_LONG", maxLength: MAX_DESCRIPTION, message: "Description exceeds maximum length" });
});

const currency = z.enum(currencies);

const sku = z.string().trim().superRefine((value, ctx) => {
  if (value && codePoints(value) > MAX_SKU) addIssue(ctx, { reason: "TOO_LONG", maxLength: MAX_SKU, message: "SKU exceeds maximum length" });
});

const createSku = sku.nullable().transform((value) => (value === "" || value === null ? undefined : value)).optional();
const updateSku = sku.transform((value) => (value === "" ? null : value)).nullable().optional();

const price = (minimum: number) =>
  z
    .unknown()
    .superRefine((value, ctx) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > MAX_PRICE) {
        addIssue(ctx, { reason: "INVALID_PRICE", minimum, maximum: MAX_PRICE, message: "Invalid price" });
        return;
      }
      if (!/^\d+(?:\.\d{1,2})?$/.test(value.toString())) addIssue(ctx, { reason: "INVALID_PRECISION", maxDecimals: 2, message: "Price has too many decimals" });
    })
    .pipe(z.number());

const salePrice = price(0.01);
const purchasePrice = price(0);

const initialStock = z.preprocess(
  (value) => value ?? 0,
  z
    .unknown()
    .superRefine((value, ctx) => {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) addIssue(ctx, { reason: "INVALID_STOCK", message: "Invalid stock" });
    })
    .pipe(z.number()),
);

const createVariant = z.object({
  sku: createSku,
  salePrice,
  purchasePrice: z.preprocess((value) => (value === null ? undefined : value), purchasePrice.optional()),
  initialStock,
});

/** Every row that shares a SKU with another row of the request is reported, not only the later ones. */
function checkUniqueSkus(items: readonly unknown[], ctx: z.core.$RefinementCtx): void {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const value = isRecord(item) && typeof item.sku === "string" ? item.sku.trim() : "";
    if (value) groups.set(normalize(value), [...groups.get(normalize(value)) ?? [], index]);
  });
  for (const group of groups.values()) if (group.length > 1) for (const index of group) addIssue(ctx, { reason: "DUPLICATE_SKU", message: "Repeated SKU" }, [index, "sku"]);
}

export const createProductSchema = z.object({
  name: z.preprocess((value) => (typeof value === "string" ? value : ""), name),
  description: description.nullable().optional(),
  currency,
  variants: z
    .array(createVariant)
    .superRefine((items, ctx) => {
      if (Array.isArray(items)) checkUniqueSkus(items, ctx);
    }, { when: () => true })
    .superRefine((items, ctx) => {
      let total = 0;
      for (const item of items) {
        if (item.initialStock > Number.MAX_SAFE_INTEGER - total) {
          addIssue(ctx, { reason: "INVALID_TOTAL_STOCK", message: "Total stock exceeds the supported range" });
          break;
        }
        total += item.initialStock;
      }
    }),
});

const updateVariant = z.preprocess(
  (value) => (isRecord(value) && (typeof value.id !== "string" || !value.id) ? { id: value.id } : value),
  z.object({
    id: z
      .preprocess((value) => (typeof value === "string" ? value : ""), z.string().superRefine((value, ctx) => {
        if (!value) addIssue(ctx, { reason: "REQUIRED", message: "Variant ID is required" });
      }))
      .transform((value) => value as VariantId),
    sku: updateSku,
    salePrice: salePrice.optional(),
    purchasePrice: purchasePrice.nullable().optional(),
  }),
);

function checkUniqueVariants(items: readonly unknown[], supplied: ReadonlySet<string>, ctx: z.core.$RefinementCtx): void {
  const ids = new Set<string>();
  const skus = new Set<string>();
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    if (typeof item.id === "string" && item.id) {
      if (ids.has(item.id)) addIssue(ctx, { reason: "DUPLICATE_VARIANT", message: "Repeated variant" }, [index, "id"]);
      else if (!supplied.has(item.id)) addIssue(ctx, { reason: "VARIANT_NOT_FOUND", message: "Variant does not belong to the product" }, [index, "id"]);
      ids.add(item.id);
    }
    const value = typeof item.sku === "string" ? item.sku.trim() : undefined;
    if (value) {
      const normalized = normalize(value);
      if (skus.has(normalized)) addIssue(ctx, { reason: "DUPLICATE_SKU", message: "Repeated SKU" }, [index, "sku"]);
      skus.add(normalized);
    }
  });
}

/** The variant patch of `updateVariant`: the only place a price or SKU is edited outside the editor's save. */
export function variantPatchSchema(suppliedVariantIds: ReadonlySet<string>) {
  return z.object({
    variants: z
      .array(updateVariant)
      .default([])
      .superRefine((items, ctx) => {
        if (Array.isArray(items)) checkUniqueVariants(items, suppliedVariantIds, ctx);
      }, { when: () => true }),
  });
}

function invalidType(field: ProductField | VariantField, variantLevel: boolean): DomainIssue {
  if (variantLevel) return { reason: "INVALID_TYPE", message: "Invalid variant" };
  switch (field) {
    case "name": return { reason: "INVALID_TYPE", message: "Name must be text" };
    case "description": return { reason: "INVALID_TYPE", message: "Description must be text" };
    case "imageId": return { reason: "INVALID_TYPE", message: "Image must be an identifier" };
    case "options": return { reason: "INVALID_TYPE", message: "Options must be a list" };
    case "variants": return { reason: "INVALID_TYPE", message: "Variants must be a list" };
    case "sku": return { reason: "INVALID_TYPE", message: "SKU must be text" };
    default: return { reason: "INVALID_TYPE", message: "Invalid value" };
  }
}

function reasonFor(issue: z.core.$ZodIssue, field: ProductField | VariantField, variantLevel: boolean, options: TranslationOptions): DomainIssue {
  if (issue.code === "custom" && issue.params) return issue.params as DomainIssue;
  if (field === "currency") return { reason: "INVALID_CURRENCY", message: "Unsupported currency" };
  if (field === "variants" && options.missingVariantsReason === "REQUIRED" && (issue.code === "invalid_type" || issue.code === "too_small")) {
    return { reason: "REQUIRED", message: "At least one variant is required" };
  }
  if (issue.code === "too_small") return { reason: "REQUIRED", message: "This field is required" };
  return invalidType(field, variantLevel);
}

function isProductField(value: unknown): value is ProductField {
  return typeof value === "string" && productFields.some((field) => field === value);
}

function isVariantField(value: unknown): value is VariantField {
  return typeof value === "string" && variantFields.some((field) => field === value);
}

export function toValidationIssues(error: z.ZodError, options: TranslationOptions): readonly ValidationIssue[] {
  return error.issues.map((issue): ValidationIssue => {
    const path = issue.path;
    if (path[0] === "variants" && typeof path[1] === "number") {
      const variantLevel = !isVariantField(path[2]);
      const field = variantLevel ? options.variantFallback : (path[2] as VariantField);
      return { ...options.variantRef(path[1]), field, ...reasonFor(issue, field, variantLevel, options) };
    }
    const field: ProductField = isProductField(path[0]) ? path[0] : "variants";
    return { scope: "product", field, ...reasonFor(issue, field, false, options) };
  });
}
