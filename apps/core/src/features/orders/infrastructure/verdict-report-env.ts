import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;
const settingsSchema = z.object({ VERDICT_REPORT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000) });

/** The report's own statement timeout; invalid values fail at startup and empty ones count as unset. */
export function readVerdictReportTimeoutMs(env: Env): number {
  return settingsSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""))).VERDICT_REPORT_TIMEOUT_MS;
}
