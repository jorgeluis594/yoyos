import OpenAI from "openai";
import type { ReaderStages } from "@core/src/features/orders/application/reader/stages";
import { readChatReaderEnv } from "@core/src/features/orders/infrastructure/chat-reader-env";
import { createReaderStages } from "@core/src/features/orders/infrastructure/reader/runtime/create-stage";
import { createOpenAiStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/openai-structured-model";
import { createPromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The staged reader's ports from the env: null without OPENAI_API_KEY and without a fake configuration, and a startup error on an invalid
 * stage configuration. `stageInputMaxChars` is `READER_STAGE_INPUT_MAX_CHARS`, read by the composition. The env never builds the fake client (it has no scripted answers); tests inject theirs through `createReaderStages`.
 */
export function readerStagesFromEnv(env: Env, stageInputMaxChars: number): ReaderStages | null {
  const { OPENAI_API_KEY, AI_TIMEOUT_MS } = readChatReaderEnv(env);
  const openai = OPENAI_API_KEY ? createOpenAiStructuredModel(new OpenAI({ apiKey: OPENAI_API_KEY, timeout: AI_TIMEOUT_MS, maxRetries: 0 })) : null;
  // Extraction is the one stage with a confirming configuration by default (technical design 2).
  const withDefaults = { ...env, READER_EXTRACTION_CONFIRM_PROMPT: env.READER_EXTRACTION_CONFIRM_PROMPT || "extraction_confirm-v1" };
  return createReaderStages(withDefaults, createPromptRegistry(stageInputMaxChars), { openai, fake: null });
}
