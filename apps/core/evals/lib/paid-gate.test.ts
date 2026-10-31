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
  expect(estimate.systemUsd).toBeCloseTo(estimate.messages * 3 * referenceCostPerMessageUsd);
  expect(estimate.judgeUsd).toBeGreaterThanOrEqual(0);
  expect(estimate.totalUsd).toBeCloseTo(estimate.systemUsd + estimate.judgeUsd);
  expect(paidGateText({ cases, runs: 3, env: { EVAL_PAID: "1" } }).allowed).toBe(true);
  expect(paidGateText({ cases, runs: 3, env: { EVAL_PAID: "0" } }).allowed).toBe(false);
  expect(paidGateText({ cases, runs: 3, env: { EVAL_MODELS: "fake" } })).toMatchObject({ allowed: true });
});

test("the estimate counts a conversation by its messages and scales with the runs", () => {
  const cases = selectCases(allCases, { skipParaphrases: true });
  expect(estimateRun({ cases, runs: 5 }).totalUsd).toBeCloseTo(estimateRun({ cases, runs: 1 }).totalUsd * 5);
  expect(estimateRun({ cases: [], runs: 3 }).totalUsd).toBe(0);
});
