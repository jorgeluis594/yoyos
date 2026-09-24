import { expect, test } from "vitest";
import { createErrors } from "@core/src/features/products/presentation/messages";

test("translates typed product reasons to their fields in Spanish", () => {
  expect(createErrors({ code: "VALIDATION_ERROR", message: "Invalid product", issues: [
    { scope: "product", field: "description", reason: "TOO_LONG", maxLength: 5000, message: "Too long" },
    { scope: "variant", index: 0, field: "salePrice", reason: "INVALID_PRECISION", maxDecimals: 2, message: "Too precise" },
  ] })).toEqual({
    description: "La descripción debe tener como máximo 5000 caracteres.",
    salePrice: "El precio de venta admite hasta 2 decimales.",
  });
  expect(createErrors({ code: "DUPLICATE_SKU", message: "Duplicate" })).toEqual({ sku: "Este SKU ya está en uso." });
});
