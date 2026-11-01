import { expect, test } from "vitest";
import { readReadingBudgets } from "@core/src/features/orders/infrastructure/reading-budgets-env";

test("defaults the reading budgets", () => {
  expect(readReadingBudgets({})).toEqual({ contextMessages: 12, contextHours: 48, contextMessageChars: 500, maxItems: 40, stageInputMaxChars: 24_000 });
  expect(readReadingBudgets({ READER_CONTEXT_MESSAGES: "", READER_STAGE_INPUT_MAX_CHARS: "" })).toMatchObject({ contextMessages: 12, stageInputMaxChars: 24_000 });
});

test("reads the reading budgets from the env", () => {
  expect(readReadingBudgets({ READER_CONTEXT_MESSAGES: "6", READER_CONTEXT_HOURS: "24", READER_CONTEXT_MESSAGE_CHARS: "200", READER_MAX_ITEMS: "10", READER_STAGE_INPUT_MAX_CHARS: "9000" }))
    .toEqual({ contextMessages: 6, contextHours: 24, contextMessageChars: 200, maxItems: 10, stageInputMaxChars: 9000 });
});

test("fails at startup on an invalid reading budget", () => {
  expect(() => readReadingBudgets({ READER_CONTEXT_MESSAGES: "many" })).toThrow();
  expect(() => readReadingBudgets({ READER_CONTEXT_HOURS: "0" })).toThrow();
  expect(() => readReadingBudgets({ READER_STAGE_INPUT_MAX_CHARS: "100" })).toThrow();
});
