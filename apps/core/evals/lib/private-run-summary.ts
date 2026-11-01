import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseRecord } from "@core/evals/lib/case-record";

/**
 * What a private run (`EVAL_PRIVATE_DIR`) leaves apart from the aggregate lines: the ids of the cases that failed and the type of each failure.
 * No input, product, order, judge reason or error text. The file stays under `<dir>/runs/`.
 */

export type FailureType = "error" | "ignored_action" | "wrong_silent_change" | "extra_notice" | "wrong_intent" | "wrong_fields" | "wrong_resolution" | "wrong_decision" | "wrong_result";
export type PrivateRunSummary = Readonly<{ runs: number; failures: readonly Readonly<{ id: string; failedRuns: number; types: readonly FailureType[] }>[] }>;

/** The failure types of one record, in a fixed order; a record that failed with none of the specific signs is a `wrong_result`. */
export function failureTypesOf(record: CaseRecord): readonly FailureType[] {
  if (record.passed) return [];
  const types: FailureType[] = [
    ...(record.error ? ["error" as const] : []),
    ...(record.ignoredActions > 0 ? ["ignored_action" as const] : []),
    ...(record.wrongSilentChange ? ["wrong_silent_change" as const] : []),
    ...(record.extraNotice ? ["extra_notice" as const] : []),
    ...(record.facts?.intent === false ? ["wrong_intent" as const] : []),
    ...(record.facts?.fields === false ? ["wrong_fields" as const] : []),
    ...(record.facts?.resolution === false ? ["wrong_resolution" as const] : []),
    ...(record.facts?.decision === false ? ["wrong_decision" as const] : []),
  ];
  return types.length ? types : ["wrong_result"];
}

export function privateRunSummary(records: readonly CaseRecord[]): PrivateRunSummary {
  const failures = new Map<string, { failedRuns: number; types: Set<FailureType> }>();
  for (const record of records) {
    const types = failureTypesOf(record);
    if (!types.length) continue;
    const entry = failures.get(record.caseId) ?? { failedRuns: 0, types: new Set<FailureType>() };
    entry.failedRuns += 1;
    for (const type of types) entry.types.add(type);
    failures.set(record.caseId, entry);
  }
  return { runs: new Set(records.map(({ repeat }) => repeat)).size,
    failures: [...failures.entries()].map(([id, { failedRuns, types }]) => ({ id, failedRuns, types: [...types] })) };
}

/** Writes `<dir>/runs/<runId>.summary.json` and returns its path. */
export function writePrivateRunSummary(privateDir: string, runId: string, records: readonly CaseRecord[]): string {
  const dir = join(privateDir, "runs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${runId}.summary.json`);
  writeFileSync(path, `${JSON.stringify(privateRunSummary(records), null, 2)}\n`);
  return path;
}
