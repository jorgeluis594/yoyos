import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { privateRunSummary, writePrivateRunSummary } from "@core/evals/lib/private-run-summary";

const secret = "quiero la taza secreta";
const failing = (over = {}) => messageRecord({ caseId: "pv-12", input: secret, expected: [{ notice: null, outcomes: ["added"], order: [{ product: "taza-secreta" }] }], actual: { notice: "ready" },
  signature: `added taza-secreta`, error: null, judge: { pass: false, score: 0, reason: `no agregó ${secret}` }, passed: false, ...over });

test("writes private run summaries with ids and failure types only", () => {
  const records = [
    failing({ ignoredActions: 1 }),
    failing({ repeat: 1, wrongSilentChange: true }),
    failing({ caseId: "pv-c3#2", conversationId: "pv-c3", step: 2, extraNotice: true, error: `boom ${secret}` }),
    messageRecord({ caseId: "pv-ok", passed: true }),
  ];
  const summary = privateRunSummary(records);

  expect(summary.runs).toBe(2);
  expect(summary.failures).toEqual([
    { id: "pv-12", failedRuns: 2, types: ["ignored_action", "wrong_silent_change"] },
    { id: "pv-c3#2", failedRuns: 1, types: ["error", "extra_notice"] },
  ]);
  const dir = mkdtempSync(join(tmpdir(), "private-run-"));
  const path = writePrivateRunSummary(dir, "run-1", records);
  const text = readFileSync(path, "utf8");

  expect(path.startsWith(join(dir, "runs"))).toBe(true);
  expect(text).toContain("pv-12");
  expect(text).toContain("wrong_silent_change");
  for (const leaked of [secret, "taza-secreta", "boom", "no agregó"]) expect(text).not.toContain(leaked);
});
