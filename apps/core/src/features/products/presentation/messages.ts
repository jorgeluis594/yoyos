import { createInstance } from "i18next";
import resources from "@core/app/locales";
import type { CreateError } from "@core/src/features/products/application/create";
import type { UpdateError } from "@core/src/features/products/application/update";
import type { InputError } from "@core/src/features/products/presentation/request-input";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";

const translations = createInstance();
void translations.init({ lng: "es", fallbackLng: "es", resources, initAsync: false });
type Language = "es" | "pt";

export type FormErrors = Readonly<{ form?: string; name?: string; description?: string; sku?: string; salePrice?: string; purchasePrice?: string; initialStock?: string }>;

// T1 shows no option or value texts: every new reason and code maps to an existing generic text until the editors add theirs.
const labelled = ["id", "name", "description", "sku", "salePrice", "purchasePrice", "initialStock", "currency", "imageId", "variants"] as const;
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
    case "REQUIRED": return !names ? generic() : names.field === "variants" ? t("productErrors.requiredVariant") : t(["description", "currency", "imageId"].includes(names.field) ? "productErrors.requiredFeminine" : "productErrors.requiredMasculine", { subject: names.subject });
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

function translate(error: CreateError | UpdateError | InputError, language: Language): FormErrors {
  const t = translations.getFixedT(language, "translation");
  switch (error.code) {
    case "PRODUCT_NOT_FOUND": return { form: t("productErrors.productNotFound") };
    case "DUPLICATE_SKU": return { sku: t("productErrors.skuInUse") };
    case "PRODUCT_ID_CONFLICT": return { form: t("productErrors.idConflict") };
    case "ID_CONFLICT": return { form: t("productErrors.idConflict") };
    case "DUPLICATE_COMBINATION": return { form: t("productErrors.duplicateAttributes") };
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

export function updateErrors(error: UpdateError | InputError, language: Language = "es"): FormErrors {
  return translate(error, language);
}
