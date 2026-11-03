import type { DecisionKind, IntentKind, MessageExpectation } from "@core/evals/cases/schema";
import type { ScoredChangedLine } from "@core/evals/lib/changed-lines";
import type { StageFacts } from "@core/evals/lib/case-record";

/**
 * Scoring of the staged reader's answers (technical design 6.3): a case states the intent, the extracted fields, the chosen product and the decision;
 * the cases written before the stages are relabelled by derivation from their notice and outcomes. The staged path (T16) and the fake mode both build
 * a `StageAnswer` and score it here.
 */

/**
 * Notices that interrupt the seller: the problems, the payment request and the count of several problems. «Pedido #N cambió» is counted apart.
 * `ready_with_pendings` is one of them: the production reader lists it among its problems (`problemKinds` in reader/decision.ts, the decision's `urgent`
 * kind, docs/message-to-order.md «Problems (all urgent)»), because a «listo» that leaves a pending needs the seller's chat before charging.
 */
const urgentNotices: ReadonlySet<string> = new Set(["not_identified", "not_clear", "variant_missing", "variant_not_available", "quantity_above_limit", "unclear_item", "unnamed_add",
  "variant_only", "image_with_request", "no_open_order", "failed", "order_closed", "several_problems", "not_applied", "caption_not_applied", "product_not_available",
  "variant_for_several_pendings", "payment_request", "ready_with_pendings"]);
/** Outcomes that are problems for the seller: a case that states one of them with no notice still expects an interruption, never a silent change. */
const urgentOutcomes: ReadonlySet<string> = new Set(["unnamed_add", "variant_only", "image_with_request", "no_open_order", "not_identified", "not_clear", "variant_missing",
  "variant_not_available", "quantity_above_limit", "unclear_item", "failed", "order_closed", "product_not_available", "variant_for_several_pendings", "payment_requested",
  "invalid_action", "reader_doubt", "request_not_allowed", "ready_with_pendings"]);
/** The problems a pending carries as its own «Por resolver» point (the question the seller asks to finish it). A case that states no notice reads them beside a pending as the pending. */
const pendingPoints: ReadonlySet<string> = new Set(["variant_missing", "variant_not_available", "not_clear"]);
const pendingOutcomes: ReadonlySet<string> = new Set(["pending_created", "pending_updated", "pending_split"]);
const noticeOutcomes: ReadonlySet<string> = new Set(["ready", "only_item_kept"]);
/** `pending_ended` is not one: a decline ends the pending as the buyer asked, so it is a change; a case that expects an interruption states its `decision`. */
const noChangeOutcomes: ReadonlySet<string> = new Set(["no_intent", "questions", "caption_not_applied"]);

const severity: readonly DecisionKind[] = ["urgent", "pending", "doubtful", "applied", "silent"];

/** What a message left, as both sides state it: a case's labels and the reader's own result. Both go through `decisionFromEvidence`. */
export type DecisionEvidence = Readonly<{
  notice: string | null;
  outcomes: readonly string[];
  /** The decisions of the reader's actions when the outcomes carry nothing to read them from, and `doubtful` (a decision the outcomes cannot tell). A case with an order states `applied`. */
  decisions?: readonly DecisionKind[];
}>;

/**
 * The ONE criterion of a message's decision, used for the expected side (`decisionOf`) and the actual one (lib/staged-answer.ts), so a label that
 * matches what the reader did can be scored as right. In order:
 * 1. urgent: an urgent notice (the seller is interrupted, whatever else the message did) or a problem outcome; with no notice, a pending's own point
 *    (`pendingPoints`) beside a pending is the pending's, not a problem. So «pending created + not_clear» that sends «not_clear» is urgent, on both sides.
 * 2. notice: an informative notice, or «listo» / «only item kept» outcomes.
 * 3. pending: the message created, updated or split a pending, unless the trace's only decisions are `doubtful` (a marked change to the pending is a
 *    mark, not lost behind its outcome). A completion is not one: it adds the item, so it is a change.
 * 4. else the change itself: `doubtful` when the reader marked it, `applied` when it changed the order, `silent` otherwise.
 */
export function decisionFromEvidence({ notice, outcomes, decisions = [] }: DecisionEvidence): DecisionKind {
  const pending = outcomes.some((kind) => pendingOutcomes.has(kind));
  const problems = outcomes.filter((kind) => urgentOutcomes.has(kind) && !(pending && pendingPoints.has(kind)));
  const noticeIsUrgent = notice !== null && urgentNotices.has(notice);
  if (problems.length > 0 || noticeIsUrgent) return "urgent";
  if ((notice !== null && !urgentNotices.has(notice)) || outcomes.some((kind) => noticeOutcomes.has(kind))) return "notice";
  if (pending) return decisions.includes("doubtful") && !decisions.includes("pending") ? "doubtful" : "pending";
  if (outcomes.length === 0) return severity.find((kind) => decisions.includes(kind)) ?? "silent";
  if (!outcomes.some((kind) => !noChangeOutcomes.has(kind))) return "silent";
  return decisions.includes("doubtful") ? "doubtful" : "applied";
}

