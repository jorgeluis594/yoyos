import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { searchForAssistant, type ProductSearchPage, type SearchForAssistantDependencies } from "@core/src/features/products/application/search-for-assistant";

const emptyPage: ProductSearchPage = { items: [], page: 1, total: 0, storeHasProducts: true };
const vocabulary = [{ optionName: "Color", valueName: "Azul", productRank: 1, position: 0 }];

function dependencies(overrides: Partial<SearchForAssistantDependencies> = {}) {
  const deps = {
    snapshot: (read) => read(),
    readVocabulary: vi.fn(async () => ok(vocabulary)),
    searchPage: vi.fn(async () => ok(emptyPage)),
    ...overrides,
  } as SearchForAssistantDependencies & { readVocabulary: ReturnType<typeof vi.fn>; searchPage: ReturnType<typeof vi.fn> };
  return deps;
}

test("does not read the vocabulary when no value is sent", async () => {
  const deps = dependencies();
  const result = await searchForAssistant({ text: "polo", sort: "recent", page: 1 }, deps);
  expect(result.success).toBe(true);
  expect(deps.readVocabulary).not.toHaveBeenCalled();
  expect(deps.searchPage).toHaveBeenCalledOnce();
});

test("answers the value rejection without searching the page", async () => {
  const deps = dependencies();
  const result = await searchForAssistant({ values: ["Celeste"], sort: "recent", page: 1 }, deps);
  expect(result).toMatchObject({ success: false, error: { code: "VALUE_REJECTED", rejection: { kind: "unknown_value", written: "Celeste" } } });
  expect(deps.searchPage).not.toHaveBeenCalled();
});

test("passes the low-stock threshold and a cap of 10 matching variants to the page query", async () => {
  const deps = dependencies();
  await searchForAssistant({ values: ["azul"], priceFromCents: 4000, stock: "low", sort: "name", page: 3 }, deps);
  expect(deps.searchPage).toHaveBeenCalledWith({
    valueSets: [[{ optionName: "Color", valueName: "Azul" }]], priceFrom: 4000, stock: "low",
    sort: "name", offset: 40, limit: 20, lowStockThreshold: 3, matchingVariantCap: 10,
  });
});

test("returns a persistence failure, never an empty page", async () => {
  const failure = { code: "PERSISTENCE_UNAVAILABLE", message: "down" } as const;
  const vocabularyDown = await searchForAssistant({ values: ["azul"], sort: "recent", page: 1 }, dependencies({ readVocabulary: async () => err(failure) }));
  const pageDown = await searchForAssistant({ sort: "recent", page: 1 }, dependencies({ searchPage: async () => err({ code: "STATEMENT_TIMEOUT", message: "slow" }) }));
  expect(vocabularyDown).toEqual({ success: false, error: failure });
  expect(pageDown).toMatchObject({ success: false, error: { code: "STATEMENT_TIMEOUT" } });
});

test("refuses a reversed price range before reading", async () => {
  const deps = dependencies();
  expect(await searchForAssistant({ priceFromCents: 500, priceToCents: 100, sort: "recent", page: 1 }, deps)).toMatchObject({ success: false, error: { code: "PRICE_RANGE_REVERSED" } });
  expect(deps.searchPage).not.toHaveBeenCalled();
});

test("answers an empty page, not the no-options text, when values are sent to a store without products", async () => {
  const deps = dependencies({ readVocabulary: vi.fn(async () => ok([])), searchPage: vi.fn(async () => ok({ ...emptyPage, storeHasProducts: false })) });
  const result = await searchForAssistant({ values: ["Azul"], priceFromCents: 4000, sort: "recent", page: 1 }, deps);
  expect(result).toEqual({ success: true, data: { ...emptyPage, storeHasProducts: false } });
  expect(deps.searchPage).toHaveBeenCalledOnce();
  expect(deps.searchPage).toHaveBeenCalledWith(expect.objectContaining({ valueSets: [], offset: 0, limit: 1 }));
});

test("keeps the no-options rejection for a store that has products without options", async () => {
  const deps = dependencies({ readVocabulary: vi.fn(async () => ok([])), searchPage: vi.fn(async () => ok({ ...emptyPage, storeHasProducts: true })) });
  const result = await searchForAssistant({ values: ["Azul"], sort: "recent", page: 1 }, deps);
  expect(result).toMatchObject({ success: false, error: { code: "VALUE_REJECTED", rejection: { kind: "no_options" } } });
});

test("returns the failure of the probe for an empty vocabulary", async () => {
  const deps = dependencies({ readVocabulary: async () => ok([]), searchPage: async () => err({ code: "STATEMENT_TIMEOUT", message: "slow" }) });
  expect(await searchForAssistant({ values: ["Azul"], sort: "recent", page: 1 }, deps)).toMatchObject({ success: false, error: { code: "STATEMENT_TIMEOUT" } });
});
