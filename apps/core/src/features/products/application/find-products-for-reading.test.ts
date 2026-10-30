import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import { buildProductsForReading, findProductsForReading, type ReadingRows } from "@core/src/features/products/application/find-products-for-reading";

const product = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as ProductId;
const variant = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}` as VariantId;
const price = (amount: number) => ({ amount, currency: "PEN" as const });
const option = (variantId: VariantId, optionName: string, optionPosition: number, valueName: string, valuePosition: number) => ({ variantId, optionName, optionPosition, valueName, valuePosition });

const polo: ReadingRows = {
  products: [{ id: product(1), name: "Polo básico", status: "active" }],
  variants: [
    { id: variant(2), productId: product(1), sku: null, unitPrice: price(40) },
    { id: variant(1), productId: product(1), sku: "PB-MN", unitPrice: price(35) },
  ],
  options: [
    option(variant(1), "Color", 1, "Negro", 0), option(variant(1), "Talla", 0, "M", 0),
    option(variant(2), "Color", 1, "Blanco", 1), option(variant(2), "Talla", 0, "M", 0),
  ],
};

describe("buildProductsForReading", () => {
  test("lists each attribute once in option order with its values in value order, and the variants in saved order", () => {
    const [read] = buildProductsForReading([product(1)], polo);
    expect(read).toEqual({
      productId: product(1), name: "Polo básico", sellable: true,
      attributes: [{ name: "Talla", values: ["M"] }, { name: "Color", values: ["Negro", "Blanco"] }],
      variants: [
        { variantId: variant(1), productName: "Polo básico", sku: "PB-MN", unitPrice: price(35), variantAttributes: { Talla: "M", Color: "Negro" } },
        { variantId: variant(2), productName: "Polo básico", sku: null, unitPrice: price(40), variantAttributes: { Talla: "M", Color: "Blanco" } },
      ],
    });
  });

  test("reports a product that is not active as not sellable, with its name and no variants", () => {
    const rows: ReadingRows = { ...polo, products: [{ id: product(1), name: "Polo básico", status: "archived" }] };
    expect(buildProductsForReading([product(1)], rows)).toEqual([{ productId: product(1), name: "Polo básico", sellable: false, attributes: [], variants: [] }]);
  });

  test("reports a product whose variants are all inactive as not sellable", () => {
    const rows: ReadingRows = { products: polo.products, variants: [], options: [] };
    expect(buildProductsForReading([product(1)], rows)[0]).toMatchObject({ sellable: false, attributes: [], variants: [] });
  });

  test("leaves out a product the rows do not hold and repeats none, keeping the order asked", () => {
    const rows: ReadingRows = { ...polo, products: [...polo.products, { id: product(3), name: "Gorra", status: "active" }] };
    expect(buildProductsForReading([product(3), product(9), product(1), product(3)], rows).map(({ productId }) => productId)).toEqual([product(3), product(1)]);
  });

  test("gives a product with a single variant and no options an empty attribute list", () => {
    const rows: ReadingRows = { products: [{ id: product(3), name: "Gorra", status: "active" }], variants: [{ id: variant(5), productId: product(3), sku: null, unitPrice: price(20) }], options: [] };
    expect(buildProductsForReading([product(3)], rows)[0]).toMatchObject({ sellable: true, attributes: [], variants: [{ variantAttributes: {} }] });
  });
});

describe("findProductsForReading", () => {
  test("reads nothing for no ids", async () => {
    let reads = 0;
    expect(await findProductsForReading([], { readRows: async () => { reads += 1; return ok(polo); } })).toEqual(ok([]));
    expect(reads).toBe(0);
  });

  test("passes a read failure through", async () => {
    const failure = err({ code: "INVALID_STORED_DATA" as const, message: "Unable to read catalog" });
    expect(await findProductsForReading([product(1)], { readRows: async () => failure })).toEqual(failure);
  });
});
