import { z } from "zod";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import type { ReportVerdictLabelsInput, ReportVerdictLabelsOutput } from "@core/src/features/orders/application/report-verdict-labels";
import { readerNameOf, type TraceReader } from "@core/src/features/orders/presentation/trace-reader-token";

const argumentsSchema = z.strictObject({ since: z.iso.date(), until: z.iso.date() });

export type VerdictsCommand = Readonly<{
  args: readonly string[];
  readers: readonly TraceReader[];
  /** Asked for only after the arguments are valid; the token never comes from argv or env. */
  token: () => Promise<string | null>;
  report: (input: ReportVerdictLabelsInput) => Promise<Result<ReportVerdictLabelsOutput, Readonly<{ code?: string; message: string }>>>;
  print: (text: string) => void;
  fail: (text: string) => void;
}>;

function parseArguments(args: readonly string[]): ReportVerdictLabelsInput | null {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag?.startsWith("--") || args[index + 1] === undefined) return null;
    values[flag.slice(2)] = args[index + 1]!;
  }
  const parsed = argumentsSchema.safeParse(values);
  return parsed.success ? { since: new Date(`${parsed.data.since}T00:00:00Z`), until: new Date(`${parsed.data.until}T00:00:00Z`) } : null;
}

/** Exit codes: 0 reported, 1 refused or failed (nothing printed), 2 bad usage. The report holds counts only, so the read is logged but not audited. */
export async function runVerdictsReport(command: VerdictsCommand): Promise<number> {
  const window = parseArguments(command.args);
  if (!window) { command.fail("Usage: verdicts:report --since <YYYY-MM-DD> --until <YYYY-MM-DD> (until is exclusive, at most 366 days); the token comes from standard input"); return 2; }
  const token = await command.token();
  const readerName = token === null ? null : readerNameOf(command.readers, token);
  if (readerName === null) {
    log.warn({ event: "verdict_report_refused", reason: token === null ? "missing_token" : "unknown_token" }, "Verdict report refused");
    command.fail(token === null ? "A reader token is required on standard input" : "Unknown reader token");
    return 1;
  }
  const result = await command.report(window);
  if (!result.success) { command.fail(`Unable to report the verdicts: ${result.error.code ?? "UNKNOWN"}`); return 1; }
  log.info({ event: "verdict_report_read", readerName, since: window.since, until: window.until }, "Verdict labels reported");
  command.print(`${JSON.stringify(result.data, null, 2)}\n`);
  return 0;
}
