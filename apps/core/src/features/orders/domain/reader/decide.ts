import type { ResolvedChatAction } from "@core/src/features/orders/domain/chat-order";
import type { Agreement, CertaintySignals, ChangeDecision, ChangeRisk, DoubtReason, ProblemKind } from "@core/src/features/orders/domain/reader/decision";
import type { RequestRef } from "@core/src/features/orders/domain/reader/refs";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

/**
 * One action the checks resolved, with what the decision needs and nothing the model said.
 * `doubt` is the reason shown when a single best reading exists; `urgent` is what the seller learns when none does.
 */
export type CheckedAction = Readonly<{
  request: RequestRef;
  action: ResolvedChatAction;
  signals: CertaintySignals;
  doubt: DoubtReason | null;
  urgent: Readonly<{ problem: ProblemKind; question: SuggestedQuestion | null }> | null;
  /** The chat has no order open for this item change: urgent whatever the certainty. */
  blocked: "no_open_order" | "order_closed" | null;
}>;

/** Facts from outside the action that change a decision. */
export type DecisionGuards = Readonly<{ captionUnread: boolean }>;

/** High certainty holds only when every signal holds; the photo just sent counts as a named target for set wording. */
export function isHighCertainty(signals: CertaintySignals): boolean {
  return signals.quotesComplete && signals.targetNamed !== "context" && signals.variantChangeVerb !== "absent" && signals.candidates === "single";
}

/** Items a message can change by a name or by reference. */
export function riskOf(action: ResolvedChatAction, signals: CertaintySignals): ChangeRisk {
  switch (action.kind) {
    case "remove": case "set_quantity": case "lower_quantity": case "change_variant": case "set_photo_item_quantity": case "change_unfound_item": return "high";
    case "add": case "increase_quantity": case "set_mentioned_price": return signals.targetNamed === "context" ? "high" : "low";
    default: return "low";
  }
}

/** What an action does, without the words that produced it: kind, target, variant and quantity. */
function signatureOf(action: ResolvedChatAction): string {
  switch (action.kind) {
    case "add": return JSON.stringify([action.kind, action.item.variantId, action.quantity]);
    case "remove": return JSON.stringify([action.kind, action.target, action.amount]);
    case "set_quantity": case "increase_quantity": case "lower_quantity": return JSON.stringify([action.kind, action.target, action.quantity]);
    case "change_variant": return JSON.stringify([action.kind, action.target, action.to.kind === "resolved" ? action.to.item.variantId : [action.to.kind, action.to.productId]]);
    case "set_mentioned_price": case "change_unfound_item": return JSON.stringify([action.kind, action.target]);
    case "change_pending_quantity": return JSON.stringify([action.kind, action.pendingId, action.mode, action.quantity]);
    case "set_photo_item_quantity": return JSON.stringify([action.kind, action.variantId, action.quantity]);
    case "draft_pending": return JSON.stringify([action.kind, action.draft.subject, action.draft.quantity, action.draft.known]);
    case "advance_pending": return JSON.stringify([action.kind, action.request.pendingId, action.request.mode, action.request.quantity, action.request.values]);
    case "decline_pending": return JSON.stringify([action.kind, action.pendingId]);
    case "caption_doubt": return JSON.stringify([action.kind, action.productId]);
    case "ready": return action.kind;
    case "report": return JSON.stringify([action.kind, action.outcome.kind]);
  }
}

/** `agree` when the confirming chain resolves to the same action kind, target, variant and quantity. It knows nothing of which stages had a confirming configuration. */
export function agreementOf(primary: ResolvedChatAction, confirming: ResolvedChatAction | null): Agreement {
  if (confirming === null) return "not_run";
  return signatureOf(primary) === signatureOf(confirming) ? "agree" : "disagree";
}

const pendingSide: ReadonlySet<ResolvedChatAction["kind"]> = new Set(["draft_pending", "advance_pending", "change_pending_quantity", "decline_pending"]);

/** The decision of one action, from its signals, risk and agreement alone. The same inputs give the same decision, without a model. */
export function decideChange(checked: CheckedAction, risk: ChangeRisk, agreement: Agreement, guards: DecisionGuards): ChangeDecision {
  const { action, signals } = checked;
  if (action.kind === "report") return reportDecision(checked);
  if (action.kind === "ready") return { kind: "applied" };
  if (action.kind === "caption_doubt") return { kind: "silent" };
  if (action.kind === "draft_pending") return { kind: "pending" };
  if (action.kind === "change_unfound_item" && !checked.blocked) return { kind: "urgent", ...(checked.urgent ?? { problem: "unclear_item", question: null }) };
  if (checked.blocked) return { kind: "urgent", problem: checked.blocked, question: null };
  if (action.kind === "add" && guards.captionUnread) return { kind: "doubtful", reason: { kind: "caption_unread" } };
  const high = isHighCertainty(signals) && (risk === "low" || agreement === "agree");
  if (high) return pendingSide.has(action.kind) ? { kind: "pending" } : { kind: "applied" };
  if (checked.doubt) return { kind: "doubtful", reason: checked.doubt };
  return { kind: "urgent", ...(checked.urgent ?? { problem: "reader_doubt", question: null }) };
}

function reportDecision(checked: CheckedAction): ChangeDecision {
  const { action } = checked;
  if (action.kind !== "report") return { kind: "silent" };
  const { outcome } = action;
  if (outcome.kind === "no_intent") return { kind: "silent" };
  if ((outcome.kind === "not_identified" || outcome.kind === "not_clear") && outcome.silent) return { kind: "silent" };
  return { kind: "urgent", problem: outcome.kind, question: checked.urgent?.question ?? null };
}
