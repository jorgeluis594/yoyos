import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CustomerId } from "@core/src/features/contacts/domain/contact";

export type ChatId = string & { readonly __brand: "ChatId" };

/** Where a chat order comes from: its chat and the customer of the chat's contact. */
export type OrderChatSource = Readonly<{ chatId: ChatId; customerId: CustomerId }>;

export function isOpenForMessageItems(order: OrderAggregate, chatId: ChatId): boolean {
  return order.chatId === chatId && !order.cancelled && order.completedAt === null
    && order.payments.every((payment) => payment.status === "voided")
    && order.checkoutConfirmedAt === null && order.deliveryStatus === "pending" && !order.stockDeducted;
}
