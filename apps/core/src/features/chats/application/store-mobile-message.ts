import type { Result } from "@shared/result";
import type { NewMobileMessage, RegisterMobileMessageError, StoreOutcome } from "@core/src/features/chats/domain/mobile-message";
import type { Chat } from "@core/src/features/chats/domain/message";
import type { WhatsAppContact } from "@core/src/features/contacts";

type StoreError = RegisterMobileMessageError;
export type StoreMobileMessageDependencies = Readonly<{
  ensureContact: (input: Readonly<{ companyId: string; whatsappAccountId: string; whatsappLid: string }>) => Promise<Result<WhatsAppContact, StoreError>>;
  ensureChat: (contactId: string) => Promise<Result<Chat, StoreError>>;
  insertAndRead: (input: NewMobileMessage, chatId: string) => Promise<Result<StoreOutcome, StoreError>>;
  transaction: <T>(operation: () => Promise<Result<T, StoreError>>) => Promise<Result<T, StoreError>>;
}>;

export function storeMobileMessage(input: NewMobileMessage, dependencies: StoreMobileMessageDependencies): Promise<Result<StoreOutcome, StoreError>> {
  return dependencies.transaction(async () => {
    const contact = await dependencies.ensureContact({ companyId: input.companyId, whatsappAccountId: input.accountId, whatsappLid: input.remoteChatId });
    if (!contact.success) return contact;
    const chat = await dependencies.ensureChat(contact.data.id);
    if (!chat.success) return chat;
    return dependencies.insertAndRead(input, chat.data.id);
  });
}
