import { expect, test } from "vitest";
import type { ConversationCase } from "@core/evals/cases/schema";
import { ConversationEventError } from "@core/evals/lib/conversation";
import { conversationRecordsOf, readingOf } from "@core/evals/lib/run-case";
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

test("a conversation whose event threw keeps the event as a failed record and the messages it never reached as failed too", () => {
  const testCase = { id: "c", pass: "conversation", kind: "pending-after-payment", tags: [], steps: [
    { event: "report_payment" }, { input: { text: "a" }, expected: { notice: null } }, { input: { text: "b" }, expected: { notice: null } },
  ] } as unknown as ConversationCase;
  const failure = new ConversationEventError({ event: "report_payment" }, 1, 0, new Error("The conversation has no order for report_payment"));

  const records = conversationRecordsOf(testCase, 2, { results: [], error: failure }, "eval");

  expect(records.map(({ caseId, step, repeat, passed, error }) => ({ caseId, step, repeat, passed, error }))).toEqual([
    { caseId: "c#event1", step: null, repeat: 2, passed: false, error: "The conversation has no order for report_payment" },
    { caseId: "c#1", step: 1, repeat: 2, passed: false, error: "The conversation has no order for report_payment" },
    { caseId: "c#2", step: 2, repeat: 2, passed: false, error: "The conversation has no order for report_payment" },
  ]);
});
