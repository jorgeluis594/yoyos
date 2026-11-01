import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** The stored masks of the given messages in one read. A message without a stored mask is absent from the map. */
export async function findMaskedTexts(messageIds: readonly ChatMessageId[]): Promise<Result<ReadonlyMap<ChatMessageId, string>, PersistenceError>> {
  if (!messageIds.length) return ok(new Map());
  try {
    const rows = await prisma.$queryRaw<Array<{ messageId: string; text: string }>>`
      SELECT "messageId", "text" FROM "MessageMaskedText"
      WHERE "companyId" = ${getCompanyId()}::uuid AND "messageId" = ANY(${[...messageIds]}::uuid[])
    `;
    return ok(new Map(rows.map((row) => [row.messageId as ChatMessageId, row.text])));
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_masked_texts", err: cause }, "unable_to_find_masked_texts");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read masked texts" });
  }
}
