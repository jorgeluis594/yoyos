import { expect, test } from "vitest";
import { readChatMessageLimits } from "@core/src/features/orders/infrastructure/chat-message-limits-env";

test("defaults the pending lifetime and the reader ceilings", () => {
  expect(readChatMessageLimits({})).toEqual({ maxItemQuantity: 99, pendingTtlMs: 7 * 86_400_000, maxReaderProducts: 24, maxReaderItems: 40, maxReaderTextChars: 2000 });
  expect(readChatMessageLimits({ CHAT_PENDING_TTL_DAYS: "", READER_MAX_PRODUCTS: "" })).toMatchObject({ pendingTtlMs: 7 * 86_400_000, maxReaderProducts: 24 });
});

test("reads the limits from the env", () => {
  expect(readChatMessageLimits({ CHAT_PENDING_TTL_DAYS: "2", READER_MAX_PRODUCTS: "10", READER_MAX_ITEMS: "5", READER_MAX_TEXT_CHARS: "300" }))
    .toMatchObject({ pendingTtlMs: 2 * 86_400_000, maxReaderProducts: 10, maxReaderItems: 5, maxReaderTextChars: 300 });
});

test("fails at startup on an invalid limit", () => {
  expect(() => readChatMessageLimits({ READER_MAX_PRODUCTS: "many" })).toThrow();
  expect(() => readChatMessageLimits({ READER_MAX_TEXT_CHARS: "0" })).toThrow();
});
