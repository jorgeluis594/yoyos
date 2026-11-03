import type { OrderLine } from "@core/evals/cases/schema";
import type { ProductKey } from "@core/evals/fixtures/catalog";
import type { CaseRecord, ReadingRecord, StageFacts } from "@core/evals/lib/case-record";
import { changedLinesOf, scoredLinesOf, type ChangeRow, type ScoredChangedLine } from "@core/evals/lib/changed-lines";
import { messageExpectationsOf, rebuildResult, rescoreMessage, type ResultFile } from "@core/evals/lib/rebuild";
import { buildReport, type EvalReport, type RunsTally } from "@core/evals/lib/report";
import type { MetricName, MetricRange } from "@core/evals/lib/metrics";
import { expectedOrder, type ActualLine, type MessageActual } from "@core/evals/lib/scorers";
import { expectedStagesOf, scoreStages } from "@core/evals/lib/stage-facts";
import { stagedAnswerOf } from "@core/evals/lib/staged-answer";
import type { MessageTrace } from "@core/src/features/orders/domain/reader/trace";

/**
 * Offline rescoring of a saved run (evals/README.md «Rescoring a saved run»): every fact of every message is computed again with the current code from what
 * the record stores (the expectations, the reading trace, the actual result and the earlier order), then the whole report. No model, no database, no
 * network. Pure: unit-tested in rescore.test.ts.
 */

/** What a record's facts kept as they were because the record lacks the data to compute them again. */
export type KeptReason = "facts" | "changedLines";

export type KeptCounts = Readonly<{
  /** Messages that carry facts. */
  messages: number;
  /** Their actual-side facts (intent, fields, decision, marks, lines) stay as stored: the run kept no reading, or the record is a legacy one. */
  facts: number;
  /** Only the changed lines stay as stored: the change rows cannot be rebuilt from the earlier and the final order. */
  changedLines: number;
  /** Records with no facts at all (a message that failed before it was read): left alone. */
  withoutFacts: number;
}>;

const orderFieldNames = ["product", "variant", "quantity", "mentionedPrice"] as const;

/** The stored reading as the trace `stagedAnswerOf` reads. Only the parts it reads are filled: the stage outputs and the decision of each action. */
const traceOf = (reading: ReadingRecord | undefined): MessageTrace | null => reading
  ? { stages: reading.stages.map(({ stage, reading: kind, output }) => ({ call: { stage, reading: kind, costUsd: 0 }, output })),
    decisions: reading.decisions.map(({ action, decision }) => ({ action: { kind: action, productId: null }, decision })), photo: null } as unknown as MessageTrace
  : null;

const lineKey = (line: Readonly<{ product: string | null; variant: Readonly<Record<string, string>> }>) =>
  `${line.product ?? "?"}|${JSON.stringify(Object.entries(line.variant).sort(([a], [b]) => a.localeCompare(b)))}`;
const snapshotOf = (line: Readonly<{ product: string | null; variant: Readonly<Record<string, string>>; quantity: number; mentionedPrice?: Readonly<{ amount: number; units: number }> | null }>) =>
  ({ variantId: lineKey(line), variantAttributes: line.variant, quantity: line.quantity,
    mentionedPrice: line.mentionedPrice ? { amount: { amount: line.mentionedPrice.amount }, units: line.mentionedPrice.units } : null });
