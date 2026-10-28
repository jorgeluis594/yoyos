import { expect, test } from "vitest";
import { createErrors, feedbackIssues, saveErrors, saveFeedback } from "@core/src/features/products/presentation/messages";

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
  expect(saveErrors({ code: "PRODUCT_NOT_FOUND", message: "Missing" })).toEqual({ form: "El producto ya no está disponible." });
  expect(saveErrors({ code: "DUPLICATE_SKU", message: "Duplicate" })).toEqual({ sku: "Este SKU ya está en uso." });
  expect(saveErrors({ code: "PERSISTENCE_UNAVAILABLE", message: "database down" })).toEqual({ form: "No se pudo verificar la imagen. Inténtalo de nuevo." });
  expect(saveErrors({ code: "VALIDATION_ERROR", message: "Invalid", issues: [
    { scope: "variant", variantId: "foreign", field: "id", reason: "VARIANT_NOT_FOUND", message: "Foreign" },
  ] })).toEqual({ form: "La variante no pertenece a este producto." });
});

test("translates product validation and technical errors in Portuguese", () => {
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid", issues: [
    { scope: "product", field: "description", reason: "TOO_LONG", maxLength: 5000, message: "Too long" },
  ] }, "pt")).toEqual({ description: "A descrição deve ter no máximo 5000 caracteres." });
  expect(saveErrors({ code: "PERSISTENCE_UNAVAILABLE", message: "database down" }, "pt"))
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

test("a stale structure version and a late order reach the form as notices", () => {
  expect(saveErrors({ code: "PRODUCT_CHANGED", message: "Changed" })).toEqual({ changed: "Este producto cambió desde que lo abriste. Recarga el producto para ver los cambios." });
  expect(saveErrors({ code: "VARIANT_HAS_ORDERS", message: "Orders" }).form).toContain("tiene pedidos o stock");
});

test("rejected saves name the row, option or value with a short text", () => {
  const error = { code: "VALIDATION_ERROR" as const, message: "Invalid", issues: [
    { scope: "newVariant" as const, index: 1, field: "sku" as const, reason: "DUPLICATE_SKU" as const, message: "dup" },
    { scope: "variant" as const, variantId: "v1", field: "salePrice" as const, reason: "REQUIRED" as const, message: "req" },
    { scope: "option" as const, optionIndex: 0, optionId: "o1", field: "values" as const, reason: "TOO_MANY_VARIANTS" as const, maximum: 100, message: "many" },
    { scope: "variant" as const, variantId: "v2", field: "id" as const, reason: "VARIANT_HAS_ORDERS" as const, message: "orders" },
  ] as const };
  expect(feedbackIssues(error).map(({ message, index, variantId, optionId }) => ({ message, index, variantId, optionId }))).toEqual([
    { message: "SKU en uso por otra variante", index: 1 },
    { message: "Falta el precio", variantId: "v1" },
    { message: "Máximo 100 variantes", optionId: "o1" },
    { message: "Tiene pedidos, por eso no se puede eliminar.", variantId: "v2" },
  ].map((item) => ({ index: undefined, variantId: undefined, optionId: undefined, ...item })));
  expect(feedbackIssues({ code: "DUPLICATE_SKU", message: "dup" })).toEqual([]);
});

test("a save with too many photos names the field and a rejected photo leaves the form-level message to its thumbnail", () => {
  const tooMany = { code: "VALIDATION_ERROR" as const, message: "invalid", issues: [{ scope: "product" as const, field: "photoIds" as const, reason: "TOO_MANY_PHOTOS" as const, maximum: 8, message: "Too many photos" }] as const };
  expect(saveFeedback(tooMany).errors).toEqual({ photos: "Un producto puede tener hasta 8 fotos. Quita alguna y guarda de nuevo." });
  expect(saveFeedback(tooMany, "pt").errors).toEqual({ photos: "Um produto pode ter até 8 fotos. Remova alguma e salve de novo." });
  const missing = { code: "VALIDATION_ERROR" as const, message: "invalid", issues: [{ scope: "photo" as const, field: "photoIds" as const, index: 1, reason: "PHOTO_NOT_FOUND" as const, message: "Photo is unavailable" }] as const };
  const feedback = saveFeedback(missing);
  expect(feedback.errors).toEqual({});
  expect(feedback.issues).toEqual([{ scope: "photo", field: "photoIds", reason: "PHOTO_NOT_FOUND", message: "No pudimos usar esta foto. Quítala o súbela de nuevo.", index: 1 }]);
});
