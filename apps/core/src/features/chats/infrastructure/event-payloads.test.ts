import { expect, test } from "vitest";
import { parseMessageCreated } from "@core/src/features/chats/infrastructure/event-payloads";

const companyId = "00000000-0000-4000-8000-000000000001";
const chatId = "00000000-0000-4000-8000-000000000003";
const messageId = "00000000-0000-4000-8000-000000000002";

test("parses a message_created payload with company, chat and message ids", () => {
  expect(parseMessageCreated({ companyId, chatId, messageId })).toEqual({ success: true, data: { companyId, chatId, messageId } });
});

test("rejects a payload with extra fields, missing ids (including chatId) or non-UUID ids as INVALID_EVENT", () => {
  for (const input of [{ companyId, chatId, messageId, extra: 1 }, { companyId, messageId }, { companyId, chatId }, { companyId, chatId: "x", messageId }, { companyId }, { messageId }, { companyId: "x", chatId, messageId }, { companyId, chatId, messageId: "x" }, null])
    expect(parseMessageCreated(input)).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
});
