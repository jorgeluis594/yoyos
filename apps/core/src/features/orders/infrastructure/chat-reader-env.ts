import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;

// Invalid values fail at startup; empty values count as unset.
const chatReaderEnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  AI_READER_MODEL: z.string().default("gpt-6-luna"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

export type ChatReaderEnv = z.output<typeof chatReaderEnvSchema>;

export function readChatReaderEnv(env: Env): ChatReaderEnv {
  return chatReaderEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
}
