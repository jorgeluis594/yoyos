import type { Result } from "@shared/result";
import type { CompanyId, CoreMessageId, LinkId, NativeMessageId, UserId, WhatsAppChatId } from "@mobile/features/whatsapp/domain/ids";
import type { InboundMessage } from "@mobile/features/whatsapp/domain/inbound-message";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";
import type { ConversationSummary, Page, StoredImage, StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import type { RejectCode } from "@mobile/features/whatsapp/domain/sync-policy";

export type StoreError = Readonly<{ code: "LOCAL_STORAGE_FAILED"; message: string }>;

export type Placement =
  | Readonly<{ kind: "linked"; link: WhatsAppLink; claim: boolean; initial: "pending" | "held_unknown_date" }>
  | Readonly<{ kind: "orphan" }>;

export type SaveOutcome = Readonly<{ status: "stored" | "duplicate"; message: StoredMessage }>;

export type MessageStore = Readonly<{
  saveOnce(message: InboundMessage, placement: Placement, now: Date): Promise<Result<SaveOutcome, StoreError>>;
  nextPending(companyId: CompanyId, now: Date, limit: number): Promise<Result<readonly StoredMessage[], StoreError>>;
  markSynced(id: NativeMessageId, coreMessageId: CoreMessageId, at: Date): Promise<Result<void, StoreError>>;
  markRetry(id: NativeMessageId, attempts: number, nextAttemptAt: Date): Promise<Result<void, StoreError>>;
  markRejected(id: NativeMessageId, code: RejectCode, at: Date): Promise<Result<void, StoreError>>;
  listConversations(companyId: CompanyId): Promise<Result<readonly ConversationSummary[], StoreError>>;
  listMessages(companyId: CompanyId, chatId: WhatsAppChatId, page: Page): Promise<Result<readonly StoredMessage[], StoreError>>;
  findImage(companyId: CompanyId, id: NativeMessageId): Promise<Result<StoredImage | null, StoreError>>;
}>;

export type LinkStore = Readonly<{
  all(): Promise<Result<readonly WhatsAppLink[], StoreError>>;
  active(): Promise<Result<WhatsAppLink | null, StoreError>>;
  /** Fails while another link is active. */
  start(companyId: CompanyId, userId: UserId, now: Date): Promise<Result<WhatsAppLink, StoreError>>;
  end(id: LinkId, now: Date): Promise<Result<void, StoreError>>;
}>;

export type Clock = () => Date;
