import type { MessageExpectation, OrderLine } from "@core/evals/cases/schema";
import { splitOf, type EvalSplit } from "@core/evals/cases/split";
import type { CaseRecord } from "@core/evals/lib/case-record";
import type { ModelCall } from "@core/evals/lib/model-meter";
import { buildReport, type EvalReport } from "@core/evals/lib/report";
import { scoreMessage, type MessageActual } from "@core/evals/lib/scorers";

/**
 * Recomputes a run's report from the case records saved in its result JSON, with no model call: the report views can change
 * without spending a run. Claude's error groups and the classifier's usage are kept as they were.
 */

export type ResultFile = Readonly<{ report: EvalReport; records: readonly CaseRecord[]; extraCalls?: readonly ModelCall[] }>;

/**
 * Scores a message record again under the current rules, from its stored expectations, actual result and earlier order. The unit
 * price check stays as recorded (it depends on the catalog the run used), and a judge rescue stays.
 */
export function rescoreMessage(record: CaseRecord): CaseRecord {
  const actual = record.actual as Partial<MessageActual>;
  if (record.pass === "image" || !Array.isArray(record.expected) || !actual.outcomes) return record;
  const expectations = (record.expected as readonly MessageExpectation[]).filter((expectation) => "notice" in expectation || "outcomes" in expectation);
  if (!expectations.length) return record;
  const scored = scoreMessage({ outcomes: actual.outcomes, notice: actual.notice ?? null, noticeProducts: actual.noticeProducts ?? [], order: actual.order ?? [] },
    expectations, record.previousOrder as readonly OrderLine[]);
  const fields = { ...scored.fields, unitPrice: record.fields.unitPrice ?? true };
  const exactPassed = Object.values(fields).every((value) => value !== false);
  const rescued = record.passed && !record.exactPassed;
  return { ...record, fields, exactPassed, passed: exactPassed || rescued, expectationIndex: scored.expectationIndex, ignoredActions: scored.ignoredActions,
    wrongSilentChange: scored.wrongSilentChange, extraNotice: scored.extraNotice, expectedSilent: scored.expectedSilent };
}

/**
 * Records from before visual picks were kept: an image case whose one visual certainty met the gate and found one product picked
 * that product, so its pick is known. Below the gate it stays unknown and ungraded.
 */
export function backfillVisualPick(record: CaseRecord): CaseRecord {
  const visual = record.certainties.filter(({ source }) => source === "visual");
  const actual = record.actual as { kind?: string; products?: readonly string[] };
  if (record.pass !== "image" || visual.length !== 1 || visual[0]!.pick !== undefined || visual[0]!.confidence < visual[0]!.gate) return record;
  if (actual.kind !== "found" || actual.products?.length !== 1) return record;
  return { ...record, certainties: record.certainties.map((certainty) => certainty === visual[0] ? { ...certainty, pick: actual.products![0]! } : certainty) };
}

/** Calls made outside the cases (the classifier). Older files did not keep them, so they are rebuilt from the report's usage. */
function extraCallsOf(file: ResultFile): readonly ModelCall[] {
  if (file.extraCalls) return file.extraCalls;
  const classifier = file.report.usage.byRole.classifier;
  if (!classifier?.calls) return [];
  const model = String(file.report.settings.claudeModel ?? "claude-sonnet-5-5");
  return [{ provider: "anthropic", role: "classifier", endpoint: "/v1/messages", model, inputTokens: classifier.inputTokens, outputTokens: classifier.outputTokens,
    durationMs: 0, status: 200 }];
}

/** Tags a record `known-limitation` when its base case is one now, so a later decision is reported without a rerun. */
const withKnownLimitation = (knownLimitations: ReadonlySet<string>) => (record: CaseRecord): CaseRecord =>
  knownLimitations.has(record.baseId) && !record.tags.includes("known-limitation") ? { ...record, tags: [...record.tags, "known-limitation"] } : record;

/** `knownLimitations`: base case ids tagged `known-limitation` in the current cases. */
export function rebuildResult(file: ResultFile, knownLimitations: ReadonlySet<string> = new Set()): ResultFile {
  const records = file.records.map((record) => withKnownLimitation(knownLimitations)(backfillVisualPick(rescoreMessage(record))));
  const { runId, startedAt, finishedAt, settings, errorGroups } = file.report;
  const extraCalls = extraCallsOf(file);
  return { report: buildReport(records, { runId, startedAt, finishedAt, settings }, extraCalls, errorGroups), records, extraCalls };
}

/**
 * The part of a run in one split (cases/split.ts), to read dev and test apart from one full run. The classifier ran over the whole
 * run, so its groups keep only this split's cases and its cost is left out.
 */
export function splitResult(file: ResultFile, split: EvalSplit): ResultFile {
  const records = file.records.filter(({ baseId }) => splitOf(baseId) === split);
  const ids = new Set(records.map(({ caseId }) => caseId));
  const errorGroups = file.report.errorGroups.map((group) => ({ ...group, caseIds: group.caseIds.filter((id) => ids.has(id)) }))
    .filter(({ caseIds }) => caseIds.length);
  return { report: { ...file.report, settings: { ...file.report.settings, split }, errorGroups }, records, extraCalls: [] };
}
