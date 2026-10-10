import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { MessageStore, Placement, StoreError } from "@mobile/features/whatsapp/application/ports";
import {
  parseAccountId, parseChatId, parseCompanyId, parseCoreMessageId, parseImageReference, parseLinkId, parseNativeMessageId, parseProtocolMessageId,
} from "@mobile/features/whatsapp/domain/ids";
import type { InboundContent, InboundMessage } from "@mobile/features/whatsapp/domain/inbound-message";
import type { ConversationSummary, StoredMessage, SyncState } from "@mobile/features/whatsapp/domain/stored-message";
import type { RejectCode } from "@mobile/features/whatsapp/domain/sync-policy";
import type { LocalSql, SqlTransaction } from "@mobile/features/whatsapp/infrastructure/local-sql";

type MessageRow = Readonly<{
  id: string; link_id: string | null; company_id: string | null; account_id: string; chat_id: string; whatsapp_message_id: string;
  direction: "incoming" | "outgoing"; sent_at: number | null; arrival_seq: number; stored_at: number;
  content_type: "text" | "image"; text: string | null; image_mime_type: string | null; image_size: number | null; image_reference: string | null;
  sync_state: SyncState["state"]; sync_attempts: number; next_attempt_at: number | null; core_message_id: string | null;
  sync_error_code: string | null; synced_at: number | null; rejected_at: number | null;
}>;

