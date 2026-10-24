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
export type LocateNoticeError = StoreError | Readonly<{ code: "MESSAGE_NOT_FOUND"; message: string }>;
const notFound: LocateNoticeError = { code: "MESSAGE_NOT_FOUND", message: "The notice message is not on this phone" };

/** What the search has loaded so far; passing it back as `resume` continues from where it stopped. */
export type NoticeSearchProgress = LocatedNotice;

/**
 * Finds the notice's message by the core id of the notice and loads the chat from it to the newest,
 * so the seller lands on it without paging from the end. Pages the remaining older range when the
 * message is more than `noticeFirstQueryLimit` messages back. `onProgress` receives what is loaded
 * after each query that did not reach the message yet, so a failed search can be resumed.
 */
export async function locateNoticeMessage(
  store: Pick<MessageStore, "findByCoreMessageId" | "listFromArrivalSeq" | "listMessages">,
  companyId: CompanyId,
  chatId: WhatsAppChatId,
  coreMessageId: CoreMessageId,
  options: Readonly<{ resume?: NoticeSearchProgress; onProgress?: (progress: NoticeSearchProgress) => void }> = {},
): Promise<Result<LocatedNotice, LocateNoticeError>> {
  let target: StoredMessage;
  let messages: readonly StoredMessage[];
  if (options.resume) {
    ({ target, messages } = options.resume);
  } else {
    const found = await store.findByCoreMessageId(companyId, coreMessageId);
    if (!found.success) return found;
    if (found.data === null || found.data.chatId !== chatId) return err(notFound);
    target = found.data;
    const first = await store.listFromArrivalSeq(companyId, chatId, target.arrivalSeq, noticeFirstQueryLimit);
    if (!first.success) return first;
    messages = first.data;
    if (!messages.some((message) => message.arrivalSeq <= target.arrivalSeq)) options.onProgress?.({ messages, target });
  }
  while (!messages.some((message) => message.arrivalSeq <= target.arrivalSeq)) {
    const oldest = messages.at(-1)?.arrivalSeq ?? null;
    if (oldest === null) return err(notFound);
    const older = await store.listMessages(companyId, chatId, { beforeArrivalSeq: oldest, limit: noticePageSize });
    if (!older.success) return older;
    // The message was deleted while paging: the range ended before reaching it.
    if (older.data.length === 0) return err(notFound);
    messages = [...messages, ...older.data];
    if (!messages.some((message) => message.arrivalSeq <= target.arrivalSeq)) options.onProgress?.({ messages, target });
  }
  return ok({ messages, target });
}
