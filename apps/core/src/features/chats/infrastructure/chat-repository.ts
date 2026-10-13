import { log } from "@core/src/shared/infrastructure/logger";
import { err, ok } from "@shared/functional";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import type { Result } from "@shared/result";
import type { Chat } from "@core/src/features/chats/domain/mobile-message";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

function isPersistenceFailure(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError;
}

function mapChat(chat: { id: string; contactId: string; createdAt: Date }): Chat {
  return { id: chat.id, contactId: chat.contactId, createdAt: chat.createdAt };
}

type ChatError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;

export const chatRepository = {
  async ensureChat(contactId: string): Promise<Result<Chat, ChatError>> {
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
      log.error({ event: "unable_to_ensure_whatsapp_chat", err: cause }, "unable_to_ensure_whatsapp_chat");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to ensure chat" });
    }
  },
};
