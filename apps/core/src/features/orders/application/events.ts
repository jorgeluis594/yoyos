import type { CompanyId, OrderId, PaymentId } from "@core/src/features/orders/domain/order";
import type { DeductionOutcome, ServeOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import type { ProductStockIncreased } from "@core/src/features/products/application/events";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import type { Result } from "@shared/result";
import type { EventBusError } from "@core/src/shared/events/application/contracts";

export type OrderCancelled = Readonly<{ orderId: OrderId; companyId: CompanyId }>;
/** A message was read and its outcomes call for a notice to the seller who registered it. */
export type ChatMessageProcessed = Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>;
declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents { order_cancelled: OrderCancelled; chat_message_processed: ChatMessageProcessed }
}
export type PublishOrderCancelled = (payload: OrderCancelled) => Promise<Result<void, EventBusError>>;
export type PublishChatMessageProcessed = (payload: ChatMessageProcessed) => Promise<Result<void, EventBusError>>;

/** In-transaction events (see docs/event-bus.md): the handler runs inside the producer's transaction and its outcome comes back to the producer. */
export type PaymentConfirmed = Readonly<{ companyId: CompanyId; orderId: OrderId; paymentId: PaymentId }>;
export type OrderDeliveryChanged = Readonly<{ companyId: CompanyId; orderId: OrderId }>;
export type OrderStockDeductionOverdue = Readonly<{ companyId: CompanyId; orderId: OrderId }>;
declare module "@core/src/shared/events/application/in-transaction-events" {
  interface InTransactionEvents {
    payment_confirmed: { payload: PaymentConfirmed; outcome: DeductionOutcome };
    order_delivery_changed: { payload: OrderDeliveryChanged; outcome: DeductionOutcome };
    order_stock_deduction_overdue: { payload: OrderStockDeductionOverdue; outcome: DeductionOutcome };
    product_stock_increased: { payload: ProductStockIncreased; outcome: ServeOutcome };
  }
}
