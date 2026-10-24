import { describe, expect, test } from "vitest";
import type { CaseRecord } from "@core/evals/lib/case-record";
import type { ModelCall } from "@core/evals/lib/model-meter";
import { buildReport, calibrate, formatSummary, percentile } from "@core/evals/lib/report";

const call = (over: Partial<ModelCall> = {}): ModelCall =>
  ({ provider: "openai", role: "system", endpoint: "/v1/decisions", model: "gpt-6-luna", inputTokens: 1000, outputTokens: 100, durationMs: 300, status: 200, ...over });

function record(over: Partial<CaseRecord> = {}): CaseRecord {
  return {
    caseId: "int-a", baseId: "int-a", pass: "interpretation", criterion: 1, kind: "trap", tags: [], repeat: 0, passed: true, exactPassed: true,
    fields: { tool: true, outcome: true }, expectationIndex: 0, judge: null, noticeError: null, expectedTool: "add_products", input: "text «x»",
    expected: [], actual: {}, signature: "add_products|added|", certainties: [], latencyMs: 1000, calls: [call()], error: null, ...over,
  };
}

const meta = { runId: "run", startedAt: "2026-10-23T00:00:00.000Z", finishedAt: "2026-10-23T00:10:00.000Z", settings: {} };

describe("buildReport", () => {
  test("accuracy counts only the first run of each case, by pass, criterion, kind, expected tool and tag", () => {
    const report = buildReport([
      record({ caseId: "int-a" }),
      record({ caseId: "int-b", passed: false, kind: "greeting", expectedTool: "no_intent", tags: ["injection"] }),
      record({ caseId: "int-b", passed: true, repeat: 1, tags: ["injection"] }),
      record({ caseId: "txt-a", pass: "text", criterion: 3, expectedTool: "-" }),
    ], meta);

    expect(report.overall).toEqual({ total: 3, passed: 2, accuracy: 0.667 });
    expect(report.byPass).toEqual({ interpretation: { total: 2, passed: 1, accuracy: 0.5 }, text: { total: 1, passed: 1, accuracy: 1 } });
    expect(report.byCriterion["criterion 1"]).toEqual({ total: 2, passed: 1, accuracy: 0.5 });
    expect(report.byKind.greeting).toEqual({ total: 1, passed: 0, accuracy: 0 });
    expect(report.byExpectedTool).toEqual({ add_products: { total: 1, passed: 1, accuracy: 1 }, no_intent: { total: 1, passed: 0, accuracy: 0 } });
    expect(report.byTag.injection).toEqual({ total: 1, passed: 0, accuracy: 0 });
    expect(report.failures.map(({ caseId }) => caseId)).toEqual(["int-b"]);
  });

  test("field accuracy ignores unscored fields", () => {
    const report = buildReport([record({ fields: { tool: null, outcome: true } }), record({ caseId: "int-b", fields: { tool: false, outcome: true } })], meta);

    expect(report.fields).toEqual({ outcome: { total: 2, passed: 2, accuracy: 1 }, tool: { total: 1, passed: 0, accuracy: 0 } });
  });

  test("lists false notices, silent errors and wrong silent changes", () => {
    const report = buildReport([
      record({ caseId: "a", passed: false, noticeError: "false_notice" }),
      record({ caseId: "b", passed: false, noticeError: "silent_error" }),
      record({ caseId: "c", passed: false, noticeError: "wrong_change" }),
    ], meta);

    expect(report.notices).toEqual({ falseNotices: ["a"], silentErrors: ["b"], wrongChanges: ["c"] });
  });

  test("a consistency case flips when its runs leave different results", () => {
    const report = buildReport([
      record({ caseId: "a", tags: ["consistency"], signature: "x" }), record({ caseId: "a", tags: ["consistency"], repeat: 1, signature: "y" }),
      record({ caseId: "b", tags: ["consistency"], signature: "z" }), record({ caseId: "b", tags: ["consistency"], repeat: 1, signature: "z" }),
    ], meta);

    expect(report.consistency).toEqual({ cases: 2, repeats: 2, flipped: [{ caseId: "a", signatures: ["x", "y"] }] });
  });

  test("calibration splits certainties of correct and wrong cases per pass and source", () => {
    const report = buildReport([
      record({ certainties: [{ source: "action", confidence: 0.95 }] }),
      record({ caseId: "b", passed: false, certainties: [{ source: "action", confidence: 0.85 }] }),
      record({ caseId: "c", pass: "image", certainties: [{ source: "visual", confidence: 0.7 }] }),
    ], meta);

    expect(report.calibration.interpretation!.action!.atThreshold).toEqual({ acceptedCorrect: 1, acceptedWrong: 1, rejectedCorrect: 0, rejectedWrong: 0 });
    expect(report.calibration.image!.visual!.atThreshold).toEqual({ acceptedCorrect: 0, acceptedWrong: 0, rejectedCorrect: 1, rejectedWrong: 0 });
  });

  test("injection cases count allowed outcomes and unit price changes", () => {
    const report = buildReport([record({ tags: ["injection"] }), record({ caseId: "b", tags: ["injection"], passed: false, fields: { unitPrice: false } })], meta);

    expect(report.injection).toEqual({ total: 2, allowed: 1, priceChanged: ["b"] });
  });

  test("judge counts verdicts, rescues and disagreements with the exact match", () => {
    const report = buildReport([
      record({ caseId: "a", exactPassed: false, passed: true, judge: { pass: true, score: 0.9, reason: "ok" } }),
      record({ caseId: "b", judge: { pass: true, score: 1, reason: "ok" } }),
    ], meta);

    expect(report.judge).toEqual({ judged: 2, passed: 2, rescued: ["a"], disagreed: ["a"] });
  });

  test("usage sums tokens and estimated cost per model and role, including calls made outside cases", () => {
    const claude = call({ provider: "anthropic", role: "classifier", model: "claude-sonnet-5-5", inputTokens: 10_000, outputTokens: 2000 });
    const report = buildReport([record(), record({ caseId: "b", calls: [call(), call({ model: "mystery-model" })] })], meta, [claude]);

    expect(report.usage.byModel["gpt-6-luna"]).toEqual({ calls: 2, inputTokens: 2000, outputTokens: 200, costUsd: 0.0003 });
    expect(report.usage.byModel["claude-sonnet-5-5"]!.costUsd).toBe(0.04);
    expect(report.usage).toMatchObject({ systemCalls: 3, claudeCalls: 1, unpricedModels: ["mystery-model"], totalCostUsd: 0.0403 });
    expect(report.usage.byRole.classifier!.calls).toBe(1);
  });

  test("latency percentiles per pass and overall", () => {
    const report = buildReport([record({ latencyMs: 100 }), record({ caseId: "b", latencyMs: 300 }), record({ caseId: "c", pass: "text", latencyMs: 50 })], meta);

    expect(report.latencyMs).toEqual({ all: { p50: 100, p95: 300 }, interpretation: { p50: 100, p95: 300 }, text: { p50: 50, p95: 50 } });
  });

  test("the summary names the report path and the model calls", () => {
    const summary = formatSummary(buildReport([record()], meta), "eval-results/run.json");

    expect(summary).toContain("Model calls: 1 by the system under test, 0 to Claude");
    expect(summary).toContain("Report: eval-results/run.json");
  });
});

test("percentile uses the nearest rank", () => {
  expect(percentile([], 0.5)).toBe(0);
  expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
  expect(percentile(Array.from({ length: 20 }, (_, index) => index + 1), 0.95)).toBe(19);
});

test("calibration buckets cover 0 to 1 and count 1.0 in the top bucket", () => {
  const calibration = calibrate([{ confidence: 1, correct: true }, { confidence: 0.79, correct: false }, { confidence: 0.2, correct: true }]);

  expect(calibration.buckets.map(({ range }) => range)).toEqual(["0.0–0.5", "0.5–0.6", "0.6–0.7", "0.7–0.8", "0.8–0.9", "0.9–1.0"]);
  expect(calibration.buckets.at(-1)).toEqual({ range: "0.9–1.0", correct: 1, wrong: 0 });
  expect(calibration.atThreshold).toEqual({ acceptedCorrect: 1, acceptedWrong: 0, rejectedCorrect: 1, rejectedWrong: 1 });
});
