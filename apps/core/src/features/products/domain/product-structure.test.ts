import { describe, expect, test } from "vitest";
import type { Currency } from "@shared/money";
import type { OptionId, OptionText, OptionValueId, Product, ProductId, ProductOption, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { combinationKey, orderedAttributes, sortVariants } from "@core/src/features/products/domain/product-structure";

const optionId = (value: string) => value as OptionId;
const valueId = (value: string) => value as OptionValueId;
const text = (value: string) => value as OptionText;
const currency: Currency = "PEN";

const color: ProductOption = { id: optionId("o-color"), name: text("Color"), values: [{ id: valueId("v-negro"), name: text("Negro") }, { id: valueId("v-azul"), name: text("Azul") }] };
const size: ProductOption = { id: optionId("o-talla"), name: text("Talla"), values: [{ id: valueId("v-m"), name: text("M") }, { id: valueId("v-l"), name: text("L") }] };

function variant(id: string, combination: Record<string, string>): ProductVariant {
  return { id: id as VariantId, productId: "p" as ProductId, combination: combination as ProductVariant["combination"],
    salePrice: { amount: 10, currency }, qrCode: id, status: "active", stock: { variantId: id as VariantId, quantity: 0 } };
}

function product(options: readonly ProductOption[], variants: readonly ProductVariant[]): Product {
  return { id: "p" as ProductId, name: "Polo", currency, qrCode: "q", status: "active", createdAt: new Date(0), updatedAt: new Date(0),
    structureVersion: 1, options, variants: variants as Product["variants"] };
}

describe("product structure", () => {
  test("orders attributes by saved option position", () => {
    const polo = product([color, size], [variant("a", { "o-talla": "v-m", "o-color": "v-azul" })]);
    expect(Object.entries(orderedAttributes(polo, polo.variants[0]))).toEqual([["Color", "Azul"], ["Talla", "M"]]);
    const reordered = product([size, color], polo.variants);
    expect(Object.entries(orderedAttributes(reordered, reordered.variants[0]))).toEqual([["Talla", "M"], ["Color", "Azul"]]);
  });

  test("a product without options has no attributes", () => {
    const simple = product([], [variant("a", {})]);
    expect(orderedAttributes(simple, simple.variants[0])).toEqual({});
    expect(combinationKey({})).toBe("");
  });

  test("combination key sorts lowercase value ids by code unit and is stable across rename and reorder", () => {
    const key = combinationKey({ [optionId("o1")]: valueId("B0000000-0000-0000-0000-000000000001"), [optionId("o2")]: valueId("a0000000-0000-0000-0000-000000000002") });
    expect(key).toBe("a0000000-0000-0000-0000-000000000002,b0000000-0000-0000-0000-000000000001");
    expect(combinationKey({ [optionId("o2")]: valueId("a0000000-0000-0000-0000-000000000002"), [optionId("o1")]: valueId("b0000000-0000-0000-0000-000000000001") })).toBe(key);
    expect(combinationKey({ [optionId("o1")]: valueId("Z"), [optionId("o2")]: valueId("a") })).toBe("a,z");
    expect(combinationKey({ [optionId("o1")]: valueId("_"), [optionId("o2")]: valueId("B") })).toBe("_,b");
  });

  test("sorts variants by option positions and then value positions", () => {
    const variants = [
      variant("azul-l", { "o-color": "v-azul", "o-talla": "v-l" }),
      variant("negro-l", { "o-color": "v-negro", "o-talla": "v-l" }),
      variant("azul-m", { "o-color": "v-azul", "o-talla": "v-m" }),
      variant("negro-m", { "o-color": "v-negro", "o-talla": "v-m" }),
    ];
    expect(sortVariants(product([color, size], variants)).map((item) => item.id)).toEqual(["negro-m", "negro-l", "azul-m", "azul-l"]);
    expect(sortVariants(product([size, color], variants)).map((item) => item.id)).toEqual(["negro-m", "azul-m", "negro-l", "azul-l"]);
  });
});
