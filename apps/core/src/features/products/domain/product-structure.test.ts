import { describe, expect, test } from "vitest";
import type { Currency } from "@shared/money";
import type { OptionId, OptionText, OptionValueId, Product, ProductId, ProductOption, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { normalizeOptionText, productOptionLimits as sharedLimits } from "@shared/contracts/products";
import { combinationKey, productOptionLimits, emptiedValues, isEmptyChange, orderedAttributes, parseProductStructure, planProductSave, sortVariants, type ProductStructureChange, type RawOption, type SaveRequest } from "@core/src/features/products/domain/product-structure";

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

describe("planProductSave", () => {
  const ids = (() => { let counter = 0; return () => `new-${++counter}`; })();
  const now = new Date("2026-10-26T12:00:00.000Z");
  const noOrders: ReadonlySet<VariantId> = new Set();
  const withStock = (item: ProductVariant, quantity: number): ProductVariant => ({ ...item, stock: { ...item.stock, quantity } });

  // Talla [M, L] x Color [Negro, Azul], four saved variants, structureVersion 1.
  const saved = () => product([size, color], [
    variant("m-negro", { "o-talla": "v-m", "o-color": "v-negro" }), variant("m-azul", { "o-talla": "v-m", "o-color": "v-azul" }),
    variant("l-negro", { "o-talla": "v-l", "o-color": "v-negro" }), variant("l-azul", { "o-talla": "v-l", "o-color": "v-azul" }),
  ]);
  const mirror = (current: Product): SaveRequest => ({
    structureVersion: current.structureVersion, name: current.name, description: null, imageId: null,
    options: current.options.map((option) => ({ id: option.id, name: option.name, values: option.values.map((value) => ({ id: value.id, name: value.name })) })),
    variants: current.variants.map((item) => ({ id: item.id, sku: item.sku ?? null, salePrice: item.salePrice.amount, purchasePrice: item.purchasePrice?.amount ?? null })),
    newVariants: [], deletedVariantIds: [],
  });
  const plan = (request: SaveRequest, current = saved(), ordered = noOrders) => planProductSave(current, request, ordered, { newId: ids, now });
  const change = (request: SaveRequest, current = saved(), ordered = noOrders): ProductStructureChange => {
    const result = plan(request, current, ordered);
    if (!result.success) throw new Error(`Unexpected rejection: ${JSON.stringify(result.error.issues)}`);
    return result.data;
  };
  const issues = (request: SaveRequest, current = saved(), ordered = noOrders) => {
    const result = plan(request, current, ordered);
    if (result.success) throw new Error("Expected a rejection");
    return result.error.issues;
  };
  const withOptions = (request: SaveRequest, options: SaveRequest["options"]): SaveRequest => ({ ...request, options });
  const xl = { id: "v-xl", name: "XL" };
  const withXl = (request: SaveRequest): SaveRequest => withOptions(request, request.options.map((option) => option.id === "o-talla" ? { ...option, values: [...option.values, xl] } : option));
  const newRow = (values: string[], extra: Partial<SaveRequest["newVariants"][number]> = {}) => ({ values, sku: null, salePrice: 10, purchasePrice: null, initialStock: 0, ...extra });

  test("an unchanged form is an empty plan", () => {
    const result = change(mirror(saved()));
    expect(isEmptyChange(result)).toBe(true);
    expect(result.product).toEqual({});
  });

  test("adds a value with its new variants as an insert and bumps the structure version", () => {
    const request = { ...withXl(mirror(saved())), newVariants: [newRow(["v-xl", "v-negro"]), newRow(["v-xl", "v-azul"], { initialStock: 4 })] };
    const result = change(request);
    expect(result.insertValues).toEqual([{ id: "v-xl", optionId: "o-talla", name: "XL", position: 2 }]);
    expect(result.insertVariants.map((item) => [item.combination, item.initialStock])).toEqual([
      [{ "o-talla": "v-xl", "o-color": "v-negro" }, 0], [{ "o-talla": "v-xl", "o-color": "v-azul" }, 4]]);
    expect(result.insertVariants.every((item) => item.qrCode && item.id && item.combinationKey)).toBe(true);
    expect(result.rekeyVariants).toEqual([]);
    expect(result.product).toEqual({ updatedAt: now, structureVersion: 2 });
  });

  test("rejects deleting a value whose saved variants are not all deleted", () => {
    const request = withOptions(mirror(saved()), mirror(saved()).options.map((option) => option.id === "o-color" ? { ...option, values: option.values.filter((value) => value.id !== "v-azul") } : option));
    expect(issues({ ...request, deletedVariantIds: ["m-azul" as VariantId] })).toEqual([expect.objectContaining({ reason: "VALUE_IN_USE", scope: "variant", variantId: "l-azul" })]);
    const complete = change({ ...request, variants: request.variants.filter((item) => !item.id.endsWith("azul")), deletedVariantIds: ["m-azul", "l-azul"] as VariantId[] });
    expect(complete.deleteValueIds).toEqual(["v-azul"]);
    expect(complete.deleteVariantIds).toEqual(["m-azul", "l-azul"]);
  });

  test("rejects adding an option to a saved product without a value for existing variants", () => {
    const request = withOptions(mirror(saved()), [...mirror(saved()).options, { id: "o-manga", name: "Manga", values: [{ id: "v-corta", name: "Corta" }] }]);
    expect(issues(request)).toEqual([expect.objectContaining({ scope: "option", optionIndex: 2, reason: "MISSING_VALUE_FOR_EXISTING_VARIANTS" })]);
    const fixed = change(withOptions(request, [...request.options.slice(0, 2), { ...request.options[2], valueForExistingVariants: "v-corta" }]));
    expect(fixed.insertLinks).toHaveLength(4);
    expect(fixed.insertLinks.every((link) => link.optionId === "o-manga" && link.valueId === "v-corta")).toBe(true);
    expect(fixed.rekeyVariants).toHaveLength(4);
  });

  test("adding the first option to a simple product keeps its variant and gives it the chosen value", () => {
    const simple = product([], [variant("only", {})]);
    const request: SaveRequest = { ...mirror(simple), options: [{ id: "o-talla", name: "Talla", values: [{ id: "v-s", name: "S" }, { id: "v-m", name: "M" }], valueForExistingVariants: "v-s" }],
      newVariants: [newRow(["v-m"])] };
    const result = change(request, simple);
    expect(result.deleteVariantIds).toEqual([]);
    expect(result.insertLinks).toEqual([{ variantId: "only", optionId: "o-talla", valueId: "v-s" }]);
    expect(result.rekeyVariants).toEqual([{ id: "only", combinationKey: "v-s" }]);
    expect(result.insertVariants).toHaveLength(1);
  });

  test("deleting the last single-valued option turns the product into a simple product", () => {
    const single = product([{ ...size, values: [size.values[0]] }], [variant("only", { "o-talla": "v-m" })]);
    const result = change({ ...mirror(single), options: [] }, single);
    expect(result.deleteLinksOfOptionIds).toEqual(["o-talla"]);
    expect(result.deleteValueIds).toEqual(["v-m"]);
    expect(result.deleteOptionIds).toEqual(["o-talla"]);
    expect(result.rekeyVariants).toEqual([{ id: "only", combinationKey: "" }]);
  });

  test("rejects deleting an option that still has several values in the final state", () => {
    const request = { ...mirror(saved()), options: mirror(saved()).options.filter((option) => option.id !== "o-color") };
    expect(issues(request)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "OPTION_HAS_SEVERAL_VALUES" })]));
  });

  test("deletes an option whose other values are removed with their variants in the same save", () => {
    const request: SaveRequest = { ...mirror(saved()), options: mirror(saved()).options.filter((option) => option.id !== "o-color"),
      variants: mirror(saved()).variants.filter((item) => item.id.endsWith("negro")), deletedVariantIds: ["m-azul", "l-azul"] as VariantId[] };
    const result = change(request);
    expect(result.deleteOptionIds).toEqual(["o-color"]);
    expect([...result.deleteValueIds].sort()).toEqual(["v-azul", "v-negro"]);
    expect(result.deleteLinksOfOptionIds).toEqual(["o-color"]);
    expect(result.rekeyVariants.map((item) => [item.id, item.combinationKey])).toEqual([["m-negro", "v-m"], ["l-negro", "v-l"]]);
  });

  test("rejects deleting the last option when the remaining variant is inactive", () => {
    const single = product([{ ...size, values: [size.values[0]] }], [{ ...variant("only", { "o-talla": "v-m" }), status: "inactive" }]);
    expect(issues({ ...mirror(single), options: [] }, single)).toEqual([expect.objectContaining({ reason: "LAST_OPTION_VARIANT_INACTIVE" })]);
  });

  test("rejects a repeated id, a value moved to another option and valueForExistingVariants on a saved option", () => {
    const base = mirror(saved());
    const moved = withOptions(base, [{ ...base.options[0], values: [base.options[0].values[0]] }, { ...base.options[1], values: [...base.options[1].values, base.options[0].values[1]] }]);
    expect(issues(moved)).toEqual(expect.arrayContaining([expect.objectContaining({ scope: "value", valueId: "v-l", reason: "ID_CONFLICT" })]));
    const repeated = withOptions(base, [base.options[0], { ...base.options[1], id: "o-talla" }]);
    expect(issues(repeated)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "ID_CONFLICT" })]));
    const onSaved = withOptions(base, [{ ...base.options[0], valueForExistingVariants: "v-m" }, base.options[1]]);
    expect(issues(onSaved)).toEqual([expect.objectContaining({ scope: "option", optionIndex: 0, reason: "INVALID_COMBINATION" })]);
    const outside = withOptions(base, [...base.options, { id: "o-manga", name: "Manga", values: [{ id: "v-corta", name: "Corta" }], valueForExistingVariants: "v-m" }]);
    expect(issues(outside)).toEqual([expect.objectContaining({ scope: "option", optionIndex: 2, reason: "INVALID_COMBINATION" })]);
  });

  test("reports a new variant that references a deleted or unknown value on its own row", () => {
    const base = mirror(saved());
    const request: SaveRequest = { ...base, options: base.options.map((option) => option.id === "o-color" ? { ...option, values: [option.values[0]] } : option),
      variants: base.variants.filter((item) => item.id.endsWith("negro")), deletedVariantIds: ["m-azul", "l-azul"] as VariantId[], newVariants: [newRow(["v-m", "v-azul"])] };
    expect(issues(request)).toEqual([expect.objectContaining({ scope: "newVariant", index: 0, reason: "VALUE_NOT_FOUND" })]);
  });

  test("the plan writes only variants whose price, SKU or key changed", () => {
    const base = mirror(saved());
    const request = { ...base, variants: base.variants.map((item) => item.id === "m-negro" ? { ...item, salePrice: 12, sku: " P-1 " } : item.id === "l-azul" ? { ...item, purchasePrice: 3 } : item) };
    const result = change(request);
    expect(result.variantFieldChanges).toEqual([{ id: "m-negro", sku: "P-1", salePrice: 12 }, { id: "l-azul", purchasePrice: 3 }]);
    expect(result.rekeyVariants).toEqual([]);
    expect(result.product).toEqual({ updatedAt: now });
    expect(result.insertVariants).toEqual([]);
  });

  test("renames and reorders become renames and moves without touching keys", () => {
    const base = mirror(saved());
    const request = withOptions(base, [{ ...base.options[1], name: "Tono", values: [{ id: "v-azul", name: "Azul" }, { id: "v-negro", name: "Negro carbón" }] }, base.options[0]]);
    const result = change(request);
    expect(result.renameOrMoveOptions).toEqual([{ id: "o-color", name: "Tono", position: 0 }, { id: "o-talla", name: "Talla", position: 1 }]);
    expect(result.renameOrMoveValues).toEqual([{ id: "v-azul", name: "Azul", position: 0 }, { id: "v-negro", name: "Negro carbón", position: 1 }]);
    expect(result.rekeyVariants).toEqual([]);
    expect(result.product.structureVersion).toBe(2);
  });

  test("reports orders before stock on deleted variants and refuses to leave the product without variants", () => {
    const base = mirror(saved());
    const stocked = product([size, color], saved().variants.map((item) => item.id === "l-negro" ? withStock(item, 2) : item));
    const request = { ...base, deletedVariantIds: ["m-azul", "l-negro"] as VariantId[] };
    expect(issues(request, stocked, new Set(["m-azul" as VariantId]))).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "variant", variantId: "m-azul", reason: "VARIANT_HAS_ORDERS" }),
      expect.objectContaining({ scope: "variant", variantId: "l-negro", reason: "VARIANT_HAS_STOCK" }),
    ]));
    const all = { ...base, variants: [], deletedVariantIds: saved().variants.map((item) => item.id) };
    expect(issues(all)).toEqual(expect.arrayContaining([expect.objectContaining({ scope: "product", field: "variants", reason: "LAST_VARIANT" })]));
  });

  test("rejects unknown and repeated variant ids", () => {
    const base = mirror(saved());
    expect(issues({ ...base, variants: [...base.variants, { id: "ghost" as VariantId, sku: null, salePrice: 1, purchasePrice: null }] }))
      .toEqual([expect.objectContaining({ scope: "variant", variantId: "ghost", reason: "VARIANT_NOT_FOUND" })]);
    expect(issues({ ...base, deletedVariantIds: ["ghost" as VariantId] })).toEqual([expect.objectContaining({ variantId: "ghost", reason: "VARIANT_NOT_FOUND" })]);
    expect(issues({ ...base, variants: [...base.variants, base.variants[0]] })).toEqual([expect.objectContaining({ variantId: "m-negro", reason: "DUPLICATE_VARIANT" })]);
  });

  test("reports duplicate SKUs of listed and new variants on both rows", () => {
    const base = mirror(saved());
    const request = { ...base, variants: base.variants.map((item) => item.id === "m-negro" ? { ...item, sku: "A-1" } : item), newVariants: [newRow(["v-m", "v-negro"], { sku: "a-1 " })] };
    const found = issues(request);
    expect(found).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "variant", variantId: "m-negro", field: "sku", reason: "DUPLICATE_SKU" }),
      expect.objectContaining({ scope: "newVariant", index: 0, field: "sku", reason: "DUPLICATE_SKU" }),
    ]));
  });

  test("rejects a new variant with the combination of a remaining saved variant, and keeps going after the first issue", () => {
    const base = mirror(saved());
    const found = issues({ ...base, name: "  ", newVariants: [newRow(["v-m", "v-negro"])] });
    expect(found).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "product", field: "name", reason: "REQUIRED" }),
      expect.objectContaining({ reason: "DUPLICATE_COMBINATION" }),
    ]));
  });

  test("drops a value whose rows were all removed, on create and on save", () => {
    const base = mirror(saved());
    const request = { ...withXl(base), newVariants: [] };
    const result = change(request);
    expect(result.insertValues).toEqual([]);
    expect(isEmptyChange(result)).toBe(true);
    const removed = change({ ...base, variants: base.variants.filter((item) => !item.id.endsWith("azul")), deletedVariantIds: ["m-azul", "l-azul"] as VariantId[] });
    expect(removed.deleteValueIds).toEqual(["v-azul"]);
    expect(removed.deleteOptionIds).toEqual([]);
  });

  test("a rejected plan lists issues of the whole request together", () => {
    const base = mirror(saved());
    const found = issues({ ...base, description: "x".repeat(5001), options: [...base.options, ...["a", "b"].map((name) => ({ id: `o-${name}`, name, values: [{ id: `v-${name}`, name }], valueForExistingVariants: `v-${name}` })), { id: "o-d", name: "d", values: [] }] });
    expect(new Set(found.map((issue) => issue.reason))).toEqual(new Set(["TOO_LONG", "TOO_MANY_OPTIONS", "OPTION_WITHOUT_VALUES", "MISSING_VALUE_FOR_EXISTING_VARIANTS"]));
  });
});
