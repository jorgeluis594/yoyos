import { expect, test } from "vitest";
import type { ChatMessageId, NativeMessageId, WhatsAppAccountId, WhatsAppChatId, ProtocolMessageId, MobileMessageContent } from "@core/src/features/chats/domain/mobile-message";
import type { AppEvents } from "@core/src/shared/events/application/app-events";
import type { EventName, EventPayload } from "@core/src/shared/events/application/contracts";

test("mobile message identities and content remain distinct at typecheck", () => {
  const messageId = "00000000-0000-4000-8000-000000000001" as ChatMessageId;
  const nativeId = "wa-message:v1:x" as NativeMessageId;
  const accountId = "1@lid" as WhatsAppAccountId;
  const chatId = "2@lid" as WhatsAppChatId;
  const protocolId = "ABC" as ProtocolMessageId;
  // @ts-expect-error Native and internal message IDs are different.
  const wrongMessage: ChatMessageId = nativeId;
  // @ts-expect-error Account and chat LIDs are different roles.
  const wrongChat: WhatsAppChatId = accountId;
  // @ts-expect-error Protocol and account IDs are different roles.
  const wrongProtocol: ProtocolMessageId = accountId;
  // @ts-expect-error Text cannot carry image metadata.
  const mixed: MobileMessageContent = { type: "text", text: "x", caption: null };
  expect([messageId, nativeId, accountId, chatId, protocolId, wrongMessage, wrongChat, wrongProtocol, mixed]).toHaveLength(9);
});

test("mobile message event has a strict typed name and payload", () => {
  const name: EventName<AppEvents> = "whatsapp_message_recorded";
  // @ts-expect-error Unknown event names are rejected.
  const unknown: EventName<AppEvents> = "whatsapp_message_deleted";
  // @ts-expect-error The company ID is required.
  const noCompany: EventPayload<AppEvents, "whatsapp_message_recorded"> = { messageId: "id" };
  // @ts-expect-error The message ID is required.
  const noMessage: EventPayload<AppEvents, "whatsapp_message_recorded"> = { companyId: "id" };
  expect([name, unknown, noCompany, noMessage]).toHaveLength(4);
});