const storageFailure: StoreError = { code: "LOCAL_STORAGE_FAILED", message: "Local storage failed" };
const rejectCodes: readonly string[] = ["INVALID_INPUT", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"];

// Stored data is corrupt if it fails these; the throw is translated to LOCAL_STORAGE_FAILED by `guarded`.
function unwrap<T>(result: Result<T, { message: string }>): T {
  if (!result.success) throw new Error(`Stored message is invalid: ${result.error.message}`);
  return result.data;
}

function toContent(row: MessageRow): InboundContent {
  if (row.content_type === "text") return { type: "text", text: row.text ?? "" };
  return {
    type: "image", caption: row.text, mimeType: row.image_mime_type, size: row.image_size,
    reference: unwrap(parseImageReference(row.image_reference ?? "")),
  };
}

function toSync(row: MessageRow): SyncState {
  switch (row.sync_state) {
    case "pending":
      return { state: "pending", attempts: row.sync_attempts, nextAttemptAt: new Date(row.next_attempt_at ?? row.stored_at) };
    case "synced":
      return { state: "synced", coreMessageId: unwrap(parseCoreMessageId(row.core_message_id ?? "")), syncedAt: new Date(row.synced_at ?? row.stored_at) };
    case "rejected": {
      if (!row.sync_error_code || !rejectCodes.includes(row.sync_error_code)) throw new Error("Stored rejection code is invalid");
      return { state: "rejected", code: row.sync_error_code as RejectCode, at: new Date(row.rejected_at ?? row.stored_at) };
    }
    default:
      return { state: row.sync_state };
  }
}

function toStored(row: MessageRow): StoredMessage {
  return {
    id: unwrap(parseNativeMessageId(row.id)),
    accountId: unwrap(parseAccountId(row.account_id)),
    chatId: unwrap(parseChatId(row.chat_id)),
    whatsappMessageId: unwrap(parseProtocolMessageId(row.whatsapp_message_id)),
    direction: row.direction,
    sentAt: row.sent_at === null ? null : new Date(row.sent_at),
    content: toContent(row),
    linkId: row.link_id === null ? null : unwrap(parseLinkId(row.link_id)),
    companyId: row.company_id === null ? null : unwrap(parseCompanyId(row.company_id)),
    arrivalSeq: row.arrival_seq,
    storedAt: new Date(row.stored_at),
    sync: toSync(row),
  };
}

async function guarded<T>(operation: () => Promise<T>): Promise<Result<T, StoreError>> {
  try {
    return ok(await operation());
  } catch {
    return err(storageFailure);
  }
}

const selectMessage = "SELECT * FROM whatsapp_messages";

async function insertMessage(tx: SqlTransaction, message: InboundMessage, placement: Placement, now: Date): Promise<void> {
  const seq = await tx.first<{ next: number }>("SELECT COALESCE(MAX(arrival_seq), 0) + 1 AS next FROM whatsapp_messages");
  if (!seq) throw new Error("Arrival sequence unavailable");
  const linked = placement.kind === "linked";
  const state = linked ? placement.initial : "orphaned";
  const content = message.content;
  await tx.run(
    `INSERT INTO whatsapp_messages (id, link_id, company_id, account_id, chat_id, whatsapp_message_id, direction, sent_at, arrival_seq, stored_at,
       content_type, text, image_mime_type, image_size, image_reference, sync_state, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    message.id, linked ? placement.link.id : null, linked ? placement.link.companyId : null, message.accountId, message.chatId,
    message.whatsappMessageId, message.direction, message.sentAt?.getTime() ?? null, seq.next, now.getTime(),
    content.type, content.type === "text" ? content.text : content.caption,
    content.type === "image" ? content.mimeType : null, content.type === "image" ? content.size : null,
    content.type === "image" ? content.reference : null, state, state === "pending" ? now.getTime() : null,
  );
}

export function createSqliteMessageStore(sql: LocalSql): MessageStore {
  return {
    saveOnce: (message, placement, now) => guarded(() => sql.transaction(async (tx) => {
      const existing = await tx.first<MessageRow>(`${selectMessage} WHERE id = ?`, message.id);
      if (existing) return { status: "duplicate" as const, message: toStored(existing) };
      if (placement.kind === "linked" && placement.claim) {
        const claimed = await tx.run("UPDATE whatsapp_links SET account_id = ? WHERE id = ? AND account_id IS NULL", message.accountId, placement.link.id);
        if (claimed !== 1) throw new Error("Link could not be claimed");
      }
      await insertMessage(tx, message, placement, now);
      const row = await tx.first<MessageRow>(`${selectMessage} WHERE id = ?`, message.id);
      if (!row) throw new Error("Inserted message not found");
      return { status: "stored" as const, message: toStored(row) };
    })),

    nextPending: (companyId, now, limit) => guarded(async () => (await sql.all<MessageRow>(
      `${selectMessage} WHERE company_id = ? AND sync_state = 'pending' AND COALESCE(next_attempt_at, 0) <= ? ORDER BY arrival_seq LIMIT ?`,
      companyId, now.getTime(), limit,
    )).map(toStored)),

    markSynced: (id, coreMessageId, at) => guarded(async () => {
      await sql.run(
        "UPDATE whatsapp_messages SET sync_state = 'synced', core_message_id = ?, synced_at = ?, next_attempt_at = NULL WHERE id = ? AND sync_state = 'pending'",
        coreMessageId, at.getTime(), id,
      );
    }),

    markRetry: (id, attempts, nextAttemptAt) => guarded(async () => {
      await sql.run(
        "UPDATE whatsapp_messages SET sync_attempts = ?, next_attempt_at = ? WHERE id = ? AND sync_state = 'pending'",
        attempts, nextAttemptAt.getTime(), id,
      );
    }),

    markRejected: (id, code, at) => guarded(async () => {
      await sql.run(
        "UPDATE whatsapp_messages SET sync_state = 'rejected', sync_error_code = ?, rejected_at = ?, next_attempt_at = NULL WHERE id = ? AND sync_state = 'pending'",
        code, at.getTime(), id,
      );
    }),

    listConversations: (companyId) => guarded(async () => {
      const rows = await sql.all<{
        chat_id: string; content_type: "text" | "image"; text: string | null; sent_at: number | null;
        direction: "incoming" | "outgoing"; message_count: number; unsynced: number;
      }>(
        `SELECT m.chat_id, m.content_type, m.text, m.sent_at, m.direction, s.message_count, s.unsynced
         FROM (SELECT MAX(arrival_seq) AS last_seq, COUNT(*) AS message_count,
                      SUM(sync_state IN ('pending', 'held_unknown_date')) AS unsynced
               FROM whatsapp_messages WHERE company_id = ? GROUP BY chat_id) s
         JOIN whatsapp_messages m ON m.arrival_seq = s.last_seq
         ORDER BY s.last_seq DESC`,
        companyId,
      );
      return rows.map((row): ConversationSummary => ({
        chatId: unwrap(parseChatId(row.chat_id)),
        lastMessage: { preview: row.text, type: row.content_type, sentAt: row.sent_at === null ? null : new Date(row.sent_at), direction: row.direction },
        messageCount: row.message_count,
        unsynced: row.unsynced,
      }));
    }),

    listMessages: (companyId, chatId, page) => guarded(async () => (await sql.all<MessageRow>(
      `${selectMessage} WHERE company_id = ? AND chat_id = ? AND (? IS NULL OR arrival_seq < ?) ORDER BY arrival_seq DESC LIMIT ?`,
      companyId, chatId, page.beforeArrivalSeq, page.beforeArrivalSeq, page.limit,
    )).map(toStored)),

    findImage: (companyId, id) => guarded(async () => {
      const row = await sql.first<MessageRow>(`${selectMessage} WHERE id = ? AND company_id = ? AND content_type = 'image'`, id, companyId);
      if (!row) return null;
      const message = toStored(row);
      return message.content.type === "image" ? { messageId: message.id, reference: message.content.reference } : null;
    }),
  };
}