const productOfId = (variantId: string): ProductKey | null => { const product = variantId.split("|")[0]!; return product === "?" ? null : product as ProductKey; };
const samePrice = (a: ActualLine["mentionedPrice"] | undefined, b: ActualLine["mentionedPrice"] | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The change rows a message left, rebuilt from the order before and after it (the rows themselves are not stored): a line that is new is a row with no line
 * before, one that is gone a row with no line after, one whose quantity or price changed a row with both. The marks are not set here (`applied` for all).
 */
export function changeRowsOf(previous: readonly Readonly<{ product: string; variant: Readonly<Record<string, string>>; quantity: number }>[], order: readonly ActualLine[]): readonly ChangeRow[] {
  const before = new Map(previous.map((line) => [lineKey(line), line]));
  const after = new Map(order.map((line) => [lineKey(line), line]));
  const row = (previousLine: object | null, line: object | null): ChangeRow => ({ decision: "applied", before: previousLine, after: line });
  return [
    ...[...after].flatMap(([key, line]): readonly ChangeRow[] => {
      const old = before.get(key);
      if (!old) return [row(null, snapshotOf(line))];
      const changed = old.quantity !== line.quantity || !samePrice((old as { mentionedPrice?: ActualLine["mentionedPrice"] }).mentionedPrice, line.mentionedPrice);
      return changed ? [row(snapshotOf(old), snapshotOf(line))] : [];
    }),
    ...[...before].filter(([key]) => !after.has(key)).map(([, line]) => row(snapshotOf(line), null)),
  ];
}

/**
 * The changed lines of a message with their marks, scored against the expected order, or null when they cannot be rebuilt: the rows do not number what the
 * record counted, or some lines were marked and others not (the marks belong to the run and are not stored per line). A record that never counted its lines
 * takes the marks from the decisions of its reading.
 */
function scoredLinesFor(record: CaseRecord, facts: StageFacts, expected: Parameters<typeof expectedOrder>[0]): readonly ScoredChangedLine[] | null {
  const rows = changeRowsOf(record.previousOrder, (record.actual as MessageActual).order ?? []);
  const kinds = record.reading?.decisions.map(({ decision }) => decision) ?? [];
  let marked: number;
  if (facts.changedLines !== undefined && facts.unmarkedLines !== undefined) {
    if (facts.changedLines !== rows.length) return null;
    marked = rows.length - facts.unmarkedLines;
  } else marked = kinds.includes("doubtful") && !kinds.includes("applied") ? rows.length : 0;
  if (marked !== 0 && marked !== rows.length) return null;
  const decision = marked > 0 ? "doubtful" as const : "applied" as const;
  return scoredLinesOf(changedLinesOf(rows.map((row) => ({ ...row, decision })), productOfId), expectedOrder(expected, record.previousOrder as readonly OrderLine[]));
}

/** What the record stored about its lines, as the facts keep it. */
const storedLines = ({ changedLines, unmarkedLines, silentLines, changeApplied, marked }: StageFacts): Partial<StageFacts> =>
  ({ changeApplied, marked, ...(changedLines !== undefined ? { changedLines } : {}), ...(unmarkedLines !== undefined ? { unmarkedLines } : {}), ...(silentLines !== undefined ? { silentLines } : {}) });

export type RescoreContext = Readonly<{
  /** Some record of the run kept its reading: a message with none then read nothing (a skipped message). In a run with none, the records are older than the trace. */
  hasReadings: boolean;
}>;

/** Scores one record again: the fields of the order and the expected decision (`rescoreMessage`), then the facts of the actual side. */
export function rescoreRecord(record: CaseRecord, context: RescoreContext): Readonly<{ record: CaseRecord; kept: readonly KeptReason[] }> {
  const scored = rescoreMessage(record);
  const facts = scored.facts;
  if (!facts) return { record: scored, kept: [] };
  const actual = scored.actual as Partial<MessageActual>;
  const expectations = messageExpectationsOf(scored);
  const recomputable = scored.pass !== "image" && Array.isArray(actual.outcomes) && expectations.length > 0 && facts.decision !== null && (scored.reading !== undefined || context.hasReadings);
  if (!recomputable) return { record: scored, kept: ["facts"] };

  const expectation = expectations[scored.expectationIndex]!;
  const expected = expectedStagesOf(expectation);
  const lines = scoredLinesFor(scored, facts, expectation);
  const answer = stagedAnswerOf({ trace: traceOf(scored.reading), expected, outcomes: actual.outcomes!, notice: actual.notice ?? null,
    orderMatches: orderFieldNames.every((name) => scored.fields[name] !== false), ...(lines ? { changedLines: lines } : {}), latencyMs: facts.readingMs, productKeyOf: () => null });
  // The product the reader chose cannot be named again (the catalog ids are not stored), and the timings and costs are of the run.
  const computed: StageFacts = { ...scoreStages(expected, answer), resolution: facts.resolution, readingMs: facts.readingMs, queuedMs: facts.queuedMs, stageCostsUsd: facts.stageCostsUsd,
    ...(lines ? {} : storedLines(facts)) };
  return { record: { ...scored, facts: computed }, kept: lines ? [] : ["changedLines"] };
}

/** The whole result file scored again, its report built with the current code (`rebuildResult`), and what was kept as stored. The input is not changed. */
export function rescoreFile(file: ResultFile, knownLimitations: ReadonlySet<string> = new Set()): Readonly<{ result: ResultFile; kept: KeptCounts }> {
  const context = { hasReadings: file.records.some(({ reading }) => reading !== undefined) };
  const rescored = file.records.map((record) => rescoreRecord(record, context));
  const messages = rescored.filter(({ record }) => record.facts);
  return {
    result: rebuildResult({ ...file, records: rescored.map(({ record }) => record) }, knownLimitations),
    kept: { messages: messages.length, facts: messages.filter(({ kept }) => kept.includes("facts")).length, changedLines: messages.filter(({ kept }) => kept.includes("changedLines")).length,
      withoutFacts: rescored.filter(({ record }) => !record.facts && record.pass !== "image" && record.event === undefined).length },
  };
}

export type ComparisonRow = Readonly<{ metric: string; before: string; after: string; note?: string }>;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const number = (value: number) => String(Math.round(value * 100) / 100);
const rangeText = (range: MetricRange | null | undefined, show: (value: number) => string): string => {
  if (!range) return "not measured";
  return range.min === range.max && range.runs === 1 ? show(range.mean) : `${show(range.mean)} (min ${show(range.min)}, max ${show(range.max)})`;
};
const metricRow = (metric: string, name: MetricName, before: EvalReport, after: EvalReport, show: (value: number) => string): ComparisonRow =>
  ({ metric, before: rangeText(before.runs?.metrics?.[name], show), after: rangeText(after.runs.metrics[name], show) });

/** The end-to-end tally and the conversation counts of a report; a report from before they existed has them computed from its stored records instead. */
function sectionsOf(report: EvalReport, stored: readonly CaseRecord[] | undefined): Readonly<{ endToEnd: RunsTally | null; conversationSteps: EvalReport["conversationSteps"] | null; derived: boolean }> {
  const current = report.endToEnd?.all?.runs !== undefined && report.conversationSteps !== undefined;
  if (current) return { endToEnd: report.endToEnd.all, conversationSteps: report.conversationSteps, derived: false };
  if (!stored) return { endToEnd: null, conversationSteps: null, derived: true };
  const rebuilt = buildReport(stored, { runId: report.runId, startedAt: report.startedAt, finishedAt: report.finishedAt, settings: report.settings });
  return { endToEnd: rebuilt.endToEnd.all, conversationSteps: rebuilt.conversationSteps, derived: true };
}

/**
 * One row per audited metric, from the report stored in the file («before») and from the recomputation («after»). `stored` are the file's records, used only
 * when the stored report is older than the end-to-end range and the own and carried conversation failures: those two are then counted from the stored
 * records with their stored scores, and the row says so. Aggregate numbers only.
 */
export function comparisonOf(before: EvalReport, after: EvalReport, stored?: readonly CaseRecord[]): readonly ComparisonRow[] {
  const old = sectionsOf(before, stored);
  const now = sectionsOf(after, undefined);
  const note = old.derived ? "before counted from the stored records, with their stored scores (the stored report predates it)" : undefined;
  const endToEnd = (tally: RunsTally | null) => !tally ? "not measured" : tally.runs === 0 ? "no end-to-end messages" : percent(tally.accuracy);
  const range = (tally: RunsTally | null) => !tally || tally.runs === 0 ? "n/a" : `${percent(tally.min)}–${percent(tally.max)}`;
  const steps = (value: EvalReport["conversationSteps"] | null, kind: "own" | "carried") => !value ? "not measured" : String(value[kind].count);
  const order = (report: EvalReport, field: string) => report.fields?.[field] ? percent(report.fields[field]!.accuracy) : "not measured";
  return [
    metricRow("false urgent share", "falseUrgentShare", before, after, percent),
    metricRow("urgent recall", "urgentRecall", before, after, percent),
    metricRow("urgent precision", "urgentPrecision", before, after, percent),
    metricRow("silent wrong changes per run", "silentWrongChanges", before, after, number),
    metricRow("ignored requests per run", "ignoredRequests", before, after, number),
    metricRow("intent precision (intentAccuracy)", "intentAccuracy", before, after, percent),
    metricRow("variant and quantity (fields accuracy)", "fieldsAccuracy", before, after, percent),
    { metric: "final order variant (first run)", before: order(before, "variant"), after: order(after, "variant") },
    { metric: "final order quantity (first run)", before: order(before, "quantity"), after: order(after, "quantity") },
    metricRow("resolution accuracy", "resolutionAccuracy", before, after, percent),
    metricRow("decision accuracy", "decisionAccuracy", before, after, percent),
    { metric: "end-to-end mean", before: endToEnd(old.endToEnd), after: endToEnd(now.endToEnd), ...(note ? { note } : {}) },
    { metric: "end-to-end range", before: range(old.endToEnd), after: range(now.endToEnd), ...(note ? { note } : {}) },
    { metric: "conversation failures own", before: steps(old.conversationSteps, "own"), after: steps(now.conversationSteps, "own"), ...(note ? { note } : {}) },
    { metric: "conversation failures carried", before: steps(old.conversationSteps, "carried"), after: steps(now.conversationSteps, "carried"), ...(note ? { note } : {}) },
  ];
}

/** The table printed by the command, and what was kept as stored. No case id and no input. */
export function formatComparison(rows: readonly ComparisonRow[], kept: KeptCounts): string {
  const width = Math.max(...rows.map(({ metric }) => metric.length));
  const beforeWidth = Math.max("before".length, ...rows.map(({ before }) => before.length));
  const notes = [...new Set(rows.flatMap(({ note }) => note ? [note] : []))];
  return [
    `${"metric".padEnd(width)}  ${"before".padEnd(beforeWidth)}  after`,
    ...rows.map(({ metric, before, after }) => `${metric.padEnd(width)}  ${before.padEnd(beforeWidth)}  ${after}`),
    ...notes.map((text) => `note: ${text}`),
    `Messages with facts: ${kept.messages}. Kept as stored (data missing): ${kept.facts} with all their facts, ${kept.changedLines} with their changed lines. Records with no facts left alone: ${kept.withoutFacts}.`,
  ].join("\n");
}
