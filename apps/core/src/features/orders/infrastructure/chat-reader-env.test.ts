import { expect, test } from "vitest";
import { readChatReaderEnv } from "@core/src/features/orders/infrastructure/chat-reader-env";

test("defaults the model and the timeout and leaves the key unset", () => {
  expect(readChatReaderEnv({})).toEqual({ AI_READER_MODEL: "gpt-6-luna", AI_TIMEOUT_MS: 20_000 });
  expect(readChatReaderEnv({ AI_READER_MODEL: "", AI_TIMEOUT_MS: "", OPENAI_API_KEY: "" })).toEqual({ AI_READER_MODEL: "gpt-6-luna", AI_TIMEOUT_MS: 20_000 });
});

test("reads the key, the model and the timeout", () => {
  expect(readChatReaderEnv({ OPENAI_API_KEY: "key", AI_READER_MODEL: "other", AI_TIMEOUT_MS: "5000" })).toEqual({ OPENAI_API_KEY: "key", AI_READER_MODEL: "other", AI_TIMEOUT_MS: 5000 });
});

test("fails at startup on an invalid timeout", () => {
  expect(() => readChatReaderEnv({ AI_TIMEOUT_MS: "soon" })).toThrow();
  expect(() => readChatReaderEnv({ AI_TIMEOUT_MS: "0" })).toThrow();
});
