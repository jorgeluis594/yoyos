import { describe, expect, test } from "vitest";
import type { ReaderStageConfig } from "@core/src/features/orders/infrastructure/reader/runtime/stage-config-env";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import { createStageAdapter } from "@core/src/features/orders/infrastructure/reader/runtime/stage-adapter";
import { createReadingDeadline } from "@core/src/features/orders/infrastructure/reader/runtime/reading-deadline";
import type { ProductMention, Quote } from "@core/src/features/orders/domain/reader/readings";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ProductForReading } from "@core/src/features/products/domain/reading-product";
import type { ResolutionInput } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { parseResolution, resolutionFallback } from "@core/src/features/orders/infrastructure/reader/stages/resolution/resolution-parser";
import { planResolution } from "@core/src/features/orders/infrastructure/reader/stages/resolution/resolution-plan";
import { promptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";

const quote = (text: string): Quote => ({ source: "current", text });
const request = (n: number) => `R${n}` as RequestRef;
const productId = (n: number) => `product-${n}` as ProductId;
const product = (n: number, name: string, attributes: ProductForReading["attributes"] = [], sellable = true): ProductForReading => ({ productId: productId(n), name, sellable, attributes, variants: [] });
const mention = (n: number, words: string, values: ProductMention["values"] = [], candidateIds?: readonly ProductId[]): ProductMention =>
  ({ request: request(n), words: quote(words), values, ...candidateIds ? { candidateIds } : {} });
const value = (valueWords: string, attributeWords: string | null = null) => ({ attributeWords: attributeWords ? quote(attributeWords) : null, valueWords: quote(valueWords) });
const budget = 24_000;

const polo = product(1, "Polo básico", [{ name: "Talla", values: ["S", "M", "L"] }, { name: "Color", values: ["Azul marino", "Negro"] }]);
const gorra = product(2, "Gorra trucker");
const input: ResolutionInput = { mentions: [mention(1, "polo basico", [value("mediana", "talla")]), mention(2, "gorra")], candidates: [polo, gorra] };

describe("resolution rendering", () => {
  test("renders only the named attributes' values of a resolution candidate", () => {
    const { text } = planResolution(input, budget);

    expect(text).toContain("P1 (sellable) Polo básico — Talla = S, M, L; Color: 2 values");
    expect(text).not.toContain("Azul marino");
    expect(text).toContain("answer with these labels");
  });

  test("renders the stated price of a mention and the price range of the candidates it may be", () => {
    const priced = { ...product(3, "Polo premium"), variants: [{ variantId: "v1" as never, productName: "Polo premium", variantAttributes: {}, sku: null, unitPrice: { amount: 55, currency: "PEN" as const } },
      { variantId: "v2" as never, productName: "Polo premium", variantAttributes: {}, sku: null, unitPrice: { amount: 60, currency: "PEN" as const } }] };
    const stated = (units: number, basis: "unit" | "lot" | "not_explicit") => ({ ...mention(1, "polo"), price: { amount: 55, units, basis } });
    const text = (m: ProductMention) => planResolution({ mentions: [m], candidates: [priced, gorra] }, budget).text;

    expect(text(stated(1, "not_explicit"))).toContain("R1: «polo» — stated price: 55 for each unit");
    expect(text(stated(1, "not_explicit"))).toContain("P1 (sellable) Polo premium — price: 55 to 60 PEN");
    expect(text(stated(3, "unit"))).toContain("stated price: 55 for each unit");
    expect(text(stated(3, "lot"))).toContain("stated price: 55 for 3 units, the whole quantity");
    expect(text(stated(3, "not_explicit"))).toContain("55 for 3 units, each or the whole quantity (not said)");
    expect(planResolution(input, budget).text).not.toContain("price");
  });

  test("lists at most 30 values of an attribute and counts the rest", () => {
    const many = product(3, "Medias", [{ name: "Talla", values: Array.from({ length: 35 }, (_, index) => `T${index}`) }]);
    const { text } = planResolution({ mentions: [mention(1, "medias", [value("T1", "talla")])], candidates: [many] }, budget);

    expect(text).toContain("T29, y 5 más");
    expect(text).not.toContain("T30");
  });

  test("never exceeds the stage input budget at every fixed limit", () => {
    const wide = Array.from({ length: 10 }, (_, index) => product(index + 10, `Producto ${"x".repeat(190)}${index}`,
      [{ name: "Talla", values: Array.from({ length: 30 }, (_, v) => `${"v".repeat(26)}${v.toString().padStart(4, "0")}`) }, { name: "Color", values: ["Rojo"] }]));
    const mentions = wide.map((entry, index) => mention(index + 1, entry.name, [value("v", "talla")], [entry.productId, wide[(index + 1) % 10]!.productId]));
    for (const limit of [3000, 6000, 12_000, 24_000]) {
      const plan = planResolution({ mentions, candidates: wide }, limit);

      expect(plan.text.length).toBeLessThanOrEqual(limit);
      expect(plan.rendered.length + plan.omitted.length).toBe(10);
    }
  });

  test("lowers the candidates per mention to one before dropping values", () => {
    const wide = Array.from({ length: 4 }, (_, index) => product(index + 10, `Producto ${"x".repeat(100)}${index}`, [{ name: "Talla", values: ["S", "M"] }]));
    const ids = wide.map((entry) => entry.productId);
    const full = planResolution({ mentions: [mention(1, "producto", [], ids)], candidates: wide }, budget);
    const cut = planResolution({ mentions: [mention(1, "producto", [], ids)], candidates: wide }, full.text.length - 1);

    expect(cut.cut.candidatesPerMention).toBe(1);
    expect(cut.rendered[0]?.allowed).toEqual([ids[0]]);
  });
});

describe("resolution parser", () => {
  const answer = (results: unknown[]) => ({ results });

  test("maps a chosen product and its catalog values with the buyer's quote", () => {
    const result = parseResolution(answer([
      { request: "R1", kind: "chosen", products: ["P1"], values: [{ attribute: "talla", value: "m", quote: "Mediana" }] },
      { request: "R2", kind: "between", products: ["P1", "P2"], values: [] },
    ]), input, budget);

    expect(result).toEqual({ success: true, data: [
      { request: "R1", kind: "chosen", productId: productId(1), values: [{ attribute: "Talla", value: "M", quote: quote("mediana") }], unmatched: [] },
      { request: "R2", kind: "between", productIds: [productId(1), productId(2)], values: [] },
    ] });
  });

  test("refuses a between of one or five products", () => {
    const five = Array.from({ length: 5 }, (_, index) => product(index + 20, `Gorra ${index}`));
    const many: ResolutionInput = { mentions: [mention(1, "gorra")], candidates: five };
    const labels = ["P1", "P2", "P3", "P4", "P5"];

    expect(parseResolution(answer([{ request: "R1", kind: "between", products: labels, values: [] }]), many, budget).success).toBe(false);
    expect(parseResolution(answer([{ request: "R1", kind: "between", products: ["P1"], values: [] }]), many, budget).success).toBe(false);
  });

  test("drops a value that is not in the catalog as unmatched instead of refusing the answer", () => {
    const result = parseResolution(answer([{ request: "R1", kind: "chosen", products: ["P1"], values: [{ attribute: "Talla", value: "XL", quote: "mediana" }], unmatched: [] },
      { request: "R2", kind: "none", products: [], values: [] }]), input, budget);

    expect(result).toEqual({ success: true, data: [{ request: "R1", kind: "chosen", productId: productId(1), values: [], unmatched: [quote("mediana")] }, { request: "R2", kind: "none" }] });
  });

  test("keeps the unmatched value words the answer lists, once, and ignores quotes the buyer did not write", () => {
    const result = parseResolution(answer([{ request: "R1", kind: "chosen", products: ["P1"], values: [{ attribute: "Talla", value: "M", quote: "mediana" }], unmatched: ["Mediana", "inventada"] },
      { request: "R2", kind: "none", products: [], values: [] }]), input, budget);

    expect(result.success && result.data[0]).toEqual({ request: "R1", kind: "chosen", productId: productId(1), values: [{ attribute: "Talla", value: "M", quote: quote("mediana") }], unmatched: [] });
  });

  test("accepts a value quoted from the mention's own words", () => {
    const inName: ResolutionInput = { mentions: [mention(1, "polo basico negro")], candidates: [polo] };
    const result = parseResolution(answer([{ request: "R1", kind: "chosen", products: ["P1"], values: [{ attribute: "Color", value: "Negro", quote: "negro" }] }]), inName, budget);

    expect(result).toEqual({ success: true, data: [{ request: "R1", kind: "chosen", productId: productId(1), values: [{ attribute: "Color", value: "Negro", quote: quote("negro") }], unmatched: [] }] });
  });

  test("keeps in a between only the values every candidate offers", () => {
    const twin = product(3, "Polo oversize", [{ name: "Talla", values: ["M", "L"] }, { name: "Color", values: ["Rojo"] }]);
    const both: ResolutionInput = { mentions: [mention(1, "polo", [value("mediana", "talla"), value("negro")])], candidates: [polo, twin] };
    const result = parseResolution(answer([{ request: "R1", kind: "between", products: ["P1", "P2"],
      values: [{ attribute: "Talla", value: "M", quote: "mediana" }, { attribute: "Color", value: "Negro", quote: "negro" }] }]), both, budget);

    expect(result).toEqual({ success: true, data: [{ request: "R1", kind: "between", productIds: [productId(1), productId(3)], values: [{ attribute: "Talla", value: "M", quote: quote("mediana") }] }] });
  });

  test("renders a values-only mention without product words", () => {
    const only: ResolutionInput = { mentions: [{ ...mention(1, "negra", [value("negra")], [productId(1)]), valuesOnly: true }], candidates: [polo] };
    const { text } = planResolution(only, budget);

    expect(text).toContain("R1: (product already known) — values: «negra»");
    expect(text).toContain("R1 may be: P1");
    expect(parseResolution(answer([{ request: "R1", kind: "chosen", products: ["P1"], values: [{ attribute: "Color", value: "Negro", quote: "negra" }] }]), only, budget))
      .toEqual({ success: true, data: [{ request: "R1", kind: "chosen", productId: productId(1), values: [{ attribute: "Color", value: "Negro", quote: quote("negra") }], unmatched: [] }] });
  });

  test("resolves a mention that was not rendered to none", () => {
    const orphan: ResolutionInput = { mentions: [mention(1, "polo", [], [productId(1)]), mention(2, "camisa", [], [])], candidates: [polo] };
    const result = parseResolution(answer([{ request: "R1", kind: "chosen", products: ["P1"], values: [] }]), orphan, budget);

    expect(result).toEqual({ success: true, data: [{ request: "R1", kind: "chosen", productId: productId(1), values: [], unmatched: [] }, { request: "R2", kind: "none" }] });
  });

  test("refuses a mention the answer leaves out or resolves twice", () => {
    expect(parseResolution(answer([{ request: "R1", kind: "none", products: [], values: [] }]), input, budget).success).toBe(false);
    expect(parseResolution(answer([{ request: "R1", kind: "none", products: [], values: [] }, { request: "R1", kind: "none", products: [], values: [] }, { request: "R2", kind: "none", products: [], values: [] }]), input, budget).success).toBe(false);
  });

  test("refuses a choice outside the mention's own candidates", () => {
    const narrowed: ResolutionInput = { mentions: [mention(1, "polo", [], [productId(1)])], candidates: [polo, gorra] };

    expect(parseResolution(answer([{ request: "R1", kind: "chosen", products: ["P2"], values: [] }]), narrowed, budget).success).toBe(false);
  });
});

describe("resolution fallback", () => {
  test("leaves a mention not identified when its choice is outside the candidates and keeps the rest", () => {
    const result = resolutionFallback({ results: [{ request: "R1", kind: "chosen", products: ["P9"], values: [] }, { request: "R2", kind: "chosen", products: ["P2"], values: [] }] }, input, budget);

    expect(result).toEqual([{ request: "R1", kind: "none" }, { request: "R2", kind: "chosen", productId: productId(2), values: [], unmatched: [] }]);
  });

  test("does not repair invalid JSON or any other defect", () => {
    expect(resolutionFallback(undefined, input, budget)).toBeNull();
    expect(resolutionFallback({ nothing: true }, input, budget)).toBeNull();
    expect(resolutionFallback({ results: [{ request: "R1", kind: "between", products: ["P1"], values: [] }, { request: "R2", kind: "none", products: [], values: [] }] }, input, budget)).toBeNull();
  });
});

describe("resolution-v1", () => {
  test("is registered with the parser and fallback bound to the stage budget", () => {
    const version = promptRegistry.resolution["resolution-v1"]!;

    expect(version).toMatchObject({ stage: "resolution", version: "resolution-v1" });
    expect(version.renderInput(input)).toBe(planResolution(input, budget).text);
    expect(version.fallback?.(input, { results: [{ request: "R1", kind: "chosen", products: ["P7"], values: [] }, { request: "R2", kind: "none", products: [], values: [] }] }))
      .toEqual([{ request: "R1", kind: "none" }, { request: "R2", kind: "none" }]);
  });
});

describe("resolution stage", () => {
  const run = async (answers: unknown[]) => {
    const model = createFakeStructuredModel({ resolution: answers.map((json) => ({ json })) });
    const stage = createStageAdapter({ config: { stage: "resolution", reading: "primary", provider: "fake", model: "scripted", promptVersion: "resolution-v1" as ReaderStageConfig["promptVersion"], timeoutMs: 10_000 },
      version: promptRegistry.resolution["resolution-v1"]!, model });
    return { model, result: await stage(input, createReadingDeadline(60_000, {}).signal) };
  };
  const outside = { results: [{ request: "R1", kind: "chosen", products: ["P9"], values: [] }, { request: "R2", kind: "none", products: [], values: [] }] };

  test("retries a resolution choice outside the candidates once and then leaves the mention not identified", async () => {
    const { model, result } = await run([outside, outside]);

    expect(model.requests).toHaveLength(2);
    expect(result).toMatchObject({ success: true, data: { value: [{ request: "R1", kind: "none" }, { request: "R2", kind: "none" }], call: { attempts: 2 } } });
  });

  test("keeps the retry's answer when it fixes the choice", async () => {
    const fixed = { results: [{ request: "R1", kind: "chosen", products: ["P1"], values: [] }, { request: "R2", kind: "none", products: [], values: [] }] };
    const { result } = await run([outside, fixed]);

    expect(result).toMatchObject({ success: true, data: { value: [{ request: "R1", kind: "chosen", productId: productId(1) }, { request: "R2", kind: "none" }] } });
  });

  test("still fails when the answer is not JSON of the expected shape", async () => {
    const { result } = await run(["bad", "worse"]);

    expect(result).toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
  });
});
