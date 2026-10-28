import { createInstance } from "i18next";
import resources from "@core/app/locales";
import type { CreateError } from "@core/src/features/products/application/create";
import type { SaveProductError } from "@core/src/features/products/application/save-product";
import type { InputError } from "@core/src/features/products/presentation/request-input";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";

const translations = createInstance();
void translations.init({ lng: "es", fallbackLng: "es", resources, initAsync: false, interpolation: { escapeValue: false } });
export type Language = "es" | "pt";

/** The fixed translator the product texts of the server use; React escapes what it renders, so values are not escaped twice. */
export const productText = (language: Language) => translations.getFixedT(language, "translation");

export type FormErrors = Readonly<{ form?: string; changed?: string; inDoubt?: string; name?: string; description?: string; sku?: string; salePrice?: string; purchasePrice?: string; initialStock?: string }>;

/** One rejected part of an editor save, with the text to show next to its option, value or row. */
export type FeedbackIssue = Readonly<{
  scope: "product" | "option" | "value" | "variant" | "newVariant" | "photo";
  field: string; reason: string; message: string;
  optionId?: string; valueId?: string; variantId?: string; index?: number;
}>;
export type SaveFeedback = Readonly<{ errors: FormErrors; issues: readonly FeedbackIssue[] }>;

const labelled = ["id", "name", "description", "sku", "salePrice", "purchasePrice", "initialStock", "currency", "photoIds", "variants"] as const;
type Labelled = (typeof labelled)[number];
const isLabelled = (field: string): field is Labelled => labelled.some((candidate) => candidate === field);

function field(issue: ValidationIssue): keyof FormErrors {
  if (issue.scope === "product") return issue.field === "name" || issue.field === "description" ? issue.field : "form";
  if (issue.scope === "variant" || issue.scope === "newVariant") return issue.field === "sku" || issue.field === "salePrice" || issue.field === "purchasePrice" || issue.field === "initialStock" ? issue.field : "form";
  return "form";
}

function message(issue: ValidationIssue, language: Language): string {
  const t = translations.getFixedT(language, "translation");
  const generic = () => t("productErrors.invalidValue");
  const names = isLabelled(issue.field) ? { label: t(`productErrors.label.${issue.field}`), subject: t(`productErrors.subject.${issue.field}`), field: issue.field } : null;
  switch (issue.reason) {
    case "REQUIRED": return !names ? generic() : names.field === "variants" ? t("productErrors.requiredVariant") : t(["description", "currency", "photoIds"].includes(names.field) ? "productErrors.requiredFeminine" : "productErrors.requiredMasculine", { subject: names.subject });
    case "TOO_LONG": return names ? t("productErrors.tooLong", { subject: names.subject, maxLength: issue.maxLength }) : generic();
    case "INVALID_CURRENCY": return t("productErrors.invalidCurrency");
    case "INVALID_PRICE": return names ? t("productErrors.invalidPrice", { label: names.label, minimum: issue.minimum, maximum: issue.maximum }) : generic();
    case "INVALID_PRECISION": return names ? t("productErrors.invalidPrecision", { label: names.label, maxDecimals: issue.maxDecimals }) : generic();
    case "INVALID_STOCK": return t("productErrors.invalidStock");
    case "INVALID_TOTAL_STOCK": return t("productErrors.invalidTotalStock");
    case "DUPLICATE_SKU": return t("productErrors.skuInUse");
    case "DUPLICATE_COMBINATION": return t("productErrors.duplicateAttributes");
    case "DUPLICATE_VARIANT": return t("productErrors.duplicateVariant");
    case "VARIANT_NOT_FOUND": return t("productErrors.variantNotFound");
    case "ID_CONFLICT": return t("productErrors.idConflict");
    case "INVALID_TYPE": return names ? t("productErrors.invalidType", { label: names.label }) : generic();
    default: return generic();
  }
}

function inputErrors(error: InputError, language: Language): FormErrors {
  const t = translations.getFixedT(language, "translation");
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.field.replace(/^variants\.\d+\./, "");
    errors[["name", "description", "sku", "salePrice", "purchasePrice", "initialStock"].includes(key) ? key : "form"] =
      issue.reason === "UNKNOWN_FIELD" ? t("productErrors.unknownField") : issue.reason === "INVALID_ID" ? t("productErrors.invalidId") : t("productErrors.invalidValue");
  }
  return errors;
}

