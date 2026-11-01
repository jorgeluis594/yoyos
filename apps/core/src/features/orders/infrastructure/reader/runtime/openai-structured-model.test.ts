import type OpenAI from "openai";
import { describe, expect, test, vi } from "vitest";
import { createOpenAiStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/openai-structured-model";
import type { StructuredModelRequest } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";

const request: StructuredModelRequest = { stage: "intent", model: "gpt-6-luna", instructions: "fixed", input: "the message", schemaName: "intent_answer", jsonSchema: { type: "object" }, reasoningEffort: "none", maxOutputTokens: 500 };
const response = (overrides: Record<string, unknown> = {}) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: "{\"n\":1}" }] }],
  usage: { input_tokens: 120, output_tokens: 8, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 0 } },
  ...overrides,
}) as unknown as OpenAI.Responses.Response;
const clientOf = (create: (...args: unknown[]) => Promise<OpenAI.Responses.Response>) => ({ responses: { create } });

describe("OpenAI structured model", () => {
  test("sends strict json_schema, store false and no retries, with the instructions before the input", async () => {
    const create = vi.fn(async () => response());
    const signal = new AbortController().signal;

    const result = await createOpenAiStructuredModel(clientOf(create))(request, signal);

    expect(create).toHaveBeenCalledWith({
      model: "gpt-6-luna", instructions: "fixed", input: "the message", store: false, reasoning: { effort: "none" }, max_output_tokens: 500,
      text: { format: { type: "json_schema", name: "intent_answer", strict: true, schema: { type: "object" } } },
    }, { maxRetries: 0, signal });
    expect(result).toEqual({ success: true, data: { json: { n: 1 }, usage: { inputTokens: 120, cachedInputTokens: 100, outputTokens: 8, reasoningTokens: 0 } } });
  });

  test("maps an aborted signal to DEADLINE_EXCEEDED and a network failure to AI_PROVIDER_UNAVAILABLE", async () => {
    const aborted = new AbortController();
    aborted.abort();

    expect(await createOpenAiStructuredModel(clientOf(async () => { throw new Error("aborted"); }))(request, aborted.signal))
      .toEqual({ success: false, error: expect.objectContaining({ code: "DEADLINE_EXCEEDED", stage: "intent", call: null }) });
    expect(await createOpenAiStructuredModel(clientOf(async () => { throw new Error("socket"); }))(request, new AbortController().signal))
      .toEqual({ success: false, error: expect.objectContaining({ code: "AI_PROVIDER_UNAVAILABLE" }) });
  });

  test.each([
    ["an incomplete answer", response({ status: "incomplete" })],
    ["a refusal", response({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })],
    ["an answer without text", response({ output: [] })],
    ["an answer that is not JSON", response({ output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] })],
  ])("treats %s as INVALID_AI_RESPONSE", async (_title, answer) => {
    expect(await createOpenAiStructuredModel(clientOf(async () => answer))(request, new AbortController().signal))
      .toEqual({ success: false, error: expect.objectContaining({ code: "INVALID_AI_RESPONSE" }) });
  });
});
