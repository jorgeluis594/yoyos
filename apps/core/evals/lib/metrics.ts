import type { CaseRecord, StageFacts } from "@core/evals/lib/case-record";
import { percentile } from "@core/evals/lib/stats";

/** The metrics of a run (one pass over the selected set) and their aggregation over `EVAL_REPEATS` runs. Pure: unit-tested in metrics.test.ts. */

export const metricNames = ["intentAccuracy", "fieldsAccuracy", "resolutionAccuracy", "decisionAccuracy", "silentWrongChanges", "ignoredRequests", "urgentShare",
  "falseUrgentShare", "urgentPrecision", "urgentRecall", "changedNotices", "costIntentUsd", "costExtractionUsd", "costResolutionUsd", "costPhotoUsd", "costPerMessageUsd", "p95DecisionMs"] as const;
export type MetricName = (typeof metricNames)[number];
export type RunMetrics = Readonly<Record<MetricName, number | null>>;
/** Mean and range over the runs that measured the metric. */
export type MetricRange = Readonly<{ mean: number; min: number; max: number; runs: number }>;
export type AggregatedMetrics = Readonly<Record<MetricName, MetricRange | null>>;

/** Metrics where a smaller number is better; the others are better when larger, except `changedNotices`, which is only reported. */
const lowerIsBetter: ReadonlySet<MetricName> = new Set(["silentWrongChanges", "ignoredRequests", "urgentShare", "falseUrgentShare", "costIntentUsd", "costExtractionUsd", "costResolutionUsd",
  "costPhotoUsd", "costPerMessageUsd", "p95DecisionMs"]);
const higherIsBetter: ReadonlySet<MetricName> = new Set(["intentAccuracy", "fieldsAccuracy", "resolutionAccuracy", "decisionAccuracy", "urgentPrecision", "urgentRecall"]);

/**
 * The founder's gate: a wrong change applied with no «Con duda» mark and no notice. With the message's change rows read, it is per changed line: a line the
 * message changed (a completion included) carries no mark (own or inherited), no notice was sent, and that line differs from the expected order's line. Lines
 * the message did not touch do not count for it (a cascade from an earlier message). Without the rows (older records), a message-wide reading.
 */
export const silentWrongChangeOf = (facts: StageFacts): boolean => {
  if (facts.noticed) return false;
  if (facts.silentLines !== undefined) return facts.silentLines > 0;
  return facts.orderMatches === false && (facts.unmarkedLines !== undefined ? facts.unmarkedLines > 0 : facts.changeApplied && !facts.marked);
};
/** A request that left no change, no mark, no «Por resolver» point and no notice. */
export const ignoredRequestOf = (facts: StageFacts): boolean => facts.requested && !facts.changeApplied && !facts.marked && !facts.point && !facts.noticed;

/** From the start of the reading to the decision. The wait in the chat's queue (`enqueuedAt` to `readingStartedAt`) is not part of it. */
export const decisionLatencyMs = ({ readingStartedAt, decidedAt }: Readonly<{ enqueuedAt: Date; readingStartedAt: Date; decidedAt: Date }>): number =>
  decidedAt.getTime() - readingStartedAt.getTime();

const rate = (values: readonly boolean[]): number | null => values.length ? values.filter(Boolean).length / values.length : null;
const mean = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const stageGroup = (stage: string): "intent" | "extraction" | "resolution" | "photo" | "other" =>
  stage.startsWith("photo") ? "photo" : stage.endsWith("extraction") ? "extraction" : stage.endsWith("resolution") ? "resolution" : stage === "intent" ? "intent" : "other";

const sum = (costs: StageFacts["stageCostsUsd"], group: ReturnType<typeof stageGroup> | "all") =>
  Object.entries(costs).reduce((total, [stage, cost]) => group === "all" || stageGroup(stage) === group ? total + cost : total, 0);

