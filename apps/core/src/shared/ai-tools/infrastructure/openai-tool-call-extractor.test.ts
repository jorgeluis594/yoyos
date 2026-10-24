import OpenAI from "openai";
import { describe, expect, test } from "vitest";
import type { ExtractionRequest } from "@core/src/shared/ai-tools/application/orchestrate";
import { createOpenAiToolCallExtractor, EXTRACTION_INSTRUCTIONS } from "@core/src/shared/ai-tools/infrastructure/openai-tool-call-extractor";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const request: ExtractionRequest = {
  contextText: "Order: A",
  messageParts: [{ kind: "text", text: "una gorra roja" }, { kind: "image", dataUrl: "data:image/png;base64,AAAA" }],
  tools: [{ name: "add_item", description: "Adds", jsonSchema: { type: "object", properties: { product: { type: "string" } }, required: ["product"], additionalProperties: false } }],
};
const functionCall = (name: string, args: string) => ({ type: "function_call", id: "fc_1", call_id: "call_1", name, arguments: args, status: "completed" });
const response = (output: unknown[]) => ({ id: "resp_1", object: "response", model: "gpt-6-luna", status: "completed", output, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } });

function extract(respond: (init: RequestInit | undefined) => Promise<Response>, timeoutMs = 50) {
  const bodies: Record<string, unknown>[] = [];
  const client = new OpenAI({ apiKey: "test-key", fetch: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return respond(init); } });
  return { extract: createOpenAiToolCallExtractor({ client, model: "gpt-6-luna", timeoutMs }), bodies };
}
const hangUntilAborted = (init: RequestInit | undefined) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
const code = (result: { success: boolean; error?: { code: string } }) => result.error?.code;

describe("createOpenAiToolCallExtractor", () => {
  test("sends store false, strict function tools and required tool choice to the extraction model", async () => {
    const { extract: run, bodies } = extract(async () => json(response([functionCall("add_item", '{"product":"gorra"}')])));
    const result = await run(request, new AbortController().signal);
    expect(result).toEqual({ success: true, data: [{ tool: "add_item", args: { product: "gorra" } }] });
    expect(bodies[0]).toMatchObject({
      model: "gpt-6-luna", store: false, tool_choice: "required", parallel_tool_calls: true, instructions: EXTRACTION_INSTRUCTIONS,
      tools: [{ type: "function", name: "add_item", strict: true, parameters: request.tools[0]!.jsonSchema }],
    });
  });

  test("parses only function call items and rejects malformed arguments", async () => {
    const mixed = await extract(async () => json(response([{ type: "message", id: "m", role: "assistant", status: "completed", content: [] }, functionCall("add_item", '{"product":"polo"}')]))).extract(request, new AbortController().signal);
    expect(mixed).toEqual({ success: true, data: [{ tool: "add_item", args: { product: "polo" } }] });
    const malformed = await extract(async () => json(response([functionCall("add_item", "{not json")]))).extract(request, new AbortController().signal);
    expect(code(malformed)).toBe("INVALID_AI_RESPONSE");
  });

  test("maps timeout, network, 429 and 5xx to AI provider unavailable", async () => {
    for (const respond of [hangUntilAborted, () => Promise.reject(new TypeError("fetch failed")), async () => json({ error: { message: "x" } }, 429), async () => json({ error: { message: "x" } }, 500)]) {
      expect(code(await extract(respond).extract(request, new AbortController().signal))).toBe("AI_PROVIDER_UNAVAILABLE");
    }
  });

  test("maps an abort at the deadline to deadline exceeded", async () => {
    const controller = new AbortController();
    const pending = extract(hangUntilAborted, 5_000).extract(request, controller.signal);
    controller.abort();
    expect(code(await pending)).toBe("DEADLINE_EXCEEDED");
  });

  test("maps other 4xx to invalid AI response", async () => {
    expect(code(await extract(async () => json({ error: { message: "bad" } }, 400)).extract(request, new AbortController().signal))).toBe("INVALID_AI_RESPONSE");
  });
});
