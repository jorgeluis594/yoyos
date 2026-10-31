import { describe, expect, test } from "vitest";
import type { CaseRecord, StageFacts } from "@core/evals/lib/case-record";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { aggregateRuns, compareMetric, decisionLatencyMs, ignoredRequestOf, metricsOfRun, silentWrongChangeOf } from "@core/evals/lib/metrics";

const facts = (over: Partial<StageFacts> = {}): StageFacts => ({
  intent: true, fields: true, resolution: true, decision: true, decisionExpected: "applied", decisionActual: "applied", requested: true, changeApplied: true, marked: false,
  point: false, noticed: false, orderMatches: true, changedNotice: false, readingMs: 1000, queuedMs: 0, stageCostsUsd: {}, ...over,
});
const record = (over: Partial<StageFacts> = {}, rest: Partial<CaseRecord> = {}) => messageRecord({ facts: facts(over), ...rest });

describe("metrics of one run", () => {
  test("counts a silent wrong change as an applied change without mark or notice that differs from the expected order", () => {
    expect(silentWrongChangeOf(facts({ orderMatches: false }))).toBe(true);
    expect(silentWrongChangeOf(facts({ orderMatches: false, marked: true }))).toBe(false);
    expect(silentWrongChangeOf(facts({ orderMatches: false, noticed: true }))).toBe(false);
    expect(silentWrongChangeOf(facts({ orderMatches: true }))).toBe(false);
    expect(silentWrongChangeOf(facts({ changeApplied: false, orderMatches: false }))).toBe(false);
    expect(metricsOfRun([record({ orderMatches: false }), record(), record({ orderMatches: false, marked: true })]).silentWrongChanges).toBe(1);
  });

  test("counts an ignored request as a request with no change, mark, point or notice", () => {
    const nothing = { changeApplied: false, marked: false, point: false, noticed: false };
    expect(ignoredRequestOf(facts(nothing))).toBe(true);
    for (const [name, value] of Object.entries({ changeApplied: true, marked: true, point: true, noticed: true })) expect(ignoredRequestOf(facts({ ...nothing, [name]: value })), name).toBe(false);
    expect(ignoredRequestOf(facts({ ...nothing, requested: false }))).toBe(false);
    expect(metricsOfRun([record(nothing), record(nothing, { caseId: "b" }), record()]).ignoredRequests).toBe(2);
  });

  test("computes urgent precision and recall and counts «Pedido #N cambió» apart", () => {
    const run = metricsOfRun([
      record({ decisionExpected: "urgent", decisionActual: "urgent" }),
      record({ decisionExpected: "urgent", decisionActual: "applied" }),
      record({ decisionExpected: "applied", decisionActual: "urgent" }),
      record({ decisionExpected: "applied", decisionActual: "applied", changedNotice: true }),
      record({ decisionExpected: "applied", decisionActual: "applied" }),
    ]);

    expect(run.urgentShare).toBeCloseTo(2 / 5);
    expect(run.urgentPrecision).toBeCloseTo(1 / 2);
    expect(run.urgentRecall).toBeCloseTo(1 / 2);
    expect(run.changedNotices).toBe(1);
    expect(metricsOfRun([record()]).urgentPrecision).toBeNull();
    expect(metricsOfRun([record()]).urgentRecall).toBeNull();
  });

  test("computes p95 from reading start to decision without queue wait", () => {
    const at = (second: number) => new Date(Date.UTC(2026, 9, 31, 12, 0, second));
    expect(decisionLatencyMs({ enqueuedAt: at(0), readingStartedAt: at(30), decidedAt: at(34) })).toBe(4000);
    const readings = Array.from({ length: 20 }, (_, index) => (index + 1) * 100);
    const run = metricsOfRun(readings.map((readingMs) => record({ readingMs, queuedMs: 60_000 })));

    expect(run.p95DecisionMs).toBe(1900);
  });

  test("reports cost per stage and counts photo stages toward the average", () => {
    const run = metricsOfRun([
      record({ stageCostsUsd: { intent: 0.0003, extraction: 0.0004, confirming_extraction: 0.0001, resolution: 0.0003 } }),
      record({ stageCostsUsd: { intent: 0.0003, extraction: 0.0004, resolution: 0.0003, photo_qr: 0.0002, photo_visual: 0.0008 } }),
    ]);

    expect(run.costIntentUsd).toBeCloseTo(0.0003);
    expect(run.costExtractionUsd).toBeCloseTo(0.00045);
    expect(run.costResolutionUsd).toBeCloseTo(0.0003);
    expect(run.costPhotoUsd).toBeCloseTo(0.0005);
    expect(run.costPerMessageUsd).toBeCloseTo((0.0011 + 0.002) / 2);
  });

  test("scores intent, fields, resolution and decision over the messages that state them", () => {
    const run = metricsOfRun([record(), record({ intent: false, decision: false }), record({ fields: null, resolution: null })]);

    expect(run.intentAccuracy).toBeCloseTo(2 / 3);
    expect(run.fieldsAccuracy).toBe(1);
    expect(run.resolutionAccuracy).toBe(1);
    expect(run.decisionAccuracy).toBeCloseTo(2 / 3);
  });

  test("leaves records without stage facts out of the stage metrics, and keeps the older flags for the gates", () => {
    const run = metricsOfRun([messageRecord({ wrongSilentChange: true, ignoredActions: 2 }), record()]);

    expect(run.silentWrongChanges).toBe(1);
    expect(run.ignoredRequests).toBe(1);
    expect(run.intentAccuracy).toBe(1);
  });
});

describe("runs", () => {
  test("aggregates EVAL_REPEATS runs into mean and range per metric", () => {
    const runs = [1, 3, 2].map((count) => metricsOfRun(Array.from({ length: count }, () => record({ orderMatches: false }))));
    const aggregate = aggregateRuns(runs);

    expect(aggregate.silentWrongChanges).toEqual({ mean: 2, min: 1, max: 3, runs: 3 });
    expect(aggregate.intentAccuracy).toEqual({ mean: 1, min: 1, max: 1, runs: 3 });
    expect(aggregate.urgentPrecision).toBeNull();
    expect(aggregateRuns([]).silentWrongChanges).toBeNull();
  });

  test("calls a change better only when its range does not overlap the previous one", () => {
    const range = (min: number, max: number) => ({ mean: (min + max) / 2, min, max, runs: 3 });

    expect(compareMetric("silentWrongChanges", range(4, 6), range(0, 2))).toBe("better");
    expect(compareMetric("silentWrongChanges", range(0, 2), range(4, 6))).toBe("worse");
    expect(compareMetric("silentWrongChanges", range(2, 5), range(0, 3))).toBe("not distinguishable");
    expect(compareMetric("silentWrongChanges", range(2, 2), range(2, 2))).toBe("not distinguishable");
    expect(compareMetric("decisionAccuracy", range(0.5, 0.6), range(0.8, 0.9))).toBe("better");
    expect(compareMetric("decisionAccuracy", range(0.8, 0.9), range(0.5, 0.6))).toBe("worse");
    expect(compareMetric("changedNotices", range(1, 1), range(2, 2))).toBe("different");
    expect(compareMetric("silentWrongChanges", null, range(0, 1))).toBe("not measured");
  });
});
