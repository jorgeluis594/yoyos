import { expect, test } from "vitest";
import { runsOf } from "@core/evals/lib/runs";
import { readEvalEnv } from "@core/evals/lib/eval-env";

const cases = [{ id: "a", tags: ["consistency"] }, { id: "b", tags: ["pinned-miss"] }, { id: "c", tags: [] }];

test("repeats the cases of every tag in EVAL_REPEAT_TAGS", () => {
  expect(runsOf(cases, 3, ["consistency"]).map(({ label }) => label)).toEqual(["a", "b", "c", "a (repeat 1)", "a (repeat 2)"]);
  expect(runsOf(cases, 3, ["consistency", "pinned-miss"]).filter(({ repeat }) => repeat > 0).map(({ label }) => label))
    .toEqual(["a (repeat 1)", "a (repeat 2)", "b (repeat 1)", "b (repeat 2)"]);
  expect(runsOf(cases, 1, ["consistency"])).toHaveLength(3);
});

test("reads the repeat tags from the environment, consistency by default", () => {
  expect(readEvalEnv({}).EVAL_REPEAT_TAGS).toEqual(["consistency"]);
  expect(readEvalEnv({ EVAL_REPEAT_TAGS: "consistency, pinned-miss" }).EVAL_REPEAT_TAGS).toEqual(["consistency", "pinned-miss"]);
});
