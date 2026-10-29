import OpenAI from "openai";
import { describe, expect, test } from "vitest";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { CompanyId } from "@core/src/features/orders/domain/order";
import type { ChatReadingContext } from "@core/src/features/orders/domain/chat-reading";
import { createOpenAiChatReader, readerRequestSettings } from "@core/src/features/orders/infrastructure/openai-chat-reader";
import { readerInstructions } from "@core/src/features/orders/infrastructure/chat-reader-text";

const meta = { companyId: "company" as CompanyId, messageId: "message" as ChatMessageId };
const context: ChatReadingContext = { kind: "text", text: "dos polos en M y ya", items: [], pendings: [], products: [], truncated: false };
const noFields = { product: null, pendingProduct: null, attributes: null, quantity: null, price: null, pending: null, item: null, amount: null, mode: null, pendings: null };
const strictAnswer = { outcome: "actions", moreActions: false, actions: [
  { ...noFields, kind: "add", product: { kind: "ref", ref: "P1", refs: null }, attributes: [{ name: "Talla", value: "M" }], quantity: 2 },
  { ...noFields, kind: "ready" },
] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const completed = (content: unknown[], over: Record<string, unknown> = {}) => json({
  id: "resp_1", object: "response", created_at: 0, model: "gpt-6-luna", status: "completed", error: null, incomplete_details: null, parallel_tool_calls: false, tool_choice: "auto", tools: [],
  output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content }],
  usage: { input_tokens: 5200, input_tokens_details: { cached_tokens: 4000 }, output_tokens: 230, output_tokens_details: { reasoning_tokens: 30 }, total_tokens: 5430 }, ...over,
});
const answerResponse = (answer: unknown) => completed([{ type: "output_text", text: JSON.stringify(answer), annotations: [] }]);

type Sent = { url: string; body: Record<string, unknown>; signal: AbortSignal | null | undefined };
function readerWith(respond: (init: RequestInit | undefined) => Promise<Response>) {
  const sent: Sent[] = [];
  const client = new OpenAI({ apiKey: "test-key", fetch: async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>, signal: init?.signal });
    return respond(init);
  } });
  return { read: createOpenAiChatReader({ client, model: "gpt-6-luna", timeoutMs: 1000 }), sent };
}
const readWith = (response: () => Response | Promise<Response>, signal = new AbortController().signal) => {
  const { read, sent } = readerWith(async () => response());
  return read(context, meta, signal).then((result) => ({ result, sent }));
};

