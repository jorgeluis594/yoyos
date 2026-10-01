import { translate as localize } from "@core/app/translations";
import type { Language } from "@core/app/locale";
import type { CreateError } from "@core/src/features/products/application/create";
import type { UpdateError } from "@core/src/features/products/application/update";
import type { InputError } from "@core/src/features/products/presentation/input";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";

export type FormErrors = Readonly<{ form?: string; name?: string; description?: string; sku?: string; salePrice?: string; purchasePrice?: string; initialStock?: string }>;

function field(issue: ValidationIssue): keyof FormErrors {
  return issue.scope === "product" ? issue.field === "name" || issue.field === "description" ? issue.field : "form" :
    issue.field === "sku" || issue.field === "salePrice" || issue.field === "purchasePrice" || issue.field === "initialStock" ? issue.field : "form";
}

function message(issue: ValidationIssue, language: Language): string {
  const t = (text: string, values?: readonly (string | number)[]) => localize(language, text, values);
  const label = { id: t("identificador"), name: t("nombre"), description: t("descripción"), sku: t("SKU"), salePrice: t("precio de venta"), purchasePrice: t("precio de compra"), initialStock: t("stock inicial"), currency: t("moneda"), imageId: t("imagen"), variants: t("variantes"), attributes: t("atributos") }[issue.field];
  const subject = { id: t("El identificador"), name: t("El nombre"), description: t("La descripción"), sku: t("El SKU"), salePrice: t("El precio de venta"), purchasePrice: t("El precio de compra"), initialStock: t("El stock inicial"), currency: t("La moneda"), imageId: t("La imagen"), variants: t("Las variantes"), attributes: t("Los atributos") }[issue.field];
  switch (issue.reason) {
    case "REQUIRED": return issue.field === "variants" ? t("Se requiere al menos una variante.") : t("{0} es {1}.", [subject, ["description", "currency", "imageId"].includes(issue.field) ? t("obligatoria") : t("obligatorio")]);
    case "TOO_LONG": return t("{0} debe tener como máximo {1} caracteres.", [subject, issue.maxLength]);
    case "INVALID_CURRENCY": return t("La moneda no es válida.");
    case "INVALID_PRICE": return t("El {0} debe estar entre {1} y {2}.", [label, issue.minimum, issue.maximum]);
    case "INVALID_PRECISION": return t("El {0} admite hasta {1} decimales.", [label, issue.maxDecimals]);
    case "INVALID_STOCK": return t("El stock inicial debe ser un número entero no negativo.");
    case "INVALID_TOTAL_STOCK": return t("El stock total no puede superar el máximo permitido.");
    case "DUPLICATE_SKU": return t("El SKU está repetido.");
    case "DUPLICATE_ATTRIBUTES": return t("Las variantes deben ser distintas.");
    case "DUPLICATE_VARIANT": return t("No se puede repetir una variante.");
    case "VARIANT_NOT_FOUND": return t("La variante no pertenece a este producto.");
    case "INVALID_ATTRIBUTES": return t("Los atributos no son válidos.");
    case "INVALID_TYPE": return t("El valor de {0} no es válido.", [label]);
  }
}

function inputErrors(error: InputError, language: Language): FormErrors {
  const t = (text: string, values?: readonly (string | number)[]) => localize(language, text, values);
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.field.replace(/^variants\.\d+\./, "");
    errors[["name", "description", "sku", "salePrice", "purchasePrice", "initialStock"].includes(key) ? key : "form"] =
      issue.reason === "UNKNOWN_FIELD" ? t("La solicitud contiene campos no permitidos.") : issue.reason === "INVALID_ID" ? t("El identificador no es válido.") : t("El valor no es válido.");
  }
  return errors;
}

function validationErrors(error: { issues: readonly [ValidationIssue, ...ValidationIssue[]] }, language: Language): FormErrors {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[field(issue)] = message(issue, language);
  return errors;
}

function translate(error: CreateError | UpdateError | InputError, language: Language): FormErrors {
  const t = (text: string, values?: readonly (string | number)[]) => localize(language, text, values);
  if (error.code === "PRODUCT_NOT_FOUND") return { form: t("El producto ya no está disponible.") };
  if (error.code === "DUPLICATE_SKU") return { sku: t("Este SKU ya está en uso.") };
  if (error.code === "PRODUCT_ID_CONFLICT") return { form: t("El identificador ya está en uso.") };
  if (error.code === "IMAGE_NOT_FOUND") return { form: t("La imagen ya no está disponible.") };
  if (error.code === "PERSISTENCE_UNAVAILABLE") return { form: t("No se pudo verificar la imagen. Inténtalo de nuevo.") };
  if (error.code === "INVALID_STORED_DATA") return { form: t("No se pudo leer el producto. Inténtalo de nuevo.") };
  if (error.code === "MALFORMED_JSON") return { form: t("La solicitud no es válida. Inténtalo de nuevo.") };
  if (error.code === "INVALID_INPUT") return inputErrors(error, language);
  return validationErrors(error, language);
}

export function createErrors(error: CreateError | InputError, language: Language = "es"): FormErrors {
  return translate(error, language);
}

export function updateErrors(error: UpdateError | InputError, language: Language = "es"): FormErrors {
  return translate(error, language);
}
