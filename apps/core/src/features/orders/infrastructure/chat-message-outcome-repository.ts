import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { Prisma } from "@prisma/client";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, requireActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { chatMessageOutcomesSchema, type ChatMessageFailureCode, type ChatMessageOutcomes, type StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import { isNoticeDue } from "@core/src/features/orders/domain/seller-notice";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type MessageAlreadyProcessed = Readonly<{ code: "MESSAGE_ALREADY_PROCESSED"; message: string }>;

export type ChatMessageOutcomeRecord = Readonly<{ messageId: ChatMessageId; outcomes: ChatMessageOutcomes }>;

export async function findOutcome(messageId: ChatMessageId): Promise<Result<StoredChatMessageOutcome | null, PersistenceError | InvalidStoredData>> {
  try {
    const row = await prisma.chatMessageOutcome.findFirst({ where: { companyId: getCompanyId(), messageId }, select: { outcomes: true, noticeSentAt: true } });
    if (!row) return ok(null);
    const parsed = chatMessageOutcomesSchema.safeParse(row.outcomes);
    if (!parsed.success) {
      log.error({ event: "invalid_stored_chat_message_outcome", messageId }, "invalid_stored_chat_message_outcome");
      return err({ code: "INVALID_STORED_DATA", message: "Invalid stored chat message outcome" });
    }
    return ok({ outcomes: parsed.data, noticeSentAt: row.noticeSentAt });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_chat_message_outcome", messageId, err: cause }, "unable_to_find_chat_message_outcome");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read chat message outcome" });
  }
}

/** Part of the message transaction: the primary key closes the race between two jobs of the same message. */
export async function recordOutcome(record: ChatMessageOutcomeRecord): Promise<Result<null, PersistenceError | InvalidStoredData | MessageAlreadyProcessed>> {
  const companyId = getCompanyId();
  requireActiveTransaction(companyId);
  const parsed = chatMessageOutcomesSchema.safeParse(record.outcomes);
  if (!parsed.success) return err({ code: "INVALID_STORED_DATA", message: "Invalid chat message outcomes" });
  try {
    await prisma.chatMessageOutcome.create({ data: { companyId, messageId: record.messageId, outcomes: parsed.data as unknown as Prisma.InputJsonArray } });
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return err({ code: "MESSAGE_ALREADY_PROCESSED", message: "Message already processed" });
    log.error({ event: "unable_to_record_chat_message_outcome", messageId: record.messageId, err: cause }, "unable_to_record_chat_message_outcome");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to record chat message outcome" });
  }
}

/** A message that failed counts as a photo that left nothing: it clears «the photo just sent» of its chat, so the next text cannot inherit an older photo. Best effort. */
async function rememberFailedMessage(messageId: ChatMessageId, companyId: string): Promise<void> {
  try {
    await prisma.$executeRaw`INSERT INTO "ChatPendings" ("companyId", "chatId", "pendings", "readyRemembered", "lastIncomingPhoto", "updatedAt")
      SELECT ${companyId}::uuid, "chatId", '[]'::jsonb, false, '{"left":null}'::jsonb, now() FROM "ChatMessage" WHERE "companyId" = ${companyId}::uuid AND id = ${messageId}::uuid
      ON CONFLICT ("companyId", "chatId") DO UPDATE SET "lastIncomingPhoto" = '{"left":null}'::jsonb, "updatedAt" = now()`;
  } catch (cause) {
    log.warn({ event: "unable_to_remember_failed_chat_message", companyId, messageId, err: cause }, "unable_to_remember_failed_chat_message");
  }
}

export type FailedOutcomeResult = Readonly<{ publishNotice: boolean }>;

/**
 * Records `failed` for a message that has no outcome yet. `publishNotice` is true when this call wrote the row, or when an
 * existing row calls for a notice that was not claimed. A message that does not exist leaves nothing to notify.
 */
export async function recordFailedOutcome(messageId: ChatMessageId, errorCode: ChatMessageFailureCode): Promise<Result<FailedOutcomeResult, PersistenceError | InvalidStoredData>> {
  const companyId = getCompanyId();
  try {
    const outcomes: ChatMessageOutcomes = [{ kind: "failed", errorCode }];
    const inserted = await prisma.chatMessageOutcome.createMany({ data: [{ companyId, messageId, outcomes: outcomes as unknown as Prisma.InputJsonArray }], skipDuplicates: true });
    if (inserted.count === 1) {
      await rememberFailedMessage(messageId, companyId);
      return ok({ publishNotice: true });
    }
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003") {
      log.warn({ event: "chat_message_outcome_without_message", messageId, errorCode }, "chat_message_outcome_without_message");
      return ok({ publishNotice: false });
    }
    log.error({ event: "unable_to_record_failed_chat_message_outcome", messageId, err: cause }, "unable_to_record_failed_chat_message_outcome");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to record failed chat message outcome" });
  }
  const existing = await findOutcome(messageId);
  return existing.success ? ok({ publishNotice: existing.data !== null && isNoticeDue(existing.data.outcomes, existing.data.noticeSentAt) }) : existing;
}