/** The metrics of one run: its records, every message of the message passes. Stage metrics use the records that carry facts. */
export function metricsOfRun(records: readonly CaseRecord[]): RunMetrics {
  const messages = records.filter(({ pass }) => pass !== "image");
  const withFacts = messages.flatMap((record) => record.facts ? [record.facts] : []);
  const stated = (pick: (facts: StageFacts) => boolean | null) => withFacts.flatMap((facts) => { const value = pick(facts); return value === null ? [] : [value]; });
  // A path that states no decision (the legacy baseline) has no urgent share, precision or recall.
  const decided = withFacts.filter(({ decision }) => decision !== null);
  const urgentActual = decided.filter(({ decisionActual }) => decisionActual === "urgent");
  const urgentExpected = decided.filter(({ decisionExpected }) => decisionExpected === "urgent");
  const cost = (group: Parameters<typeof sum>[1]) => mean(withFacts.map(({ stageCostsUsd }) => sum(stageCostsUsd, group)));
  const readings = withFacts.map(({ readingMs }) => readingMs);
  return {
    intentAccuracy: rate(stated(({ intent }) => intent)),
    fieldsAccuracy: rate(stated(({ fields }) => fields)),
    resolutionAccuracy: rate(stated(({ resolution }) => resolution)),
    decisionAccuracy: rate(stated(({ decision }) => decision)),
    // Records without facts (the legacy reader path) keep the flags their scoring already set.
    silentWrongChanges: messages.filter((record) => record.facts ? silentWrongChangeOf(record.facts) : record.wrongVisibleField).length,
    ignoredRequests: messages.filter((record) => record.facts ? ignoredRequestOf(record.facts) : record.ignoredActions > 0).length,
    urgentShare: decided.length ? urgentActual.length / decided.length : null,
    // The seller is interrupted when the case did not need it: over the decided messages, so an adversarial set cannot hide it behind the share of expected urgents.
    falseUrgentShare: decided.length ? urgentActual.filter(({ decisionExpected }) => decisionExpected !== "urgent").length / decided.length : null,
    urgentPrecision: urgentActual.length ? urgentActual.filter(({ decisionExpected }) => decisionExpected === "urgent").length / urgentActual.length : null,
    urgentRecall: urgentExpected.length ? urgentExpected.filter(({ decisionActual }) => decisionActual === "urgent").length / urgentExpected.length : null,
    changedNotices: withFacts.filter(({ changedNotice }) => changedNotice).length,
    costIntentUsd: cost("intent"),
    costExtractionUsd: cost("extraction"),
    costResolutionUsd: cost("resolution"),
    costPhotoUsd: cost("photo"),
    costPerMessageUsd: cost("all"),
    p95DecisionMs: readings.length ? percentile(readings, 0.95) : null,
  };
}

/** Mean, min and max of each metric over the runs that measured it; null when none did. */
export function aggregateRuns(runs: readonly RunMetrics[]): AggregatedMetrics {
  return Object.fromEntries(metricNames.map((name) => {
    const values = runs.flatMap((run) => run[name] === null ? [] : [run[name]]);
    if (!values.length) return [name, null];
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Floating-point sums can leave the mean a hair outside identical values.
    return [name, { mean: Math.min(max, Math.max(min, mean(values)!)), min, max, runs: values.length }];
  })) as AggregatedMetrics;
}

export type Comparison = "better" | "worse" | "different" | "not distinguishable" | "not measured";

/** How `after` stands against `before`: better or worse only when the two ranges do not overlap, else «not distinguishable». */
export function compareMetric(name: MetricName, before: MetricRange | null, after: MetricRange | null): Comparison {
  if (!before || !after) return "not measured";
  if (before.max >= after.min && after.max >= before.min) return "not distinguishable";
  const lower = after.max < before.min;
  if (lowerIsBetter.has(name)) return lower ? "better" : "worse";
  if (higherIsBetter.has(name)) return lower ? "worse" : "better";
  return "different";
}

/** The records of a report file grouped by run (`repeat`), each group one run. */
export function runsOfRecords(records: readonly CaseRecord[]): readonly (readonly CaseRecord[])[] {
  const groups = new Map<number, CaseRecord[]>();
  for (const record of records) groups.set(record.repeat, [...(groups.get(record.repeat) ?? []), record]);
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}
