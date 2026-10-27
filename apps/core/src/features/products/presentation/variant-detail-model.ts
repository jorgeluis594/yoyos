import { z } from "zod";
import { createInstance } from "i18next";
import resources from "@core/app/locales";
import { changeCombinationRequestSchema, changeVariantStatusRequestSchema, updateVariantRequestSchema, type ProductDetailResponse } from "@shared/contracts/products";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { combinationLabel } from "@shared/product-variants";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";
import { parseRequestValue, type InputError } from "@core/src/features/products/presentation/request-input";

type Product = ProductDetailResponse["product"];
type Variant = Product["variants"][number];
type Language = "es" | "pt";

const translations = createInstance();
void translations.init({ lng: "es", fallbackLng: "es", resources, initAsync: false, interpolation: { escapeValue: false } });

export const variantLabel = (product: Product, variant: Variant): string => combinationLabel(product.options, variant.combination);

export type DeleteBlock = Readonly<{ reason: "orders" } | { reason: "stock"; stock: number } | { reason: "last" }>;

/** The first reason that keeps a variant from being deleted, in the order core checks them. */
export function deleteBlock(product: Product, variant: Variant): DeleteBlock | null {
  if (variant.hasOrders) return { reason: "orders" };
  if (variant.stock > 0) return { reason: "stock", stock: variant.stock };
  if (product.variants.length === 1) return { reason: "last" };
  return null;
}

/** The values of this variant that no other variant uses: deleting it or moving it to another combination removes them. */
export function valuesLeftWithoutVariants(product: Product, variant: Variant): readonly Readonly<{ optionName: string; valueName: string }>[] {
  const others = product.variants.filter((candidate) => candidate.id !== variant.id);
  return variant.combination.flatMap(({ optionId, valueId }) => {
    if (others.some((other) => other.combination.some((entry) => entry.valueId === valueId))) return [];
    const option = product.options.find((candidate) => candidate.id === optionId);
    const value = option?.values.find((candidate) => candidate.id === valueId);
    return option && value ? [{ optionName: option.name, valueName: value.name }] : [];
  });
}

export type VariantIntent = "update" | "combination" | "status" | "delete";
export type VariantRequest =
  | Readonly<{ intent: "update"; request: z.output<typeof updateVariantRequestSchema> }>
  | Readonly<{ intent: "combination"; request: z.output<typeof changeCombinationRequestSchema> }>
  | Readonly<{ intent: "status"; request: z.output<typeof changeVariantStatusRequestSchema> }>
  | Readonly<{ intent: "delete"; request: Record<string, never> }>;

const noBody = z.strictObject({}).readonly();

/** The body of the detail's action: `intent` plus what the matching per-variant request accepts. */
export function parseVariantAction(text: string): Result<VariantRequest, InputError> {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return err({ code: "MALFORMED_JSON", message: "Invalid JSON", issues: [] }); }
  const { intent, ...rest } = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : { intent: undefined };
  const message = "Invalid variant input";
  const parsed = intent === "update" ? parseRequestValue(updateVariantRequestSchema, rest, message)
    : intent === "combination" ? parseRequestValue(changeCombinationRequestSchema, rest, message)
    : intent === "status" ? parseRequestValue(changeVariantStatusRequestSchema, rest, message)
    : intent === "delete" ? parseRequestValue(noBody, rest, message)
    : null;
  if (!parsed) return err({ code: "INVALID_INPUT", message, issues: [{ field: "intent", reason: "INVALID_TYPE" }] });
  if (!parsed.success) return parsed;
  return ok({ intent, request: parsed.data } as VariantRequest);
}

export type VariantErrors = Readonly<{ form?: string; inDoubt?: string; sku?: string; salePrice?: string; purchasePrice?: string; combination?: string }>;
export type VariantOutcome =
  | Readonly<{ intent: VariantIntent; saved: string }>
  | Readonly<{ intent: VariantIntent; failed: true; errors: VariantErrors }>;
type Entries = z.output<typeof changeCombinationRequestSchema>["values"];
type Context = Readonly<{ product: Product | null; variantId: string; entries?: Entries; status?: "active" | "inactive" }>;
type Failure = Readonly<{ code: string; message: string; issues?: readonly ValidationIssue[] }>;

const text = (language: Language) => translations.getFixedT(language, "translation");

