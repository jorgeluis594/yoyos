import { expect, test } from "vitest";
import { parseMessageCreated } from "@core/src/features/chats/infrastructure/event-payloads";

const companyId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";

test("parses a message_created payload with company and message ids", () => {
  expect(parseMessageCreated({ companyId, messageId })).toEqual({ success: true, data: { companyId, messageId } });
});

test("rejects a payload with extra fields, missing ids or non-UUID ids as INVALID_EVENT", () => {
  for (const input of [{ companyId, messageId, extra: 1 }, { companyId }, { messageId }, { companyId: "x", messageId }, { companyId, messageId: "x" }, null])
    expect(parseMessageCreated(input)).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
});
