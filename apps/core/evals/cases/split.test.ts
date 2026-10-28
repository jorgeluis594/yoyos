import { expect, test } from "vitest";
import { allCases, baseCases, selectCases } from "@core/evals/cases";
import { splitOf, splitOfCase } from "@core/evals/cases/split";
import { readEvalEnv } from "@core/evals/lib/eval-env";

test("a case's split is a stable hash of its base id", () => {
  expect(splitOf("int-greeting")).toBe(splitOf("int-greeting"));
  expect(new Set(["int-greeting", "int-thanks", "txt-chompa", "hold-plin", "int-ready"].map(splitOf)).size).toBe(2);
});

test("about 30% of the base cases are in the frozen test split, in every pass with message or text cases", () => {
  const share = (cases: readonly { id: string }[]) => cases.filter(({ id }) => splitOf(id) === "test").length / cases.length;

  expect(share(baseCases)).toBeGreaterThan(0.2);
  expect(share(baseCases)).toBeLessThan(0.4);
  for (const pass of ["interpretation", "text"]) expect(share(baseCases.filter((testCase) => testCase.pass === pass))).toBeGreaterThan(0.15);
});

test("a paraphrase follows its base case", () => {
  const paraphrases = allCases.filter(({ paraphraseOf }) => paraphraseOf);

  expect(paraphrases.length).toBeGreaterThan(0);
  expect(paraphrases.every((testCase) => splitOfCase(testCase) === splitOf(testCase.paraphraseOf!))).toBe(true);
});

test("a split selects only its cases, and together the splits select every case", () => {
  const dev = selectCases(allCases, { split: "dev" });
  const frozen = selectCases(allCases, { split: "test" });

  expect(dev.every((testCase) => splitOfCase(testCase) === "dev")).toBe(true);
  expect(frozen.every((testCase) => splitOfCase(testCase) === "test")).toBe(true);
  expect(dev.length + frozen.length).toBe(allCases.length);
});

test("EVAL_SPLIT runs every split unless dev or test is asked for", () => {
  expect(readEvalEnv({}).EVAL_SPLIT).toBe("all");
  expect(readEvalEnv({ EVAL_SPLIT: "dev" }).EVAL_SPLIT).toBe("dev");
  expect(() => readEvalEnv({ EVAL_SPLIT: "holdout" })).toThrow();
});
