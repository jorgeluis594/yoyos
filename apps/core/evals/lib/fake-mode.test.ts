import { expect, test } from "vitest";
import { allCases, selectCases } from "@core/evals/cases";
import { metricNames } from "@core/evals/lib/metrics";
import { buildReport, formatGateSummary } from "@core/evals/lib/report";
import { runFakeHarness } from "@core/evals/lib/fake-mode";
import { modelSuitesBlocker, readEvalEnv } from "@core/evals/lib/eval-env";

const meta = { runId: "fake", startedAt: "2026-10-31T00:00:00.000Z", finishedAt: "2026-10-31T00:01:00.000Z", settings: {} };

test("runs the whole harness in fake mode with zero model calls", () => {
  const cases = selectCases(allCases, { skipParaphrases: true });
  const { records } = runFakeHarness(cases, 3);
  const report = buildReport(records, meta);

  expect(records.flatMap(({ calls }) => calls)).toEqual([]);
  expect(report.usage.systemCalls + report.usage.claudeCalls).toBe(0);
  expect(report.runs.count).toBe(3);
  // Every case of every pass ran in each of the 3 runs, and the scripted answers equal the expectations.
  expect(new Set(records.map(({ repeat }) => repeat))).toEqual(new Set([0, 1, 2]));
  expect(records.filter(({ repeat }) => repeat === 0)).toHaveLength(cases.reduce((total, testCase) => total + (testCase.pass === "conversation" ? testCase.steps.filter((step) => !("event" in step)).length : 1), 0));
  expect(report.overall.accuracy).toBe(1);
  for (const name of metricNames) {
    const range = report.runs.metrics[name];
    expect(range, name).not.toBeNull();
    expect(range!.runs).toBe(3);
    expect(range!.min).toBeLessThanOrEqual(range!.mean);
    expect(range!.mean).toBeLessThanOrEqual(range!.max);
  }
  expect(report.runs.metrics.silentWrongChanges).toEqual({ mean: 0, min: 0, max: 0, runs: 3 });
  expect(report.runs.metrics.ignoredRequests).toEqual({ mean: 0, min: 0, max: 0, runs: 3 });
  expect(report.runs.metrics.urgentPrecision!.mean).toBe(1);
  expect(report.runs.metrics.urgentRecall!.mean).toBe(1);
  expect(report.runs.metrics.costPhotoUsd!.mean).toBeGreaterThan(0);
  expect(formatGateSummary(report)).toContain("Metrics over 3 runs");
});

test("fake mode needs no provider key and a real run needs EVAL_PAID", () => {
  const keys = { OPENAI_API_KEY: "k", CLAUDE_API_KEY: "k" };
  expect(modelSuitesBlocker(readEvalEnv({ EVAL_MODELS: "fake" }))).toBeNull();
  expect(modelSuitesBlocker(readEvalEnv(keys))).toContain("EVAL_PAID=1");
  expect(modelSuitesBlocker(readEvalEnv({ ...keys, EVAL_PAID: "1" }))).toBeNull();
  expect(modelSuitesBlocker(readEvalEnv({ EVAL_PAID: "1" }))).toContain("OPENAI_API_KEY");
  expect(modelSuitesBlocker(readEvalEnv({ EVAL_MODELS: "fake", CI: "1" }))).toBeNull();
});

const suites = ["interpretation", "end_to_end", "conversation", "image"] as const;
/** Fields and product are stated by the cases of the seed-bank families only, so a suite may measure neither. */
const alwaysMeasured = metricNames.filter((name) => name !== "fieldsAccuracy" && name !== "resolutionAccuracy" && name !== "urgentPrecision" && name !== "urgentRecall" && name !== "costPhotoUsd");

test.each(suites)("a fake-mode run of the %s suite reports its stage metrics with zero model calls", (pass) => {
  const cases = selectCases(allCases, { skipParaphrases: true }).filter((testCase) => testCase.pass === pass);
  const { records } = runFakeHarness(cases, 2, "staged");
  const report = buildReport(records, meta);

  expect(cases.length).toBeGreaterThan(0);
  expect(records.flatMap(({ calls }) => calls)).toEqual([]);
  expect(report.usage.systemCalls + report.usage.claudeCalls).toBe(0);
  expect(report.overall.accuracy).toBe(1);
  // The image pass has no reader: it carries no stage facts and no stage metric.
  for (const name of pass === "image" ? [] : alwaysMeasured) expect(report.runs.metrics[name], `${pass} ${name}`).not.toBeNull();
  expect(records.every((record) => (record.facts !== undefined) === (pass !== "image"))).toBe(true);
});

test("the staged fake run scripts the three stages and the legacy one a single call", () => {
  const cases = selectCases(allCases, { skipParaphrases: true }).filter((testCase) => testCase.pass === "interpretation");
  const staged = runFakeHarness(cases, 1, "staged").records;
  const legacy = runFakeHarness(cases, 1, "legacy").records;

  expect(Object.keys(staged[0]!.facts!.stageCostsUsd)).toEqual(expect.arrayContaining(["intent", "extraction", "resolution"]));
  expect(legacy.length).toBeGreaterThan(0);
  expect(legacy.length).toBeLessThan(staged.length);
  for (const record of legacy) {
    expect(Object.keys(record.facts!.stageCostsUsd)).toEqual(["legacy"]);
    expect(record.facts).toMatchObject({ decision: null, fields: null, resolution: null });
  }
  const report = buildReport(legacy, meta);
  expect(report.runs.metrics.costPerMessageUsd!.mean).toBeCloseTo(0.0011);
  expect(report.runs.metrics.urgentRecall).toBeNull();
  expect(report.runs.metrics.intentAccuracy!.mean).toBe(1);
  expect(report.runs.metrics.p95DecisionMs).not.toBeNull();
});

test("the gate summary names the reader the run used", () => {
  const records = runFakeHarness(selectCases(allCases, { skipParaphrases: true }).slice(0, 5), 1, "legacy").records;
  expect(formatGateSummary(buildReport(records, { ...meta, settings: { reader: "legacy" } }))).toContain("Metrics over 1 run (mean and range), legacy reader");
});
