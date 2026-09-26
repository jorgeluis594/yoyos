import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { validRecordMessage, type Chat, type ChatMessage, type RecordMessageError, type RecordMessageOutcome, type RecordMessageInput, type MessageOrigin, type MessageImage } from "@core/src/features/chats/domain/message";
import { ensureContact } from "@core/src/features/contacts/application/ensure-contact";
import type { Contact } from "@core/src/features/contacts/domain/contact";
import { contactRepository } from "@core/src/features/contacts/infrastructure/contact-repository";
import { chatRepository } from "@core/src/features/chats/infrastructure/chat-repository";
import { withinTransaction } from "@core/src/shared/infrastructure/persistance";

export type NewChatMessage = Readonly<{ chatId: string; externalId: string; origin: MessageOrigin; sentAt: Date; receivedAt: Date; content:
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "image"; caption: string | null; image: Extract<MessageImage, { status: "pending" }> }>
}>;
export type ChatRepository = Readonly<{
  findMessageId: (externalId: string) => Promise<Result<Pick<ChatMessage, "id"> | null, RecordMessageError>>;
  ensureChat: (contactId: string) => Promise<Result<Chat, RecordMessageError>>;
  insertMessage: (input: NewChatMessage) => Promise<Result<RecordMessageOutcome, RecordMessageError>>;
}>;
export type RecordMessageDependencies = Readonly<{
  ensureContact: (input: Readonly<{ phone: string; profileName: string | null }>) => Promise<Result<Contact, RecordMessageError>>;
  chats: ChatRepository;
  transaction: <T>(operation: () => Promise<Result<T, RecordMessageError>>) => Promise<Result<T, RecordMessageError>>;
}>;

export async function recordMessage(input: RecordMessageInput, dependencies: RecordMessageDependencies): Promise<Result<RecordMessageOutcome, RecordMessageError>> {
  if (!validRecordMessage(input)) return err({ code: "INVALID_MESSAGE", message: "Invalid message" });
  return dependencies.transaction(async () => {
    const prior = await dependencies.chats.findMessageId(input.externalId);
    if (!prior.success) return prior;
    if (prior.data) return ok({ status: "duplicate", messageId: prior.data.id });
    const contact = await dependencies.ensureContact({ phone: input.contactPhone, profileName: input.contactName });
    if (!contact.success) return contact;
    const chat = await dependencies.chats.ensureChat(contact.data.id);
    if (!chat.success) return chat;
    const content: NewChatMessage["content"] = input.content.type === "text"
      ? input.content
      : { type: "image", caption: input.content.caption, image: { status: "pending", mediaId: input.content.mediaId, attempts: 0, nextAttemptAt: input.receivedAt } };
    return dependencies.chats.insertMessage({ chatId: chat.data.id, externalId: input.externalId, origin: input.origin, sentAt: input.sentAt, receivedAt: input.receivedAt, content });
  });
}

const dependencies: RecordMessageDependencies = {
  ensureContact: (input) => ensureContact(input, contactRepository),
  chats: chatRepository,
  transaction: (operation) => withinTransaction(operation),
};

export function recordWhatsAppMessage(input: RecordMessageInput) {
  return recordMessage(input, dependencies);
}