/** The decision a case expects: its own `decision`, else the one its notice and outcomes give (`decisionFromEvidence`). */
export function decisionOf(expectation: MessageExpectation): DecisionKind {
  if (expectation.decision) return expectation.decision;
  const outcomes = expectation.outcomes ?? [];
  return decisionFromEvidence({ notice: expectation.notice ?? null, outcomes, decisions: outcomes.length === 0 && expectation.order !== undefined ? ["applied"] : [] });
}

export type ExpectedStages = Readonly<{
  intent: IntentKind;
  /** The buyer asked for something: the intent is `requests`. */
  requested: boolean;
  fields: Readonly<Record<string, string>> | null;
  product: string | null;
  decision: DecisionKind;
}>;

/** A step that states nothing but a silent decision (no outcomes, no notice, no order): the buyer asked nothing, so there is no request the reader could ignore. */
const onlySilent = (expectation: MessageExpectation): boolean =>
  expectation.decision === "silent" && expectation.outcomes === undefined && expectation.notice == null && expectation.order === undefined;

export function expectedStagesOf(expectation: MessageExpectation): ExpectedStages {
  const outcomes = expectation.outcomes ?? [];
  const asksNothing = onlySilent(expectation) || (expectation.outcomes !== undefined && outcomes.every((kind) => kind === "no_intent" || kind === "questions"));
  const intent: IntentKind = expectation.stages?.intent ?? (asksNothing ? "no_intent" : "requests");
  return { intent, requested: intent === "requests", fields: expectation.stages?.fields ?? null, product: expectation.stages?.product ?? null, decision: decisionOf(expectation) };
}

/** What a reader path (staged pipeline or script) leaves for one message. */
export type StageAnswer = Readonly<{
  intent: IntentKind;
  fields: Readonly<Record<string, string>> | null;
  product: string | null;
  /** Null when the path states no decision (the legacy baseline, which only has an intent and a cost). */
  decision: DecisionKind | null;
  /** The path reads the intent only: fields, product and decision are not scored. */
  intentOnly?: boolean;
  changeApplied: boolean;
  marked: boolean;
  /** The lines the message changed, each with its mark (own or inherited) and whether it differs from the expected order's line; absent when the path does not read them. */
  changedLines?: readonly ScoredChangedLine[];
  point: boolean;
  noticed: boolean;
  changedNotice: boolean;
  orderMatches: boolean | null;
  readingMs: number;
  queuedMs: number;
  stageCostsUsd: Readonly<Record<string, number>>;
}>;

/** The text without accents, case or edge spaces: how values and names are compared. */
export const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const foldedFields = (fields: Readonly<Record<string, string>>): ReadonlyMap<string, string> => new Map(Object.entries(fields).map(([name, value]) => [fold(name), fold(value)]));

/** Same names and values, folding case and accents: the answer holds catalog values, and a label may spell them with another case. */
const sameFields = (expected: Readonly<Record<string, string>>, answered: Readonly<Record<string, string>> | null): boolean => {
  if (answered === null) return false;
  const wanted = foldedFields(expected);
  const found = foldedFields(answered);
  return wanted.size === found.size && [...wanted].every(([name, value]) => found.get(name) === value);
};

export function scoreStages(expected: ExpectedStages, answer: StageAnswer): StageFacts {
  return {
    intent: expected.intent === answer.intent,
    fields: expected.fields && !answer.intentOnly ? sameFields(expected.fields, answer.fields) : null,
    resolution: expected.product !== null && !answer.intentOnly ? expected.product === answer.product : null,
    decision: answer.decision === null ? null : expected.decision === answer.decision,
    decisionExpected: expected.decision,
    decisionActual: answer.decision ?? (answer.changeApplied ? "applied" : "silent"),
    requested: expected.requested,
    changeApplied: answer.changeApplied, marked: answer.marked,
    ...(answer.changedLines ? { changedLines: answer.changedLines.length, unmarkedLines: answer.changedLines.filter(({ marked }) => !marked).length,
    silentLines: answer.changedLines.filter(({ marked, wrong }) => !marked && wrong).length } : {}),
    point: answer.point, noticed: answer.noticed,
    orderMatches: answer.orderMatches, changedNotice: answer.changedNotice,
    readingMs: answer.readingMs, queuedMs: answer.queuedMs, stageCostsUsd: answer.stageCostsUsd,
  };
}
