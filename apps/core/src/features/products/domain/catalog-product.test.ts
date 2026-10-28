import { expect, test } from "vitest";
import { toCatalogCard, toCatalogProduct, type StoredCatalogProduct } from "@core/src/features/products/domain/catalog-product";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const product = (variants: StoredCatalogProduct["variants"], options: StoredCatalogProduct["options"] = []): StoredCatalogProduct =>
  ({ id: "p1" as ProductId, name: "Polo básico", description: null, imageId: null, currency: "PEN", options, variants });
const variant = (id: string, attributes: Record<string, string>, salePrice: number, stock: number) => ({ id: id as VariantId, attributes, salePrice, stock });

test("shows «Desde» price when variants of a product have different prices", () => {
  const polo = toCatalogProduct(product([variant("m", { Talla: "M", Color: "Negro" }, 45, 3), variant("l", { Talla: "L", Color: "Negro" }, 49, 0)],
    [{ name: "Talla", values: ["M", "L"] }, { name: "Color", values: ["Negro"] }]), null);
  expect(polo.price).toEqual({ kind: "from", amount: { amount: 45, currency: "PEN" } });
  expect(polo.soldOut).toBe(false);
  expect(polo.attributes).toEqual([{ name: "Talla", values: ["M", "L"] }, { name: "Color", values: ["Negro"] }]);
  expect(polo.variants.map(({ maxQuantity }) => maxQuantity)).toEqual([3, 0]);

  const single = toCatalogProduct(product([variant("a", {}, 30, 500), variant("b", {}, 30, 0)]), "https://img/a.png");
  expect(single.price).toEqual({ kind: "single", amount: { amount: 30, currency: "PEN" } });
  expect(single.variants[0].maxQuantity).toBe(99);
  expect(toCatalogProduct(product([variant("x", {}, 10, 0)]), null).soldOut).toBe(true);
});

test("catalog selectors follow saved order and hide values without active variants", () => {
  // Color is saved before Talla; Azul, M and XL are used by no active variant.
  const polo = toCatalogProduct(product([variant("sn", { Color: "Negro", Talla: "S" }, 45, 3), variant("ln", { Color: "Negro", Talla: "L" }, 45, 1)],
    [{ name: "Color", values: ["Negro", "Azul"] }, { name: "Talla", values: ["S", "M", "L", "XL"] }]), null);
  expect(polo.attributes).toEqual([{ name: "Color", values: ["Negro"] }, { name: "Talla", values: ["S", "L"] }]);
  const noOptionValues = toCatalogProduct(product([variant("a", {}, 30, 2)], [{ name: "Color", values: ["Negro"] }]), null);
  expect(noOptionValues.attributes).toEqual([]);
});

test("a card is single priced when the active variants share a price and from otherwise", () => {
  const card = { id: "p1" as ProductId, name: "Polo", imageId: null, currency: "PEN" as const, minPrice: 45, maxPrice: 45, soldOut: false };
  expect(toCatalogCard(card, null).price).toEqual({ kind: "single", amount: { amount: 45, currency: "PEN" } });
  expect(toCatalogCard({ ...card, maxPrice: 49, soldOut: true }, "https://img/a.png")).toMatchObject({ price: { kind: "from" }, soldOut: true, imageUrl: "https://img/a.png" });
});
