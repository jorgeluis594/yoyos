import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { parseChatMessageProcessed } from "@core/src/features/orders/infrastructure/event-payloads";

const ids = { companyId: "00000000-0000-4000-8000-000000000001", messageId: "00000000-0000-4000-8000-000000000002" };

test("parses chat_message_processed with its strict payload", () => {
  expect(parseChatMessageProcessed(ids)).toEqual(ok(ids));
  for (const invalid of [{ ...ids, extra: 1 }, { companyId: ids.companyId }, { ...ids, messageId: "x" }, null])
    expect(parseChatMessageProcessed(invalid)).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
});
