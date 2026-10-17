import { expect, test } from "vitest";
import { optionState, selectedVariant } from "@core/src/features/catalog/presentation/variant-selection";
import { toCatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const variant = (id: string, Talla: string, Color: string, stock: number) => ({ id: id as VariantId, attributes: { Talla, Color }, salePrice: 45, stock });
const polo = toCatalogProduct({ id: "p" as ProductId, name: "Polo", description: null, imageId: null, currency: "PEN",
  variants: [variant("mn", "M", "Negro", 3), variant("ln", "L", "Negro", 0), variant("mb", "M", "Beige", 1)] }, null);

test("sold out and missing combinations are not selectable and a full selection picks its variant", () => {
  expect(optionState(polo, {}, "Talla", "L")).toBe("sold_out");
  expect(optionState(polo, { Color: "Beige" }, "Talla", "L")).toBe("missing");
  expect(optionState(polo, { Talla: "L" }, "Talla", "M")).toBe("available");
  expect(selectedVariant(polo, { Talla: "M" })).toBeNull();
  expect(selectedVariant(polo, { Talla: "M", Color: "Negro" })).toMatchObject({ id: "mn", maxQuantity: 3 });
});
