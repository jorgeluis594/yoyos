import { recordMessage, type RecordMessageDependencies } from "@core/src/features/chats/application/record-message";
import { storeMessageImage } from "@core/src/features/chats/application/store-message-image";
import { ensureContact } from "@core/src/features/contacts/application/ensure-contact";
import { contactRepository } from "@core/src/features/contacts/infrastructure/contact-repository";
import { chatRepository } from "@core/src/features/chats/infrastructure/chat-repository";
import { downloadWhatsAppMedia } from "@core/src/features/chats/infrastructure/whatsapp-media";
import type { WhatsAppConnection } from "@core/src/features/chats/infrastructure/whatsapp-connections";
import { withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { findCompletedPrivateImageImport, importPrivateImage } from "@core/src/shared/images";
import type { RecordMessageInput } from "@core/src/features/chats/domain/message";

export function recordWhatsAppMessage(input: RecordMessageInput, connection: WhatsAppConnection) {
  const dependencies: RecordMessageDependencies = {
    ensureContact: (contact) => ensureContact(contact, contactRepository),
    chats: chatRepository,
    storeImage: (externalId, mediaId) => storeMessageImage(externalId, mediaId, {
      findCompletedPrivateImageImport: (sourceKey) => findCompletedPrivateImageImport(connection.companyId, sourceKey),
      download: (id) => downloadWhatsAppMedia(connection, id),
      importPrivateImage: (sourceKey, file) => importPrivateImage(connection.companyId, sourceKey, file),
    }),
    transaction: withinTransaction,
  };
  return recordMessage(input, dependencies);
}
export type { Chat, ChatMessage, MessageOrigin, RecordMessageInput, RecordMessageOutcome } from "@core/src/features/chats/domain/message";
