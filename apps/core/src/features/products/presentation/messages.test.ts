import { expect, test } from "vitest";
import { createErrors, updateErrors } from "@core/src/features/products/presentation/messages";

test("translates typed product reasons to their fields in Spanish", () => {
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid product", issues: [
    { scope: "product", field: "description", reason: "TOO_LONG", maxLength: 5000, message: "Too long" },
    { scope: "newVariant", index: 0, field: "salePrice", reason: "INVALID_PRECISION", maxDecimals: 2, message: "Too precise" },
  ] })).toEqual({
    description: "La descripción debe tener como máximo 5000 caracteres.",
    salePrice: "El precio de venta admite hasta 2 decimales.",
  });
  expect(createErrors({ code: "DUPLICATE_SKU", message: "Duplicate" })).toEqual({ sku: "Este SKU ya está en uso." });
  expect(createErrors({ code: "PERSISTENCE_UNAVAILABLE", message: "database down" })).toEqual({ form: "No se pudo verificar la imagen. Inténtalo de nuevo." });
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid product", issues: [
    { scope: "product", field: "variants", reason: "INVALID_TOTAL_STOCK", message: "Total stock exceeds the supported range" },
  ] })).toEqual({ form: "El stock total no puede superar el máximo permitido." });
});

test("translates update failures without comparing technical messages", () => {
  expect(updateErrors({ code: "PRODUCT_NOT_FOUND", message: "Missing" })).toEqual({ form: "El producto ya no está disponible." });
  expect(updateErrors({ code: "DUPLICATE_SKU", message: "Duplicate" })).toEqual({ sku: "Este SKU ya está en uso." });
  expect(updateErrors({ code: "PERSISTENCE_UNAVAILABLE", message: "database down" })).toEqual({ form: "No se pudo verificar la imagen. Inténtalo de nuevo." });
  expect(updateErrors({ code: "VALIDATION_ERROR", message: "Invalid", issues: [
    { scope: "variant", variantId: "foreign", field: "id", reason: "VARIANT_NOT_FOUND", message: "Foreign" },
  ] })).toEqual({ form: "La variante no pertenece a este producto." });
});

test("translates product validation and technical errors in Portuguese", () => {
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid", issues: [
    { scope: "product", field: "description", reason: "TOO_LONG", maxLength: 5000, message: "Too long" },
  ] }, "pt")).toEqual({ description: "A descrição deve ter no máximo 5000 caracteres." });
  expect(updateErrors({ code: "PERSISTENCE_UNAVAILABLE", message: "database down" }, "pt"))
    .toEqual({ form: "Não foi possível verificar a imagem. Tente novamente." });
});

test("maps the new reasons and codes to existing generic texts", () => {
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid", issues: [
    { scope: "product", field: "options", reason: "TOO_MANY_OPTIONS", maximum: 3, message: "Too many" },
    { scope: "newVariant", index: 0, field: "values", reason: "INVALID_COMBINATION", message: "Invalid" },
  ] })).toEqual({ form: "El valor no es válido." });
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid", issues: [
    { scope: "newVariant", index: 0, field: "values", reason: "DUPLICATE_COMBINATION", message: "Repeated" },
  ] })).toEqual({ form: "Las variantes deben ser distintas." });
  expect(createErrors({ code: "ID_CONFLICT", message: "Used" })).toEqual({ form: "El identificador ya está en uso." });
  expect(createErrors({ code: "DUPLICATE_COMBINATION", message: "Used" })).toEqual({ form: "Las variantes deben ser distintas." });
});
