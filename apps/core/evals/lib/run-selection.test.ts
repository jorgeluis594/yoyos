import { expect, test } from "vitest";
import { allCases, selectCases } from "@core/evals/cases";
import { readerCasesOf, selectionOf } from "@core/evals/lib/run-selection";
import { readEvalEnv } from "@core/evals/lib/eval-env";

const cases = selectCases(allCases, { skipParaphrases: true });

test("the staged reader runs every case and is the default", () => {
  expect(readEvalEnv({}).EVAL_READER).toBe("staged");
  expect(readerCasesOf(cases, "staged")).toBe(cases);
  expect(selectionOf(readEvalEnv({ EVAL_SKIP_PARAPHRASES: "1" })).cases).toHaveLength(cases.length);
  expect(() => readEvalEnv({ EVAL_READER: "both" })).toThrow();
});

test("the legacy baseline keeps the text messages of the message passes and the image pass, never conversations or photo messages", () => {
  const legacy = readerCasesOf(cases, "legacy");

  expect(legacy.length).toBeGreaterThan(0);
  expect(legacy.length).toBeLessThan(cases.length);
  expect(legacy.some((testCase) => testCase.pass === "conversation")).toBe(false);
  expect(legacy.every((testCase) => testCase.pass === "image" || (testCase.pass !== "conversation" && testCase.input.text !== undefined))).toBe(true);
  expect(selectionOf(readEvalEnv({ EVAL_READER: "legacy", EVAL_SKIP_PARAPHRASES: "1" })).cases).toHaveLength(legacy.length);
});
