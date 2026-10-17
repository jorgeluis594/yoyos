import { expect, test } from "vitest";
import { toCatalogProduct, type StoredCatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const product = (variants: StoredCatalogProduct["variants"]): StoredCatalogProduct =>
  ({ id: "p1" as ProductId, name: "Polo básico", description: null, imageId: null, currency: "PEN", variants });
const variant = (id: string, attributes: Record<string, string>, salePrice: number, stock: number) => ({ id: id as VariantId, attributes, salePrice, stock });

test("shows «Desde» price when variants of a product have different prices", () => {
  const polo = toCatalogProduct(product([variant("m", { Talla: "M", Color: "Negro" }, 45, 3), variant("l", { Talla: "L", Color: "Negro" }, 49, 0)]), null);
  expect(polo.price).toEqual({ kind: "from", amount: { amount: 45, currency: "PEN" } });
  expect(polo.soldOut).toBe(false);
  expect(polo.attributes).toEqual([{ name: "Talla", values: ["M", "L"] }, { name: "Color", values: ["Negro"] }]);
  expect(polo.variants.map(({ maxQuantity }) => maxQuantity)).toEqual([3, 0]);

  const single = toCatalogProduct(product([variant("a", {}, 30, 500), variant("b", {}, 30, 0)]), "https://img/a.png");
  expect(single.price).toEqual({ kind: "single", amount: { amount: 30, currency: "PEN" } });
  expect(single.variants[0].maxQuantity).toBe(99);
  expect(toCatalogProduct(product([variant("x", {}, 10, 0)]), null).soldOut).toBe(true);
});
