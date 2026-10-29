import type { CaseRecord } from "@core/evals/lib/case-record";
import type { CaseRun } from "@core/evals/lib/runs";

/** What a suite lets into the vitest-evals report and the test names. A private run (`EVAL_PRIVATE_DIR`) lets in scores only. */

/** One record standing for a whole run of a case in the report: a conversation's messages are summed up. */
export function summaryOf(records: readonly CaseRecord[]): CaseRecord {
  const first = records[0]!;
  return { ...first, passed: records.every(({ passed }) => passed), exactPassed: records.every(({ exactPassed }) => exactPassed),
    fields: Object.fromEntries(records.flatMap(({ fields }) => Object.entries(fields))), error: records.find(({ error }) => error)?.error ?? null,
    signature: records.map(({ signature }) => signature).join(" ; "), input: records.map(({ input }) => input).join(" → "), calls: records.flatMap(({ calls }) => calls) };
}

/** A record with no input, product, judge reason or error text: only scores and counts remain. */
export function redacted(record: CaseRecord): CaseRecord {
  return { ...record, caseId: "", baseId: "", kind: "", tags: [], input: "", expected: null, actual: null, signature: "", certainties: [], noticeProducts: [], previousOrder: [],
    conversationId: null, judge: record.judge ? { ...record.judge, reason: "" } : null, error: record.error ? "error" : null };
}

/** Test names: the case id, or in a private run the case's position («case 3», «case 3 (repeat 1)»), never its id. */
export function labelledRuns<Case extends Readonly<{ id: string; tags: readonly string[] }>>(runs: readonly CaseRun<Case>[], privateRun: boolean): readonly CaseRun<Case>[] {
  if (!privateRun) return runs;
  const order = [...new Set(runs.map(({ testCase }) => testCase.id))];
  return runs.map((run) => ({ ...run, label: `case ${order.indexOf(run.testCase.id) + 1}${run.repeat > 0 ? ` (repeat ${run.repeat})` : ""}` }));
}
