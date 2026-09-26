import { err, ok } from "@shared/functional";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { ChatRepository } from "@core/src/features/chats/application/record-message";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

function isPersistenceFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

function mapChat(chat: { id: string; contactId: string; createdAt: Date }) {
  return { id: chat.id, contactId: chat.contactId, createdAt: chat.createdAt };
}

export const chatRepository: ChatRepository = {
  async findMessageId(externalId) {
    try {
      const message = await prisma.chatMessage.findFirst({ where: { externalId }, select: { id: true } });
      return ok(message);
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to find WhatsApp message", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find message" });
    }
  },
  async ensureChat(contactId) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "Chat" ("id", "contactId", "createdAt")
        VALUES (${randomUUID()}::uuid, ${contactId}::uuid, now())
        ON CONFLICT ("companyId", "contactId") DO NOTHING
      `;
      const chat = await prisma.chat.findFirst({ where: { contactId } });
      if (!chat) return err({ code: "INVALID_STORED_DATA", message: "Chat insert was not visible" });
      return ok(mapChat(chat));
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
        chatId: input.chatId, externalId: input.externalId,
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
      const message = await prisma.chatMessage.findFirst({ where: { externalId: input.externalId }, select: { id: true } });
      if (!message) return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to persist message" });
      return ok({ status: inserted.count ? "stored" as const : "duplicate" as const, messageId: message.id });
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      console.error("Unable to persist WhatsApp message", { error: cause.name });
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to persist message" });
    }
  },
};
