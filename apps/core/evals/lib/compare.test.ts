import { expect, test } from "vitest";
import { messageRecord } from "@core/evals/lib/record-fixture";
import type { CaseRecord, StageFacts } from "@core/evals/lib/case-record";
import { buildReport, type EvalReport } from "@core/evals/lib/report";
import { compareResults, formatComparison, type ResultFile } from "@core/evals/lib/compare";

const meta = { runId: "run", startedAt: "2026-10-31T00:00:00.000Z", finishedAt: "2026-10-31T00:10:00.000Z", settings: {} };
const facts = (over: Partial<StageFacts> = {}): StageFacts => ({ intent: true, fields: null, resolution: null, decision: true, decisionExpected: "applied", decisionActual: "applied",
  requested: true, changeApplied: true, marked: false, point: false, noticed: false, orderMatches: true, changedNotice: false, readingMs: 1000, queuedMs: 0, stageCostsUsd: {}, ...over });

/** One result file with a run per entry of `silentPerRun`: that many silent wrong changes in the run. */
const result = (silentPerRun: readonly number[]): ResultFile => {
  const records: CaseRecord[] = silentPerRun.flatMap((silent, repeat) => Array.from({ length: 6 }, (_, index) =>
    messageRecord({ caseId: `c${index}`, repeat, facts: facts({ orderMatches: index >= silent }) })));
  return { report: buildReport(records, meta), records };
};

test("calls a change better only when its range does not overlap the previous one, in a comparison of two reports", () => {
  const overlapping = compareResults(result([1, 2, 3]), result([0, 2, 4]));
  const apart = compareResults(result([4, 5, 6]), result([0, 1, 1]));

  expect(overlapping.find(({ name }) => name === "silentWrongChanges")).toMatchObject({ verdict: "not distinguishable" });
  expect(apart.find(({ name }) => name === "silentWrongChanges")).toMatchObject({ verdict: "better" });
  expect(formatComparison(overlapping, "a", "b")).toContain("silentWrongChanges");
  expect(formatComparison(overlapping, "a", "b")).toMatch(/silentWrongChanges.*not distinguishable/);
  expect(formatComparison(apart, "a", "b")).toMatch(/silentWrongChanges.*better/);
});

test("compares a report file saved before the runs section by recomputing it from its records", () => {
  const file = result([1, 1, 1]);
  const { runs: _runs, ...legacy } = file.report;

  expect(compareResults({ ...file, report: legacy as unknown as EvalReport }, file).find(({ name }) => name === "silentWrongChanges")).toMatchObject({ verdict: "not distinguishable" });
});
