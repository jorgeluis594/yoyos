import type { ChatMessageId, CompanyId } from "@core/src/features/chats/domain/mobile-message";

export type WhatsAppMessageRecorded = Readonly<{ companyId: CompanyId; messageId: ChatMessageId }>;

declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents { whatsapp_message_recorded: WhatsAppMessageRecorded }
}
