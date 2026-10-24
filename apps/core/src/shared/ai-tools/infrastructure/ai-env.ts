import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;

// Invalid tuning values fail at startup; empty values count as unset.
const aiEnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  AI_EXTRACTION_MODEL: z.string().default("gpt-6-luna"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  MESSAGE_ACTION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  MESSAGE_TOOL_PREDICATE_MIN: z.coerce.number().min(0).max(1).default(0.5),
});

export type AiEnv = z.output<typeof aiEnvSchema>;

export function readAiEnv(env: Env): AiEnv {
  return aiEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
}
