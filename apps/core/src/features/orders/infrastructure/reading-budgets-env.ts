import { z } from "zod";
import { defaultReadingBudgets, type ReadingBudgets } from "@core/src/features/orders/domain/reader/budgets";

type Env = Readonly<Record<string, string | undefined>>;

const defaults = defaultReadingBudgets;
// Invalid values fail at startup; empty values count as unset. A stage input must at least hold the longest current text (2,000 characters) and its context.
const budgetsSchema = z.object({
  READER_CONTEXT_MESSAGES: z.coerce.number().int().min(0).default(defaults.contextMessages),
  READER_CONTEXT_HOURS: z.coerce.number().positive().default(defaults.contextHours),
  READER_CONTEXT_MESSAGE_CHARS: z.coerce.number().int().min(1).default(defaults.contextMessageChars),
  READER_MAX_ITEMS: z.coerce.number().int().min(1).default(defaults.maxItems),
  READER_STAGE_INPUT_MAX_CHARS: z.coerce.number().int().min(3000).default(defaults.stageInputMaxChars),
});

/** The reading budgets of section 6.8 from env. */
export function readReadingBudgets(env: Env): ReadingBudgets {
  const config = budgetsSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  return { contextMessages: config.READER_CONTEXT_MESSAGES, contextHours: config.READER_CONTEXT_HOURS, contextMessageChars: config.READER_CONTEXT_MESSAGE_CHARS,
    maxItems: config.READER_MAX_ITEMS, stageInputMaxChars: config.READER_STAGE_INPUT_MAX_CHARS };
}
