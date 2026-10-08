import { z } from "zod";
import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { applicationEventBus } from "@core/src/composition/event-bus";
import type { WhatsAppMessageRecorded } from "@core/src/features/chats/application/events";
import type { ChatMessageId, CompanyId, RegisterMobileMessageError } from "@core/src/features/chats/domain/mobile-message";
import type { EventMetadata } from "@core/src/shared/events/application/contracts";
import { getCompanyId, prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { log } from "@core/src/shared/infrastructure/logger";

const payloadSchema = z.strictObject({ companyId: z.uuid(), messageId: z.uuid() });
const metadataSchema = z.strictObject({ eventId: z.uuid(), occurredAt: z.iso.datetime({ offset: false }) });

export async function dispatchMessageRecorded(payload: WhatsAppMessageRecorded, metadata: EventMetadata): Promise<Result<void, RegisterMobileMessageError>> {
  if (!payloadSchema.safeParse(payload).success || !metadataSchema.safeParse(metadata).success || metadata.eventId !== payload.messageId)
    return err({ code: "INVALID_EVENT", message: "Invalid message event" });
  let companyId: string;
  try { companyId = getCompanyId(); }
  catch { return err({ code: "INVALID_EVENT", message: "Invalid message event" }); }
  if (companyId !== payload.companyId) return err({ code: "INVALID_EVENT", message: "Invalid message event" });
  const result = await applicationEventBus().provider.publish("whatsapp_message_recorded", payload, metadata);
  if (!result.success) log.error({ event: "mobile_message_event_dispatch_failed", companyId, messageId: payload.messageId,
    errorCode: result.error.code }, "Unable to dispatch message event");
  return result.success ? result : err({ code: result.error.code === "INVALID_EVENT" ? "INVALID_EVENT" : "EVENT_BUS_UNAVAILABLE", message: "Unable to dispatch message event" });
}

export async function markEventDispatched(companyId: CompanyId, messageId: ChatMessageId, at: Date): Promise<Result<void, RegisterMobileMessageError>> {
  try {
    return await withTenantIsolation(companyId, async () => {
      const updated = await prisma.chatMessage.updateMany({ where: { companyId, id: messageId, whatsappMessageId: { not: null }, eventDispatchedAt: null }, data: { eventDispatchedAt: at } });
      if (updated.count) return { success: true, data: undefined };
      const existing = await prisma.chatMessage.findFirst({ where: { companyId, id: messageId, whatsappMessageId: { not: null } }, select: { eventDispatchedAt: true } });
      return existing?.eventDispatchedAt ? { success: true, data: undefined } : err({ code: "INVALID_STORED_DATA", message: "Invalid stored message" });
    });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_mark_mobile_message_event", err: cause }, "Unable to mark mobile message event");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to mark message event" });
  }
}
