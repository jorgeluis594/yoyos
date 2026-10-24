import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
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
