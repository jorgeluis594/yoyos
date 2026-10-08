import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { validRecordMessage, type Chat, type ChatMessage, type RecordMessageError, type RecordMessageOutcome, type RecordMessageInput, type MessageOrigin, type CloudMessageImage } from "@core/src/features/chats/domain/message";
import type { PhoneContact } from "@core/src/features/contacts";

export type NewChatMessage = Readonly<{ chatId: string; externalId: string; origin: MessageOrigin; sentAt: Date; receivedAt: Date; content:
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "image"; caption: string | null; image: CloudMessageImage }>
}>;
export type ChatRepository = Readonly<{
  findMessageId: (externalId: string) => Promise<Result<Pick<ChatMessage, "id"> | null, RecordMessageError>>;
  ensureChat: (contactId: string) => Promise<Result<Chat, RecordMessageError>>;
  insertMessage: (input: NewChatMessage) => Promise<Result<RecordMessageOutcome, RecordMessageError>>;
}>;
export type RecordMessageDependencies = Readonly<{
  ensureContact: (input: Readonly<{ phone: string; profileName: string | null }>) => Promise<Result<PhoneContact, RecordMessageError>>;
  chats: ChatRepository;
  storeImage: (externalId: string, mediaId: string) => Promise<Result<CloudMessageImage>>;
  transaction: <T>(operation: () => Promise<Result<T, RecordMessageError>>) => Promise<Result<T, RecordMessageError>>;
}>;

export async function recordMessage(input: RecordMessageInput, dependencies: RecordMessageDependencies): Promise<Result<RecordMessageOutcome>> {
  if (!validRecordMessage(input)) return err({ code: "INVALID_MESSAGE", message: "Invalid message" });
  const prior = await dependencies.chats.findMessageId(input.externalId);
  if (!prior.success) return prior;
  if (prior.data) return ok({ status: "duplicate", messageId: prior.data.id });
  let content: NewChatMessage["content"];
  if (input.content.type === "image") {
    const image = await dependencies.storeImage(input.externalId, input.content.mediaId);
    if (!image.success) return image;
    content = { type: "image", caption: input.content.caption, image: image.data };
  } else content = input.content;
  return dependencies.transaction(async () => {
    const contact = await dependencies.ensureContact({ phone: input.contactPhone, profileName: input.contactName });
    if (!contact.success) return contact;
    const chat = await dependencies.chats.ensureChat(contact.data.id);
    if (!chat.success) return chat;
    return dependencies.chats.insertMessage({ chatId: chat.data.id, externalId: input.externalId, origin: input.origin, sentAt: input.sentAt, receivedAt: input.receivedAt, content });
  });
}
