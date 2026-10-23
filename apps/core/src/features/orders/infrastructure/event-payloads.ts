import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { EventBusError } from "@core/src/shared/events/application/contracts";
import type { ChatMessageProcessed, OrderCancelled } from "@core/src/features/orders/application/events";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
import { isCompanyId, isOrderId } from "@core/src/features/orders/domain/order";

const schema = z.strictObject({ orderId: z.uuid(), companyId: z.uuid() });
export function parseOrderCancelled(input: unknown): Result<OrderCancelled, EventBusError> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return err({ code: "INVALID_EVENT", message: "Invalid order cancellation payload" });
  const { orderId, companyId } = parsed.data;
  if (!isOrderId(orderId) || !isCompanyId(companyId))
    return err({ code: "INVALID_EVENT", message: "Invalid order cancellation payload" });
  return ok({ orderId, companyId });
}

const chatMessageProcessedSchema = z.strictObject({ companyId: z.uuid(), messageId: z.uuid() });
export function parseChatMessageProcessed(input: unknown): Result<ChatMessageProcessed, EventBusError> {
  const parsed = chatMessageProcessedSchema.safeParse(input);
  if (!parsed.success || !isCompanyId(parsed.data.companyId)) return err({ code: "INVALID_EVENT", message: "Invalid chat message processed payload" });
  return ok({ companyId: parsed.data.companyId, messageId: parsed.data.messageId as ChatMessageId });
}
