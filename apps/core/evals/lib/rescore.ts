import { basename, join, resolve } from "node:path";
import type { OrderLine } from "@core/evals/cases/schema";
import type { ProductKey } from "@core/evals/fixtures/catalog";
import type { CaseRecord, ReadingRecord, StageFacts } from "@core/evals/lib/case-record";
import { changedLinesOf, scoredLinesOf, type ChangeRow, type ScoredChangedLine } from "@core/evals/lib/changed-lines";
import { messageExpectationsOf, rebuildResult, rescoreMessage, type ResultFile } from "@core/evals/lib/rebuild";
import { buildReport, type EvalReport, type RunsTally } from "@core/evals/lib/report";
import { runsOfRecords, type MetricName, type MetricRange } from "@core/evals/lib/metrics";
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
export type KeptReason = "facts" | "legacy" | "changedLines";

export type KeptCounts = Readonly<{
  /** Messages that carry facts. */
  messages: number;
  /** Their actual-side facts (intent, fields, decision, marks, lines) stay as stored: the run kept no reading, or the record is a legacy one. */
  facts: number;
  /** Legacy baseline records (`EVAL_READER=legacy`): they state an intent and no decision by design, so they are not missing data. */
  legacy: number;
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

/** The earlier order stores a product outside the catalog as «unknown» (run-case.ts `lineOf`), the actual order as null: both are one line. */
const lineKey = (line: Readonly<{ product: string | null; variant: Readonly<Record<string, string>> }>) =>
  `${line.product === null || line.product === "unknown" ? "?" : line.product}|${JSON.stringify(Object.entries(line.variant).sort(([a], [b]) => a.localeCompare(b)))}`;
const snapshotOf = (line: Readonly<{ product: string | null; variant: Readonly<Record<string, string>>; quantity: number; mentionedPrice?: Readonly<{ amount: number; units: number }> | null }>) =>
  ({ variantId: lineKey(line), variantAttributes: line.variant, quantity: line.quantity,
    mentionedPrice: line.mentionedPrice ? { amount: { amount: line.mentionedPrice.amount }, units: line.mentionedPrice.units } : null });
const productOfId = (variantId: string): ProductKey | null => { const product = variantId.split("|")[0]!; return product === "?" ? null : product as ProductKey; };
const samePrice = (a: ActualLine["mentionedPrice"] | undefined, b: ActualLine["mentionedPrice"] | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The change rows a message left, rebuilt from the order before and after it (the rows themselves are not stored): a line that is new is a row with no line
 * before, one that is gone a row with no line after, one whose quantity or price changed a row with both. The marks are not set here (`applied` for all).
 * The earlier order does not store the prices the buyer mentioned, so an earlier price is unknown unless the line carries one: the line then keeps the price it ends
 * with (this message did not touch it), unless the message states a price (`priceStated`), when the earlier price is taken as none.
 */
export function changeRowsOf(previous: readonly Readonly<{ product: string; variant: Readonly<Record<string, string>>; quantity: number; mentionedPrice?: ActualLine["mentionedPrice"] }>[],
  order: readonly ActualLine[], { priceStated = false }: Readonly<{ priceStated?: boolean }> = {}): readonly ChangeRow[] {
  const before = new Map(previous.map((line) => [lineKey(line), line]));
  const after = new Map(order.map((line) => [lineKey(line), line]));
  const row = (previousLine: object | null, line: object | null): ChangeRow => ({ decision: "applied", before: previousLine, after: line });
  return [
    ...[...after].flatMap(([key, line]): readonly ChangeRow[] => {
      const old = before.get(key);
      if (!old) return [row(null, snapshotOf(line))];
      const earlierPrice = old.mentionedPrice !== undefined ? old.mentionedPrice : priceStated ? null : line.mentionedPrice;
      const changed = old.quantity !== line.quantity || !samePrice(earlierPrice, line.mentionedPrice);
      return changed ? [row(snapshotOf({ ...old, mentionedPrice: earlierPrice }), snapshotOf(line))] : [];
    }),
    ...[...before].filter(([key]) => !after.has(key)).map(([, line]) => row(snapshotOf(line), null)),
  ];
}

/** The message states a price: its extraction has a request with one. */
const statesPrice = (reading: ReadingRecord | undefined): boolean => (reading?.stages ?? []).some(({ stage, reading: kind, output }) =>
  stage === "extraction" && kind === "primary" && ((output as { requests?: readonly { price?: unknown }[] } | null)?.requests ?? []).some(({ price }) => price !== null && price !== undefined));

/**
 * The changed lines of a message with their marks, scored against the expected order, or null when they cannot be rebuilt: the rows do not number what the
 * record counted, or some lines were marked and others not (the marks belong to the run and are not stored per line). A record that never counted its lines
 * takes the marks from the decisions of its reading.
 */
function scoredLinesFor(record: CaseRecord, facts: StageFacts, expected: Parameters<typeof expectedOrder>[0]): readonly ScoredChangedLine[] | null {
  const rows = changeRowsOf(record.previousOrder, (record.actual as MessageActual).order ?? [], { priceStated: statesPrice(record.reading) });
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
  if (facts.decision === null) return { record: scored, kept: ["legacy"] };
  const recomputable = scored.pass !== "image" && Array.isArray(actual.outcomes) && expectations.length > 0 && (scored.reading !== undefined || context.hasReadings);
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
    kept: { messages: messages.length, facts: messages.filter(({ kept }) => kept.includes("facts")).length,
      legacy: messages.filter(({ kept }) => kept.includes("legacy")).length, changedLines: messages.filter(({ kept }) => kept.includes("changedLines")).length,
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

/** The records the table may read besides the two reports: the file's as stored, and as scored again. */
export type ComparisonRecords = Readonly<{ stored: readonly CaseRecord[]; rescored: readonly CaseRecord[] }>;

/** Mean and range over the runs of the share of messages whose order field scored right (the report convention of lib/metrics.ts); known limitations are left out. */
function orderFieldRange(records: readonly CaseRecord[], name: string): MetricRange | null {
  const rates = runsOfRecords(records.filter(({ event, tags }) => event === undefined && !tags.includes("known-limitation"))).flatMap((run) => {
    const scores = run.flatMap(({ fields }) => typeof fields[name] === "boolean" ? [fields[name] as boolean] : []);
    return scores.length ? [scores.filter(Boolean).length / scores.length] : [];
  });
  if (!rates.length) return null;
  return { mean: rates.reduce((sum, rate) => sum + rate, 0) / rates.length, min: Math.min(...rates), max: Math.max(...rates), runs: rates.length };
}

const rangeOf = (tally: RunsTally | null) => !tally || tally.runs === 0 ? "n/a" : `${percent(tally.min)}–${percent(tally.max)}`;
const meanOf = (tally: RunsTally | null) => !tally ? "not measured" : tally.runs === 0 ? "no end-to-end messages" : percent(tally.accuracy);
const stepsOf = (value: EvalReport["conversationSteps"] | null, kind: "own" | "carried") => !value ? "not measured" : String(value[kind].count);

/**
 * One row per audited metric, from the report stored in the file («before») and from the recomputation («after»). A «before» is what the stored report says where
 * it has the metric. Where it does not, the cell says so; with the file's stored records it adds a recount from them with their stored scores, labelled. The end-to-end
 * of a report older than the range is its first run only, and says so. The order-level variant and quantity are the mean and range over all runs, counted from
 * the records (`records`), the before with its stored scores. Aggregate numbers only.
 */
export function comparisonOf(before: EvalReport, after: EvalReport, records?: ComparisonRecords): readonly ComparisonRow[] {
  const stored = records ? buildReport(records.stored, { runId: before.runId, startedAt: before.startedAt, finishedAt: before.finishedAt, settings: before.settings }) : null;
  const current = before.endToEnd?.all?.runs !== undefined && before.conversationSteps !== undefined;
  const recount = (value: string) => `n/a in stored report${stored ? `; recount with stored scores: ${value}` : ""}`;
  const firstRun = before.byPass?.end_to_end;
  const beforeMean = current ? meanOf(before.endToEnd.all) : firstRun ? `${percent(firstRun.accuracy)} (stored report: first run only)` : stored ? `${meanOf(stored.endToEnd.all)} (recount with stored scores)` : "not measured";
  const orderRow = (metric: string, name: string): ComparisonRow => records
    ? { metric, before: rangeText(orderFieldRange(records.stored, name), percent), after: rangeText(orderFieldRange(records.rescored, name), percent),
      note: "before counted from the stored records, with their stored scores" }
    : { metric, before: `${before.fields?.[name] ? percent(before.fields[name]!.accuracy) : "not measured"} (first run only)`, after: `${after.fields?.[name] ? percent(after.fields[name]!.accuracy) : "not measured"} (first run only)` };
  return [
    metricRow("false urgent share", "falseUrgentShare", before, after, percent),
    metricRow("urgent recall", "urgentRecall", before, after, percent),
    metricRow("urgent precision", "urgentPrecision", before, after, percent),
    metricRow("silent wrong changes per run", "silentWrongChanges", before, after, number),
    metricRow("ignored requests per run", "ignoredRequests", before, after, number),
    metricRow("intent precision (intentAccuracy)", "intentAccuracy", before, after, percent),
    metricRow("variant and quantity (fields accuracy)", "fieldsAccuracy", before, after, percent),
    orderRow("final order variant", "variant"),
    orderRow("final order quantity", "quantity"),
    metricRow("resolution accuracy", "resolutionAccuracy", before, after, percent),
    metricRow("decision accuracy", "decisionAccuracy", before, after, percent),
    { metric: "end-to-end mean", before: beforeMean, after: meanOf(after.endToEnd.all) },
    { metric: "end-to-end range", before: current ? rangeOf(before.endToEnd.all) : recount(rangeOf(stored?.endToEnd.all ?? null)), after: rangeOf(after.endToEnd.all) },
    { metric: "conversation failures own", before: current ? stepsOf(before.conversationSteps, "own") : recount(stepsOf(stored?.conversationSteps ?? null, "own")), after: stepsOf(after.conversationSteps, "own") },
    { metric: "conversation failures carried", before: current ? stepsOf(before.conversationSteps, "carried") : recount(stepsOf(stored?.conversationSteps ?? null, "carried")),
      after: stepsOf(after.conversationSteps, "carried") },
  ];
}

/** The table printed by the command, and what was kept as stored. No case id and no input. */
export function formatComparison(rows: readonly ComparisonRow[], kept: KeptCounts): string {
  const width = Math.max(0, ...rows.map(({ metric }) => metric.length));
  const beforeWidth = Math.max("before".length, ...rows.map(({ before }) => before.length));
  const notes = [...new Set(rows.flatMap(({ note }) => note ? [note] : []))];
  return [
    `${"metric".padEnd(width)}  ${"before".padEnd(beforeWidth)}  after`,
    ...rows.map(({ metric, before, after }) => `${metric.padEnd(width)}  ${before.padEnd(beforeWidth)}  ${after}`),
    ...notes.map((text) => `note: ${text}`),
    `Messages with facts: ${kept.messages}. Kept as stored (data missing): ${kept.facts} with all their facts, ${kept.changedLines} with their changed lines. `
      + `${kept.legacy} legacy baseline (no decision by design, not missing data). Records with no facts left alone: ${kept.withoutFacts}.`,
  ].join("\n");
}

/**
 * The input and the target of the command from its arguments: the run, and `--out` (anywhere among them) or by default `<resultsDir>/<run>.rescored.json`. The
 * input is never the target.
 */
export function rescoreArgumentsOf(args: readonly string[], resultsDir: string): Readonly<{ input: string; target: string }> | Readonly<{ error: string }> {
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0 && (args[outIndex + 1] === undefined || args[outIndex + 1]!.startsWith("--"))) return { error: "--out needs a path" };
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const inputs = args.filter((arg, index) => !arg.startsWith("--") && !(outIndex >= 0 && index === outIndex + 1));
  if (inputs.length !== 1) return { error: "Usage: pnpm eval:rescore <run.json> [--out <path>]" };
  const input = resolve(inputs[0]!);
  const target = resolve(out ?? join(resultsDir, `${basename(input).replace(/\.json$/, "")}.rescored.json`));
  return target === input ? { error: "--out is the input file: the input is never overwritten" } : { input, target };
}
