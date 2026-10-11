export type ChatMessageId = string & { readonly __brand: "ChatMessageId" };
export type NativeMessageId = string & { readonly __brand: "NativeMessageId" };
export type WhatsAppAccountId = string & { readonly __brand: "WhatsAppAccountId" };
export type WhatsAppChatId = string & { readonly __brand: "WhatsAppChatId" };
export type ProtocolMessageId = string & { readonly __brand: "ProtocolMessageId" };
export type CompanyId = string & { readonly __brand: "CompanyId" };

export type MobileMessageContent =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "image"; caption: string | null; mimeType: string | null; size: number | null }>;

export type MobileMessageInput = Readonly<{
  externalId: NativeMessageId;
  accountId: WhatsAppAccountId;
  remoteChatId: WhatsAppChatId;
  whatsappMessageId: ProtocolMessageId;
  direction: "incoming" | "outgoing";
  /** null = unknown date. */
  sentAt: Date | null;
  content: MobileMessageContent;
}>;

export type RegistrationContext = Readonly<{ companyId: CompanyId; uploadedByUserId: string }>;
export type NewMobileMessage = MobileMessageInput & RegistrationContext & Readonly<{ id: ChatMessageId; receivedAt: Date }>;
export type MobileMessage = NewMobileMessage & Readonly<{ chatId: string; eventDispatchedAt: Date | null }>;
export type StoreOutcome = Readonly<{ created: boolean; message: MobileMessage }>;
export type RegisterOutcome = Readonly<{ status: "stored" | "duplicate"; messageId: ChatMessageId; eventId: ChatMessageId; receivedAt: Date }>;
export type RegisterMobileMessageError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "EVENT_BUS_UNAVAILABLE" | "INVALID_STORED_DATA" | "INVALID_EVENT"; message: string }>;
