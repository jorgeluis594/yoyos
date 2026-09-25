import type { CreateError } from "@core/src/features/products/application/create";
import type { UpdateError } from "@core/src/features/products/application/update";
import type { InputError } from "@core/src/features/products/presentation/input";
import type { ValidationIssue } from "@core/src/features/products/domain/errors";

export type FormErrors = Readonly<{ form?: string; name?: string; description?: string; sku?: string; salePrice?: string; purchasePrice?: string; initialStock?: string }>;

function field(issue: ValidationIssue): keyof FormErrors {
  return issue.scope === "product" ? issue.field === "name" || issue.field === "description" ? issue.field : "form" :
    issue.field === "sku" || issue.field === "salePrice" || issue.field === "purchasePrice" || issue.field === "initialStock" ? issue.field : "form";
}

function message(issue: ValidationIssue): string {
  const label = { id: "identificador", name: "nombre", description: "descripción", sku: "SKU", salePrice: "precio de venta", purchasePrice: "precio de compra", initialStock: "stock inicial", currency: "moneda", imageId: "imagen", variants: "variantes", attributes: "atributos" }[issue.field];
  const subject = { id: "El identificador", name: "El nombre", description: "La descripción", sku: "El SKU", salePrice: "El precio de venta", purchasePrice: "El precio de compra", initialStock: "El stock inicial", currency: "La moneda", imageId: "La imagen", variants: "Las variantes", attributes: "Los atributos" }[issue.field];
  switch (issue.reason) {
    case "REQUIRED": return issue.field === "variants" ? "Se requiere al menos una variante." : `${subject} es ${["description", "currency", "imageId"].includes(issue.field) ? "obligatoria" : "obligatorio"}.`;
    case "TOO_LONG": return `${subject} debe tener como máximo ${issue.maxLength} caracteres.`;
    case "INVALID_CURRENCY": return "La moneda no es válida.";
    case "INVALID_PRICE": return `El ${label} debe estar entre ${issue.minimum} y ${issue.maximum}.`;
    case "INVALID_PRECISION": return `El ${label} admite hasta ${issue.maxDecimals} decimales.`;
    case "INVALID_STOCK": return "El stock inicial debe ser un número entero no negativo.";
    case "INVALID_TOTAL_STOCK": return "El stock total no puede superar el máximo permitido.";
    case "DUPLICATE_SKU": return "El SKU está repetido.";
    case "DUPLICATE_ATTRIBUTES": return "Las variantes deben ser distintas.";
    case "DUPLICATE_VARIANT": return "No se puede repetir una variante.";
    case "VARIANT_NOT_FOUND": return "La variante no pertenece a este producto.";
    case "INVALID_ATTRIBUTES": return "Los atributos no son válidos.";
    case "INVALID_TYPE": return `El valor de ${label} no es válido.`;
  }
}

function inputErrors(error: InputError): FormErrors {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.field.replace(/^variants\.\d+\./, "");
    errors[["name", "description", "sku", "salePrice", "purchasePrice", "initialStock"].includes(key) ? key : "form"] =
      issue.reason === "UNKNOWN_FIELD" ? "La solicitud contiene campos no permitidos." : issue.reason === "INVALID_ID" ? "El identificador no es válido." : "El valor no es válido.";
  }
  return errors;
}

function validationErrors(error: { issues: readonly [ValidationIssue, ...ValidationIssue[]] }): FormErrors {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[field(issue)] = message(issue);
  return errors;
}

function translate(error: CreateError | UpdateError | InputError): FormErrors {
  if (error.code === "PRODUCT_NOT_FOUND") return { form: "El producto ya no está disponible." };
  if (error.code === "DUPLICATE_SKU") return { sku: "Este SKU ya está en uso." };
  if (error.code === "IMAGE_NOT_FOUND") return { form: "La imagen ya no está disponible." };
  if (error.code === "PERSISTENCE_UNAVAILABLE") return { form: "No se pudo verificar la imagen. Inténtalo de nuevo." };
  if (error.code === "MALFORMED_JSON") return { form: "La solicitud no es válida. Inténtalo de nuevo." };
  if (error.code === "INVALID_INPUT") return inputErrors(error);
  return validationErrors(error);
}

export function createErrors(error: CreateError | InputError): FormErrors {
  return translate(error);
}

export function updateErrors(error: UpdateError | InputError): FormErrors {
  return translate(error);
}
