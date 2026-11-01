import { isDeepStrictEqual } from "node:util";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { SellableVariant } from "@core/src/features/orders/domain/catalog-order";
import type { ChatPendings } from "@core/src/features/orders/domain/chat-pendings";
import { undoability, undoPlan, type UndoRefusal } from "@core/src/features/orders/domain/message-changes";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { CompanyId, OrderId, OrderItemId, UserId } from "@core/src/features/orders/domain/order";
import type { OrderItemChanges } from "@core/src/features/orders/domain/order-edit";
import type { OrderAggregate, OrderDomainError } from "@core/src/features/orders/domain/order-state-machine";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { OrderItemChange } from "@core/src/features/orders/domain/message-changes";
import type { StoredMessageChanges } from "@core/src/features/orders/infrastructure/message-change-repository";

export type UndoMessageInput = Readonly<{ orderId: OrderId; messageId: ChatMessageId }>;
type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
export type UndoMessageError =
  | PersistenceError | InvalidStoredData | OrderDomainError
  | Readonly<{ code: "ORDER_NOT_FOUND" | "MESSAGE_CHANGES_NOT_FOUND"; message: string }>
  | Readonly<{ code: "UNDO_REFUSED"; message: string; reason: UndoRefusal; variantId?: VariantId }>
  | Readonly<{ code: "VARIANT_NOT_FOUND"; message: string; variantId: VariantId }>;

export type UndoneMessage = Readonly<{
  order: OrderAggregate;
  /** False for a repeat: the message was already undone and nothing was written. */
  undone: boolean;
  changeCount: number;
  pendingsRestored: number;
  pendingsEnded: number;
}>;

export type UndoMessageChangesDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, UndoMessageError>>) => Promise<Result<T, UndoMessageError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, UndoMessageError>>;
  findChatPendingsForUpdate: (chatId: ChatId) => Promise<Result<ChatPendings, UndoMessageError>>;
  findMessageChanges: (orderId: OrderId, messageId: ChatMessageId) => Promise<Result<StoredMessageChanges | null, UndoMessageError>>;
  /** The order's changes with `seq` after the given one. */
  findLaterChanges: (orderId: OrderId, afterSeq: number) => Promise<Result<readonly OrderItemChange[], UndoMessageError>>;
  findSellableVariants: (ids: readonly VariantId[]) => Promise<Result<readonly SellableVariant[], UndoMessageError>>;
  saveItemChanges: (order: OrderAggregate, changes: OrderItemChanges) => Promise<Result<null, UndoMessageError>>;
  saveChatPendings: (chatId: ChatId, pendings: ChatPendings) => Promise<Result<null, UndoMessageError>>;
  markMessageUndone: (orderId: OrderId, messageId: ChatMessageId, userId: UserId, at: Date) => Promise<Result<null, UndoMessageError>>;
  setUndoneVerdicts: (orderId: OrderId, messageId: ChatMessageId, at: Date) => Promise<Result<null, UndoMessageError>>;
  saveSellerActedAt: (orderId: OrderId, companyId: CompanyId, at: Date) => Promise<Result<null, UndoMessageError>>;
  clock: () => Date;
  newItemId: () => OrderItemId;
  /** Pendings without an order expire this long after their last change. */
  pendingTtlMs: number;
}>;

/**
 * Undoes one message's changes, all or nothing, under the order lock. Lines and pendings come back one by one as the message found them; stock is not touched,
 * because an order open for messages has no deducted stock. A repeat of an undone message answers the current state.
 */
export async function undoMessageChanges(input: UndoMessageInput, access: OrderAccess, deps: UndoMessageChangesDependencies): Promise<Result<UndoneMessage, UndoMessageError>> {
  return deps.transaction(access.companyId, async () => {
    const found = await deps.findOrderForUpdate(input.orderId, access.companyId);
    if (!found.success) return found;
    const order = found.data;
    if (!order || !order.chatId) return err({ code: "ORDER_NOT_FOUND", message: "Order is not available" });
    const message = await deps.findMessageChanges(input.orderId, input.messageId);
    if (!message.success) return message;
    if (!message.data || message.data.changes.length === 0 && message.data.pendingsBefore.length === 0 && message.data.pendingsAfter.length === 0)
      return err({ code: "MESSAGE_CHANGES_NOT_FOUND", message: "The message changed nothing in this order" });
    const stored = await deps.findChatPendingsForUpdate(order.chatId);
    if (!stored.success) return stored;
    if (message.data.undoneAt) return ok<UndoneMessage>({ order, undone: false, changeCount: 0, pendingsRestored: 0, pendingsEnded: 0 });

    const lastSeq = Math.max(0, ...message.data.changes.map((change) => change.seq));
    const later = await deps.findLaterChanges(input.orderId, lastSeq);
    if (!later.success) return later;
    const restoredVariants = message.data.changes.flatMap((change) => (change.before ? [change.before.variantId] : []));
    const sellable = restoredVariants.length > 0 ? await deps.findSellableVariants(restoredVariants) : ok<readonly SellableVariant[]>([]);
    if (!sellable.success) return sellable;
    const verdict = undoability({ order, message: message.data, pendings: stored.data.pendings, laterChanges: later.data, sellable: sellable.data });
    if (verdict.kind === "refused")
      return err({ code: "UNDO_REFUSED", message: "The message cannot be undone", reason: verdict.reason, ...(verdict.variantId ? { variantId: verdict.variantId } : {}) });

    const now = deps.clock();
    const plan = undoPlan({ order, message: message.data, pendings: stored.data.pendings, pendingTtlMs: deps.pendingTtlMs, now, newItemId: deps.newItemId });
    if (!plan.success) return plan;
    const itemsChanged = plan.data.changes.added.length + plan.data.changes.updated.length + plan.data.changes.removedItemIds.length > 0;
    if (itemsChanged) {
      const saved = await deps.saveItemChanges(plan.data.order, plan.data.changes);
      if (!saved.success) return saved;
    }
    if (!isDeepStrictEqual(plan.data.pendings, stored.data.pendings)) {
      const saved = await deps.saveChatPendings(order.chatId, { ...stored.data, pendings: plan.data.pendings });
      if (!saved.success) return saved;
    }
    const marked = await deps.markMessageUndone(input.orderId, input.messageId, access.userId, now);
    if (!marked.success) return marked;
    const verdicts = await deps.setUndoneVerdicts(input.orderId, input.messageId, now);
    if (!verdicts.success) return verdicts;
    const acted = await deps.saveSellerActedAt(input.orderId, access.companyId, now);
    if (!acted.success) return acted;
    return ok<UndoneMessage>({ order: plan.data.order, undone: true, changeCount: message.data.changes.length, pendingsRestored: plan.data.pendingsRestored, pendingsEnded: plan.data.pendingsEnded });
  });
}
