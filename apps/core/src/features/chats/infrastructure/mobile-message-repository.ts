import { type ChatMessage, type Contact } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { registerWhatsAppMessageRequestSchema } from "@shared/contracts/whatsapp-messages";
import type { NewMobileMessage, MobileMessage, RegisterMobileMessageError, StoreOutcome } from "@core/src/features/chats/domain/mobile-message";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { log } from "@core/src/shared/infrastructure/logger";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";

const invalidStoredData = { code: "INVALID_STORED_DATA", message: "Invalid stored message" } as const;
const unavailable = { code: "PERSISTENCE_UNAVAILABLE", message: "Unable to persist message" } as const;
type MessageRow = ChatMessage & { chat: { companyId: string; contact: Contact } };

const validDate = (date: Date) => Number.isFinite(date.getTime()) && z.iso.datetime({ offset: false }).safeParse(date.toISOString()).success;
const storedDate = z.date().refine(validDate);

// Invariants of a mobile row as stored: no Cloud API or media columns, a seller or contact source matching the
// direction, and content columns that belong to the message type.
const storedRowBase = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  chatId: z.uuid(),
  direction: z.enum(["incoming", "outgoing"]),
  source: z.enum(["contact", "seller"]),
  sentAt: storedDate.nullable(),
  receivedAt: storedDate,
  eventDispatchedAt: storedDate.nullable(),
  uploadedByUserId: z.string().min(1),
  userId: z.null(),
  whatsappMediaId: z.null(),
  imageId: z.null(),
  imageFailureCode: z.null(),
  imageFailureMessage: z.null(),
  chat: z.object({ companyId: z.string(), contact: z.object({ companyId: z.string() }) }),
});
const storedRowSchema = z.discriminatedUnion("type", [
  storedRowBase.extend({ type: z.literal("text"), caption: z.null(), imageStatus: z.null(), imageMimeType: z.null(), imageSize: z.null() }),
  storedRowBase.extend({ type: z.literal("image"), text: z.null(), imageStatus: z.literal("metadata_only"),
    imageSize: z.bigint().min(0n).max(BigInt(Number.MAX_SAFE_INTEGER)).nullable() }),
]).refine((row) => row.source === (row.direction === "incoming" ? "contact" : "seller")
  && row.chat.companyId === row.companyId && row.chat.contact.companyId === row.companyId);

export function mapMobileMessage(row: MessageRow): Result<MobileMessage, RegisterMobileMessageError> {
  const stored = storedRowSchema.safeParse(row);
  if (!stored.success) return err(invalidStoredData);
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
  if (!valid.success) return err(invalidStoredData);
  return ok({
    id: row.id as MobileMessage["id"], companyId: row.companyId as MobileMessage["companyId"], chatId: row.chatId,
    externalId: valid.data.message.id as MobileMessage["externalId"],
    accountId: valid.data.message.accountId as MobileMessage["accountId"],
    remoteChatId: valid.data.message.chatId as MobileMessage["remoteChatId"],
    whatsappMessageId: valid.data.message.whatsappMessageId as MobileMessage["whatsappMessageId"],
    direction: valid.data.message.direction, sentAt: row.sentAt, receivedAt: row.receivedAt,
    uploadedByUserId: stored.data.uploadedByUserId, content: valid.data.message.content.type === "text"
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
