import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { OrderLinkActionId } from "@core/src/features/orders/domain/order-review";
import type { OrderReviewId } from "@core/src/features/orders/domain/message-changes";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { UserId } from "@core/src/features/orders/domain/order";

export type LinkActionKind = "copy" | "share" | "open";
export type RecordLinkActionInput = Readonly<{ id: OrderLinkActionId; orderId: OrderId; action: LinkActionKind }>;
export type RecordLinkActionError = Readonly<{ code: "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type RecordLinkActionDependencies = Readonly<{
  orderExists: (orderId: OrderId, companyId: CompanyId) => Promise<Result<boolean, RecordLinkActionError>>;
  /** Inserts the row; a repeated id succeeds without writing. */
  saveLinkAction: (action: Readonly<{ id: OrderLinkActionId; orderId: OrderId; userId: UserId; action: LinkActionKind; reviewId: OrderReviewId | null; takenAt: Date }>) => Promise<Result<null, RecordLinkActionError>>;
  clock: () => Date;
}>;

/** The seller copied, shared or opened the checkout link. It takes no order lock: a race with a message is accepted, and the change still shows in the next review. */
export async function recordLinkAction(input: RecordLinkActionInput, access: OrderAccess, deps: RecordLinkActionDependencies): Promise<Result<null, RecordLinkActionError>> {
  const exists = await deps.orderExists(input.orderId, access.companyId);
  if (!exists.success) return exists;
  if (!exists.data) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
  const saved = await deps.saveLinkAction({ id: input.id, orderId: input.orderId, userId: access.userId, action: input.action, reviewId: null, takenAt: deps.clock() });
  return saved.success ? ok(null) : saved;
}
