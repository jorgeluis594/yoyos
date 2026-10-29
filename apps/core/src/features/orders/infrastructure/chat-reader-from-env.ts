import OpenAI from "openai";
import { log } from "@core/src/shared/infrastructure/logger";
import type { ReadChatMessage } from "@core/src/features/orders/application/read-chat-message";
import { readChatReaderEnv } from "@core/src/features/orders/infrastructure/chat-reader-env";
import { createOpenAiChatReader } from "@core/src/features/orders/infrastructure/openai-chat-reader";

/** The chat reader from the env; null without OPENAI_API_KEY, so texts are skipped and captions ignored. */
export function createChatReaderFromEnv(env: Readonly<Record<string, string | undefined>>): ReadChatMessage | null {
  const config = readChatReaderEnv(env);
  if (!config.OPENAI_API_KEY) {
    log.info({ event: "chat_reader_disabled", reason: "missing_api_key" }, "chat_reader_disabled");
    return null;
  }
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: config.AI_TIMEOUT_MS, maxRetries: 0 });
  return createOpenAiChatReader({ client, model: config.AI_READER_MODEL, timeoutMs: config.AI_TIMEOUT_MS });
}
