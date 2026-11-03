import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import { agreementOf, decideChange, riskOfChecked, type CheckedAction, type DecisionGuards } from "@core/src/features/orders/domain/reader/decide";
import type { Agreement, ChangeDecision, ChangeRisk } from "@core/src/features/orders/domain/reader/decision";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";
import type { VariantId } from "@core/src/features/products/domain/product";

type Doubtful = Extract<ChangeDecision, { kind: "doubtful" }>;

export type DecidedAction = Readonly<{ checked: CheckedAction; risk: ChangeRisk; agreement: Agreement; decision: ChangeDecision }>;
export type DecidedChanges = Readonly<{
  /** One per checked action, with what the decision was made from. */
  decided: readonly DecidedAction[];
  /** What the order domain applies: applied and doubtful actions as they are, and a report in place of every urgent action. */
  actions: readonly ResolvedChatAction[];
  /** The decision of the change rows by variant, for the lines a doubtful action touches. */
  doubtful: ReadonlyMap<VariantId, Doubtful>;
  /** Doubtful decisions on pendings (a quantity change or a partial answer), by pending id. */
  pendingDoubts: ReadonlyMap<ChatPendingId, Doubtful>;
  /** The suggested questions of the urgent decisions, in action order. */
  questions: readonly SuggestedQuestion[];
}>;

/** The variants of the order a doubtful action touches. */
function variantsOf(action: ResolvedChatAction): readonly VariantId[] {
  switch (action.kind) {
    case "add": return [action.item.variantId];
    case "remove": case "set_quantity": case "increase_quantity": case "lower_quantity": case "set_mentioned_price":
      return action.target.kind === "variant" ? [action.target.variantId] : [];
    case "change_variant": return [...action.target.kind === "variant" ? [action.target.variantId] : [], ...action.to.kind === "resolved" ? [action.to.item.variantId] : []];
    case "set_photo_item_quantity": return [action.variantId];
    default: return [];
  }
}

function pendingOf(action: ResolvedChatAction): ChatPendingId | null {
  if (action.kind === "change_pending_quantity") return action.pendingId;
  return action.kind === "advance_pending" ? action.request.pendingId : null;
}

/** The confirming chain's actions of the same request: «agree» when one has the same signature, «disagree» when it resolved the request differently or not at all. */
function agreementFor(action: CheckedAction, confirming: readonly CheckedAction[] | null): Agreement {
  if (confirming === null) return "not_run";
  const same = confirming.filter(({ request }) => request === action.request);
  if (same.length === 0) return "disagree";
  return same.some((other) => agreementOf(action.action, other.action) === "agree") ? "agree" : "disagree";
}

/** The units a pending quantity change or an answer with a number gives, or null for an action that states no quantity on a pending. */
export function pendingQuantityOf(action: ResolvedChatAction): number | null {
  if (action.kind === "change_pending_quantity") return action.quantity;
  return action.kind === "advance_pending" ? action.request.quantity : null;
}

/** Whether the confirming reading of the same request says another quantity (or mode) for the same pending; false when it did not run. */
function pendingQuantityDisputed(action: CheckedAction, confirming: readonly CheckedAction[] | null): boolean {
  if (confirming === null || pendingQuantityOf(action.action) === null) return false;
  const same = confirming.filter(({ request }) => request === action.request).map((other) => other.action);
  const mine = action.action;
  return !same.some((other) => other.kind === mine.kind && pendingOf(other) === pendingOf(mine) && pendingQuantityOf(other) === pendingQuantityOf(mine)
    && (mine.kind !== "change_pending_quantity" || (other.kind === "change_pending_quantity" && other.mode === mine.mode)));
}

/** The action that stands for an urgent decision: a check's own report, or «reader_doubt» for an action with no best reading. */
function reportFor(checked: CheckedAction): ResolvedChatAction {
  const { action } = checked;
  if (action.kind === "report" || action.kind === "change_unfound_item") return action;
  return { kind: "report", outcome: { kind: "reader_doubt", orderId: null } };
}

/**
 * Decides every checked action of a message from its certainty signals, risk and agreement with the confirming chain (pure).
 * The caller runs the checks on the locked state, so the signals are those of the state the decision applies to.
 */
export function decideChanges(checks: readonly CheckedAction[], confirming: readonly CheckedAction[] | null, guards: DecisionGuards): DecidedChanges {
  const decided = checks.map((checked): DecidedAction => {
    const risk = riskOfChecked(checked);
    const agreement = agreementFor(checked, confirming);
    const decision = decideChange(checked, risk, agreement, guards);
    // A quantity on a pending that the confirming reading reads differently is never silent: the pending carries «Con duda», which a completion inherits.
    const disputed = decision.kind === "pending" && checked.doubt !== null && pendingQuantityDisputed(checked, confirming);
    return { checked, risk, agreement, decision: disputed ? { kind: "doubtful", reason: checked.doubt! } : decision };
  });
  const doubtful = new Map<VariantId, Doubtful>();
  const pendingDoubts = new Map<ChatPendingId, Doubtful>();
  const questions: SuggestedQuestion[] = [];
  const actions = decided.map(({ checked, decision }): ResolvedChatAction => {
    if (decision.kind === "doubtful") {
      for (const variantId of variantsOf(checked.action)) doubtful.set(variantId, decision);
      const pendingId = pendingOf(checked.action);
      if (pendingId) pendingDoubts.set(pendingId, decision);
    }
    if (decision.kind !== "urgent") return checked.action;
    if (decision.question) questions.push(decision.question);
    return reportFor(checked);
  });
  return { decided, actions, doubtful, pendingDoubts, questions };
}
