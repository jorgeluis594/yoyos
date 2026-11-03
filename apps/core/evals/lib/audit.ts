import type { DecisionKind } from "@core/evals/cases/schema";
import { messageExpectationsOf, type CaseRecord } from "@core/evals/lib/case-record";
import { stepFailuresOf } from "@core/evals/lib/conversation";
import { rangeOfValues, runsOfRecords, silentWrongRecord, type MetricRange } from "@core/evals/lib/metrics";

/**
 * The views the CTO's audit of PR #393 asked for, next to the metrics of lib/metrics.ts: variants of the same measurements (without label artefacts, without
 * cascades, with `ready_with_pendings` counted as urgent) that never replace the gate's own definition. Computed per run from the stored records and
 * aggregated as mean and range over the runs. Pure: unit-tested in audit.test.ts. Aggregate numbers only.
 */

/**
 * Labels of the private holdout that no reader can match, so a false urgent on them is an artefact of the label, not a reader error: labels whose stated decision
 * cannot follow from their own notice under `decisionFromEvidence`. Only the false urgent view without them uses this set; the cases and their labels are not
 * edited, and no other metric excludes them. Matched by the base id of the record, so paraphrases and the steps of a conversation follow their case.
 */
export const impossibleLabelCaseIds: ReadonlySet<string> = new Set(["h5-100", "h5-103", "h5-104"]);

export type AuditReport = Readonly<{
  /** The stage fields compared strictly, apart from the main `fieldsAccuracy` metric (see README «How the stages are scored»). */
  stageFields: Readonly<{
    /** Per run: the messages whose case states fields, and of them those with a request left between several products. */
    labelled: MetricRange | null;
    between: MetricRange | null;
    /** `fields` accuracy when a message with a `between` resolution never passes. */
    strictAccuracy: MetricRange | null;
  }>;
  /**
   * What the false urgent share and the urgent recall would read if «listo» with pendings (`ready_with_pendings`) counted as urgent, on the side of the label
   * (unless it states its own `decision`) and on the side of the answer. The gate does not count it: the founder has not approved that definition.
   */
  readyWithPendings: Readonly<{ falseUrgentShare: MetricRange | null; urgentRecall: MetricRange | null }>;
  /**
   * The false urgent share of the gate (messages that interrupted the seller without needing it, over the decided messages) as it is, without the messages of
   * `impossibleLabelCaseIds`, without the carried failures, and without both. An excluded message is not counted as a false urgent and stays among the decided
   * messages, so the share is read over the same base in the four views.
   */
  falseUrgent: Readonly<{ asIs: MetricRange | null; withoutImpossibleLabels: MetricRange | null; withoutCascades: MetricRange | null; withoutBoth: MetricRange | null }>;
  /** Silent wrong changes per run (a count), as they are and without the carried failures. */
  silentWrongChanges: Readonly<{ asIs: MetricRange | null; withoutCascades: MetricRange | null }>;
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

/** The decision of the label and of the answer of one message. */
type Decisions = Readonly<{ expected: DecisionKind; actual: DecisionKind }>;

const readyWithPendings = "ready_with_pendings";
type Said = Readonly<{ notice?: string | null; outcomes?: readonly string[] }>;
const saysReadyWithPendings = (said: Said | null | undefined): boolean => said?.notice === readyWithPendings || (said?.outcomes ?? []).includes(readyWithPendings);

/** The decision of each side if `ready_with_pendings` were urgent: urgent when the label (with no `decision` of its own) or the answer says it, else as scored. */
function decisionsIfReadyUrgent(record: CaseRecord): Decisions {
  const facts = record.facts!;
  const expectation = messageExpectationsOf(record)[record.expectationIndex];
  const expectedUrgent = expectation !== undefined && expectation.decision === undefined && saysReadyWithPendings(expectation);
  return { expected: expectedUrgent ? "urgent" : facts.decisionExpected, actual: saysReadyWithPendings(record.actual as Said | null) ? "urgent" : facts.decisionActual };
}

/** Records of a run that state a decision (the legacy baseline states none), with the decision of both sides under `decisions`. */
const decided = (run: readonly CaseRecord[]) => run.filter(({ facts }) => facts !== undefined && facts.decision !== null);

function readyWithPendingsOf(records: readonly CaseRecord[]): AuditReport["readyWithPendings"] {
  const runs = runsWithFacts(records).map((run) => decided(run).map(decisionsIfReadyUrgent));
  const share = (run: Decisions[]) => run.length ? run.filter(({ expected, actual }) => actual === "urgent" && expected !== "urgent").length / run.length : null;
  const recall = (run: Decisions[]) => {
    const urgent = run.filter(({ expected }) => expected === "urgent");
    return urgent.length ? urgent.filter(({ actual }) => actual === "urgent").length / urgent.length : null;
  };
  const measured = (measure: (run: Decisions[]) => number | null) => rangeOfValues(runs.flatMap((run) => measure(run) ?? []));
  return { falseUrgentShare: measured(share), urgentRecall: measured(recall) };
}

/**
 * The records that are carried failures (lib/conversation.ts `stepFailuresOf`: a failed step after an earlier failed step of the same conversation and run).
 * Read over the records of the whole file, events included, because a failed event makes the later messages carried.
 */
const carriedOf = (records: readonly CaseRecord[]): ReadonlySet<CaseRecord> =>
  new Set(stepFailuresOf(records).filter(({ kind }) => kind === "carried").map(({ record }) => record));

const isFalseUrgent = ({ facts }: CaseRecord) => facts !== undefined && facts.decisionActual === "urgent" && facts.decisionExpected !== "urgent";

function falseUrgentOf(records: readonly CaseRecord[]): AuditReport["falseUrgent"] {
  const carried = carriedOf(records);
  const runs = runsWithFacts(records).map(decided).filter((run) => run.length > 0);
  const view = (dropLabels: boolean, dropCascades: boolean) => rangeOfValues(runs.map((run) =>
    run.filter((record) => isFalseUrgent(record) && !(dropLabels && impossibleLabelCaseIds.has(record.baseId)) && !(dropCascades && carried.has(record))).length / run.length));
  return { asIs: view(false, false), withoutImpossibleLabels: view(true, false), withoutCascades: view(false, true), withoutBoth: view(true, true) };
}

function silentWrongChangesOf(records: readonly CaseRecord[]): AuditReport["silentWrongChanges"] {
  const carried = carriedOf(records);
  const runs = runsOfRecords(records.filter(({ event, pass }) => event === undefined && pass !== "image"));
  return { asIs: rangeOfValues(runs.map((run) => run.filter(silentWrongRecord).length)),
    withoutCascades: rangeOfValues(runs.map((run) => run.filter((record) => silentWrongRecord(record) && !carried.has(record)).length)) };
}

/** `records` are the records of the run file without the known limitations, events included. */
export function auditOf(records: readonly CaseRecord[]): AuditReport {
  return { stageFields: stageFieldsOf(records), readyWithPendings: readyWithPendingsOf(records), falseUrgent: falseUrgentOf(records), silentWrongChanges: silentWrongChangesOf(records) };
}
