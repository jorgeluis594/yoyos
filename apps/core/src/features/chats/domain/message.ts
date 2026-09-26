export type MessageOrigin = Readonly<{ direction: "incoming"; source: "contact" }> | Readonly<{ direction: "outgoing"; source: "seller"; userId: string | null }>;
export type ReceivedContent = Readonly<{ type: "text"; text: string }> | Readonly<{ type: "image"; mediaId: string; caption: string | null }>;
export type RecordMessageInput = Readonly<{ externalId: string; contactPhone: string; contactName: string | null; origin: MessageOrigin; sentAt: Date; receivedAt: Date; content: ReceivedContent }>;
export type RecordMessageError = Readonly<{ code: "INVALID_MESSAGE" | "INVALID_CONTACT" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA"; message: string }>;
export type RecordMessageOutcome = Readonly<{ status: "stored"; messageId: string }> | Readonly<{ status: "duplicate"; messageId: string }>;
export type Chat = Readonly<{ id: string; contactId: string; createdAt: Date }>;
export type MessageImage =
  | Readonly<{ status: "ready"; mediaId: string; imageId: string }>
  | Readonly<{ status: "failed"; mediaId: string; failure: Readonly<{ code: "INVALID_IMAGE" | "MEDIA_UNAVAILABLE" | "IMAGE_STORAGE_UNAVAILABLE"; message: string }> }>;
export type StoredContent = Readonly<{ type: "text"; text: string }> | Readonly<{ type: "image"; caption: string | null; image: MessageImage }>;
export type ChatMessage = Readonly<{ id: string; chatId: string; externalId: string; origin: MessageOrigin; sentAt: Date; receivedAt: Date; content: StoredContent }>;
export function validRecordMessage(input: RecordMessageInput): boolean {
  const validOrigin = (input.origin.direction === "incoming" && input.origin.source === "contact")
    || (input.origin.direction === "outgoing" && input.origin.source === "seller" && (input.origin.userId === null || input.origin.userId.length > 0));
  return Boolean(input.externalId.trim()) && validOrigin
    && Number.isFinite(input.sentAt.getTime()) && Number.isFinite(input.receivedAt.getTime())
    && (input.content.type === "text" ? typeof input.content.text === "string" : Boolean(input.content.mediaId.trim()) && (typeof input.content.caption === "string" || input.content.caption === null));
}
