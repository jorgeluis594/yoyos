import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { Prisma } from "@prisma/client";
import type { Result } from "@shared/result";
import type { CompanyId, UserId } from "@shared/identity";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

export type OrderSourceMessage = Readonly<{
  id: ChatMessageId;
  companyId: CompanyId;
  chatId: string;
  contactId: string;
  direction: "incoming" | "outgoing";
  uploadedByUserId: UserId;
  imageId: string | null; // null for text messages
  text: string | null; // null for image messages
  caption: string | null; // null for text messages and uncaptioned images
  /** The reading context is anchored at `sentAt`, or at `receivedAt` when the message has none. */
  sentAt: Date | null;
  receivedAt: Date;
}>;

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export async function findOrderSourceMessage(messageId: string): Promise<Result<OrderSourceMessage | null, PersistenceError>> {
  try {
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId },
      select: { id: true, companyId: true, chatId: true, direction: true, uploadedByUserId: true, imageId: true, text: true, caption: true, sentAt: true, receivedAt: true, chat: { select: { contactId: true } } },
    });
    if (!message) return ok(null);
    return ok({
      id: message.id as ChatMessageId, companyId: message.companyId as CompanyId, chatId: message.chatId, contactId: message.chat.contactId,
      direction: message.direction === "incoming" ? "incoming" : "outgoing",
      uploadedByUserId: message.uploadedByUserId as UserId, imageId: message.imageId, text: message.text, caption: message.caption,
      sentAt: message.sentAt, receivedAt: message.receivedAt,
    });
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError
      || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    log.error({ event: "unable_to_find_order_source_message", err: cause }, "unable_to_find_order_source_message");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find message" });
  }
}
