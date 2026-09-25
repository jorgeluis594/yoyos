import { expect, test } from "vitest";
import { createErrors, updateErrors } from "@core/src/features/products/presentation/messages";

test("translates typed product reasons to their fields in Spanish", () => {
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid product", issues: [
    { scope: "product", field: "description", reason: "TOO_LONG", maxLength: 5000, message: "Too long" },
    { scope: "variant", index: 0, field: "salePrice", reason: "INVALID_PRECISION", maxDecimals: 2, message: "Too precise" },
  ] })).toEqual({
    description: "La descripción debe tener como máximo 5000 caracteres.",
    salePrice: "El precio de venta admite hasta 2 decimales.",
  });
  expect(createErrors({ code: "DUPLICATE_SKU", message: "Duplicate" })).toEqual({ sku: "Este SKU ya está en uso." });
  expect(createErrors({ code: "PERSISTENCE_UNAVAILABLE", message: "database down" })).toEqual({ form: "No se pudo verificar la imagen. Inténtalo de nuevo." });
});

test("translates update failures without comparing technical messages", () => {
  expect(updateErrors({ code: "PRODUCT_NOT_FOUND", message: "Missing" })).toEqual({ form: "El producto ya no está disponible." });
  expect(updateErrors({ code: "DUPLICATE_SKU", message: "Duplicate" })).toEqual({ sku: "Este SKU ya está en uso." });
  expect(updateErrors({ code: "PERSISTENCE_UNAVAILABLE", message: "database down" })).toEqual({ form: "No se pudo verificar la imagen. Inténtalo de nuevo." });
  expect(updateErrors({ code: "VALIDATION_ERROR", message: "Invalid", issues: [
    { scope: "variant", index: 0, field: "id", reason: "VARIANT_NOT_FOUND", message: "Foreign" },
  ] })).toEqual({ form: "La variante no pertenece a este producto." });
});