describe("createOpenAiChatReader", () => {
  test("maps a recorded strict response with an add and a ready to the reader answer", async () => {
    const { result } = await readWith(() => answerResponse(strictAnswer));
    expect(result).toEqual({ success: true, data: {
      answer: { kind: "actions", moreActions: false, actions: [
        { kind: "add", product: { kind: "ref", ref: "P1" }, attributes: [{ name: "Talla", value: "M" }], quantity: 2, price: null },
        { kind: "ready" },
      ] },
      usage: { inputTokens: 5200, cachedInputTokens: 4000, outputTokens: 230, reasoningTokens: 30 },
    } });
  });

  test("sends instructions before the context and passes the caller's signal", async () => {
    const controller = new AbortController();
    const { sent } = await readWith(() => answerResponse(strictAnswer), controller.signal);
    expect(sent).toHaveLength(1);
    const [{ url, body, signal }] = sent;
    expect(url).toMatch(/\/responses$/);
    expect(Object.keys(body)).toEqual(expect.arrayContaining(["instructions", "input"]));
    expect(Object.keys(body).indexOf("instructions")).toBeLessThan(Object.keys(body).indexOf("input"));
    expect(body.instructions).toBe(readerInstructions);
    expect(String(body.input)).toMatch(/Buyer's message:\ndos polos en M y ya$/);
    expect(signal).toBeDefined();
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  test("sends byte-identical instructions and schema for two different contexts and only the input changes", async () => {
    const other: ChatReadingContext = { ...context, kind: "photo_not_product", text: "otro mensaje", items: [{ ref: "I1", variantId: "v" as VariantId, productId: null, productName: "Casaca", variantAttributes: {}, quantity: 1, unitPrice: { amount: 10, currency: "PEN" } }] };
    const { read, sent } = readerWith(async () => answerResponse(strictAnswer));
    await read(context, meta, new AbortController().signal);
    await read(other, meta, new AbortController().signal);
    const [first, second] = sent.map(({ body }) => body);
    expect(JSON.stringify(first!.text)).toBe(JSON.stringify(second!.text));
    expect(first!.instructions).toBe(second!.instructions);
    expect(first!.input).not.toBe(second!.input);
  });

  test("asks for a strict json schema answer that is not stored, with the pinned settings", async () => {
    const { sent } = await readWith(() => answerResponse(strictAnswer));
    const { body } = sent[0]!;
    expect(body.store).toBe(false);
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning).toEqual({ effort: readerRequestSettings.reasoningEffort });
    expect(body.max_output_tokens).toBe(readerRequestSettings.maxOutputTokens);
    expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true, name: "chat_reader_answer" } });
  });

  test("maps a timeout, a 429 and a 5xx to provider unavailable", async () => {
    for (const response of [() => json({ error: { message: "slow down" } }, 429), () => json({ error: { message: "down" } }, 503), () => Promise.reject(new TypeError("fetch failed"))]) {
      const { result } = await readWith(response);
      expect(result).toEqual({ success: false, error: { code: "AI_PROVIDER_UNAVAILABLE", message: expect.any(String) } });
    }
    const slow = createOpenAiChatReader({ client: new OpenAI({ apiKey: "k", fetch: (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) }), model: "gpt-6-luna", timeoutMs: 20 });
    expect(await slow(context, meta, new AbortController().signal)).toEqual({ success: false, error: { code: "AI_PROVIDER_UNAVAILABLE", message: expect.any(String) } });
  });

  test("maps a refusal and an incomplete output to invalid response", async () => {
    const invalid = { success: false, error: { code: "INVALID_AI_RESPONSE", message: expect.any(String) } };
    expect((await readWith(() => completed([{ type: "refusal", refusal: "I can't help with that" }]))).result).toEqual(invalid);
    expect((await readWith(() => completed([{ type: "output_text", text: "{\"outcome\":\"act", annotations: [] }], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }))).result).toEqual(invalid);
  });

  test("maps another 4xx, text that is not json and a schema mismatch to invalid response", async () => {
    const invalid = { success: false, error: { code: "INVALID_AI_RESPONSE", message: expect.any(String) } };
    expect((await readWith(() => json({ error: { message: "bad model" } }, 400))).result).toEqual(invalid);
    expect((await readWith(() => completed([{ type: "output_text", text: "not json", annotations: [] }]))).result).toEqual(invalid);
    expect((await readWith(() => answerResponse({ outcome: "actions", moreActions: false, actions: [{ ...noFields, kind: "refund" }] }))).result).toEqual(invalid);
    expect((await readWith(() => completed([]))).result).toEqual(invalid);
  });

  test("aborts at the caller's deadline as deadline exceeded", async () => {
    const controller = new AbortController();
    const { read } = readerWith((init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const pending = read(context, meta, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ success: false, error: { code: "DEADLINE_EXCEEDED", message: expect.any(String) } });
  });

  test("reports cached and reasoning tokens from the usage", async () => {
    const { result } = await readWith(() => answerResponse({ outcome: "no_intent", moreActions: false, actions: [] }));
    expect(result).toMatchObject({ success: true, data: { answer: { kind: "no_intent" }, usage: { cachedInputTokens: 4000, reasoningTokens: 30 } } });
  });

  test("counts missing usage details as zero", async () => {
    const { result } = await readWith(() => answerResponse({ outcome: "doubt", moreActions: false, actions: [] }).json().then((body) => json({ ...body, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } })));
    expect(result).toMatchObject({ success: true, data: { answer: { kind: "doubt" }, usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0 } } });
  });
});
