import { recordMessage, type RecordMessageDependencies } from "@core/src/features/chats/application/record-message";
import { storeMessageImage } from "@core/src/features/chats/application/store-message-image";
import { ensureContact } from "@core/src/features/contacts/application/ensure-contact";
import { contactRepository } from "@core/src/features/contacts/infrastructure/contact-repository";
import { chatRepository } from "@core/src/features/chats/infrastructure/chat-repository";
import { downloadWhatsAppMedia } from "@core/src/features/chats/infrastructure/whatsapp-media";
import type { WhatsAppConnection } from "@core/src/features/chats/infrastructure/whatsapp-connections";
import { withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { importPrivateImage } from "@core/src/shared/images/application/images";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import type { RecordMessageInput } from "@core/src/features/chats/domain/message";

const storage = createR2ImageStorage({ endpoint: process.env.R2_ENDPOINT ?? "", bucket: process.env.R2_BUCKET ?? "", privateBucket: process.env.R2_PRIVATE_BUCKET ?? "", accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "", publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "" });

export function recordWhatsAppMessage(input: RecordMessageInput, connection: WhatsAppConnection) {
  const dependencies: RecordMessageDependencies = {
    ensureContact: (contact) => ensureContact(contact, contactRepository),
    chats: chatRepository,
    storeImage: (externalId, mediaId) => storeMessageImage(externalId, mediaId, {
      findCompletedImport: (sourceKey) => imageRepository.findCompletedImport(connection.companyId, sourceKey),
      download: (id) => downloadWhatsAppMedia(connection, id),
      importImage: (sourceKey, file) => importPrivateImage(connection.companyId, sourceKey, file, storage, imageRepository),
    }),
    transaction: withinTransaction,
  };
  return recordMessage(input, dependencies);
}
export type { Chat, ChatMessage, MessageOrigin, RecordMessageInput, RecordMessageOutcome } from "@core/src/features/chats/domain/message";
