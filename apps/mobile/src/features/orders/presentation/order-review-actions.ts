import * as Crypto from "expo-crypto";
import type { ConfirmOrderReviewRequest, ConfirmOrderReviewResponse, OrderReviewResponse } from "@shared/contracts/order-review";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import type { Result } from "@shared/result";
import { orders } from "@mobile/features/orders/composition";
import { repeatWhileInDoubt } from "@mobile/features/orders/application/in-doubt";
import type { ReviewRequestError } from "@mobile/features/orders/application/order-operations";

export type LinkActionKind = "copy" | "share" | "open";
export type UndoRefusalReason = "order_moved_on" | "later_change" | "would_empty" | "not_sold";
export type UndoOutcome =
  | Readonly<{ kind: "done"; order: OrderAggregateResponse; review: OrderReviewResponse }>
  | Readonly<{ kind: "refused"; reason: UndoRefusalReason }>
  | Readonly<{ kind: "failed" }>;

type ConfirmOrderReviewInput = Omit<ConfirmOrderReviewRequest, "version">;

/** Confirms a review. The same input (and client id) is repeated while the answer may have been lost, so the review is saved once. */
export function confirmReview(orderId: string, input: ConfirmOrderReviewInput, onInDoubt: () => void): Promise<Result<ConfirmOrderReviewResponse, ReviewRequestError>> {
  return repeatWhileInDoubt(() => orders.confirmOrderReview(orderId, input), { onInDoubt });
}

/** Undoes one message. Core answers a repeat of an undone message with success, so repeating never undoes twice. */
export async function undoMessage(orderId: string, messageId: string, onInDoubt: () => void): Promise<UndoOutcome> {
  const result = await repeatWhileInDoubt(() => orders.undoMessage(orderId, messageId), { onInDoubt });
  if (result.success) return { kind: "done", order: result.data.order, review: result.data.review };
  return result.error.code === "UNDO_REFUSED" && result.error.reason ? { kind: "refused", reason: result.error.reason } : { kind: "failed" };
}

/** Records a link action the seller took. A failure is retried once and then dropped: the link was already taken. */
export async function recordLinkAction(orderId: string, action: LinkActionKind): Promise<void> {
  const input = { id: Crypto.randomUUID(), action };
  try {
    const first = await orders.recordLinkAction(orderId, input);
    if (!first.success) await orders.recordLinkAction(orderId, input);
  } catch { /* Dropped: «Pedido #N cambió» is not armed for that cycle. */ }
}
