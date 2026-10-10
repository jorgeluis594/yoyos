import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { registerWhatsAppMessageRequestSchema, registerWhatsAppMessageResponseSchema, type RegisterWhatsAppMessageRequest } from "@shared/contracts/whatsapp-messages";
import type { MessageApi } from "@mobile/features/whatsapp/application/ports";
import { parseCoreMessageId } from "@mobile/features/whatsapp/domain/ids";
import type { InboundMessage } from "@mobile/features/whatsapp/domain/inbound-message";
import type { TransportError } from "@mobile/shared/application/transport-error";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
export type UnknownDate = Readonly<{ code: "UNKNOWN_DATE"; message: string }>;

/**
 * Builds the exact contract body field by field. The image download reference, the delivery id and local URIs
 * are never part of it.
 */
export function toRegisterRequest(message: InboundMessage): Result<RegisterWhatsAppMessageRequest, UnknownDate> {
  if (message.sentAt === null) return err({ code: "UNKNOWN_DATE", message: "Core requires the message date" });
  const content = message.content;
  return ok({
    version: 1,
    message: {
      id: message.id,
      accountId: message.accountId,
      chatId: message.chatId,
      whatsappMessageId: message.whatsappMessageId,
      direction: message.direction,
      timestamp: message.sentAt.getTime(),
      content: content.type === "text"
        ? { type: "text", text: content.text }
        : {
          type: "image",
          ...(content.caption === null ? {} : { caption: content.caption }),
          ...(content.mimeType === null ? {} : { mimeType: content.mimeType }),
          ...(content.size === null ? {} : { size: content.size }),
        },
    },
  });
}

export function createMessageApi(request: Request): MessageApi {
  return {
    register: async (message) => {
      const body = toRegisterRequest(message);
      if (!body.success) return body;
      const validated = registerWhatsAppMessageRequestSchema.safeParse(body.data);
      if (!validated.success) return err({ code: "INVALID_RESPONSE", message: "Message does not satisfy the core contract" });
      const response = await request("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validated.data),
      });
      if (!response.success) return response;
      const parsed = registerWhatsAppMessageResponseSchema.safeParse(response.data);
      if (!parsed.success) return err({ code: "INVALID_RESPONSE", message: "Server returned an invalid message response" });
      const messageId = parseCoreMessageId(parsed.data.messageId);
      if (!messageId.success) return err({ code: "INVALID_RESPONSE", message: "Server returned an invalid message id" });
      return ok({ status: parsed.data.status, messageId: messageId.data });
    },
  };
}
