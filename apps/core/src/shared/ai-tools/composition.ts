import OpenAI from "openai";
import { log } from "@core/src/shared/infrastructure/logger";
import type { OrchestrateDependencies } from "@core/src/shared/ai-tools/application/orchestrate";
import { readAiEnv, type AiEnv } from "@core/src/shared/ai-tools/infrastructure/ai-env";
import { decisionRequestText } from "@core/src/shared/ai-tools/infrastructure/decision-request-text";
import { createOpenAiDecisionClient } from "@core/src/shared/ai-tools/infrastructure/openai-decision-client";
import { createOpenAiToolCallExtractor } from "@core/src/shared/ai-tools/infrastructure/openai-tool-call-extractor";

/** Decision and extraction clients over one OpenAI client; null client (no OPENAI_API_KEY) means interpretation is disabled. */
export function createAiTools(client: OpenAI | null, config: AiEnv): OrchestrateDependencies | null {
  if (!client) return null;
  return {
    text: decisionRequestText,
    decide: createOpenAiDecisionClient({ client, timeoutMs: config.AI_TIMEOUT_MS }),
    extract: createOpenAiToolCallExtractor({ client, model: config.AI_EXTRACTION_MODEL, timeoutMs: config.AI_TIMEOUT_MS }),
    minActionConfidence: config.MESSAGE_ACTION_MIN_CONFIDENCE,
    minToolPredicate: config.MESSAGE_TOOL_PREDICATE_MIN,
    minReportPredicate: config.MESSAGE_REPORT_PREDICATE_MIN,
  };
}

/** Reads the AI env and builds the clients; created once per process by the caller. */
export function createAiToolsFromEnv(env: Readonly<Record<string, string | undefined>>): OrchestrateDependencies | null {
  const config = readAiEnv(env);
  if (!config.OPENAI_API_KEY) {
    log.info({ event: "ai_tools_disabled", reason: "missing_api_key" }, "ai_tools_disabled");
    return null;
  }
  return createAiTools(new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: config.AI_TIMEOUT_MS, maxRetries: 0 }), config);
}
