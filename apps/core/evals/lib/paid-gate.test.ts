import { expect, test } from "vitest";
import { allCases, selectCases } from "@core/evals/cases";
import { estimateRun, paidGateText, referenceCostPerMessageUsd } from "@core/evals/lib/paid-gate";

test("refuses a paid run without EVAL_PAID and prints the estimate", () => {
  const cases = selectCases(allCases, { skipParaphrases: true });
  const refused = paidGateText({ cases, runs: 3, env: {} });
  const estimate = estimateRun({ cases, runs: 3 });

  expect(refused.allowed).toBe(false);
  expect(refused.text).toContain("EVAL_PAID=1");
  expect(refused.text).toContain(`${estimate.messages} messages × 3 runs`);
  expect(refused.text).toContain(`$${estimate.totalUsd.toFixed(2)}`);
  expect(estimate.systemUsd).toBeGreaterThanOrEqual(estimate.messages * 3 * referenceCostPerMessageUsd);
  expect(estimate.judgeUsd).toBeGreaterThanOrEqual(0);
  expect(estimate.totalUsd).toBeCloseTo(estimate.systemUsd + estimate.judgeUsd + estimate.classifierUsd);
  expect(paidGateText({ cases, runs: 3, env: { EVAL_PAID: "1" } }).allowed).toBe(true);
  expect(paidGateText({ cases, runs: 3, env: { EVAL_PAID: "0" } }).allowed).toBe(false);
  expect(paidGateText({ cases, runs: 3, env: { EVAL_MODELS: "fake" } })).toMatchObject({ allowed: true });
});

test("the estimate counts a conversation by its messages and scales with the runs", () => {
  const cases = selectCases(allCases, { skipParaphrases: true });
  // The classifier runs once per run, whatever the repeats.
  const withoutClassifier = (runs: number) => estimateRun({ cases, runs }).totalUsd - estimateRun({ cases, runs }).classifierUsd;
  expect(withoutClassifier(5)).toBeCloseTo(withoutClassifier(1) * 5);
  expect(estimateRun({ cases: [], runs: 3 }).totalUsd).toBe(0);
});

test("the estimate prices photo messages and the classifier, and EVAL_PAID never comes from a file", async () => {
  const { fileAndShellEnv } = await import("@core/evals/lib/eval-env");
  const { classifierReferenceCostUsd, photoReferenceCostUsd } = await import("@core/evals/lib/paid-gate");
  const cases = selectCases(allCases, { skipParaphrases: true });
  const estimate = estimateRun({ cases, runs: 3 });

  expect(estimate.photos).toBeGreaterThan(0);
  expect(estimate.systemUsd).toBeCloseTo((estimate.messages * referenceCostPerMessageUsd + estimate.photos * photoReferenceCostUsd) * 3);
  expect(estimate.classifierUsd).toBe(classifierReferenceCostUsd);
  expect(estimateRun({ cases: [], runs: 3 }).classifierUsd).toBe(0);
  expect(fileAndShellEnv({ EVAL_PAID: "1", EVAL_REPEATS: "2" }, {})).toEqual({ EVAL_REPEATS: "2" });
  expect(fileAndShellEnv({ EVAL_PAID: "1" }, { EVAL_PAID: "0" })).toEqual({ EVAL_PAID: "0" });
});
