import { describe, expect, test } from "vitest";
import type { Currency } from "@shared/money";
import type { OptionId, OptionText, OptionValueId, Product, ProductId, ProductOption, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { normalizeOptionText, productOptionLimits as sharedLimits } from "@shared/contracts/products";
import { combinationKey, productOptionLimits, emptiedValues, orderedAttributes, parseProductStructure, sortVariants, type RawOption } from "@core/src/features/products/domain/product-structure";

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

const raw = (id: string, name: string, values: readonly (readonly [string, string])[]): RawOption => ({ id, name, values: values.map(([valueId, valueName]) => ({ id: valueId, name: valueName })) });
const talla = raw("o-talla", "Talla", [["t-s", "S"], ["t-m", "M"], ["t-l", "L"]]);
const colores = raw("o-color", "Color", [["c-negro", "Negro"], ["c-azul", "Azul"]]);
const issueKeys = (issues: readonly { scope: string; reason: string }[]) => issues.map((issue) => `${issue.scope}:${issue.reason}`);

describe("parseProductStructure", () => {
  test("accepts a product without options and one variant without values", () => {
    expect(parseProductStructure({ options: [], variants: [{ values: [] }] })).toMatchObject({ issues: [], value: { options: [], combinations: [{}] } });
  });

  test("builds options in the given order with one combination per variant", () => {
    const parsed = parseProductStructure({ options: [talla, colores], variants: [{ values: ["t-s", "c-negro"] }, { values: ["c-azul", "t-m"] }] });
    expect(parsed.issues).toEqual([]);
    expect(parsed.value?.options.map((option) => option.name)).toEqual(["Talla", "Color"]);
    expect(parsed.value?.combinations).toEqual([{ "o-talla": "t-s", "o-color": "c-negro" }, { "o-talla": "t-m", "o-color": "c-azul" }]);
  });

  test("rejects four options, thirty-one values and one hundred and one variants with every issue together", () => {
    const many = raw("o-many", "Muchos", Array.from({ length: 31 }, (_, index) => [`m-${index}`, `V${index}`] as const));
    const extra = [1, 2, 3].map((index) => raw(`o-${index}`, `Opción ${index}`, [[`e-${index}`, "x"]]));
    const parsed = parseProductStructure({ options: [many, ...extra], variants: Array.from({ length: 101 }, () => ({ values: [] })) });
    expect(parsed.value).toBeUndefined();
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "product", field: "options", reason: "TOO_MANY_OPTIONS", maximum: 3 }),
      expect.objectContaining({ scope: "option", optionIndex: 0, field: "values", reason: "TOO_MANY_VALUES", maximum: 30 }),
      expect.objectContaining({ scope: "product", field: "variants", reason: "TOO_MANY_VARIANTS", maximum: 100 }),
    ]));
  });

  test("treats 'm' and 'M ' as the same value in an option", () => {
    const parsed = parseProductStructure({ options: [raw("o-talla", "Talla", [["t-1", "m"], ["t-2", "M "]])], variants: [{ values: ["t-1"] }, { values: ["t-2"] }] });
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "value", optionIndex: 0, valueIndex: 0, reason: "DUPLICATE_VALUE" }),
      expect.objectContaining({ scope: "value", optionIndex: 0, valueIndex: 1, reason: "DUPLICATE_VALUE" }),
    ]));
  });

  test("rejects repeated option names, empty options and invalid names", () => {
    const parsed = parseProductStructure({ options: [raw("o-1", "Color", [["a", "Rojo"]]), raw("o-2", " color ", []), raw("o-3", " ", [["b", "x".repeat(31)]])], variants: [{ values: ["a"] }] });
    expect(issueKeys(parsed.issues)).toEqual(expect.arrayContaining(["option:DUPLICATE_OPTION", "option:OPTION_WITHOUT_VALUES", "option:REQUIRED", "value:TOO_LONG"]));
  });

  test("rejects a variant without exactly one value per option", () => {
    const parsed = parseProductStructure({ options: [talla, colores], variants: [{ values: ["t-s"] }, { values: ["t-s", "t-m", "c-azul"] }, { values: ["t-l", "c-azul"] }] });
    expect(parsed.issues).toEqual([
      expect.objectContaining({ scope: "newVariant", index: 0, field: "values", reason: "INVALID_COMBINATION" }),
      expect.objectContaining({ scope: "newVariant", index: 1, field: "values", reason: "INVALID_COMBINATION" }),
    ]);
  });

  test("rejects values that no option lists and an empty variant list of values for a product with options", () => {
    const parsed = parseProductStructure({ options: [talla], variants: [{ values: ["nope"] }, { values: [] }] });
    expect(issueKeys(parsed.issues)).toEqual(["newVariant:VALUE_NOT_FOUND", "newVariant:INVALID_COMBINATION"]);
    expect(issueKeys(parseProductStructure({ options: [], variants: [{ values: ["t-s"] }] }).issues)).toEqual(["newVariant:VALUE_NOT_FOUND"]);
  });

  test("rejects two variants with the same combination, active or inactive", () => {
    const parsed = parseProductStructure({ options: [talla, colores], variants: [{ values: ["t-s", "c-azul"] }, { values: ["t-m", "c-azul"] }, { values: ["c-azul", "t-s"] }] });
    expect(parsed.issues).toEqual([
      expect.objectContaining({ scope: "newVariant", index: 0, reason: "DUPLICATE_COMBINATION" }),
      expect.objectContaining({ scope: "newVariant", index: 2, reason: "DUPLICATE_COMBINATION" }),
    ]);
    expect(issueKeys(parseProductStructure({ options: [], variants: [{ values: [] }, { values: [] }] }).issues)).toEqual(["newVariant:DUPLICATE_COMBINATION", "newVariant:DUPLICATE_COMBINATION"]);
  });

  test("rejects an id repeated across options and values", () => {
    const parsed = parseProductStructure({ options: [raw("same", "Talla", [["a", "S"], ["a", "M"]]), raw("same", "Color", [["b", "Rojo"]])], variants: [{ values: ["a", "b"] }] });
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "value", optionIndex: 0, valueIndex: 1, field: "id", reason: "ID_CONFLICT" }),
      expect.objectContaining({ scope: "option", optionIndex: 1, field: "id", reason: "ID_CONFLICT" }),
    ]));
  });

  test("drops a value whose rows were all removed, on create and on save", () => {
    const parsed = parseProductStructure({ options: [talla, colores], variants: [{ values: ["t-s", "c-negro"] }, { values: ["t-l", "c-negro"] }] });
    expect(parsed.issues).toEqual([]);
    expect(parsed.value?.options.map((option) => option.values.map((value) => value.name))).toEqual([["S", "L"], ["Negro"]]);
  });
});

describe("emptiedValues", () => {
  test("removes values left without variants and options left without values", () => {
    const options = [talla, colores].map((option): ProductOption => ({ id: optionId(option.id), name: text(option.name), values: option.values.map((value) => ({ id: valueId(value.id), name: text(value.name) })) as unknown as ProductOption["values"] }));
    const emptied = emptiedValues(options, [{ combination: { [optionId("o-talla")]: valueId("t-s") } }]);
    expect([...emptied.valueIds].sort()).toEqual(["c-azul", "c-negro", "t-l", "t-m"]);
    expect([...emptied.optionIds]).toEqual(["o-color"]);
    const none = emptiedValues(options, []);
    expect(none.valueIds.size).toBe(5);
    expect(none.optionIds.size).toBe(2);
  });
});

test("domain limits and name normalization equal the shared contract constants", () => {
  expect(productOptionLimits).toEqual(sharedLimits);
  expect(normalizeOptionText("  M ")).toBe("m");
});
