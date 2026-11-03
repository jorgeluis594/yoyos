import type { Result } from "@shared/result";
import { ok } from "@shared/functional";
import type { ChatMessageFailureCode, StoredChatMessageOutcome } from "@core/src/features/orders/domain/chat-message-outcome";
import type { LastIncomingPhoto } from "@core/src/features/orders/domain/chat-pendings";
import { memoryAfterFailure } from "@core/src/features/orders/domain/photo-just-sent";
import { isNoticeDue } from "@core/src/features/orders/domain/seller-notice";
import type { ChatMessageId } from "@core/src/features/chats/domain/mobile-message";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type InvalidStoredData = Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;

export type FailedOutcomeResult = Readonly<{ publishNotice: boolean }>;

export type RecordFailedChatMessageDependencies = Readonly<{
  /** Runs the work in one transaction of the message's company. */
  transaction: <T, E extends Readonly<{ code: string; message: string }>>(work: () => Promise<Result<T, E>>) => Promise<Result<T, E | PersistenceError>>;
  /** Inserts `failed` unless the message has an outcome; returns what is stored after the call (null for a message that does not exist). Requires the active transaction. */
  insertFailedOutcome: (messageId: ChatMessageId, errorCode: ChatMessageFailureCode) =>
    Promise<Result<Readonly<{ inserted: boolean; stored: StoredChatMessageOutcome | null }>, PersistenceError | InvalidStoredData>>;
  /** Upserts the memory of the message's chat, keeping its pendings and «listo»; nothing for a message that does not exist. Requires the active transaction. */
  saveLastIncomingPhotoOfMessageChat: (messageId: ChatMessageId, memory: LastIncomingPhoto) => Promise<Result<null, PersistenceError | InvalidStoredData>>;
}>;

const isFailed = (stored: StoredChatMessageOutcome) => stored.outcomes.some(({ kind }) => kind === "failed");

/**
 * Records `failed` for a message that has no outcome yet, and the photo memory a failed message leaves, in one transaction: a retry after a
 * partial write cannot exist. `publishNotice` is true when this call wrote the row, or when an existing row calls for a notice that was not claimed.
 * A stored successful outcome writes no memory: that message may itself be the photo just sent, and its own transaction already wrote it.
 */
export function recordFailedChatMessage(deps: RecordFailedChatMessageDependencies) {
  return (messageId: ChatMessageId, errorCode: ChatMessageFailureCode): Promise<Result<FailedOutcomeResult, PersistenceError | InvalidStoredData>> =>
    deps.transaction(async () => {
      const recorded = await deps.insertFailedOutcome(messageId, errorCode);
      if (!recorded.success) return recorded;
      const { inserted, stored } = recorded.data;
      if (stored && isFailed(stored)) {
        const saved = await deps.saveLastIncomingPhotoOfMessageChat(messageId, memoryAfterFailure());
        if (!saved.success) return saved;
      }
      return ok({ publishNotice: inserted || (stored !== null && isNoticeDue(stored.outcomes, stored.noticeSentAt)) });
    });
}
