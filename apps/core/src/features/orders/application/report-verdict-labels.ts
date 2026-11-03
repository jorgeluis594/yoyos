import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ChangeVerdict } from "@core/src/features/orders/domain/message-changes";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type VerdictDecision = "applied" | "doubtful";
export type CountedVerdict = ChangeVerdict;
export type LabelStrength = "strong" | "weak";
/** One group of changes over every company: counts only, never ids or text. `verdict` is null while nobody has judged the change. */
export type VerdictCountRow = Readonly<{ decision: VerdictDecision; doubtKind: string | null; verdict: CountedVerdict | null; count: number }>;
export type ReportVerdictLabelsInput = Readonly<{ since: Date; until: Date }>;
export type VerdictLabelRow = Readonly<{ decision: VerdictDecision; doubtKind: string | null; verdict: CountedVerdict; count: number; strength: LabelStrength | null }>;
export type ReportVerdictLabelsOutput = Readonly<{ rows: readonly VerdictLabelRow[]; unverdicted: number }>;
export type ReportVerdictLabelsDependencies = Readonly<{
  /** Reads through the SECURITY DEFINER aggregate, with its own statement timeout. */
  countVerdicts: (since: Date, until: Date) => Promise<Result<readonly VerdictCountRow[], PersistenceError>>;
}>;
type InvalidInput = Readonly<{ code: "INVALID_INPUT"; message: string }>;

const maxWindowMs = 366 * 24 * 60 * 60 * 1000;

/** Strong: «kept» on a doubtful change, or any correction or undo. Weak: «kept» on an applied change. `not_reviewed` is no label. */
function strengthOf(row: VerdictCountRow & { verdict: CountedVerdict }): LabelStrength | null {
  if (row.verdict === "not_reviewed") return null;
  if (row.verdict === "kept") return row.decision === "doubtful" ? "strong" : "weak";
  return "strong";
}

export async function reportVerdictLabels(
  input: ReportVerdictLabelsInput,
  dependencies: ReportVerdictLabelsDependencies,
): Promise<Result<ReportVerdictLabelsOutput, PersistenceError | InvalidInput>> {
  const span = input.until.getTime() - input.since.getTime();
  if (!(span > 0) || span > maxWindowMs) return err({ code: "INVALID_INPUT", message: "The window must be positive and at most 366 days" });
  const counted = await dependencies.countVerdicts(input.since, input.until);
  if (!counted.success) return counted;
  let unverdicted = 0;
  const rows: VerdictLabelRow[] = [];
  for (const row of counted.data) {
    if (row.verdict === null) { unverdicted += row.count; continue; }
    rows.push({ decision: row.decision, doubtKind: row.doubtKind, verdict: row.verdict, count: row.count, strength: strengthOf({ ...row, verdict: row.verdict }) });
  }
  return ok({ rows, unverdicted });
}
