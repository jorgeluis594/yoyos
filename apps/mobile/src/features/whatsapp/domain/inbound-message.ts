import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import {
  parseAccountId, parseChatId, parseImageReference, parseNativeMessageId, parseProtocolMessageId,
  type IdError, type ImageDownloadReference, type NativeMessageId, type ProtocolMessageId, type WhatsAppAccountId, type WhatsAppChatId,
} from "@mobile/features/whatsapp/domain/ids";

/** Message as the native library reports it. Plain data owned by this feature; the native client's type is structurally compatible. */
export type ReceivedMessageData = Readonly<{
  id: string;
  accountId: string;
  whatsappMessageId: string;
  chatId: string;
  direction: "incoming" | "outgoing";
  text?: string;
  timestamp?: number;
  image?: Readonly<{ mimeType?: string; size?: number; reference: Readonly<{ messageId: string; downloadReference: string }> }>;
}>;

export type InboundContent =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "image"; caption: string | null; mimeType: string | null; size: number | null; reference: ImageDownloadReference }>;

export type InboundMessage = Readonly<{
  id: NativeMessageId;
  accountId: WhatsAppAccountId;
  chatId: WhatsAppChatId;
  whatsappMessageId: ProtocolMessageId;
  direction: "incoming" | "outgoing";
  /** null = unknown date; never the reception time. */
  sentAt: Date | null;
  content: InboundContent;
}>;

export type InboundMessageError = Readonly<{ code: "EMPTY_MESSAGE" | "INVALID_ID"; message: string }>;

function idError(error: IdError): InboundMessageError {
  return { code: "INVALID_ID", message: error.message };
}

function parseContent(message: ReceivedMessageData): Result<InboundContent, InboundMessageError> {
  if (message.image) {
    const reference = parseImageReference(message.image.reference.downloadReference, "image.reference");
    if (!reference.success) return err(idError(reference.error));
    return ok({
      type: "image",
      caption: message.text ?? null,
      mimeType: message.image.mimeType ?? null,
      size: message.image.size ?? null,
      reference: reference.data,
    });
  }
  if (message.text === undefined || message.text === "") return err({ code: "EMPTY_MESSAGE", message: "Message has neither text nor image" });
  return ok({ type: "text", text: message.text });
}

export function fromReceivedMessage(message: ReceivedMessageData): Result<InboundMessage, InboundMessageError> {
  const id = parseNativeMessageId(message.id);
  if (!id.success) return err(idError(id.error));
  const accountId = parseAccountId(message.accountId);
  if (!accountId.success) return err(idError(accountId.error));
  const chatId = parseChatId(message.chatId);
  if (!chatId.success) return err(idError(chatId.error));
  const whatsappMessageId = parseProtocolMessageId(message.whatsappMessageId);
  if (!whatsappMessageId.success) return err(idError(whatsappMessageId.error));
  const content = parseContent(message);
  if (!content.success) return content;
  return ok({
    id: id.data,
    accountId: accountId.data,
    chatId: chatId.data,
    whatsappMessageId: whatsappMessageId.data,
    direction: message.direction,
    sentAt: message.timestamp === undefined ? null : new Date(message.timestamp),
    content: content.data,
  });
}
