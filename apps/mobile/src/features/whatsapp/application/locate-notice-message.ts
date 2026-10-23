import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, CoreMessageId, WhatsAppChatId } from "@mobile/features/whatsapp/domain/ids";
import type { StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import type { MessageStore, StoreError } from "@mobile/features/whatsapp/application/ports";

/** Rows of the first query, from the notice's message to the newest. */
export const noticeFirstQueryLimit = 1000;
/** Rows of each older page when the notice's message is further back than the first query reaches. */
export const noticePageSize = 500;

export type LocatedNotice = Readonly<{
  /** Newest first, down to at least the notice's message. */
  messages: readonly StoredMessage[];
  target: StoredMessage;
}>;
export type LocateNoticeError = StoreError | Readonly<{ code: "MESSAGE_NOT_FOUND" }>;

/**
 * Finds the notice's message by the core id of the notice and loads the chat from it to the newest,
 * so the seller lands on it without paging from the end. Pages the remaining older range when the
 * message is more than `noticeFirstQueryLimit` messages back.
 */
export async function locateNoticeMessage(
  store: Pick<MessageStore, "findByCoreMessageId" | "listFromArrivalSeq" | "listMessages">,
  companyId: CompanyId,
  chatId: WhatsAppChatId,
  coreMessageId: CoreMessageId,
): Promise<Result<LocatedNotice, LocateNoticeError>> {
  const found = await store.findByCoreMessageId(companyId, coreMessageId);
  if (!found.success) return found;
  const target = found.data;
  if (target === null || target.chatId !== chatId) return err({ code: "MESSAGE_NOT_FOUND" });

  const first = await store.listFromArrivalSeq(companyId, chatId, target.arrivalSeq, noticeFirstQueryLimit);
  if (!first.success) return first;
  let messages = first.data;
  while (!messages.some((message) => message.arrivalSeq <= target.arrivalSeq)) {
    const oldest = messages.at(-1)?.arrivalSeq ?? null;
    if (oldest === null) return err({ code: "MESSAGE_NOT_FOUND" });
    const older = await store.listMessages(companyId, chatId, { beforeArrivalSeq: oldest, limit: noticePageSize });
    if (!older.success) return older;
    // The message was deleted while paging: the range ended before reaching it.
    if (older.data.length === 0) return err({ code: "MESSAGE_NOT_FOUND" });
    messages = [...messages, ...older.data];
  }
  return ok({ messages, target });
}
