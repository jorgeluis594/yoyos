import { expect, test } from "vitest";
import {
  buildVocabulary, matchKeyOf, parsePriceCents, parseSearchCriteria, resolveValues,
  type StoreVocabulary, type VocabularyRow,
} from "@core/src/features/products/domain/product-search";

const row = (optionName: string, valueName: string, productRank: number, position: number): VocabularyRow => ({ optionName, valueName, productRank, position });
const storeRows: VocabularyRow[] = [
  row("Talla", "S", 1, 0), row("Talla", "M", 1, 1), row("Talla", "L", 1, 2),
  row("Color", "Azul", 1, 0), row("Color", "Rojo", 1, 1), row("Color", "azul", 2, 0), row("Color", "Azul claro", 2, 1),
  row("Medida", "3:4", 3, 0), row("Tela", "M", 3, 1),
];
const vocabulary = (rows: VocabularyRow[] = storeRows): StoreVocabulary => buildVocabulary(rows);

test("matches «azul», « Azul » and «AZÚL» to the same key and never «Azul claro»", () => {
  expect(matchKeyOf("azul")).toBe(matchKeyOf(" Azul "));
  expect(matchKeyOf("AZÚL")).toBe(matchKeyOf("azul"));
  expect(matchKeyOf("Azul claro")).not.toBe(matchKeyOf("azul"));
});

test("refuses cents that are negative, fractional or above the stored maximum", () => {
  expect(parsePriceCents(3990)).toEqual({ success: true, data: 3990 });
  expect(parsePriceCents(99_999_999_999)).toMatchObject({ success: true });
  expect(parsePriceCents(-1)).toMatchObject({ success: false, error: { code: "NEGATIVE" } });
  expect(parsePriceCents(10.5)).toMatchObject({ success: false, error: { code: "NOT_AN_INTEGER" } });
  expect(parsePriceCents(100_000_000_000)).toMatchObject({ success: false, error: { code: "TOO_LARGE" } });
});

test("refuses a page that is not a whole number from 1 and an unknown sort", () => {
  for (const page of [0, -1, 1.5, Number.NaN]) expect(parseSearchCriteria({ sort: "recent", page })).toMatchObject({ success: false, error: { code: "INVALID_PAGE" } });
  expect(parseSearchCriteria({ sort: "price" as never, page: 1 })).toMatchObject({ success: false, error: { code: "INVALID_SORT" } });
});

test("refuses a reversed price range", () => {
  expect(parseSearchCriteria({ priceFromCents: 5000, priceToCents: 4000, sort: "recent", page: 1 })).toMatchObject({ success: false, error: { code: "PRICE_RANGE_REVERSED" } });
  expect(parseSearchCriteria({ priceFromCents: 4000, priceToCents: 4000, sort: "recent", page: 1 })).toMatchObject({ success: true });
  expect(parseSearchCriteria({ priceFromCents: -1, sort: "recent", page: 1 })).toMatchObject({ success: false, error: { code: "INVALID_PRICE" } });
});

test("accepts a variant filter together with en_catalogo no", () => {
  const base = { inCatalog: false, sort: "recent", page: 1 } as const;
  for (const filter of [{ values: ["Azul"] }, { priceFromCents: 1 }, { priceToCents: 1 }, { stock: "low" }, { text: "polo" }] as const)
    expect(parseSearchCriteria({ ...base, ...filter })).toMatchObject({ success: true });
  expect(parseSearchCriteria({ inCatalog: true, values: ["Azul"], sort: "name", page: 2 })).toMatchObject({ success: true });
});

test("lists options alphabetically and values in saved order, newest product first, so sizes read S, M, L", () => {
  const built = vocabulary();
  expect(built.map(({ name }) => name)).toEqual(["Color", "Medida", "Talla", "Tela"]);
  expect(built.find(({ name }) => name === "Talla")?.values.map(({ name }) => name)).toEqual(["S", "M", "L"]);
});

test("lists a value written «azul» and «Azul» once, as written in the newest product, keeping both spellings", () => {
  const color = vocabulary().find(({ name }) => name === "Color")!;
  expect(color.values.map(({ name }) => name)).toEqual(["Azul", "Rojo", "Azul claro"]);
  expect(color.values[0].spellings).toEqual(expect.arrayContaining([{ optionName: "Color", valueName: "Azul" }, { optionName: "Color", valueName: "azul" }]));
  expect(color.values[0].spellings).toHaveLength(2);
});

test("resolves «M» to the spellings of every option that holds it", () => {
  expect(resolveValues(["m"], vocabulary())).toEqual({ success: true, data: [expect.arrayContaining([{ optionName: "Talla", valueName: "M" }, { optionName: "Tela", valueName: "M" }])] });
});

test("resolves «Talla: M» only to the spellings under Talla", () => {
  expect(resolveValues(["talla: M"], vocabulary())).toEqual({ success: true, data: [[{ optionName: "Talla", valueName: "M" }]] });
});

test("rejects «Color: M» as a value that exists only under another option", () => {
  const result = resolveValues(["Color: M"], vocabulary());
  expect(result).toMatchObject({ success: false, error: { kind: "value_in_other_option", written: "M", option: "Color" } });
});

test("rejects «Material: Algodón» as an unknown option", () => {
  expect(resolveValues(["Material: Algodón"], vocabulary())).toMatchObject({ success: false, error: { kind: "unknown_option", option: "Material" } });
  expect(resolveValues(["Tela: Algodón"], vocabulary())).toMatchObject({ success: false, error: { kind: "unknown_value", written: "Algodón" } });
  expect(resolveValues(["Celeste"], vocabulary())).toMatchObject({ success: false, error: { kind: "unknown_value", written: "Celeste" } });
});

test("resolves «3:4» as a whole value when 3 is not an option", () => {
  expect(resolveValues(["3:4"], vocabulary())).toEqual({ success: true, data: [[{ optionName: "Medida", valueName: "3:4" }]] });
});

test("rejects any value in a store whose products have no options", () => {
  expect(resolveValues(["Azul"], buildVocabulary([]))).toMatchObject({ success: false, error: { kind: "no_options" } });
});
