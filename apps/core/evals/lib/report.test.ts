import { describe, expect, test } from "vitest";
import type { CaseRecord } from "@core/evals/lib/case-record";
import { messageRecord } from "@core/evals/lib/record-fixture";
import type { ModelCall } from "@core/evals/lib/model-meter";
import { buildReport, calibrate, formatSummary, percentile } from "@core/evals/lib/report";

const call = (over: Partial<ModelCall> = {}): ModelCall =>
  ({ provider: "openai", role: "system", endpoint: "/v1/responses", model: "gpt-6-luna", inputTokens: 1000, outputTokens: 100, durationMs: 300, status: 200, ...over });

function record(over: Partial<CaseRecord> = {}): CaseRecord {
  return messageRecord({ passed: true, exactPassed: true, fields: { notice: true, outcome: true }, signature: "added", latencyMs: 1000, calls: [call()], ...over });
}

const meta = { runId: "run", startedAt: "2026-10-23T00:00:00.000Z", finishedAt: "2026-10-23T00:10:00.000Z", settings: {} };

describe("buildReport", () => {
  test("accuracy counts only the first run of each case, by pass, criterion, kind and tag", () => {
    const report = buildReport([
      record({ caseId: "int-a" }),
      record({ caseId: "int-b", passed: false, kind: "greeting", tags: ["injection"] }),
      record({ caseId: "int-b", passed: true, repeat: 1, tags: ["injection"] }),
      record({ caseId: "img-a", pass: "image", criterion: 5 }),
    ], meta);

    expect(report.overall).toEqual({ total: 3, passed: 2, accuracy: 0.667 });
    expect(report.byPass).toEqual({ image: { total: 1, passed: 1, accuracy: 1 }, interpretation: { total: 2, passed: 1, accuracy: 0.5 } });
    expect(report.byCriterion["criterion 1"]).toEqual({ total: 2, passed: 1, accuracy: 0.5 });
    expect(report.byKind.greeting).toEqual({ total: 1, passed: 0, accuracy: 0 });
    expect(report.byTag.injection).toEqual({ total: 1, passed: 0, accuracy: 0 });
    expect(report.failures.map(({ caseId }) => caseId)).toEqual(["int-b"]);
  });

  test("field accuracy ignores unscored fields", () => {
    const report = buildReport([record({ fields: { notice: null, outcome: true } }), record({ caseId: "int-b", fields: { notice: false, outcome: true } })], meta);

    expect(report.fields).toEqual({ notice: { total: 1, passed: 0, accuracy: 0 }, outcome: { total: 2, passed: 2, accuracy: 1 } });
  });

  test("the gate counts right messages, ignored actions, wrong silent changes and extra notices, whole and per family", () => {
    const report = buildReport([
      record({ caseId: "a", kind: "remove", expectedSilent: true }),
      record({ caseId: "b", kind: "remove", passed: false, ignoredActions: 2, expectedSilent: true }),
      record({ caseId: "c", kind: "ready", passed: false, wrongSilentChange: true }),
      record({ caseId: "d", kind: "ready", passed: false, extraNotice: true, expectedSilent: true }),
      record({ caseId: "e", kind: "ready", passed: false, ignoredActions: 1, expectedSilent: false, repeat: 1 }),
      record({ caseId: "img", pass: "image", criterion: 5 }),
    ], meta);

    expect(report.gate.whole).toEqual({ scored: 4, right: 1, rightPercent: 25, ignoredActions: 2, twoNoticeConversations: 0, wrongSilentChanges: 1,
      expectedSilent: 3, extraNotices: 1, extraNoticePercent: 33.3 });
    expect(report.gate.byFamily.remove).toMatchObject({ scored: 2, right: 1, rightPercent: 50, ignoredActions: 2, extraNotices: 0 });
    expect(report.gate.byFamily.ready).toMatchObject({ scored: 2, right: 0, wrongSilentChanges: 1, extraNotices: 1, extraNoticePercent: 100 });
  });

  test("reports extra notices as a share of the messages expected silent", () => {
    const report = buildReport([
      ...Array.from({ length: 9 }, (_, index) => record({ caseId: `s${index}`, expectedSilent: true })),
      record({ caseId: "x", expectedSilent: true, passed: false, extraNotice: true }),
      record({ caseId: "loud", expectedSilent: false }),
    ], meta);

    expect(report.gate.whole).toMatchObject({ expectedSilent: 10, extraNotices: 1, extraNoticePercent: 10 });
    expect(formatSummary(report, "run.json")).toContain("extra notices 1 of 10 messages expected silent (10.0%)");
  });

  test("counts conversations with two notices for one product unless a step expects the repeat", () => {
    const step = (conversationId: string, number: number, noticeProducts: string[], over: Partial<CaseRecord> = {}) =>
      record({ caseId: `${conversationId}#${number}`, baseId: conversationId, pass: "conversation", criterion: 0, kind: "photo-size", conversationId, step: number, noticeProducts, ...over });
    const report = buildReport([
      step("c1", 1, ["gorra"]), step("c1", 2, ["gorra"]),
      step("c2", 1, ["gorra"]), step("c2", 2, ["gorra"], { expectsRepeatNotice: true }),
      step("c3", 1, ["gorra"]), step("c3", 2, ["polo"]),
    ], meta);

    expect(report.gate.whole.twoNoticeConversations).toBe(1);
    expect(report.gate.byFamily["photo-size"]!.twoNoticeConversations).toBe(1);
    expect(report.byCriterion).toEqual({});
  });

  test("scores the first repetition and reports flips apart", () => {
    const report = buildReport([
      record({ caseId: "a", tags: ["consistency"], signature: "x" }),
      record({ caseId: "a", tags: ["consistency"], repeat: 1, signature: "y", passed: false, ignoredActions: 3 }),
      record({ caseId: "b", tags: ["pinned-miss"], ignoredActions: 0 }),
      record({ caseId: "b", tags: ["pinned-miss"], repeat: 1, ignoredActions: 1, passed: false, signature: "z" }),
    ], meta);

    expect(report.gate.whole).toMatchObject({ scored: 2, right: 2, ignoredActions: 0 });
    expect(report.consistency.flipped).toEqual([{ caseId: "a", signatures: ["x", "y"] }, { caseId: "b", signatures: ["added", "z"] }]);
    expect(report.pinnedMiss).toEqual([{ caseId: "b", repeats: [{ repeat: 0, ignoredActions: 0 }, { repeat: 1, ignoredActions: 1 }], ignoredInAnyRepeat: true }]);
  });

  test("the gate is reported whole, without photo cases and for photo cases", () => {
    const report = buildReport([
      record({ caseId: "t1" }),
      record({ caseId: "t2", passed: false, ignoredActions: 1 }),
      record({ caseId: "p1", photoCase: true, messageKind: "photo", passed: false, wrongSilentChange: true }),
      record({ caseId: "c#1", photoCase: true, conversationId: "c", step: 1 }),
      record({ caseId: "c#2", photoCase: true, conversationId: "c", step: 2, passed: false, ignoredActions: 2 }),
    ], meta);

    expect(report.gate.whole).toMatchObject({ scored: 5, right: 2, ignoredActions: 3, wrongSilentChanges: 1 });
    expect(report.gate.withoutPhoto).toMatchObject({ scored: 2, right: 1, rightPercent: 50, ignoredActions: 1, wrongSilentChanges: 0 });
    expect(report.gate.photo).toMatchObject({ scored: 3, right: 1, ignoredActions: 2, wrongSilentChanges: 1 });
  });

  test("the report partitions a conversation's records, all marked as photo case, together", () => {
    const report = buildReport([
      record({ caseId: "c#1", photoCase: true, conversationId: "c", step: 1, messageKind: "text" }),
      record({ caseId: "c#2", photoCase: true, conversationId: "c", step: 2, messageKind: "text" }),
      record({ caseId: "d#1", conversationId: "d", step: 1 }),
    ], meta);

    expect(report.gate.photo.scored).toBe(2);
    expect(report.gate.withoutPhoto.scored).toBe(1);
  });

  test("consistency counts the repeated cases whose repetitions share one signature, whole and per family", () => {
    const report = buildReport([
      record({ caseId: "a", kind: "x", signature: "s1" }), record({ caseId: "a", kind: "x", repeat: 1, signature: "s1" }), record({ caseId: "a", kind: "x", repeat: 2, signature: "s1" }),
      record({ caseId: "b", kind: "x", signature: "s1" }), record({ caseId: "b", kind: "x", repeat: 1, signature: "s2" }),
      record({ caseId: "c", kind: "y", signature: "s1" }), record({ caseId: "c", kind: "y", repeat: 1, signature: "s1" }),
      record({ caseId: "once", kind: "y" }),
    ], meta);

    expect(report.consistency).toMatchObject({ repeated: 3, consistent: 2, percent: 66.7, cases: 3, repeats: 3, flipped: [{ caseId: "b", signatures: ["s1", "s2"] }] });
    expect(report.consistency.byFamily).toEqual({ x: { repeated: 2, consistent: 1, percent: 50 }, y: { repeated: 1, consistent: 1, percent: 100 } });
    expect(buildReport([record()], meta).consistency).toMatchObject({ repeated: 0, consistent: 0, percent: 0 });
  });

  test("counts silent adds on question captions and payment requests inside a count", () => {
    const outcome = (notice: string | null, outcomes: string[]) => ({ actual: { notice, outcomes, noticeProducts: [], order: [] } });
    const report = buildReport([
      record({ caseId: "q1", tags: ["question-caption"], ...outcome(null, ["added"]) }),
      record({ caseId: "q2", tags: ["question-caption"], ...outcome("variant_missing", ["pending_created"]) }),
      record({ caseId: "q3", tags: ["question-caption"], ...outcome(null, ["no_intent"]) }),
      record({ caseId: "p1", ...outcome("payment_request", ["payment_requested"]) }),
      record({ caseId: "p2", ...outcome("several_problems", ["payment_requested", "variant_missing"]) }),
      record({ caseId: "n1", ...outcome("ready", ["ready"]) }),
      record({ caseId: "q1", repeat: 1, tags: ["question-caption"], ...outcome(null, ["added"]) }),
    ], meta);

    expect(report.tagMetrics.questionCaptionSilentAdds).toEqual({ messages: 3, silentAdds: 1 });
    expect(report.tagMetrics.paymentInCount).toEqual({ paymentRequests: 2, insideCount: 1 });
    expect(report.tagMetrics.noticesByKind).toEqual({ none: 2, payment_request: 1, ready: 1, several_problems: 1, variant_missing: 1 });
  });

  test("the report header says which reader features were scored", () => {
    const features = { paymentRequest: false, closedOrderLine: true };

    expect(buildReport([record()], meta, [], [], features).shippedReaderFeatures).toEqual(features);
    expect(buildReport([record()], meta).shippedReaderFeatures).toEqual({ paymentRequest: true, closedOrderLine: true });
    expect(formatSummary(buildReport([record()], meta, [], [], features), "p")).toContain("payment request off, closed-order line on");
  });

  test("cost per scored message counts cached and reasoning tokens, and latency p95 is per message", () => {
    const priced = call({ inputTokens: 10_000, outputTokens: 1000, cachedTokens: 4000, reasoningTokens: 200, durationMs: 800 });
    const report = buildReport([
      record({ caseId: "a", calls: [priced], latencyMs: 900 }),
      record({ caseId: "b", calls: [priced, priced], latencyMs: 1700 }),
      record({ caseId: "c", repeat: 1, calls: [priced] }),
    ], meta);

    expect(report.cost).toEqual({ perScoredMessageUsd: 0.00225, targetUsd: 0.003, overTarget: false, inputTokens: 30_000, outputTokens: 3000, cachedTokens: 12_000, reasoningTokens: 600 });
    expect(report.messageLatency).toEqual({ p95Ms: 1700, p95ModelMs: 1600 });
  });

  test("counts model calls per message kind against what the design allows", () => {
    const kinds = (kind: CaseRecord["messageKind"], calls: number, caseId: string) => record({ caseId, messageKind: kind, calls: Array.from({ length: calls }, () => call()) });
    const report = buildReport([kinds("text", 1, "a"), kinds("text", 2, "b"), kinds("photo", 0, "c"), kinds("photo_caption", 2, "d")], meta);

    expect(report.readerCalls).toEqual({
      text: { messages: 2, maxCalls: 2, meanCalls: 1.5, allowed: 1, withinDesign: false },
      photo: { messages: 1, maxCalls: 0, meanCalls: 0, allowed: 1, withinDesign: true },
      photo_caption: { messages: 1, maxCalls: 2, meanCalls: 2, allowed: 2, withinDesign: true },
    });
  });

  test("known limitations are listed apart and left out of every score", () => {
    const report = buildReport([record(), record({ caseId: "int-calcetines", passed: false, tags: ["known-limitation"], signature: "not_found" })], meta);

    expect(report.overall).toEqual({ total: 1, passed: 1, accuracy: 1 });
    expect(report.byPass.interpretation).toEqual({ total: 1, passed: 1, accuracy: 1 });
    expect(report.knownLimitations).toEqual([{ caseId: "int-calcetines", passed: false, signature: "not_found" }]);
    expect(report.failures).toEqual([]);
  });

  test("retried attempts are counted apart from latency", () => {
    expect(buildReport([record({ retries: 2 }), record({ caseId: "b" })], meta).retries).toEqual({ messages: 1, attempts: 2 });
  });

  test("calibration grades the visual model's own pick at its production gate, not what the gate decided", () => {
    const report = buildReport([
      record({ caseId: "d", pass: "image", expected: [{ kind: "found", product: "polo-rayas" }], certainties: [{ source: "visual", confidence: 0.7, gate: 0.8, pick: "polo-rayas" }] }),
      record({ caseId: "e", pass: "image", expected: [{ kind: "not_product" }], certainties: [{ source: "visual", confidence: 0.83, gate: 0.8, pick: "chompa-tejida" }] }),
      // Older records kept no visual pick: ungraded.
      record({ caseId: "f", pass: "image", expected: [{ kind: "found", product: "polo-rayas" }], certainties: [{ source: "visual", confidence: 0.77, gate: 0.8 }] }),
    ], meta);

    expect(report.calibration.image!.visual!.atGate).toEqual({ gate: 0.8, acceptedCorrect: 0, acceptedWrong: 1, rejectedCorrect: 1, rejectedWrong: 0, unverified: 1 });
    expect(report.gates).toEqual({ visual: 0.8 });
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
    const report = buildReport([record({ latencyMs: 100 }), record({ caseId: "b", latencyMs: 300 }), record({ caseId: "c", pass: "image", latencyMs: 50 })], meta);

    expect(report.latencyMs).toMatchObject({ all: { p50: 100, p95: 300 }, interpretation: { p50: 100, p95: 300 }, image: { p50: 50, p95: 50 } });
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
