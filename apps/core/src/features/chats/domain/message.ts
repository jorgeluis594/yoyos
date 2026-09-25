export type MessageOrigin = Readonly<{ direction: "incoming"; source: "contact" }> | Readonly<{ direction: "outgoing"; source: "seller"; userId: string | null }>;
export type ReceivedContent = Readonly<{ type: "text"; text: string }> | Readonly<{ type: "image"; mediaId: string; caption: string | null }>;
export type RecordMessageInput = Readonly<{ companyId: string; externalId: string; contactPhone: string; contactName: string | null; origin: MessageOrigin; sentAt: Date; receivedAt: Date; content: ReceivedContent }>;
export type RecordMessageError = Readonly<{ code: "INVALID_MESSAGE" | "INVALID_CONTACT" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type RecordMessageOutcome = Readonly<{ status: "stored"; messageId: string }> | Readonly<{ status: "duplicate"; messageId: string }>;
export type Chat = Readonly<{ id: string; companyId: string; contactId: string; createdAt: Date }>;
export type ImageFailure = Readonly<{ code: "MEDIA_UNAVAILABLE" | "INVALID_IMAGE" | "RETRIES_EXHAUSTED"; message: string }>;
export type MessageImage =
  | Readonly<{ status: "pending"; mediaId: string; attempts: number; nextAttemptAt: Date }>
  | Readonly<{ status: "processing"; mediaId: string; attempts: number; claimToken: string; leaseUntil: Date }>
  | Readonly<{ status: "ready"; mediaId: string; imageId: string }>
  | Readonly<{ status: "failed"; mediaId: string; attempts: number; failure: ImageFailure }>;
export type StoredContent = Readonly<{ type: "text"; text: string }> | Readonly<{ type: "image"; caption: string | null; image: MessageImage }>;
export type ChatMessage = Readonly<{ id: string; companyId: string; chatId: string; externalId: string; origin: MessageOrigin; sentAt: Date; receivedAt: Date; content: StoredContent }>;
export function validRecordMessage(input: RecordMessageInput): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validOrigin = (input.origin.direction === "incoming" && input.origin.source === "contact")
    || (input.origin.direction === "outgoing" && input.origin.source === "seller" && (input.origin.userId === null || input.origin.userId.length > 0));
  return uuid.test(input.companyId) && Boolean(input.externalId.trim()) && validOrigin
    && Number.isFinite(input.sentAt.getTime()) && Number.isFinite(input.receivedAt.getTime())
    && (input.content.type === "text" ? typeof input.content.text === "string" : Boolean(input.content.mediaId.trim()) && (typeof input.content.caption === "string" || input.content.caption === null));
}
