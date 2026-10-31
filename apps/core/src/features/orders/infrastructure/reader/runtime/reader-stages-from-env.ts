import OpenAI from "openai";
import type { ReaderStages } from "@core/src/features/orders/application/reader/stages";
import { readChatReaderEnv } from "@core/src/features/orders/infrastructure/chat-reader-env";
import { createReaderStages } from "@core/src/features/orders/infrastructure/reader/runtime/create-stage";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import { createOpenAiStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/openai-structured-model";
import { promptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The staged reader's ports from the env: null without OPENAI_API_KEY and without a fake configuration, and a startup error on an invalid
 * stage configuration. The fake client has no scripted answers here; tests build their own with `createFakeStructuredModel`.
 */
export function readerStagesFromEnv(env: Env): ReaderStages | null {
  const { OPENAI_API_KEY, AI_TIMEOUT_MS } = readChatReaderEnv(env);
  const openai = OPENAI_API_KEY ? createOpenAiStructuredModel(new OpenAI({ apiKey: OPENAI_API_KEY, timeout: AI_TIMEOUT_MS, maxRetries: 0 })) : null;
  return createReaderStages(env, promptRegistry, { openai, fake: env.NODE_ENV === "production" ? null : createFakeStructuredModel({}, env.NODE_ENV) });
}
