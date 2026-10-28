import type { ChatMessageId, CompanyId } from "@core/src/features/chats/domain/mobile-message";

export type MessageCreated = Readonly<{ companyId: CompanyId; chatId: string; messageId: ChatMessageId }>;

declare module "@core/src/shared/events/application/app-events" {
  interface AppEvents { message_created: MessageCreated }
}
