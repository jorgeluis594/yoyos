import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;
export type MessageTraceSettings = Readonly<{ retentionDays: number; deleteBatch: number }>;

const settingsSchema = z.object({
  MESSAGE_TRACE_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  MESSAGE_TRACE_DELETE_BATCH: z.coerce.number().int().min(1).default(500),
});

/** Invalid values fail at startup; empty values count as unset. */
export function readMessageTraceSettings(env: Env): MessageTraceSettings {
  const config = settingsSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  return { retentionDays: config.MESSAGE_TRACE_RETENTION_DAYS, deleteBatch: config.MESSAGE_TRACE_DELETE_BATCH };
}