function validation(issues: readonly ValidationIssue[], language: Language, context: Context): VariantErrors {
  const t = text(language);
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.scope === "variant" && (issue.field === "salePrice" || issue.field === "purchasePrice")) {
      errors[issue.field] ??= issue.reason === "INVALID_PRECISION" ? t("variantDetail.priceDecimals")
        : issue.field === "salePrice" ? t("variantDetail.priceRequired") : t("variantDetail.purchasePriceInvalid");
    } else if (issue.scope === "variant" && issue.field === "sku") {
      errors.sku ??= issue.reason === "DUPLICATE_SKU" ? t("variantDetail.skuInUse") : t("variantDetail.skuInvalid");
    } else if (issue.scope === "value") {
      const entry = context.entries?.find((candidate) => "newValue" in candidate && candidate.newValue.id === issue.valueId);
      const name = entry && "newValue" in entry ? entry.newValue.name.trim() : "";
      errors.combination ??= issue.reason === "DUPLICATE_VALUE" ? t("variantDetail.valueRepeated", { name })
        : issue.reason === "TOO_LONG" ? t("variantDetail.valueTooLong", { count: issue.maxLength })
        : issue.reason === "REQUIRED" ? t("variantDetail.valueRequired") : t("variantDetail.valueInvalid");
    } else if (issue.scope === "option" && issue.reason === "TOO_MANY_VALUES") {
      errors.combination ??= t("variantDetail.tooManyValues", { count: issue.maximum });
    } else errors.form ??= t("productErrors.invalidValue");
  }
  return errors;
}

function duplicatedLabel(context: Context): string {
  const { product, entries } = context;
  if (!product || !entries) return "";
  return product.options.flatMap((option) => {
    const entry = entries.find((candidate) => candidate.optionId === option.id);
    if (!entry) return [];
    return "valueId" in entry ? option.values.find((value) => value.id === entry.valueId)?.name ?? [] : entry.newValue.name.trim();
  }).join(" / ");
}

function rejection(intent: VariantIntent, error: Failure, language: Language, context: Context): VariantErrors {
  const t = text(language);
  const missing = { form: t("variantDetail.missing") };
  switch (error.code) {
    case "DUPLICATE_SKU": return { sku: t("variantDetail.skuInUse") };
    case "DUPLICATE_COMBINATION": return { combination: t("variantDetail.combinationExists", { label: duplicatedLabel(context) }) };
    case "VALIDATION_ERROR": return validation(error.issues ?? [], language, context);
    case "VARIANT_HAS_ORDERS": return { form: t("variantDetail.blockedOrdersDeactivate") };
    case "VARIANT_HAS_STOCK": {
      const stock = context.product?.variants.find((variant) => variant.id === context.variantId)?.stock;
      return { form: stock === undefined ? t("variantDetail.blockedStockUnknown") : t("variantDetail.blockedStockDeactivate", { count: stock }) };
    }
    case "LAST_VARIANT": return { form: t("variantDetail.blockedLast") };
    case "VARIANT_NOT_FOUND": case "PRODUCT_NOT_FOUND": case "PRODUCT_WITHOUT_OPTIONS": return missing;
    default: return { inDoubt: t(`variantDetail.inDoubt.${intent}`) };
  }
}

/** What the detail shows after an action: its confirmation, or the rejection next to the field it belongs to. */
export function outcomeFor(intent: VariantIntent, result: Result<unknown, Failure>, context: Context, language: Language = "es"): VariantOutcome {
  const t = text(language);
  if (!result.success) return { intent, failed: true, errors: rejection(intent, result.error, language, context) };
  const saved = intent === "status" ? t(context.status === "inactive" ? "variantDetail.saved.deactivate" : "variantDetail.saved.activate") : t(`variantDetail.saved.${intent}`);
  return { intent, saved };
}

/** A request that never reached the server is a connection problem, with its own text per action. */
export const offlineOutcome = (intent: VariantIntent, status: "active" | "inactive" | undefined, language: Language = "es"): VariantOutcome =>
  ({ intent, failed: true, errors: { form: text(language)(`variantDetail.offline.${intent === "status" ? (status === "inactive" ? "deactivate" : "activate") : intent}`) } });

/** An unexpected failure after the request left: the action may or may not have been applied. */
export const inDoubtOutcome = (intent: VariantIntent, language: Language = "es"): VariantOutcome =>
  ({ intent, failed: true, errors: { inDoubt: text(language)(`variantDetail.inDoubt.${intent}`) } });
