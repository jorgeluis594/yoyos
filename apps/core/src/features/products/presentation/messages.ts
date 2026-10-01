import { createInstance } from "i18next";
import resources from "@core/app/locales";
import type { CreateError } from "@core/src/features/products/application/create";
import type { UpdateError } from "@core/src/features/products/application/update";
import type { InputError } from "@core/src/features/products/presentation/input";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";

const translations = createInstance();
void translations.init({ lng: "es", fallbackLng: "es", resources, initAsync: false });
type Language = "es" | "pt";

export type FormErrors = Readonly<{ form?: string; name?: string; description?: string; sku?: string; salePrice?: string; purchasePrice?: string; initialStock?: string }>;

function field(issue: ValidationIssue): keyof FormErrors {
  return issue.scope === "product" ? issue.field === "name" || issue.field === "description" ? issue.field : "form" :
    issue.field === "sku" || issue.field === "salePrice" || issue.field === "purchasePrice" || issue.field === "initialStock" ? issue.field : "form";
}

function message(issue: ValidationIssue, language: Language): string {
  const t = translations.getFixedT(language, "translation");
  const label = t(`productErrors.label.${issue.field}`);
  const subject = t(`productErrors.subject.${issue.field}`);
  switch (issue.reason) {
    case "REQUIRED": return issue.field === "variants" ? t("productErrors.requiredVariant") : t(["description", "currency", "imageId"].includes(issue.field) ? "productErrors.requiredFeminine" : "productErrors.requiredMasculine", { subject });
    case "TOO_LONG": return t("productErrors.tooLong", { subject, maxLength: issue.maxLength });
    case "INVALID_CURRENCY": return t("productErrors.invalidCurrency");
    case "INVALID_PRICE": return t("productErrors.invalidPrice", { label, minimum: issue.minimum, maximum: issue.maximum });
    case "INVALID_PRECISION": return t("productErrors.invalidPrecision", { label, maxDecimals: issue.maxDecimals });
    case "INVALID_STOCK": return t("productErrors.invalidStock");
    case "INVALID_TOTAL_STOCK": return t("productErrors.invalidTotalStock");
    case "DUPLICATE_SKU": return t("productErrors.duplicateSku");
    case "DUPLICATE_ATTRIBUTES": return t("productErrors.duplicateAttributes");
    case "DUPLICATE_VARIANT": return t("productErrors.duplicateVariant");
    case "VARIANT_NOT_FOUND": return t("productErrors.variantNotFound");
    case "INVALID_ATTRIBUTES": return t("productErrors.invalidAttributes");
    case "INVALID_TYPE": return t("productErrors.invalidType", { label });
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
  if (error.code === "PRODUCT_NOT_FOUND") return { form: t("productErrors.productNotFound") };
  if (error.code === "DUPLICATE_SKU") return { sku: t("productErrors.skuInUse") };
  if (error.code === "PRODUCT_ID_CONFLICT") return { form: t("productErrors.idConflict") };
  if (error.code === "IMAGE_NOT_FOUND") return { form: t("productErrors.imageNotFound") };
  if (error.code === "PERSISTENCE_UNAVAILABLE") return { form: t("productErrors.persistenceUnavailable") };
  if (error.code === "INVALID_STORED_DATA") return { form: t("productErrors.invalidStoredData") };
  if (error.code === "MALFORMED_JSON") return { form: t("productErrors.malformedJson") };
  if (error.code === "INVALID_INPUT") return inputErrors(error, language);
  return validationErrors(error, language);
}

export function createErrors(error: CreateError | InputError, language: Language = "es"): FormErrors {
  return translate(error, language);
}

export function updateErrors(error: UpdateError | InputError, language: Language = "es"): FormErrors {
  return translate(error, language);
}
