import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { ReadChatMessage, ReaderError, ReaderUsage } from "@core/src/features/orders/application/read-chat-message";
import { countRequestTokens, readerOutputTokenLimit } from "@core/src/features/orders/infrastructure/chat-reader-budget";
import { describeReadingContext } from "@core/src/features/orders/infrastructure/chat-reader-context-text";
import { readerJsonSchema, readerSchema, toReaderAnswer } from "@core/src/features/orders/infrastructure/chat-reader-schema";
import { readerInstructions } from "@core/src/features/orders/infrastructure/chat-reader-text";

export type OpenAiChatReaderConfig = Readonly<{
  client: OpenAI;
  model: string;
  timeoutMs: number;
  /** Receives the raw parsed JSON of the answer before schema validation and mapping, or the raw text when it is not JSON. Evals use it; production does not pass it. */
  observe?: (output: unknown) => void;
}>;

/**
 * Pinned request settings; the pinned model-text file records them. The limit is the answer (10 actions of about 100 tokens, 1,000; the budget
 * derives the input side from it) plus the reasoning tokens at the pinned effort, which count against it and are 0 with `none`. Measured on the live model: gpt-6-luna rejects "minimal" with HTTP 400; "none" works with 0 reasoning tokens.
 */
export const readerRequestSettings = { reasoningEffort: "low" as ReasoningEffort, maxOutputTokens: readerOutputTokenLimit, schemaName: "chat_reader_answer" } as const;

const invalid = (message: string): ReaderError => ({ code: "INVALID_AI_RESPONSE", message });

/** Abort of the caller's signal is the attempt deadline; timeout, network, 429 and 5xx are transient; other 4xx mean the request or the reply is wrong. */
function failureOf(cause: unknown, signal: AbortSignal): ReaderError {
  if (signal.aborted || cause instanceof OpenAI.APIUserAbortError) return { code: "DEADLINE_EXCEEDED", message: "The AI request passed its deadline" };
  const status = cause instanceof OpenAI.APIError ? cause.status : undefined;
  return status === undefined || status === 429 || status >= 500
    ? { code: "AI_PROVIDER_UNAVAILABLE", message: "The AI provider is unavailable" }
    : invalid("The AI provider rejected the request");
}

const usageOf = (usage: OpenAI.Responses.ResponseUsage | undefined): ReaderUsage => ({
  inputTokens: usage?.input_tokens ?? 0,
  cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
  outputTokens: usage?.output_tokens ?? 0,
  reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
});

/** The answer text of a completed response; a refusal, an incomplete output or no text is an invalid response. */
function answerTextOf(response: OpenAI.Responses.Response): Result<string, ReaderError> {
  if (response.status === "incomplete") return err(invalid("The AI answer was incomplete"));
  const parts = response.output.flatMap((item) => (item.type === "message" ? item.content : []));
  if (parts.some(({ type }) => type === "refusal")) return err(invalid("The AI refused to answer"));
  const text = parts.flatMap((part) => (part.type === "output_text" ? [part.text] : [])).join("");
  return text ? ok(text) : err(invalid("The AI answer had no text"));
}

/** `ReadChatMessage` over the OpenAI Responses API with a strict structured answer: the fixed instructions first, then the message's context. */
export function createOpenAiChatReader(config: OpenAiChatReaderConfig): ReadChatMessage {
  return async (context, meta, signal) => {
    const started = performance.now();
    const fields = () => ({ companyId: meta.companyId, messageId: meta.messageId, model: config.model, durationMs: Math.round(performance.now() - started) });
    const contextText = describeReadingContext(context);
    let response: OpenAI.Responses.Response;
    try {
      response = await config.client.responses.create({
        model: config.model,
        instructions: readerInstructions,
        input: contextText,
        store: false,
        reasoning: { effort: readerRequestSettings.reasoningEffort },
        max_output_tokens: readerRequestSettings.maxOutputTokens,
        text: { format: { type: "json_schema", name: readerRequestSettings.schemaName, strict: true, schema: readerJsonSchema } },
      }, { timeout: config.timeoutMs, maxRetries: 0, signal }); // the event bus owns retries
    } catch (cause) {
      const error = failureOf(cause, signal);
      log.warn({ event: "chat_reader_request_failed", ...fields(), errorCode: error.code, status: cause instanceof OpenAI.APIError ? cause.status : undefined }, "chat_reader_request_failed");
      return err(error);
    }
    const rejected = (error: ReaderError, issuePaths: readonly string[] = []) => {
      log.error({ event: "chat_reader_invalid_response", ...fields(), errorCode: error.code, issuePaths }, "chat_reader_invalid_response");
      return err(error);
    };
    const text = answerTextOf(response);
    if (!text.success) return rejected(text.error);
    let value: unknown;
    try { value = JSON.parse(text.data); } catch { config.observe?.(text.data); return rejected(invalid("The AI answer was not JSON")); }
    config.observe?.(value);
    const parsed = readerSchema.safeParse(value);
    if (!parsed.success) return rejected(invalid("The AI answer did not match the schema"), [...new Set(parsed.error.issues.map(({ path }) => path.filter((part) => typeof part === "string").join(".")))]);
    const answer = toReaderAnswer(parsed.data);
    const usage = usageOf(response.usage);
    log.info({
      event: "chat_reader_completed", ...fields(), budget: context.kind === "text" ? "text" : "photo", answer: answer.kind, actionKinds: answer.kind === "actions" ? answer.actions.map(({ kind }) => kind) : [],
      productCount: context.products.length, variantCount: context.products.reduce((total, { variants }) => total + variants.length, 0),
      pendingCount: context.pendings.length, itemCount: context.items.length, contextChars: contextText.length, contextTruncated: context.truncated,
      inputTokens: usage.inputTokens, countedInputTokens: countRequestTokens(contextText), cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens,
    }, "chat_reader_completed");
    return ok({ answer, usage });
  };
}
