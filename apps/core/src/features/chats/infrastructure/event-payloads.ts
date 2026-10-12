import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { EventBusError } from "@core/src/shared/events/application/contracts";
import type { MessageCreated } from "@core/src/features/chats/application/events";
import type { ChatMessageId, CompanyId } from "@core/src/features/chats/domain/mobile-message";

const messageCreatedSchema = z.strictObject({ companyId: z.uuid(), messageId: z.uuid() });

export function parseMessageCreated(input: unknown): Result<MessageCreated, EventBusError> {
  const parsed = messageCreatedSchema.safeParse(input);
  return parsed.success
    ? ok({ companyId: parsed.data.companyId as CompanyId, messageId: parsed.data.messageId as ChatMessageId })
    : err({ code: "INVALID_EVENT", message: "Invalid message created payload" });
}
