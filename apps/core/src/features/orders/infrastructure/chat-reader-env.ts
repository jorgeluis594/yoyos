import { z } from "zod";
import { priceOf } from "@core/src/shared/infrastructure/model-prices";

type Env = Readonly<Record<string, string | undefined>>;

/** Worst time of one reader call; the attempt's time sum (photo stage + candidate search + reader + transaction) is checked against it. */
export const aiTimeoutMaxMs = 35_000;
export const defaultReaderModel = "gpt-6-luna";

// Invalid values fail at startup; empty values count as unset.
const chatReaderEnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  // A model with no price has no cost bound: changing it means adding its price and re-running the cost measurements.
  AI_READER_MODEL: z.string().default(defaultReaderModel).refine((model) => priceOf(model) !== null, { message: "AI_READER_MODEL has no price in model-prices.ts" }),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().max(aiTimeoutMaxMs).default(20_000),
});

export type ChatReaderEnv = z.output<typeof chatReaderEnvSchema>;

export function readChatReaderEnv(env: Env): ChatReaderEnv {
  return chatReaderEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
}
