import type { DecisionKind, IntentKind, MessageExpectation } from "@core/evals/cases/schema";
import type { StageFacts } from "@core/evals/lib/case-record";

/**
 * Scoring of the staged reader's answers (technical design 6.3): a case states the intent, the extracted fields, the chosen product and the decision;
 * the cases written before the stages are relabelled by derivation from their notice and outcomes. The staged path (T16) and the fake mode both build
 * a `StageAnswer` and score it here.
 */

/** Notices that interrupt the seller: the problems, the payment request and the count of several problems. «Pedido #N cambió» is counted apart. */
const urgentNotices: ReadonlySet<string> = new Set(["not_identified", "not_clear", "variant_missing", "variant_not_available", "quantity_above_limit", "unclear_item", "unnamed_add",
  "variant_only", "image_with_request", "no_open_order", "failed", "order_closed", "several_problems", "not_applied", "caption_not_applied", "product_not_available",
  "variant_for_several_pendings", "payment_request"]);
const pendingOutcomes: ReadonlySet<string> = new Set(["pending_created", "pending_updated", "pending_split"]);
const noticeOutcomes: ReadonlySet<string> = new Set(["ready", "ready_with_pendings", "only_item_kept"]);
const noChangeOutcomes: ReadonlySet<string> = new Set(["no_intent", "questions", "caption_not_applied"]);

/** The decision a case expects: its own `decision`, else derived from the notice (urgent or informative) and the outcomes (pending, applied or silent). */
export function decisionOf(expectation: MessageExpectation): DecisionKind {
  if (expectation.decision) return expectation.decision;
  if (expectation.notice) return urgentNotices.has(expectation.notice) ? "urgent" : "notice";
  const outcomes = expectation.outcomes ?? [];
  if (outcomes.some((kind) => noticeOutcomes.has(kind))) return "notice";
  if (outcomes.some((kind) => pendingOutcomes.has(kind))) return "pending";
  const changes = outcomes.some((kind) => !noChangeOutcomes.has(kind)) || (outcomes.length === 0 && expectation.order !== undefined);
  return changes ? "applied" : "silent";
}

export type ExpectedStages = Readonly<{
  intent: IntentKind;
  /** The buyer asked for something: the intent is `requests`. */
  requested: boolean;
  fields: Readonly<Record<string, string>> | null;
  product: string | null;
  decision: DecisionKind;
}>;

export function expectedStagesOf(expectation: MessageExpectation): ExpectedStages {
  const outcomes = expectation.outcomes ?? [];
  const intent: IntentKind = expectation.stages?.intent ?? (expectation.outcomes !== undefined && outcomes.every((kind) => kind === "no_intent" || kind === "questions") ? "no_intent" : "requests");
  return { intent, requested: intent === "requests", fields: expectation.stages?.fields ?? null, product: expectation.stages?.product ?? null, decision: decisionOf(expectation) };
}

/** What a reader path (staged pipeline or script) leaves for one message. */
export type StageAnswer = Readonly<{
  intent: IntentKind;
  fields: Readonly<Record<string, string>> | null;
  product: string | null;
  decision: DecisionKind;
  changeApplied: boolean;
  marked: boolean;
  point: boolean;
  noticed: boolean;
  changedNotice: boolean;
  orderMatches: boolean | null;
  readingMs: number;
  queuedMs: number;
  stageCostsUsd: Readonly<Record<string, number>>;
}>;

const sameFields = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>> | null): boolean =>
  b !== null && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([name, value]) => b[name] === value);

export function scoreStages(expected: ExpectedStages, answer: StageAnswer): StageFacts {
  return {
    intent: expected.intent === answer.intent,
    fields: expected.fields ? sameFields(expected.fields, answer.fields) : null,
    resolution: expected.product !== null ? expected.product === answer.product : null,
    decision: expected.decision === answer.decision,
    decisionExpected: expected.decision,
    decisionActual: answer.decision,
    requested: expected.requested,
    changeApplied: answer.changeApplied, marked: answer.marked, point: answer.point, noticed: answer.noticed,
    orderMatches: answer.orderMatches, changedNotice: answer.changedNotice,
    readingMs: answer.readingMs, queuedMs: answer.queuedMs, stageCostsUsd: answer.stageCostsUsd,
  };
}
