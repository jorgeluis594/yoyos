import { describe, expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { Money } from "@shared/money";
import { findTopTextCandidate, identifyProductInText, identifyProductsInText, type IdentifyProductInTextDependencies } from "@core/src/features/products/application/identify-product-in-text";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { TextCandidate, TextChoice } from "@core/src/features/products/domain/text-identification";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as ProductId;
const price = (amount: number): Money => ({ amount, currency: "PEN" });
const candidate = (n: number, name: string, similarity = 0.6): TextCandidate => ({ productId: id(n), name, minPrice: price(30 + n), maxPrice: price(30 + n), similarity });
const signal = new AbortController().signal;

function harness(options: Readonly<{ candidates?: readonly (readonly TextCandidate[])[]; find?: IdentifyProductInTextDependencies["findTextCandidates"]; choose?: IdentifyProductInTextDependencies["chooseTextProduct"] }> = {}) {
  const calls = { queries: [] as string[][], chosen: [] as { mention: string; priceHint: number | null; candidates: string[] }[] };
  const deps: IdentifyProductInTextDependencies = {
    findTextCandidates: options.find ?? (async (queries) => { calls.queries.push(queries.map(({ mention }) => mention)); return ok(options.candidates ?? queries.map(() => [])); }),
    chooseTextProduct: options.choose ?? (async (input) => { calls.chosen.push({ mention: input.mention, priceHint: input.priceHint, candidates: input.candidates.map(({ name }) => name) }); return ok({ productId: null, confidence: 0.9, probabilities: [] }); }),
    minConfidence: 0.8, unclearMinProbability: 0.25,
  };
  return { calls, deps };
}

const choice = (productId: number | null, confidence: number, probabilities: [number, number][] = []): TextChoice =>
  ({ productId: productId === null ? null : id(productId), confidence, probabilities: probabilities.map(([n, probability]) => ({ productId: id(n), probability })) });

describe("identifyProductInText", () => {
  test("accepts the chosen candidate at the minimum confidence", async () => {
    const h = harness({ candidates: [[candidate(1, "Polo básico"), candidate(2, "Polo oversize")]], choose: async () => ok(choice(1, 0.8, [[1, 0.8], [2, 0.3]])) });
    expect(await identifyProductInText({ mention: "polo", priceHint: null }, h.deps, signal)).toEqual(ok({ kind: "found", productId: id(1), confidence: 0.8 }));
  });

  test("finds the product whose price fits the hint when the chooser honors it", async () => {
    const choose: IdentifyProductInTextDependencies["chooseTextProduct"] = async ({ priceHint, candidates }) => {
      const fits = candidates.find(({ minPrice, maxPrice }) => priceHint !== null && minPrice.amount <= priceHint && priceHint <= maxPrice.amount);
      return ok(choice(fits ? Number(fits.productId.slice(-12)) : null, 0.95));
    };
    const h = harness({ choose, candidates: [[{ ...candidate(5, "Polo básico"), minPrice: price(35), maxPrice: price(35) }, { ...candidate(9, "Polo premium"), minPrice: price(60), maxPrice: price(60) }]] });
    expect(await identifyProductInText({ mention: "el polo", priceHint: 35 }, h.deps, signal)).toEqual(ok({ kind: "found", productId: id(5), confidence: 0.95 }));
  });

  test("returns not clear when two candidates are likely and none reaches the threshold", async () => {
    const h = harness({ candidates: [[candidate(1, "Polo negro"), candidate(2, "Polo blanco"), candidate(3, "Gorra")]], choose: async () => ok(choice(1, 0.5, [[1, 0.5], [2, 0.4], [3, 0.05]])) });
    expect(await identifyProductInText({ mention: "polo", priceHint: null }, h.deps, signal))
      .toEqual(ok({ kind: "not_clear", candidates: [{ productId: id(1), name: "Polo negro" }, { productId: id(2), name: "Polo blanco" }] }));
  });

  test("returns not found when a single candidate is likely but below the threshold, or the chooser answers none", async () => {
    const low = harness({ candidates: [[candidate(1, "Polo"), candidate(2, "Gorra")]], choose: async () => ok(choice(1, 0.6, [[1, 0.6], [2, 0.1]])) });
    expect(await identifyProductInText({ mention: "polo", priceHint: null }, low.deps, signal)).toEqual(ok({ kind: "not_found" }));
    const none = harness({ candidates: [[candidate(1, "Polo")]], choose: async () => ok(choice(null, 0.95)) });
    expect(await identifyProductInText({ mention: "zapatos", priceHint: null }, none.deps, signal)).toEqual(ok({ kind: "not_found" }));
  });

  test("returns not found without calling the model when there are no candidates", async () => {
    const h = harness();
    expect(await identifyProductInText({ mention: "zapatos", priceHint: null }, h.deps, signal)).toEqual(ok({ kind: "not_found" }));
    expect(h.calls.chosen).toEqual([]);
  });

  test("asks the catalog once for all the mentions and the model only for those with candidates", async () => {
    const h = harness({ candidates: [[candidate(1, "Polo")], [], [candidate(3, "Gorra")]] });
    const result = await identifyProductsInText([{ mention: "polo", priceHint: null }, { mention: "zapatos", priceHint: null }, { mention: "gorra", priceHint: 20 }], h.deps, signal);
    expect(result).toEqual(ok([{ kind: "not_found" }, { kind: "not_found" }, { kind: "not_found" }]));
    expect(h.calls.queries).toEqual([["polo", "zapatos", "gorra"]]);
    expect(h.calls.chosen.map(({ mention }) => mention)).toEqual(["polo", "gorra"]);
  });

  test("propagates catalog and matcher failures", async () => {
    const catalog = harness({ find: async () => err({ code: "PERSISTENCE_UNAVAILABLE", message: "db" }) });
    expect(await identifyProductInText({ mention: "polo", priceHint: null }, catalog.deps, signal)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    const matcher = harness({ candidates: [[candidate(1, "Polo")]], choose: async () => err({ code: "PRODUCT_MATCHER_UNAVAILABLE", message: "x" }) });
    expect(await identifyProductInText({ mention: "polo", priceHint: null }, matcher.deps, signal)).toMatchObject({ success: false, error: { code: "PRODUCT_MATCHER_UNAVAILABLE" } });
  });
});

describe("findTopTextCandidate", () => {
  test("returns the most similar candidate without any model call", async () => {
    const h = harness({ candidates: [[candidate(2, "Polo oversize", 0.9), candidate(1, "Polo", 0.5)]] });
    expect(await findTopTextCandidate("polo", h.deps)).toEqual(ok({ productId: id(2), name: "Polo oversize" }));
    expect(await findTopTextCandidate("zapatos", harness().deps)).toEqual(ok(null));
    expect(h.calls.chosen).toEqual([]);
  });
});
