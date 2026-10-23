import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import { chooseSellerNotice, sellerNoticeTarget, type SellerNoticeTarget } from "@core/src/features/orders/domain/seller-notice";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

type Failure = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type FindSellerNoticeTargetError = Failure | Readonly<{ code: "NOTICE_NOT_FOUND"; message: string }>;

export type FindSellerNoticeTargetDependencies = Readonly<{
  findOutcome: (messageId: ChatMessageId) => Promise<Result<StoredChatMessageOutcome | null, Failure>>;
  orderExists: (id: OrderId) => Promise<Result<boolean, Failure>>;
}>;

const notFound = err({ code: "NOTICE_NOT_FOUND" as const, message: "Notice not found" });

/** Where a tapped notice opens: the order of an order notice, otherwise the message. Another company's message and a deleted order are not found. */
export async function findSellerNoticeTarget(
  messageId: ChatMessageId,
  deps: FindSellerNoticeTargetDependencies,
): Promise<Result<SellerNoticeTarget, FindSellerNoticeTargetError>> {
  const stored = await deps.findOutcome(messageId);
  if (!stored.success) return stored;
  const notice = stored.data && chooseSellerNotice(stored.data.outcomes);
  if (!notice) return notFound;
  const target = sellerNoticeTarget(notice);
  if (target.kind === "message") return ok(target);
  const exists = await deps.orderExists(target.orderId);
  if (!exists.success) return exists;
  return exists.data ? ok(target) : notFound;
}
