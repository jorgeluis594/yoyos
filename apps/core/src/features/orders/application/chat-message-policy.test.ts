import { expect, test } from "vitest";
import { applyChatMessageConcurrencyMax, readApplyChatMessageConcurrency } from "@core/src/features/orders/application/chat-message-policy";

test("APPLY_CHAT_MESSAGE_CONCURRENCY defaults to its bound when unset or empty", () => {
  expect(applyChatMessageConcurrencyMax).toBe(16);
  expect(readApplyChatMessageConcurrency({})).toBe(16);
  expect(readApplyChatMessageConcurrency({ APPLY_CHAT_MESSAGE_CONCURRENCY: "" })).toBe(16);
});

test("APPLY_CHAT_MESSAGE_CONCURRENCY reads 1 to 16", () => {
  expect(readApplyChatMessageConcurrency({ APPLY_CHAT_MESSAGE_CONCURRENCY: "1" })).toBe(1);
  expect(readApplyChatMessageConcurrency({ APPLY_CHAT_MESSAGE_CONCURRENCY: "16" })).toBe(16);
});

test("APPLY_CHAT_MESSAGE_CONCURRENCY above 16 or below 1 fails at startup", () => {
  expect(() => readApplyChatMessageConcurrency({ APPLY_CHAT_MESSAGE_CONCURRENCY: "17" })).toThrow();
  expect(() => readApplyChatMessageConcurrency({ APPLY_CHAT_MESSAGE_CONCURRENCY: "0" })).toThrow();
  expect(() => readApplyChatMessageConcurrency({ APPLY_CHAT_MESSAGE_CONCURRENCY: "many" })).toThrow();
});
