import type { TransportError } from "@mobile/shared/application/transport-error";
import type { WhatsAppClient, WhatsAppError } from "@mobile/modules/whatsapp/types";
import type { Result } from "@shared/result";
import type { CompanyId, CoreMessageId, LinkId, NativeMessageId, UserId, WhatsAppChatId } from "@mobile/features/whatsapp/domain/ids";
import type { InboundMessage } from "@mobile/features/whatsapp/domain/inbound-message";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";
import type { ConversationSummary, Page, StoredImage, StoredMessage } from "@mobile/features/whatsapp/domain/stored-message";
import type { RejectCode } from "@mobile/features/whatsapp/domain/sync-policy";

export type StoreError = Readonly<{ code: "LOCAL_STORAGE_FAILED"; message: string }>;

export type Placement =
  | Readonly<{ kind: "linked"; link: WhatsAppLink; claim: boolean }>
  | Readonly<{ kind: "orphan" }>;

export type SaveOutcome = Readonly<{ status: "stored" | "duplicate"; message: StoredMessage }>;

export type MessageStore = Readonly<{
  saveOnce(message: InboundMessage, placement: Placement, now: Date): Promise<Result<SaveOutcome, StoreError>>;
  nextPending(companyId: CompanyId, now: Date, limit: number): Promise<Result<readonly StoredMessage[], StoreError>>;
  /** Earliest `next_attempt_at` among the company pending messages, or null when none is pending. */
  nextRetryAt(companyId: CompanyId): Promise<Result<Date | null, StoreError>>;
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

/** The native client operations the feature needs, supplied by composition so use cases run against fakes. */
export type WhatsAppGateway = Pick<WhatsAppClient,
  "connect" | "disconnect" | "logout" | "confirmMessageStored" | "downloadImage" | "deleteDownloadedImage" | "addListener"> & Readonly<{
  initialize(): Promise<Result<void, WhatsAppError | GatewayConfigurationError>>;
}>;

export type GatewayConfigurationError = Readonly<{ code: "INVALID_WHATSAPP_RECOVERY_BUFFER_MIB"; message: string }>;

export type Session = Readonly<{ companyId: CompanyId; userId: UserId; generation: number }>;

export type RegistrationOutcome = Readonly<{ status: "stored" | "duplicate"; messageId: CoreMessageId }>;
/** INVALID_MESSAGE: the local message does not satisfy the core contract, so no request was made. */
export type MessageApiError = TransportError | Readonly<{ code: "INVALID_MESSAGE"; message: string }>;
export type MessageApi = Readonly<{
  register(message: InboundMessage): Promise<Result<RegistrationOutcome, MessageApiError>>;
}>;
