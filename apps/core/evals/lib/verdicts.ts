import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The output of `verdicts:report` (technical design 5.10) as the eval report embeds it: counts by decision, doubt kind and verdict with the
 * label strength, and no ids or texts. Weak labels («kept» on an applied change) are kept apart from the strong ones.
 */
const verdictRow = z.strictObject({
  decision: z.string().min(1),
  doubtKind: z.string().min(1).nullable(),
  verdict: z.string().min(1),
  strength: z.enum(["strong", "weak"]).nullable(),
  count: z.number().int().min(0),
});
export const verdictFileSchema = z.strictObject({ rows: z.array(verdictRow), unverdicted: z.number().int().min(0) });
export type VerdictFile = z.output<typeof verdictFileSchema>;

export type VerdictSummary = Readonly<{
  strong: Readonly<{ total: number; byDecision: Readonly<Record<string, number>> }>;
  weak: Readonly<{ total: number; byDecision: Readonly<Record<string, number>> }>;
  /** Rows with no label strength: changes seen by the seller and not judged (`not_reviewed`). */
  unlabelled: number;
  unverdicted: number;
}>;

export const parseVerdictFile = (input: unknown): VerdictFile => verdictFileSchema.parse(input);
export const readVerdictFile = (path: string): VerdictFile => parseVerdictFile(JSON.parse(readFileSync(path, "utf8")));

export function summarizeVerdicts(file: VerdictFile): VerdictSummary {
  const part = (strength: "strong" | "weak") => {
    const rows = file.rows.filter((row) => row.strength === strength);
    const byDecision: Record<string, number> = {};
    for (const row of rows) byDecision[row.decision] = (byDecision[row.decision] ?? 0) + row.count;
    return { total: rows.reduce((sum, row) => sum + row.count, 0), byDecision: Object.fromEntries(Object.entries(byDecision).sort(([a], [b]) => a.localeCompare(b))) };
  };
  return { strong: part("strong"), weak: part("weak"), unlabelled: file.rows.filter((row) => row.strength === null).reduce((sum, row) => sum + row.count, 0), unverdicted: file.unverdicted };
}

export const verdictLine = (summary: VerdictSummary): string => {
  const split = (counts: Readonly<Record<string, number>>) => Object.entries(counts).map(([decision, count]) => `${decision} ${count}`).join(", ");
  return `Seller verdict labels: ${summary.strong.total} strong (${split(summary.strong.byDecision)}), ${summary.weak.total} weak apart (${split(summary.weak.byDecision)}), `
    + `${summary.unlabelled} not reviewed, ${summary.unverdicted} without verdict`;
};
