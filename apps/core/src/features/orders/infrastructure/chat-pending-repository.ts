import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { Prisma } from "@prisma/client";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { chatPendingsSchema, lastIncomingPhotoSchema, type ChatPendings, type LastIncomingPhoto } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type StoredRow = Readonly<{ pendings: unknown; readyRemembered: boolean; lastIncomingPhoto: unknown }>;

const none: ChatPendings = { pendings: [], readyRemembered: false, lastIncomingPhoto: null };

function parseRow(row: StoredRow | undefined, chatId: ChatId): Result<ChatPendings, InvalidStoredData> {
  if (!row) return ok(none);
  const parsed = chatPendingsSchema.safeParse({ pendings: row.pendings, readyRemembered: row.readyRemembered, lastIncomingPhoto: row.lastIncomingPhoto });
  if (parsed.success) return ok(parsed.data);
  log.error({ event: "invalid_stored_chat_pendings", companyId: getCompanyId(), chatId }, "invalid_stored_chat_pendings");
  return err({ code: "INVALID_STORED_DATA", message: "Invalid stored chat pendings" });
}

/** The chat's pendings; a chat with no row has none. */
export async function findChatPendings(chatId: ChatId): Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  try {
    const row = await prisma.chatPendings.findFirst({ where: { companyId, chatId }, select: { pendings: true, readyRemembered: true, lastIncomingPhoto: true } });
    return parseRow(row ?? undefined, chatId);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_chat_pendings", companyId, chatId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_chat_pendings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read chat pendings" });
  }
}

/** Part of the message transaction: locks the chat's row, if it has one. */
export async function findChatPendingsForUpdate(chatId: ChatId): Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  try {
    const [row] = await prisma.$queryRaw<StoredRow[]>`SELECT "pendings", "readyRemembered", "lastIncomingPhoto" FROM "ChatPendings"
      WHERE "companyId" = ${companyId}::uuid AND "chatId" = ${chatId}::uuid FOR UPDATE`;
    return parseRow(row, chatId);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_chat_pendings", companyId, chatId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_chat_pendings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read chat pendings" });
  }
}

/** Part of the message transaction. A set with no pending, no remembered ready and no last incoming photo leaves no row. */
export async function saveChatPendings(chatId: ChatId, set: ChatPendings): Promise<Result<null, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  const stored = JSON.parse(JSON.stringify(set)) as unknown;
  if (!chatPendingsSchema.safeParse(stored).success) return err({ code: "INVALID_STORED_DATA", message: "Invalid chat pendings" });
  try {
    if (set.pendings.length === 0 && !set.readyRemembered && set.lastIncomingPhoto === null) {
      await prisma.chatPendings.deleteMany({ where: { companyId, chatId } });
      return ok(null);
    }
    const data = { pendings: (stored as { pendings: unknown }).pendings as Prisma.InputJsonArray, readyRemembered: set.readyRemembered,
      lastIncomingPhoto: set.lastIncomingPhoto === null ? Prisma.DbNull : ((stored as { lastIncomingPhoto: unknown }).lastIncomingPhoto as Prisma.InputJsonObject), updatedAt: new Date() };
    await prisma.chatPendings.upsert({ where: { companyId_chatId: { companyId, chatId } }, create: { companyId, chatId, ...data }, update: data });
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_chat_pendings", companyId, chatId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_chat_pendings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to save chat pendings" });
  }
}

/**
 * Part of the message transaction of a failed message: writes only the chat's last incoming photo, keeping the pendings and the remembered ready,
 * and creating the row when the chat has none. The chat comes from the message, so a message that does not exist writes nothing.
 */
export async function saveLastIncomingPhotoOfMessageChat(messageId: ChatMessageId, memory: LastIncomingPhoto): Promise<Result<null, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  if (!lastIncomingPhotoSchema.safeParse(JSON.parse(JSON.stringify(memory))).success) return err({ code: "INVALID_STORED_DATA", message: "Invalid last incoming photo" });
  const stored = JSON.stringify(memory);
  try {
    await prisma.$executeRaw`INSERT INTO "ChatPendings" ("companyId", "chatId", "pendings", "readyRemembered", "lastIncomingPhoto", "updatedAt")
      SELECT "companyId", "chatId", '[]'::jsonb, false, ${stored}::jsonb, now() FROM "ChatMessage"
      WHERE "companyId" = ${companyId}::uuid AND "id" = ${messageId}::uuid
      ON CONFLICT ("companyId", "chatId") DO UPDATE SET "lastIncomingPhoto" = EXCLUDED."lastIncomingPhoto", "updatedAt" = EXCLUDED."updatedAt"`;
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_chat_pendings", companyId, chatId: null, messageId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_chat_pendings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to save chat pendings" });
  }
}
