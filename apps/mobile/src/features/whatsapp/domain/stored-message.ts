import type { CoreMessageId, ImageDownloadReference, LinkId, CompanyId, NativeMessageId, WhatsAppChatId } from "@mobile/features/whatsapp/domain/ids";
import type { InboundMessage } from "@mobile/features/whatsapp/domain/inbound-message";
import type { RejectCode } from "@mobile/features/whatsapp/domain/sync-policy";

export type SyncState =
  | Readonly<{ state: "pending"; attempts: number; nextAttemptAt: Date }>
  | Readonly<{ state: "synced"; coreMessageId: CoreMessageId; syncedAt: Date }>
  | Readonly<{ state: "rejected"; code: RejectCode; at: Date }>
  | Readonly<{ state: "orphaned" }>;

export type StoredMessage = InboundMessage & Readonly<{
  /** null exactly when the message is orphaned. */
  linkId: LinkId | null;
  companyId: CompanyId | null;
  /** Local monotonic arrival order; the ordering base because sentAt can be null. */
  arrivalSeq: number;
  storedAt: Date;
  sync: SyncState;
}>;

export type ConversationSummary = Readonly<{
  chatId: WhatsAppChatId;
  lastMessage: Readonly<{ preview: string | null; type: "text" | "image"; sentAt: Date | null; direction: "incoming" | "outgoing" }>;
  messageCount: number;
  /** Messages not yet registered in core and still eligible (pending). */
  unsynced: number;
}>;

export type Page = Readonly<{ beforeArrivalSeq: number | null; limit: number }>;

export type StoredImage = Readonly<{ messageId: NativeMessageId; reference: ImageDownloadReference }>;
