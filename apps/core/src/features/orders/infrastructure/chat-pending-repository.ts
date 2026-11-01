import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { Prisma } from "@prisma/client";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { chatPendingsSchema, lastIncomingPhotoSchema, type ChatPendings, type LastIncomingPhoto } from "@core/src/features/orders/domain/chat-pendings";
import type { ChatId } from "@core/src/features/orders/domain/message-order";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type StoredRow = Readonly<{ pendings: unknown; readyRemembered: boolean }>;

const none: ChatPendings = { pendings: [], readyRemembered: false };

function parseRow(row: StoredRow | undefined, chatId: ChatId): Result<ChatPendings, InvalidStoredData> {
  if (!row) return ok(none);
  const parsed = chatPendingsSchema.safeParse({ pendings: row.pendings, readyRemembered: row.readyRemembered });
  if (parsed.success) return ok(parsed.data);
  log.error({ event: "invalid_stored_chat_pendings", companyId: getCompanyId(), chatId }, "invalid_stored_chat_pendings");
  return err({ code: "INVALID_STORED_DATA", message: "Invalid stored chat pendings" });
}

/** What a chat remembers besides its pendings: the photo just sent and when a message last made a request. */
export type ChatMemory = Readonly<{ lastIncomingPhoto: LastIncomingPhoto | null; lastRequestAt: Date | null }>;
export const noChatMemory: ChatMemory = { lastIncomingPhoto: null, lastRequestAt: null };

/** The chat's memory; a chat with no row remembers nothing. Plain read: the message transaction already holds the row's lock through the pendings. */
export async function findChatMemory(chatId: ChatId): Promise<Result<ChatMemory, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  try {
    const row = await prisma.chatPendings.findFirst({ where: { companyId, chatId }, select: { lastIncomingPhoto: true, lastRequestAt: true } });
    if (!row) return ok(noChatMemory);
    const photo = row.lastIncomingPhoto === null ? null : lastIncomingPhotoSchema.safeParse(row.lastIncomingPhoto);
    if (photo && !photo.success) {
      log.error({ event: "invalid_stored_chat_pendings", companyId, chatId }, "invalid_stored_chat_pendings");
      return err({ code: "INVALID_STORED_DATA", message: "Invalid stored chat photo memory" });
    }
    return ok({ lastIncomingPhoto: photo?.data ?? null, lastRequestAt: row.lastRequestAt });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_chat_pendings", companyId, chatId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_chat_pendings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read chat memory" });
  }
}

/** The chat's pendings; a chat with no row has none. */
export async function findChatPendings(chatId: ChatId): Promise<Result<ChatPendings, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  try {
    const row = await prisma.chatPendings.findFirst({ where: { companyId, chatId }, select: { pendings: true, readyRemembered: true } });
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
    const [row] = await prisma.$queryRaw<StoredRow[]>`SELECT "pendings", "readyRemembered" FROM "ChatPendings"
      WHERE "companyId" = ${companyId}::uuid AND "chatId" = ${chatId}::uuid FOR UPDATE`;
    return parseRow(row, chatId);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_chat_pendings", companyId, chatId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_chat_pendings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read chat pendings" });
  }
}

/**
 * Part of the message transaction. A set with no pending, no remembered ready and no memory leaves no row. With `memory`, the photo memory and
 * `lastRequestAt` are written with the pendings; without it they stay as they are.
 */
export async function saveChatPendings(chatId: ChatId, set: ChatPendings, memory?: ChatMemory): Promise<Result<null, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  const stored = JSON.parse(JSON.stringify(set)) as unknown;
  if (!chatPendingsSchema.safeParse(stored).success) return err({ code: "INVALID_STORED_DATA", message: "Invalid chat pendings" });
  try {
    if (set.pendings.length === 0 && !set.readyRemembered && (memory === undefined || (memory.lastIncomingPhoto === null && memory.lastRequestAt === null))) {
      await prisma.chatPendings.deleteMany({ where: { companyId, chatId } });
      return ok(null);
    }
    const photo = memory === undefined ? {} : { lastIncomingPhoto: memory.lastIncomingPhoto === null ? Prisma.DbNull : JSON.parse(JSON.stringify(memory.lastIncomingPhoto)) as Prisma.InputJsonObject, lastRequestAt: memory.lastRequestAt };
    const data = { pendings: (stored as { pendings: unknown }).pendings as Prisma.InputJsonArray, readyRemembered: set.readyRemembered, ...photo, updatedAt: new Date() };
    await prisma.chatPendings.upsert({ where: { companyId_chatId: { companyId, chatId } }, create: { companyId, chatId, ...data }, update: data });
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_chat_pendings", companyId, chatId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_chat_pendings");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to save chat pendings" });
  }
}
