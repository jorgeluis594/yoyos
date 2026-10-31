import type { CaseRecord } from "@core/evals/lib/case-record";
import { aggregateRuns, compareMetric, metricNames, metricsOfRun, runsOfRecords, type Comparison, type MetricName, type MetricRange } from "@core/evals/lib/metrics";
import type { EvalReport } from "@core/evals/lib/report";

/** `eval:compare <a> <b>`: two saved runs, metric by metric, better or worse only when the ranges do not overlap. Pure; the script reads the files. */

export type ResultFile = Readonly<{ report: EvalReport; records: readonly CaseRecord[] }>;
export type MetricComparison = Readonly<{ name: MetricName; before: MetricRange | null; after: MetricRange | null; verdict: Comparison }>;

/** The metrics of a result file: the report's, or for a file saved before the runs section existed, recomputed from its records. */
const metricsOf = (file: ResultFile) =>
  (file.report as Partial<EvalReport>).runs?.metrics
    ?? aggregateRuns(runsOfRecords(file.records.filter((record) => !record.tags.includes("known-limitation"))).map(metricsOfRun));

export function compareResults(before: ResultFile, after: ResultFile): readonly MetricComparison[] {
  const a = metricsOf(before);
  const b = metricsOf(after);
  return metricNames.map((name) => ({ name, before: a[name], after: b[name], verdict: compareMetric(name, a[name], b[name]) }));
}

const rangeText = (range: MetricRange | null): string => range ? `${format(range.mean)} [${format(range.min)}–${format(range.max)}]` : "n/a";
const format = (value: number): string => Math.abs(value) < 0.01 && value !== 0 ? value.toExponential(1) : String(Math.round(value * 1000) / 1000);

export function formatComparison(rows: readonly MetricComparison[], beforeName: string, afterName: string): string {
  return [`Comparison of ${beforeName} (before) and ${afterName} (after): mean [min–max] over the runs of each`,
    ...rows.map(({ name, before, after, verdict }) => `  ${name.padEnd(22)} ${rangeText(before).padEnd(26)} → ${rangeText(after).padEnd(26)} ${verdict}`)].join("\n");
}