function validationErrors(error: { issues: readonly [ValidationIssue, ...ValidationIssue[]] }, language: Language): FormErrors {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[field(issue)] = message(issue, language);
  return errors;
}

function translate(error: CreateError | SaveProductError | InputError, language: Language): FormErrors {
  const t = translations.getFixedT(language, "translation");
  switch (error.code) {
    case "PRODUCT_NOT_FOUND": return { form: t("productErrors.productNotFound") };
    case "DUPLICATE_SKU": return { sku: t("productErrors.skuInUse") };
    case "PRODUCT_ID_CONFLICT": return { form: t("productErrors.idConflict") };
    case "ID_CONFLICT": return { form: t("productErrors.idConflict") };
    case "DUPLICATE_COMBINATION": return { form: t("productErrors.duplicateAttributes") };
    case "PRODUCT_CHANGED": return { changed: t("productEditor.changed") };
    case "VARIANT_HAS_ORDERS": return { form: t("productEditor.deletedBlocked") };
    case "IMAGE_NOT_FOUND": return { form: t("productErrors.imageNotFound") };
    case "PERSISTENCE_UNAVAILABLE": return { form: t("productErrors.persistenceUnavailable") };
    case "INVALID_STORED_DATA": return { form: t("productErrors.invalidStoredData") };
    case "MALFORMED_JSON": return { form: t("productErrors.malformedJson") };
    case "INVALID_INPUT": return inputErrors(error, language);
    case "VALIDATION_ERROR": return validationErrors(error, language);
  }
}

export function createErrors(error: CreateError | InputError, language: Language = "es"): FormErrors {
  return translate(error, language);
}

export function saveErrors(error: SaveProductError | InputError, language: Language = "es"): FormErrors {
  return translate(error, language);
}

function issueText(issue: ValidationIssue, language: Language): string {
  const t = translations.getFixedT(language, "translation");
  switch (issue.reason) {
    case "DUPLICATE_SKU": return t("productEditor.skuInUse");
    case "REQUIRED": return issue.scope === "variant" || issue.scope === "newVariant" ? (issue.field === "salePrice" ? t("productEditor.priceMissing") : message(issue, language)) : message(issue, language);
    case "INVALID_STOCK": return t("productEditor.stockInvalid");
    case "DUPLICATE_COMBINATION": case "DUPLICATE_VARIANT": return t("productEditor.combinationRepeated");
    case "VARIANT_HAS_ORDERS": return t("productEditor.hasOrders");
    case "VARIANT_HAS_STOCK": return t("productEditor.hasStock");
    case "INVALID_PRICE": case "INVALID_PRECISION": case "TOO_LONG": return message(issue, language);
    case "TOO_MANY_VARIANTS": return t("productEditor.tooManyVariants", { count: issue.maximum });
    case "OPTION_WITHOUT_VALUES": return t("productEditor.noValues");
    case "DUPLICATE_VALUE": return t("productEditor.valueInvalid");
    default: return issue.scope === "option" ? t("productEditor.optionInvalid") : issue.scope === "value" ? t("productEditor.valueInvalid") : issue.scope === "product" ? message(issue, language) : t("productEditor.rowInvalid");
  }
}

/** The editor's per-option, per-value and per-row messages of a rejected save; empty for every other failure. */
export function feedbackIssues(error: CreateError | SaveProductError | InputError, language: Language = "es"): readonly FeedbackIssue[] {
  if (error.code !== "VALIDATION_ERROR") return [];
  return error.issues.map((issue): FeedbackIssue => ({
    scope: issue.scope, field: issue.field, reason: issue.reason, message: issueText(issue, language),
    ...(issue.scope === "option" && issue.optionId ? { optionId: issue.optionId } : {}),
    ...(issue.scope === "value" && issue.valueId ? { valueId: issue.valueId } : {}),
    ...(issue.scope === "variant" ? { variantId: issue.variantId } : {}),
    ...(issue.scope === "newVariant" ? { index: issue.index } : {}),
  }));
}

export const createFeedback = (error: CreateError | InputError, language: Language = "es"): SaveFeedback => ({ errors: createErrors(error, language), issues: feedbackIssues(error, language) });
export const saveFeedback = (error: SaveProductError | InputError, language: Language = "es"): SaveFeedback => ({ errors: saveErrors(error, language), issues: feedbackIssues(error, language) });
