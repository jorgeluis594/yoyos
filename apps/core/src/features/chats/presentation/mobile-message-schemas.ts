import { registerWhatsAppMessageRequestSchema, type RegisterWhatsAppMessageRequest } from "@shared/contracts/whatsapp-messages";
import type { MobileMessageInput, NativeMessageId, WhatsAppAccountId, WhatsAppChatId, ProtocolMessageId } from "@core/src/features/chats/domain/mobile-message";

export function parseMobileMessage(input: unknown): MobileMessageInput | null {
  const parsed = registerWhatsAppMessageRequestSchema.safeParse(input);
  return parsed.success ? toMobileMessageInput(parsed.data) : null;
}

export function toMobileMessageInput(request: RegisterWhatsAppMessageRequest): MobileMessageInput {
  const message = request.message;
  return {
    externalId: message.id as NativeMessageId,
    accountId: message.accountId as WhatsAppAccountId,
    remoteChatId: message.chatId as WhatsAppChatId,
    whatsappMessageId: message.whatsappMessageId as ProtocolMessageId,
    direction: message.direction,
    sentAt: message.timestamp === undefined ? null : new Date(message.timestamp),
    content: message.content.type === "text" ? { type: "text", text: message.content.text } : {
      type: "image", caption: message.content.caption ?? null, mimeType: message.content.mimeType ?? null, size: message.content.size ?? null,
    },
  };
}
