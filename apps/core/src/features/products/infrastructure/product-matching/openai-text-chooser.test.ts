import OpenAI from "openai";
import { describe, expect, test } from "vitest";
import { createOpenAITextProductChooser, createOpenAIVariantChooser } from "@core/src/features/products/infrastructure/product-matching/openai-text-chooser";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { TextCandidate } from "@core/src/features/products/domain/text-identification";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const signal = new AbortController().signal;
const candidates: TextCandidate[] = [
  { productId: "product-a" as ProductId, name: "Polo básico", minPrice: { amount: 35, currency: "PEN" }, maxPrice: { amount: 35, currency: "PEN" }, similarity: 0.7 },
  { productId: "product-b" as ProductId, name: "Polo premium", minPrice: { amount: 50, currency: "PEN" }, maxPrice: { amount: 70, currency: "PEN" }, similarity: 0.6 },
];

function clientFor(reply: () => Promise<Response>, onBody?: (body: { input: { content: { text: string }[] }[]; questions: unknown[] } & Record<string, unknown>) => void) {
  return new OpenAI({ apiKey: "test-key", fetch: async (_url, init) => { onBody?.(JSON.parse(String(init?.body))); return reply(); } });
}
const config = (client: OpenAI) => ({ client, model: "gpt-6-luna", timeoutMs: 50, companyId: () => "company" });
const answer = (choice: string, confidence: number, probabilities: [string, number][]) => json({ model: "gpt-6-luna", usage: { input_tokens: 80, output_tokens: 1 },
  answers: [{ type: "choice", name: "choice", choice, confidence, probabilities: probabilities.map(([value, probability]) => ({ value, probability })) }] });

describe("createOpenAITextProductChooser", () => {
  test("sends the words, the price hint and the labeled products, and maps the answer back to product ids with probabilities", async () => {
    let body: Parameters<NonNullable<Parameters<typeof clientFor>[1]>>[0] | undefined;
    const choose = createOpenAITextProductChooser(config(clientFor(async () => answer("B", 0.9, [["A", 0.08], ["B", 0.9]]), (sent) => { body = sent; })));
    expect(await choose({ mention: "el polo de 35", priceHint: 35, candidates }, signal))
      .toEqual({ success: true, data: { productId: "product-b", confidence: 0.9, probabilities: [{ productId: "product-a", probability: 0.08 }, { productId: "product-b", probability: 0.9 }] } });
    expect(Object.keys(body!).sort()).toEqual(["input", "model", "questions"]);
    const text = body!.input[0]!.content[0]!.text;
    expect(text).toContain("el polo de 35");
    expect(text).toContain("Price per unit the customer mentioned: 35");
    expect(text).toContain("B: Polo premium (50 PEN to 70 PEN)");
  });

  test("returns a null product when the answer is none", async () => {
    const choose = createOpenAITextProductChooser(config(clientFor(async () => answer("none", 0.7, []))));
    expect(await choose({ mention: "zapatos", priceHint: null, candidates }, signal)).toEqual({ success: true, data: { productId: null, confidence: 0.7,
      probabilities: [{ productId: "product-a", probability: 0 }, { productId: "product-b", probability: 0 }] } });
  });

  test("maps a malformed answer or an unknown label to invalid matcher response and transient failures to unavailable", async () => {
    for (const reply of [() => json({ model: "m", answers: [{ type: "refusal", name: "choice" }] }), () => answer("Z", 0.9, []), () => json({ error: { message: "x" } }, 400)]) {
      expect(await createOpenAITextProductChooser(config(clientFor(async () => reply())))({ mention: "polo", priceHint: null, candidates }, signal)).toMatchObject({ success: false, error: { code: "INVALID_MATCHER_RESPONSE" } });
    }
    for (const reply of [async () => json({ error: { message: "x" } }, 429), async () => json({ error: { message: "x" } }, 503), () => Promise.reject(new TypeError("fetch failed"))]) {
      expect(await createOpenAITextProductChooser(config(clientFor(reply)))({ mention: "polo", priceHint: null, candidates }, signal)).toMatchObject({ success: false, error: { code: "PRODUCT_MATCHER_UNAVAILABLE" } });
    }
  });
});

describe("createOpenAIVariantChooser", () => {
  const variants = ["S", "M"].map((size, index) => ({ variantId: `variant-${index}` as VariantId, productName: "Polo", variantAttributes: { Talla: size }, sku: null, unitPrice: { amount: 35, currency: "PEN" as const } }));

  test("maps the chosen label to a variant and none to null", async () => {
    expect(await createOpenAIVariantChooser(config(clientFor(async () => answer("B", 0.92, []))))({ words: ["la mediana"], variants }, signal))
      .toEqual({ success: true, data: { variantId: "variant-1", confidence: 0.92 } });
    expect(await createOpenAIVariantChooser(config(clientFor(async () => answer("none", 0.9, []))))({ words: ["la xl"], variants }, signal))
      .toEqual({ success: true, data: { variantId: null, confidence: 0.9 } });
  });
});
