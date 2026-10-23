import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import { chatMessageOutcomesSchema } from "@core/src/features/orders/domain/chat-message-outcome";
import { chooseSellerNotice, type ClaimedNotice } from "@core/src/features/orders/domain/seller-notice";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;
type NoticeRepositoryError = PersistenceError | InvalidStoredData;

type ClaimRow = Readonly<{ outcomes: unknown; noticeSentAt: Date | null; chatId: string; registeredBySessionId: string | null }>;

/**
 * Takes the notice of a message in one short transaction: the row is read `FOR UPDATE`, so two claims never both succeed.
 * Returns null, writing nothing, when no notice is due, it was already claimed or no session registered the message.
 */
export async function claimNotice(messageId: ChatMessageId): Promise<Result<ClaimedNotice | null, NoticeRepositoryError>> {
  const companyId = getCompanyId();
  try {
    return await withinTransaction(async (): Promise<Result<ClaimedNotice | null, NoticeRepositoryError>> => {
      const rows = await prisma.$queryRaw<ClaimRow[]>`SELECT o."outcomes", o."noticeSentAt", m."chatId", m."registeredBySessionId"
        FROM "ChatMessageOutcome" o
        JOIN "ChatMessage" m ON m."companyId" = o."companyId" AND m.id = o."messageId"
        WHERE o."companyId" = ${companyId}::uuid AND o."messageId" = ${messageId}::uuid
        FOR UPDATE OF o`;
      const row = rows[0];
      if (!row || row.noticeSentAt !== null || row.registeredBySessionId === null) return ok(null);
      const parsed = chatMessageOutcomesSchema.safeParse(row.outcomes);
      if (!parsed.success) {
        log.error({ event: "invalid_stored_chat_message_outcome", messageId }, "invalid_stored_chat_message_outcome");
        return err({ code: "INVALID_STORED_DATA", message: "Invalid stored chat message outcome" });
      }
      const notice = chooseSellerNotice(parsed.data);
      if (!notice) return ok(null);
      await prisma.chatMessageOutcome.update({ where: { companyId_messageId: { companyId, messageId } }, data: { noticeSentAt: new Date() } });
      return ok({ messageId, chatId: row.chatId, sessionId: row.registeredBySessionId, notice });
    });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_claim_chat_message_notice", messageId, err: cause }, "unable_to_claim_chat_message_notice");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to claim chat message notice" });
  }
}

/** Gives the notice back after a failure that was not a delivery, so a retry can claim it again. */
export async function releaseNotice(messageId: ChatMessageId): Promise<Result<null, PersistenceError>> {
  try {
    await prisma.chatMessageOutcome.updateMany({ where: { companyId: getCompanyId(), messageId }, data: { noticeSentAt: null } });
    return ok(null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_release_chat_message_notice", messageId, err: cause }, "unable_to_release_chat_message_notice");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to release chat message notice" });
  }
}
