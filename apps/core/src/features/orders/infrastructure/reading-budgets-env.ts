import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ReadingLimits } from "@core/src/features/orders/application/apply-chat-message";
import { readMessageTraceSettings } from "@core/src/features/orders/infrastructure/message-trace-env";
import { readShadowConfig } from "@core/src/features/orders/infrastructure/reader/shadow-config";
import { readReadingBudgetMs } from "@core/src/features/orders/infrastructure/reader/runtime/stage-config-env";
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

const limitsSchema = z.object({
  READER_CANDIDATES_PER_MENTION: z.coerce.number().int().min(1).default(5),
});

/** What the staged reading adds to the message limits (section 5.1): the reading budget, candidates per mention, trace retention and the shadow wait. */
export function readReadingLimits(env: Env): Result<ReadingLimits, Readonly<{ code: "INVALID_STAGE_ENV"; message: string }>> {
  const budget = readReadingBudgetMs(env);
  if (!budget.success) return err({ code: "INVALID_STAGE_ENV", message: budget.error.message });
  const parsed = limitsSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  if (!parsed.success) return err({ code: "INVALID_STAGE_ENV", message: `Invalid reader settings: ${[...new Set(parsed.error.issues.map(({ path }) => String(path[0])))].join(", ")}` });
  const shadow = readShadowConfig(env);
  if (!shadow.success) return err({ code: "INVALID_STAGE_ENV", message: shadow.error.message });
  return ok({ readingBudgetMs: budget.data, candidatesPerMention: parsed.data.READER_CANDIDATES_PER_MENTION, traceRetentionDays: readMessageTraceSettings(env).retentionDays,
    shadowWaitMs: shadow.data.waitMs });
}
