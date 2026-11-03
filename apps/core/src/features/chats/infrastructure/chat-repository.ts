import { log } from "@core/src/shared/infrastructure/logger";
import { err, ok } from "@shared/functional";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import type { Result } from "@shared/result";
import type { Chat, ChatMessageId } from "@core/src/features/chats/domain/mobile-message";
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

/** One message of a chat read for context. Newest first in a result. */
export type RecentChatMessage = Readonly<{
  id: ChatMessageId; direction: "incoming" | "outgoing"; type: "text" | "image"; text: string | null; caption: string | null; sentAt: Date; imageId: string | null;
}>;
/** The messages strictly before (`anchor`, `messageId`) in (sentAt, id) order, sent at most `windowHours` before the anchor. */
export type RecentChatMessagesQuery = Readonly<{ chatId: string; anchor: Date; messageId: string; limit: number; windowHours: number }>;

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

  /**
   * Reads under the company's RLS. The row comparison and the order match the index `(companyId, chatId, sentAt, id)`;
   * a message without `sentAt` never satisfies the comparison.
   */
  async findRecentChatMessages(query: RecentChatMessagesQuery): Promise<Result<readonly RecentChatMessage[], ChatError>> {
    const since = new Date(query.anchor.getTime() - query.windowHours * 3_600_000);
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string; direction: string; type: string; text: string | null; caption: string | null; sentAt: Date; imageId: string | null }>>`
        SELECT "id", "direction", "type", "text", "caption", "sentAt", "imageId"
        FROM "ChatMessage"
        WHERE "companyId" = ${getCompanyId()}::uuid AND "chatId" = ${query.chatId}::uuid
          AND ("sentAt", "id") < (${query.anchor}::timestamptz, ${query.messageId}::uuid)
          AND "sentAt" >= ${since}::timestamptz
        ORDER BY "sentAt" DESC, "id" DESC
        LIMIT ${query.limit}
      `;
      return ok(rows.map((row) => ({ id: row.id as ChatMessageId, direction: row.direction === "incoming" ? "incoming" : "outgoing",
        type: row.type === "image" ? "image" : "text", text: row.text, caption: row.caption, sentAt: row.sentAt, imageId: row.imageId })));
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_find_recent_chat_messages", err: cause }, "unable_to_find_recent_chat_messages");
      return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to find recent chat messages" });
    }
  },
};
