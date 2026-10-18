import OpenAI from "openai";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { createOpenAiImageEmbedder } from "@core/src/features/products/infrastructure/product-matching/openai-image-embedder";
import { imageEmbedderContract, unavailableTransports, type Transport } from "@core/src/features/products/infrastructure/product-matching/image-embedder.contract";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const described = json(200, { id: "resp_1", object: "response", status: "completed", model: "gpt-6-luna",
  output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Red cotton t-shirt", annotations: [] }] }] });

function build(transport: Transport) {
  const client = new OpenAI({ apiKey: "test", fetch: transport, maxRetries: 0, timeout: 50 });
  return createOpenAiImageEmbedder({ client, describeModel: "gpt-6-luna", currentCompanyId: () => "company" });
}

function answering(values: readonly (number | null)[]): Transport {
  return async (input) => String(input).endsWith("/responses") ? described.clone()
    : json(200, { object: "list", model: "text-embedding-3-small", data: [{ object: "embedding", index: 0, embedding: values }], usage: { prompt_tokens: 1, total_tokens: 1 } });
}

describe("openai image embedder contract", () => {
  imageEmbedderContract({ dimensions: 1536, build: (transport) => build(transport).embedImage, answering, unavailable: unavailableTransports });
});

test("describes a resized JPEG with the vision model and embeds the description", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const respond = answering(Array.from({ length: 1536 }, () => 0.1));
  const embedder = build(async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return respond(input, init);
  });
  const bytes = new Uint8Array(await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#fff" } }).png().toBuffer());
  expect(embedder.model).toBe("openai/gpt-6-luna+text-embedding-3-small");
  expect((await embedder.embedImage({ bytes, contentType: "image/png" })).success).toBe(true);
  expect(requests.map(({ url }) => new URL(url).pathname)).toEqual(["/v1/responses", "/v1/embeddings"]);
  expect(requests[0].body).toMatchObject({ model: "gpt-6-luna", store: false });
  const imageUrl = (requests[0].body as { input: Array<{ content: Array<{ image_url?: string }> }> }).input[0].content[1].image_url!;
  expect(imageUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  const sent = await sharp(Buffer.from(imageUrl.split(",")[1], "base64")).metadata();
  expect([sent.width, sent.height]).toEqual([1024, 512]);
  expect(requests[1].body).toMatchObject({ model: "text-embedding-3-small", input: "Red cotton t-shirt", dimensions: 1536 });
});

test("returns EMBEDDER_UNAVAILABLE when the embedding call fails after the description", async () => {
  const embedder = build(async (input) => String(input).endsWith("/responses") ? described.clone() : json(500, { error: { message: "down" } }));
  const bytes = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer());
  expect(await embedder.embedImage({ bytes, contentType: "image/png" })).toMatchObject({ success: false, error: { code: "EMBEDDER_UNAVAILABLE" } });
});
