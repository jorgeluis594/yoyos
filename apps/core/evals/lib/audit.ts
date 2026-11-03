import type { CaseRecord } from "@core/evals/lib/case-record";
import { rangeOfValues, runsOfRecords, type MetricRange } from "@core/evals/lib/metrics";

/**
 * The views the CTO's audit of PR #393 asked for, next to the metrics of lib/metrics.ts: variants of the same measurements (without label artefacts, without
 * cascades, with `ready_with_pendings` counted as urgent) that never replace the gate's own definition. Computed per run from the stored records and
 * aggregated as mean and range over the runs. Pure: unit-tested in audit.test.ts. Aggregate numbers only.
 */

export type AuditReport = Readonly<{
  /** The stage fields compared strictly, apart from the main `fieldsAccuracy` metric (see README «How the stages are scored»). */
  stageFields: Readonly<{
    /** Per run: the messages whose case states fields, and of them those with a request left between several products. */
    labelled: MetricRange | null;
    between: MetricRange | null;
    /** `fields` accuracy when a message with a `between` resolution never passes. */
    strictAccuracy: MetricRange | null;
  }>;
}>;

const rate = (values: readonly boolean[]): number | null => values.length ? values.filter(Boolean).length / values.length : null;

/** The records of the message passes that carry facts, one run each (`repeat`). */
const runsWithFacts = (records: readonly CaseRecord[]) =>
  runsOfRecords(records.filter(({ event, pass, facts }) => event === undefined && pass !== "image" && facts !== undefined));

function stageFieldsOf(records: readonly CaseRecord[]): AuditReport["stageFields"] {
  const runs = runsWithFacts(records).map((run) => run.flatMap(({ facts }) => facts && facts.fields !== null ? [facts] : []));
  const nonEmpty = runs.filter((run) => run.length > 0);
  return {
    labelled: rangeOfValues(nonEmpty.map((run) => run.length)),
    between: rangeOfValues(nonEmpty.map((run) => run.filter(({ fieldsBetween }) => fieldsBetween === true).length)),
    strictAccuracy: rangeOfValues(nonEmpty.flatMap((run) => rate(run.map(({ fields, fieldsBetween }) => fields === true && fieldsBetween !== true)) ?? [])),
  };
}

/** `records` are the records of the run file without the known limitations, events included. */
export function auditOf(records: readonly CaseRecord[]): AuditReport {
  return { stageFields: stageFieldsOf(records) };
}
