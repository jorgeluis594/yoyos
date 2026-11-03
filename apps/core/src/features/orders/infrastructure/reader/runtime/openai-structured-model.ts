import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { err, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import type { ModelUsage } from "@core/src/features/orders/domain/reader/readings";
import type { StageError } from "@core/src/features/orders/application/reader/stages";
import { failureOf, type StructuredModel, type StructuredModelRequest } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";

/** The slice of the OpenAI client this adapter calls, so tests pass a fake client. */
export type OpenAiResponsesClient = Readonly<{
  responses: Readonly<{ create: (body: ResponseCreateParamsNonStreaming, options: Readonly<{ maxRetries: number; signal: AbortSignal }>) => Promise<OpenAI.Responses.Response> }>;
}>;

const usageOf = (usage: OpenAI.Responses.ResponseUsage | undefined): ModelUsage => ({
  inputTokens: usage?.input_tokens ?? 0,
  cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
  outputTokens: usage?.output_tokens ?? 0,
  reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
});

/** An aborted signal is the deadline; timeout, network, 429 and 5xx are transient; other 4xx mean the request or the reply is wrong. */
function failureCodeOf(cause: unknown, signal: AbortSignal): StageError["code"] {
  if (signal.aborted || cause instanceof OpenAI.APIUserAbortError) return "DEADLINE_EXCEEDED";
  const status = cause instanceof OpenAI.APIError ? cause.status : undefined;
  return status === undefined || status === 429 || status >= 500 ? "AI_PROVIDER_UNAVAILABLE" : "INVALID_AI_RESPONSE";
}

/** The answer text of a completed response; a refusal, an incomplete output or no text is an invalid response. */
function answerTextOf(response: OpenAI.Responses.Response): Result<string, AppError> {
  if (response.status === "incomplete") return err({ message: "The AI answer was incomplete" });
  const parts = response.output.flatMap((item) => (item.type === "message" ? item.content : []));
  if (parts.some(({ type }) => type === "refusal")) return err({ message: "The AI refused to answer" });
  const text = parts.flatMap((part) => (part.type === "output_text" ? [part.text] : [])).join("");
  return text ? ok(text) : err({ message: "The AI answer had no text" });
}

/** `StructuredModel` over the OpenAI Responses API: strict `json_schema`, `store: false`, no retries (the stage adapter and the event bus own them) and the caller's signal. */
export function createOpenAiStructuredModel(client: OpenAiResponsesClient): StructuredModel {
  return async (request: StructuredModelRequest, signal) => {
    let response: OpenAI.Responses.Response;
    try {
      response = await client.responses.create({
        model: request.model,
        instructions: request.instructions,
        input: request.input,
        store: false,
        reasoning: { effort: request.reasoningEffort },
        max_output_tokens: request.maxOutputTokens,
        text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: { ...request.jsonSchema } } },
      } as ResponseCreateParamsNonStreaming, { maxRetries: 0, signal });
    } catch (cause) {
      const code = failureCodeOf(cause, signal);
      return failureOf(request, code, code === "DEADLINE_EXCEEDED" ? "The AI request passed its deadline" : code === "INVALID_AI_RESPONSE" ? "The AI provider rejected the request" : "The AI provider is unavailable");
    }
    const text = answerTextOf(response);
    if (!text.success) return failureOf(request, "INVALID_AI_RESPONSE", text.error.message);
    let json: unknown;
    try { json = JSON.parse(text.data); } catch { return failureOf(request, "INVALID_AI_RESPONSE", "The AI answer was not JSON"); }
    return ok({ json, usage: usageOf(response.usage) });
  };
}
