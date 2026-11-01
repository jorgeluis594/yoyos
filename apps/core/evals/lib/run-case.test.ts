import { expect, test } from "vitest";
import { readingOf } from "@core/evals/lib/run-case";
import type { MessageTrace } from "@core/src/features/orders/domain/reader/trace";

test("keeps the masked stage outputs and the decisions of a trace, and nothing when no reading ran", () => {
  const trace = {
    stages: [{ call: { stage: "intent", reading: "primary", provider: "fake", model: "m", promptVersion: "intent-v1", usage: null, costUsd: null, durationMs: 1, attempts: 1 },
      input: { refs: [], productIds: [], productNames: [], candidateIds: [] }, output: { stage: "intent", kind: "unsure", language: "es", addressSpans: [] }, errorCode: null }],
    decisions: [{ action: { kind: "add_item" }, risk: "low", agreement: "not_run", decision: "applied", signals: {} }],
  } as unknown as MessageTrace;

  expect(readingOf(trace)).toEqual({
    stages: [{ stage: "intent", reading: "primary", promptVersion: "intent-v1", errorCode: null, output: { stage: "intent", kind: "unsure", language: "es", addressSpans: [] } }],
    decisions: [{ action: "add_item", risk: "low", agreement: "not_run", decision: "applied" }],
  });
  expect(readingOf(null)).toBeNull();
});
