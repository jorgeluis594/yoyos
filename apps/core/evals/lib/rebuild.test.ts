import { expect, test } from "vitest";
import type { CaseRecord } from "@core/evals/lib/case-record";
import { splitOf } from "@core/evals/cases/split";
import { rebuildResult, splitResult } from "@core/evals/lib/rebuild";
import { buildReport } from "@core/evals/lib/report";

const record: CaseRecord = {
  caseId: "int-remove-only-item~p1", baseId: "int-remove-only-item", pass: "interpretation", criterion: 1, kind: "remove", tags: ["paraphrase"], repeat: 0,
  passed: false, exactPassed: false, fields: { tool: false, outcome: false }, expectationIndex: 0, judge: null, noticeError: null, expectedTool: "remove_item",
  input: "text «sacalo nomas»", expected: [{ tools: ["remove_item"], outcomes: ["only_item_kept"] }], actual: { tools: [], outcomes: ["ambiguous_intent"], order: [] },
  signature: "|ambiguous_intent|", certainties: [{ source: "action", confidence: 0.5, gate: 0.6, detail: "remove_item" }],
  trace: { decisions: [], extracted: [], textChoices: [] }, latencyMs: 500, retries: 0, error: null,
  calls: [{ provider: "openai", role: "system", endpoint: "/v1/decisions", model: "gpt-6-luna", inputTokens: 1000, outputTokens: 10, durationMs: 400, status: 200 }],
};

test("a rebuild rescores notices and calibration from the records and keeps the classifier's groups and usage", () => {
  const meta = { runId: "run", startedAt: "2026-10-24T00:00:00.000Z", finishedAt: "2026-10-24T00:10:00.000Z", settings: { claudeModel: "claude-sonnet-5-5" } };
  const classifier = { provider: "anthropic" as const, role: "classifier" as const, endpoint: "/v1/messages", model: "claude-sonnet-5-5", inputTokens: 2000, outputTokens: 300, durationMs: 1, status: 200 };
  const groups = [{ cause: "low action", explanation: "x", caseIds: [record.caseId] }];
  const old = buildReport([record], meta, [classifier], groups);

  const { report, records, extraCalls } = rebuildResult({ report: old, records: [record] });

  expect(records[0]!.noticeError).toBe("missed_notice");
  expect(report.notices.missedNotices).toEqual([record.caseId]);
  expect(report.calibration.interpretation!.action!.atGate).toMatchObject({ rejectedCorrect: 1 });
  expect(report.errorGroups).toEqual(groups);
  expect(report.usage.byRole.classifier).toEqual(old.usage.byRole.classifier);
  expect(extraCalls).toHaveLength(1);
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
  const other = ["int-greeting", "int-thanks", "int-ready", "txt-chompa", "hold-plin"].find((id) => splitOf(id) !== splitOf(record.baseId))!;
  const second: CaseRecord = { ...record, caseId: other, baseId: other };
  const classifier = { provider: "anthropic" as const, role: "classifier" as const, endpoint: "/v1/messages", model: "claude-sonnet-5-5", inputTokens: 2000, outputTokens: 300, durationMs: 1, status: 200 };
  const groups = [{ cause: "low action", explanation: "x", caseIds: [record.caseId, other] }, { cause: "other", explanation: "y", caseIds: [other] }];

  const part = rebuildResult(splitResult({ report: buildReport([record, second], meta, [classifier], groups), records: [record, second], extraCalls: [classifier] }, splitOf(record.baseId)));

  expect(part.records.map(({ caseId }) => caseId)).toEqual([record.caseId]);
  expect(part.report.errorGroups).toEqual([{ ...groups[0], caseIds: [record.caseId] }]);
  expect(part.report.usage.byRole.classifier).toBeUndefined();
  expect(part.report.settings.split).toBe(splitOf(record.baseId));
});
