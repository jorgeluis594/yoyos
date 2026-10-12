import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { Prisma } from "@prisma/client";
import type { ContactId, CompanyId, UserId } from "@core/src/features/orders/domain/order";
import type { ImageId } from "@core/src/features/orders/domain/payment";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

export type OrderSourceMessage = Readonly<{
  id: ChatMessageId;
  companyId: CompanyId;
  chatId: string;
  contactId: ContactId;
  direction: "incoming" | "outgoing";
  uploadedByUserId: UserId;
  imageId: ImageId | null; // null for text and legacy metadata_only rows
}>;

export async function findOrderSourceMessage(messageId: string) {
  try {
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId },
      select: { id: true, companyId: true, chatId: true, direction: true, uploadedByUserId: true, imageId: true, chat: { select: { contactId: true } } },
    });
    // Cloud API rows have no uploader; they cannot become orders, so the use case sees them as missing.
    if (!message?.uploadedByUserId) return ok<OrderSourceMessage | null>(null);
    const { chat, ...rest } = message;
    return ok<OrderSourceMessage | null>({ ...rest, contactId: chat.contactId, uploadedByUserId: message.uploadedByUserId } as OrderSourceMessage);
  } catch (cause) {
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError || cause instanceof Prisma.PrismaClientUnknownRequestError
      || cause instanceof Prisma.PrismaClientInitializationError)) throw cause;
    log.error({ event: "unable_to_find_order_source_message", err: cause }, "unable_to_find_order_source_message");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to find message" });
  }
}
