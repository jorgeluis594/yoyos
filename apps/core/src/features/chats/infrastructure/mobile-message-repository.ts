import { type ChatMessage, type Contact } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { registerWhatsAppMessageRequestSchema, registerWhatsAppMessageResponseSchema } from "@shared/contracts/whatsapp-messages";
import type { NewMobileMessage, MobileMessage, RegisterMobileMessageError, StoreOutcome } from "@core/src/features/chats/domain/mobile-message";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";

const invalidStoredData = { code: "INVALID_STORED_DATA", message: "Invalid stored message" } as const;
const unavailable = { code: "PERSISTENCE_UNAVAILABLE", message: "Unable to persist message" } as const;
type MessageRow = ChatMessage & { chat: { companyId: string; contact: Contact } };

export function mapMobileMessage(row: MessageRow): Result<MobileMessage, RegisterMobileMessageError> {
  if (row.imageSize !== null && (row.imageSize < 0n || row.imageSize > BigInt(Number.MAX_SAFE_INTEGER))) return err(invalidStoredData);
  const size = row.imageSize === null ? null : Number(row.imageSize);
  const content = row.type === "text" ? { type: "text" as const, text: row.text } : {
    type: "image" as const, caption: row.caption, mimeType: row.imageMimeType, size,
  };
  const valid = registerWhatsAppMessageRequestSchema.safeParse({ version: 1, message: {
    id: row.externalId, accountId: row.chat.contact.whatsappAccountId, chatId: row.chat.contact.whatsappLid,
    whatsappMessageId: row.whatsappMessageId, direction: row.direction, ...(row.sentAt === null ? {} : { timestamp: row.sentAt.getTime() }),
    content: row.type === "text" ? content : { type: "image", ...(row.caption === null ? {} : { caption: row.caption }),
      ...(row.imageMimeType === null ? {} : { mimeType: row.imageMimeType }), ...(row.imageSize === null ? {} : { size }) },
  } });
  const validDate = (date: Date) => Number.isFinite(date.getTime()) && z.iso.datetime({ offset: false }).safeParse(date.toISOString()).success;
  const validResponse = validDate(row.receivedAt) && registerWhatsAppMessageResponseSchema.safeParse({
    status: "stored", messageId: row.id, eventId: row.id, receivedAt: row.receivedAt.toISOString(),
  }).success;
  if (!valid.success || !validResponse || !z.uuid().safeParse(row.companyId).success || !z.uuid().safeParse(row.chatId).success
    || (row.eventDispatchedAt !== null && !validDate(row.eventDispatchedAt))
    || row.chat.companyId !== row.companyId || row.chat.contact.companyId !== row.companyId
    || !row.uploadedByUserId || row.userId !== null || row.source !== (row.direction === "incoming" ? "contact" : "seller")
    || row.whatsappMediaId !== null || row.imageId !== null || row.imageFailureCode !== null || row.imageFailureMessage !== null
    || (row.type === "text" && (row.caption !== null || row.imageStatus !== null || row.imageMimeType !== null || row.imageSize !== null))
    || (row.type === "image" && (row.text !== null || row.imageStatus !== "metadata_only"))
    || (row.sentAt !== null && !Number.isFinite(row.sentAt.getTime()))) return err(invalidStoredData);
  return ok({
    id: row.id as MobileMessage["id"], companyId: row.companyId as MobileMessage["companyId"], chatId: row.chatId,
    externalId: valid.data.message.id as MobileMessage["externalId"],
    accountId: valid.data.message.accountId as MobileMessage["accountId"],
    remoteChatId: valid.data.message.chatId as MobileMessage["remoteChatId"],
    whatsappMessageId: valid.data.message.whatsappMessageId as MobileMessage["whatsappMessageId"],
    direction: valid.data.message.direction, sentAt: row.sentAt, receivedAt: row.receivedAt,
    uploadedByUserId: row.uploadedByUserId, content: valid.data.message.content.type === "text"
      ? { type: "text", text: valid.data.message.content.text }
      : { type: "image", caption: row.caption, mimeType: row.imageMimeType, size },
    eventDispatchedAt: row.eventDispatchedAt,
  });
}

export const mobileMessageRepository = {
  async insertAndRead(input: NewMobileMessage, chatId: string): Promise<Result<StoreOutcome, RegisterMobileMessageError>> {
    try {
      const inserted = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "ChatMessage" ("id", "companyId", "chatId", "externalId", "whatsappMessageId", "direction", "source", "userId", "type", "text", "caption", "sentAt", "receivedAt", "imageStatus", "imageMimeType", "imageSize", "uploadedByUserId")
        VALUES (${input.id}::uuid, ${input.companyId}::uuid, ${chatId}::uuid, ${input.externalId}, ${input.whatsappMessageId},
          ${input.direction}::"MessageDirection", ${input.direction === "incoming" ? "contact" : "seller"}::"MessageSource", NULL,
          ${input.content.type}::"MessageType", ${input.content.type === "text" ? input.content.text : null},
          ${input.content.type === "image" ? input.content.caption : null}, ${input.sentAt}, ${input.receivedAt},
          ${input.content.type === "image" ? "metadata_only" : null}::"MessageImageStatus",
          ${input.content.type === "image" ? input.content.mimeType : null},
          ${input.content.type === "image" && input.content.size !== null ? BigInt(input.content.size) : null}, ${input.uploadedByUserId})
        ON CONFLICT ("companyId", "chatId", "whatsappMessageId") DO NOTHING RETURNING "id"
      `;
      const row = await prisma.chatMessage.findFirst({ where: { companyId: input.companyId, chatId, whatsappMessageId: input.whatsappMessageId }, include: { chat: { include: { contact: true } } } });
      if (!row) return err(invalidStoredData);
      const mapped = mapMobileMessage(row);
      return mapped.success ? ok({ created: inserted.length === 1, message: mapped.data }) : mapped;
    } catch (cause) {
      if (!isPersistenceFailure(cause)) throw cause;
      log.error({ event: "unable_to_store_mobile_message", err: cause }, "unable_to_store_mobile_message");
      return err(unavailable);
    }
  },
};
