import { expect, test } from "vitest";
import type { CaseRecord } from "@core/evals/lib/case-record";
import { splitOf } from "@core/evals/cases/split";
import { rebuildResult, splitResult } from "@core/evals/lib/rebuild";
import { buildReport } from "@core/evals/lib/report";
import { messageRecord } from "@core/evals/lib/record-fixture";

const record: CaseRecord = messageRecord({
  caseId: "int-remove-only-item~p1", baseId: "int-remove-only-item", kind: "remove", tags: ["paraphrase"], fields: { notice: true, outcome: false }, latencyMs: 500,
  input: "text «sacalo nomas»", expected: [{ notice: "ready", outcomes: ["ready"] }],
  actual: { outcomes: ["ambiguous_intent"], notice: null, noticeProducts: [], order: [] }, signature: "ambiguous_intent|",
  previousOrder: [], calls: [{ provider: "openai", role: "system", endpoint: "/v1/responses", model: "gpt-6-luna", inputTokens: 1000, outputTokens: 10, durationMs: 400, status: 200 }],
});

test("a rebuild rescores messages under the current rules and keeps the classifier's groups and usage", () => {
  const meta = { runId: "run", startedAt: "2026-10-24T00:00:00.000Z", finishedAt: "2026-10-24T00:10:00.000Z", settings: { claudeModel: "claude-sonnet-5-5" } };
  const classifier = { provider: "anthropic" as const, role: "classifier" as const, endpoint: "/v1/messages", model: "claude-sonnet-5-5", inputTokens: 2000, outputTokens: 300, durationMs: 1, status: 200 };
  const groups = [{ cause: "lost notice", explanation: "x", caseIds: [record.caseId] }];
  const old = buildReport([record], meta, [classifier], groups);

  const { report, records, extraCalls } = rebuildResult({ report: old, records: [record] });

  expect(records[0]).toMatchObject({ exactPassed: false, passed: false, ignoredActions: 1, extraNotice: false, fields: { notice: false, outcome: false, unitPrice: true } });
  expect(report.gate.whole).toMatchObject({ scored: 1, right: 0, ignoredActions: 1 });
  expect(report.errorGroups).toEqual(groups);
  expect(report.usage.byRole.classifier).toEqual(old.usage.byRole.classifier);
  expect(extraCalls).toHaveLength(1);
});

test("a rebuild follows a changed expectation and keeps a judge rescue", () => {
  const meta = { runId: "run", startedAt: "", finishedAt: "", settings: {} };
  const relabeled = { ...record, expected: [{ notice: null, outcomes: ["ambiguous_intent"] }] };
  const rescued = { ...record, caseId: "r", passed: true, exactPassed: false };

  const { records } = rebuildResult({ report: buildReport([relabeled, rescued], meta), records: [relabeled, rescued] });

  expect(records[0]).toMatchObject({ passed: true, exactPassed: true, ignoredActions: 0 });
  expect(records[1]).toMatchObject({ passed: true, exactPassed: false });
});

test("an old image record that met the visual gate gets its found product as the pick; one under the gate stays ungraded", () => {
  const image = (confidence: number, actual: unknown): CaseRecord => ({ ...record, caseId: `img-${confidence}`, pass: "image", expected: [{ kind: "found", product: "polo-rayas" }],
    actual, certainties: [{ source: "visual", confidence, gate: 0.8 }] });
  const meta = { runId: "run", startedAt: "", finishedAt: "", settings: {} };
  const files = [image(0.9, { kind: "found", products: ["polo-rayas"], colors: [null] }), image(0.7, { kind: "not_found", reason: "low_confidence" })];

  const { report, records } = rebuildResult({ report: buildReport(files, meta), records: files });

  expect(records[0]!.certainties[0]!.pick).toBe("polo-rayas");
  expect(report.calibration.image!.visual!.atGate).toMatchObject({ acceptedCorrect: 1, unverified: 1 });
});

test("a case that is now a known limitation leaves the score on rebuild", () => {
  const meta = { runId: "run", startedAt: "", finishedAt: "", settings: {} };

  const { report } = rebuildResult({ report: buildReport([record], meta), records: [record] }, new Set([record.baseId]));

  expect(report.overall.total).toBe(0);
  expect(report.knownLimitations).toHaveLength(1);
});

test("a split's part of a run keeps its records and their error groups, without the classifier's cost", () => {
  const meta = { runId: "run", startedAt: "", finishedAt: "", settings: {} };
  const other = ["int-greeting", "int-thanks", "int-ready", "hold-v1-a", "hold-plin"].find((id) => splitOf(id) !== splitOf(record.baseId))!;
  const second: CaseRecord = { ...record, caseId: other, baseId: other };
  const classifier = { provider: "anthropic" as const, role: "classifier" as const, endpoint: "/v1/messages", model: "claude-sonnet-5-5", inputTokens: 2000, outputTokens: 300, durationMs: 1, status: 200 };
  const groups = [{ cause: "low action", explanation: "x", caseIds: [record.caseId, other] }, { cause: "other", explanation: "y", caseIds: [other] }];

  const part = rebuildResult(splitResult({ report: buildReport([record, second], meta, [classifier], groups), records: [record, second], extraCalls: [classifier] }, splitOf(record.baseId)));

  expect(part.records.map(({ caseId }) => caseId)).toEqual([record.caseId]);
  expect(part.report.errorGroups).toEqual([{ ...groups[0], caseIds: [record.caseId] }]);
  expect(part.report.usage.byRole.classifier).toBeUndefined();
  expect(part.report.settings.split).toBe(splitOf(record.baseId));
});
