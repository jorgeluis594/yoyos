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
    expected: [], actual: {}, signature: "add_products|added|", certainties: [], trace: { decisions: [], extracted: [], textChoices: [] }, latencyMs: 1000,
    retries: 0, calls: [call()], error: null, ...over,
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

  test("lists false notices, silent errors, wrong silent changes and silent drops", () => {
    const report = buildReport([
      record({ caseId: "a", passed: false, noticeError: "false_notice" }),
      record({ caseId: "b", passed: false, noticeError: "silent_error" }),
      record({ caseId: "c", passed: false, noticeError: "wrong_change" }),
      record({ caseId: "d", passed: false, noticeError: "missed_notice" }),
      record({ caseId: "e", passed: false, noticeError: "dropped_request" }),
    ], meta);

    expect(report.notices).toEqual({ falseNotices: ["a"], silentErrors: ["b"], wrongChanges: ["c"], missedNotices: ["d"], droppedRequests: ["e"], wrongNotices: [] });
    expect(formatSummary(report, "run.json")).toContain("1 missed notices (no notice where one was due), 1 dropped requests");
  });

  test("known limitations are listed apart and left out of every score", () => {
    const report = buildReport([record(), record({ caseId: "txt-calcetines", pass: "text", passed: false, tags: ["known-limitation"], signature: "not_found" })], meta);

    expect(report.overall).toEqual({ total: 1, passed: 1, accuracy: 1 });
    expect(report.byPass.text).toBeUndefined();
    expect(report.knownLimitations).toEqual([{ caseId: "txt-calcetines", passed: false, signature: "not_found" }]);
    expect(report.failures).toEqual([]);
  });

  test("retried attempts are counted apart from latency", () => {
    expect(buildReport([record({ retries: 2 }), record({ caseId: "b" })], meta).retries).toEqual({ messages: 1, attempts: 2 });
  });

  test("a consistency case flips when its runs leave different results", () => {
    const report = buildReport([
      record({ caseId: "a", tags: ["consistency"], signature: "x" }), record({ caseId: "a", tags: ["consistency"], repeat: 1, signature: "y" }),
      record({ caseId: "b", tags: ["consistency"], signature: "z" }), record({ caseId: "b", tags: ["consistency"], repeat: 1, signature: "z" }),
    ], meta);

    expect(report.consistency).toEqual({ cases: 2, repeats: 2, flipped: [{ caseId: "a", signatures: ["x", "y"] }] });
  });

  test("calibration grades the model's own pick at each production gate, not what the gate decided", () => {
    const add = [{ tools: ["add_products"], outcomes: ["added"], order: [{ product: "polo-basico", variant: { Talla: "M", Color: "Negro" }, quantity: 2, mentionedPrice: null }] }];
    const report = buildReport([
      // Under the gate the Decision still chose the right tool: a right pick rejected, though the case fails on tool.
      record({ caseId: "a", passed: false, fields: { tool: false }, expected: add, certainties: [{ source: "action", confidence: 0.5, gate: 0.6, pick: "add_products" }] }),
      record({ caseId: "b", passed: false, expected: add, certainties: [{ source: "action", confidence: 0.4, gate: 0.6, pick: "no_intent" }] }),
      // Above the gate a right text pick stays right when the case fails later, on quantity.
      record({ caseId: "c", passed: false, fields: { tool: true, quantity: false }, expected: add,
        certainties: [{ source: "action", confidence: 0.9, gate: 0.6, pick: "add_products" }, { source: "text", confidence: 1, gate: 0.8, pick: "polo-basico" },
          { source: "variant", confidence: 0.9, gate: 0.8, pick: "M Negro" }] }),
      record({ caseId: "d", pass: "image", expected: [{ kind: "found", product: "polo-rayas" }], certainties: [{ source: "visual", confidence: 0.7, gate: 0.8, pick: "polo-rayas" }] }),
      record({ caseId: "e", pass: "image", expected: [{ kind: "not_product" }], certainties: [{ source: "visual", confidence: 0.83, gate: 0.8, pick: "chompa-tejida" }] }),
      // Older records kept no visual pick: ungraded.
      record({ caseId: "f", pass: "image", expected: [{ kind: "found", product: "polo-rayas" }], certainties: [{ source: "visual", confidence: 0.77, gate: 0.8 }] }),
    ], meta);

    expect(report.calibration.interpretation!.action!.atGate).toEqual({ gate: 0.6, acceptedCorrect: 1, acceptedWrong: 0, rejectedCorrect: 1, rejectedWrong: 1, unverified: 0 });
    expect(report.calibration.interpretation!.text!.atGate).toMatchObject({ acceptedCorrect: 1, acceptedWrong: 0 });
    expect(report.calibration.interpretation!.variant!.atGate).toMatchObject({ acceptedCorrect: 1 });
    expect(report.calibration.image!.visual!.atGate).toEqual({ gate: 0.8, acceptedCorrect: 0, acceptedWrong: 1, rejectedCorrect: 1, rejectedWrong: 0, unverified: 1 });
    expect(report.gates).toEqual({ action: 0.6, text: 0.8, variant: 0.8, visual: 0.8 });
  });

  test("item choices are shown as buckets only, ungraded", () => {
    const report = buildReport([record({ certainties: [{ source: "item", confidence: 0.7, gate: 0.8, detail: "remove_item:item=I1" }] })], meta);

    expect(report.calibration.interpretation!.item!.atGate).toMatchObject({ acceptedCorrect: 0, rejectedWrong: 0, unverified: 1 });
  });

  test("the end-to-end pass is also split into photo and text messages", () => {
    const report = buildReport([record({ pass: "end_to_end", input: "photo customer/x.jpg caption «2»" }), record({ caseId: "b", pass: "end_to_end", passed: false, input: "text «quiero»" })], meta);

    expect(report.endToEnd).toEqual({ photo: { total: 1, passed: 1, accuracy: 1 }, text: { total: 1, passed: 0, accuracy: 0 } });
  });

  test("the image view splits the near-identical polos and lists negatives accepted at the gate", () => {
    const pair = (caseId: string, signature: string) => record({ caseId, pass: "image", tags: ["indistinguishable-pair"], signature,
      expected: [{ kind: "found", product: "polo-basico" }, { kind: "not_found" }] });
    const report = buildReport([
      pair("a", "found:polo-basico"), pair("b", "not_found"), pair("c", "found:polo-premium"), pair("d", "not_product"),
      record({ caseId: "neg", pass: "image", kind: "polo-v-rojo", passed: false, tags: ["folder:negative"], signature: "found:polo-basico", expected: [{ kind: "not_found" }],
        certainties: [{ source: "visual", confidence: 0.86, gate: 0.8 }] }),
      record({ caseId: "lab", pass: "image", kind: "printed_qr_label", tags: ["folder:label"], expected: [{ kind: "found", product: "polo-basico", color: "Negro" }] }),
    ], meta);

    expect(report.image.indistinguishablePair).toEqual({ total: 4, exact: ["a"], notIdentified: ["b"], otherPolo: ["c"], other: ["d"], otherPoloPicks: [] });
    expect(report.image.negativesAboveGate).toEqual([{ caseId: "neg", confidence: 0.86, signature: "found:polo-basico" }]);
    expect(report.image.labels).toEqual({ total: 1, passed: 1, accuracy: 1 });
    expect(report.image.byScenario["polo-v-rojo"]).toEqual({ total: 1, passed: 0, accuracy: 0 });
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
  const calibration = calibrate([{ confidence: 1, correct: true, gate: 0.8 }, { confidence: 0.79, correct: false, gate: 0.8 }, { confidence: 0.2, correct: true, gate: 0.8 },
    { confidence: 0.5, correct: null, gate: 0.8 }]);

  expect(calibration.buckets.map(({ range }) => range)).toEqual(["0.0–0.3", "0.3–0.4", "0.4–0.5", "0.5–0.6", "0.6–0.7", "0.7–0.8", "0.8–0.9", "0.9–1.0"]);
  expect(calibration.buckets.at(-1)).toEqual({ range: "0.9–1.0", correct: 1, wrong: 0, unverified: 0 });
  expect(calibration.atGate).toEqual({ gate: 0.8, acceptedCorrect: 1, acceptedWrong: 0, rejectedCorrect: 1, rejectedWrong: 1, unverified: 1 });
});
