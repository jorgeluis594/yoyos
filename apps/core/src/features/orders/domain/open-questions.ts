import type { ChatMessageOutcome, ChatMessageOutcomes, ChatPendingId } from "@core/src/features/orders/domain/chat-message-outcome";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

/** A chat view shows at most this many question boxes per message. */
export const maxQuestionsPerMessage = 3;

export type OrderQuestionFacts = Readonly<{ open: boolean; sellerActedAt: Date | null }>;
export type OpenQuestionFacts = Readonly<{
  /** When the message was read: its outcome's creation time. */
  readAt: Date;
  /** The ids in the chat's stored pendings. */
  alivePendingIds: ReadonlySet<ChatPendingId>;
  /** The last message of the chat read with intent `requests`. */
  lastRequestAt: Date | null;
  /** The orders the outcomes name; an order that is not here no longer exists for messages. */
  orders: ReadonlyMap<OrderId, OrderQuestionFacts>;
}>;

/** The pendings this message created, updated or split. */
export function namedPendingIds(outcomes: ChatMessageOutcomes): readonly ChatPendingId[] {
  return outcomes.flatMap((outcome): ChatPendingId[] => {
    if (outcome.kind === "pending_created" || outcome.kind === "pending_updated") return [outcome.pendingId];
    return outcome.kind === "pending_split" ? [outcome.pendingId, outcome.newPendingId] : [];
  });
}

/** The orders the message acted on; an order that a new one replaced is closed by definition and not named. */
export function namedOrderIds(outcomes: ChatMessageOutcomes): readonly OrderId[] {
  const ids = outcomes.flatMap((outcome: ChatMessageOutcome): OrderId[] => {
    switch (outcome.kind) {
      case "ready": case "only_item_kept": case "order_closed": case "new_order_after_closed": case "changed_after_link":
        return [outcome.orderId];
      case "reader_doubt": case "request_not_allowed": case "invalid_action": case "unclear_item": case "ready_with_pendings": case "caption_not_applied":
        return outcome.orderId ? [outcome.orderId] : [];
      case "payment_requested":
        return outcome.order.kind === "none" ? [] : [outcome.order.orderId];
      default:
        return [];
    }
  });
  return [...new Set(ids)];
}

/**
 * The suggested questions of a read message that are still open.
 * With pendings, they stay while any pending the message named is alive. Without, they leave when a later message of the chat is read with order
 * intent, when the seller edits, undoes or reviews a named order, or when it stops being open for messages.
 */
export function openQuestionsOf(outcomes: ChatMessageOutcomes, facts: OpenQuestionFacts): readonly SuggestedQuestion[] {
  const questions = outcomes.flatMap((outcome) => (outcome.kind === "questions" ? outcome.questions : []));
  if (questions.length === 0) return [];
  const pendings = namedPendingIds(outcomes);
  const open = pendings.length > 0 ? pendings.some((id) => facts.alivePendingIds.has(id)) : openWithoutPending(outcomes, facts);
  return open ? questions.slice(0, maxQuestionsPerMessage) : [];
}

function openWithoutPending(outcomes: ChatMessageOutcomes, facts: OpenQuestionFacts): boolean {
  if (facts.lastRequestAt && facts.lastRequestAt.getTime() > facts.readAt.getTime()) return false;
  return namedOrderIds(outcomes).every((orderId) => {
    const order = facts.orders.get(orderId);
    return !!order && order.open && !(order.sellerActedAt && order.sellerActedAt.getTime() > facts.readAt.getTime());
  });
}
