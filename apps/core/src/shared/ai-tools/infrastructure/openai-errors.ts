import OpenAI from "openai";
import type { AiError } from "@core/src/shared/ai-tools/application/ai-error";

/** Abort of the caller's signal is the attempt deadline; timeout, network, 429 and 5xx are transient; other 4xx mean the request or the reply is wrong. */
export function toAiError(cause: unknown, signal: AbortSignal): AiError {
  if (signal.aborted || cause instanceof OpenAI.APIUserAbortError) return { code: "DEADLINE_EXCEEDED", message: "The AI request passed its deadline" };
  const status = cause instanceof OpenAI.APIError ? cause.status : undefined;
  const transient = status === undefined || status === 429 || status >= 500;
  return transient
    ? { code: "AI_PROVIDER_UNAVAILABLE", message: "The AI provider is unavailable" }
    : { code: "INVALID_AI_RESPONSE", message: "The AI provider rejected the request" };
}

export const httpStatusOf = (cause: unknown) => (cause instanceof OpenAI.APIError ? cause.status : undefined);
