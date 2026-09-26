import { err, ok } from "@shared/functional";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ChatRepository } from "@core/src/features/chats/application/record-message";
import { Prisma } from "@prisma/client";

function isPersistenceFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

export const chatRepository: ChatRepository = {
  async findMessageId(companyId, externalId) {
    try {
      const message = await prisma.chatMessage.findUnique({ where: { companyId_externalId: { companyId, externalId } }, select: { id: true, companyId: true } });
      return ok(message);
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to find WhatsApp message", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find message" });
    }
  },
  async ensureChat(companyId, contactId) {
    try {
      return ok(await prisma.chat.upsert({
        where: { companyId_contactId: { companyId, contactId } },
        create: { companyId, contactId }, update: {},
      }));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to ensure WhatsApp chat", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to ensure chat" });
    }
  },
  async insertMessage(input) {
    const image = input.content.type === "image";
    try {
      const inserted = await prisma.chatMessage.createMany({ data: [{
        companyId: input.companyId, chatId: input.chatId, externalId: input.externalId,
        direction: input.origin.direction, source: input.origin.source,
        userId: input.origin.direction === "outgoing" ? input.origin.userId : null,
        type: input.content.type, text: image ? null : input.content.text,
        caption: image ? input.content.caption : null,
        sentAt: input.sentAt, receivedAt: input.receivedAt,
        whatsappMediaId: image ? input.content.image.mediaId : null,
        imageStatus: image ? input.content.image.status : null,
        imageAttempts: image ? input.content.image.attempts : null,
        imageNextAttemptAt: image ? input.content.image.nextAttemptAt : null,
      }], skipDuplicates: true });
      const message = await prisma.chatMessage.findUnique({ where: { companyId_externalId: { companyId: input.companyId, externalId: input.externalId } }, select: { id: true } });
      if (!message) return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to persist message" });
      return ok({ status: inserted.count ? "stored" as const : "duplicate" as const, companyId: input.companyId, messageId: message.id });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to persist WhatsApp message", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to persist message" });
    }
  },
};
