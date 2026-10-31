import { expect, test } from "vitest";
import { readChatMessageLimits, readerSettingBounds } from "@core/src/features/orders/infrastructure/chat-message-limits-env";

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

test("a reader setting above its upper bound fails at startup", () => {
  expect(readerSettingBounds).toEqual({ CHAT_PENDING_TTL_DAYS: 30, READER_MAX_PRODUCTS: 24, READER_MAX_ITEMS: 40, READER_MAX_TEXT_CHARS: 2000 });
  for (const [name, bound] of Object.entries(readerSettingBounds)) {
    expect(() => readChatMessageLimits({ [name]: String(bound) }), name).not.toThrow();
    expect(() => readChatMessageLimits({ [name]: String(bound + 1) }), name).toThrow();
  }
});

test("defaults are within the upper bounds", () => {
  const limits = readChatMessageLimits({});
  expect(limits.maxReaderProducts).toBeLessThanOrEqual(readerSettingBounds.READER_MAX_PRODUCTS);
  expect(limits.maxReaderItems).toBeLessThanOrEqual(readerSettingBounds.READER_MAX_ITEMS);
  expect(limits.maxReaderTextChars).toBeLessThanOrEqual(readerSettingBounds.READER_MAX_TEXT_CHARS);
  expect(limits.pendingTtlMs).toBeLessThanOrEqual(readerSettingBounds.CHAT_PENDING_TTL_DAYS * 86_400_000);
});
