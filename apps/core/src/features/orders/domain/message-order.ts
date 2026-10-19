import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";

export type ChatId = string & { readonly __brand: "ChatId" };

export type MessageOrderSkipReason =
  | "not_image"
  | "outgoing_message"
  | "unreadable_image"
  | "unrecognized_qr_code"
  | "product_not_found"
  | "visual_search_disabled"
  | "no_indexed_products"
  | "no_visual_match"
  | "low_confidence"
  | "ambiguous_variant";

export function isOpenForMessageItems(order: OrderAggregate, chatId: ChatId): boolean {
  return order.chatId === chatId && !order.cancelled && order.completedAt === null
    && order.payments.every((payment) => payment.status === "voided")
    && order.checkoutConfirmedAt === null && order.deliveryStatus === "pending" && !order.stockDeducted;
}
