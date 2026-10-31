import { expect, test } from "vitest";
import { runsOf } from "@core/evals/lib/runs";
import { readEvalEnv } from "@core/evals/lib/eval-env";

const cases = [{ id: "a" }, { id: "b" }];

test("runs the whole selected set once per repeat, in order", () => {
  expect(runsOf(cases, 3).map(({ label }) => label)).toEqual(["a", "b", "a (repeat 1)", "b (repeat 1)", "a (repeat 2)", "b (repeat 2)"]);
  expect(runsOf(cases, 1)).toHaveLength(2);
});

test("reads EVAL_REPEATS from the environment, 3 by default, and no longer knows EVAL_REPEAT_TAGS", () => {
  expect(readEvalEnv({}).EVAL_REPEATS).toBe(3);
  expect(readEvalEnv({ EVAL_REPEATS: "5" }).EVAL_REPEATS).toBe(5);
  expect(() => readEvalEnv({ EVAL_REPEATS: "6" })).toThrow();
  expect("EVAL_REPEAT_TAGS" in readEvalEnv({ EVAL_REPEAT_TAGS: "consistency" })).toBe(false);
});
