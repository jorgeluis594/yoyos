import { useEffect, useMemo, useState } from "react";
import type { CompanyId } from "@mobile/features/whatsapp/domain/ids";
import type { StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import type { MessageQuestionsApi, QuestionPoint } from "@mobile/features/whatsapp/infrastructure/message-questions-api";

/** Core answers for 100 messages per call. */
const maxMessages = 100;
/** A chat view shows up to three boxes per message. */
export const maxBoxesPerMessage = 3;

/** The core ids of the shown incoming messages that core knows, newest first, with the local message each one is. */
export function coreIdsOf(messages: readonly StoredMessage[]): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  for (const message of messages) {
    if (ids.size === maxMessages) break;
    if (message.direction === "incoming" && message.sync.state === "synced") ids.set(message.sync.coreMessageId, message.id);
  }
  return ids;
}

/**
 * The open question points by local message id. They load for the shown messages when the chat opens or new messages show,
 * when `refresh` changes (a foreground notice for the chat) and when the seller returns to the screen.
 * A failed lookup keeps what was shown: the questions are help, never the chat.
 */
export function useOpenQuestions(
  api: MessageQuestionsApi | null,
  companyId: CompanyId | null,
  messages: readonly StoredMessage[],
  options: Readonly<{ focused: boolean; refresh: number }>,
): ReadonlyMap<string, readonly QuestionPoint[]> {
  const [points, setPoints] = useState<ReadonlyMap<string, readonly QuestionPoint[]>>(new Map());
  const ids = useMemo(() => coreIdsOf(messages), [messages]);
  const key = [...ids.keys()].join(",");
  useEffect(() => {
    if (!api || companyId === null || !options.focused || key === "") return;
    let cancelled = false;
    void api.findOpenQuestions(key.split(",")).then((found) => {
      if (cancelled || !found.success) return;
      const byLocal = new Map<string, readonly QuestionPoint[]>();
      for (const [coreId, list] of found.data) {
        const localId = ids.get(coreId);
        if (localId !== undefined) byLocal.set(localId, list.slice(0, maxBoxesPerMessage));
      }
      setPoints(byLocal);
    });
    return () => { cancelled = true; };
    // `ids` follows `key`; reading it here is safe because both change together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, companyId, key, options.focused, options.refresh]);
  return points;
}
