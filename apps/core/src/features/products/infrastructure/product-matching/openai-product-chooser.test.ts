import OpenAI from "openai";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { createOpenAIProductChooser } from "@core/src/features/products/infrastructure/product-matching/openai-product-chooser";
import { productChooserContract, type ProviderReply } from "@core/src/features/products/infrastructure/product-matching/product-chooser.contract";

type DecisionBody = { input: { content: { type: string }[] }[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function respond(reply: ProviderReply, signal: AbortSignal | null | undefined): Promise<Response> {
  switch (reply.kind) {
    case "choice": return Promise.resolve(json({ model: "gpt-6-luna", usage: { input_tokens: 900, output_tokens: 1 },
      answers: [{ type: "choice", name: "product", choice: reply.choice, confidence: reply.confidence, probabilities: [] },
        { type: "predicate", name: "shows_product", probability: reply.showsProduct }] }));
    case "malformed": return Promise.resolve(json({ model: "gpt-6-luna", answers: [{ type: "refusal", name: "product" }] }));
    case "status": return Promise.resolve(json({ error: { message: "failure" } }, reply.status));
    case "network": return Promise.reject(new TypeError("fetch failed"));
    case "timeout": return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  }
}

describe("createOpenAIProductChooser", () => {
  productChooserContract((reply) => {
    const sent: number[] = [];
    const client = new OpenAI({ apiKey: "test-key", fetch: async (url, init) => {
      if (String(url).endsWith("/decisions")) {
        const body = JSON.parse(String(init?.body)) as DecisionBody;
        // Decisions has no store flag and keeps no response state; pin the body so no retention option slips in (docs/image-product-search.md).
        expect(Object.keys(body).sort()).toEqual(["input", "model", "questions"]);
        sent.push(body.input.flatMap(({ content }) => content).filter(({ type }) => type === "input_image").length);
      }
      return respond(reply, init?.signal);
    } });
    return { choose: createOpenAIProductChooser({ client, model: "gpt-6-luna", timeoutMs: 50, companyId: () => "company" }), sentImages: () => sent };
  });

  test("reports the tokens the provider says the choice used", async () => {
    const client = new OpenAI({ apiKey: "test-key", fetch: async (_url, init) => respond({ kind: "choice", choice: "A", confidence: 0.9, showsProduct: 0.9 }, init?.signal) });
    const choose = createOpenAIProductChooser({ client, model: "gpt-6-luna", timeoutMs: 50, companyId: () => "company" });
    const image = { bytes: new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).jpeg().toBuffer()), contentType: "image/jpeg" };
    const result = await choose({ query: image, candidates: [{ productId: "product-a" as never, image }] });
    expect(result).toMatchObject({ success: true, data: { kind: "product", usage: { inputTokens: 900, outputTokens: 1 } } });
  });
});
