import { expect, test } from "vitest";
import { diagnosticsOf } from "@core/evals/lib/diagnostics";

const outcome = { kind: "invalid_action", orderId: null, reason: "malformed" };
const applied = { result: { success: true, data: { kind: "applied", outcomes: [outcome, { kind: "added" }, { ...outcome, reason: "unknown_reference" }] } } } as never;
const answer = { kind: "actions", actions: [] };

test("records of a dev run keep the reader answer and the invalid action reasons", () => {
  expect(diagnosticsOf(true, applied, { readerAnswers: [{ kind: "first attempt" }, answer] }))
    .toEqual({ readerAnswer: answer, invalidReasons: ["malformed", "unknown_reference"] });
  expect(diagnosticsOf(true, { result: { success: false, error: { code: "X" } } } as never, { readerAnswers: [] }))
    .toEqual({ readerAnswer: null, invalidReasons: [] });
});

test("records of a test-split or private run keep no reader answer", () => {
  expect(diagnosticsOf(false, applied, { readerAnswers: [answer] })).toEqual({ readerAnswer: null, invalidReasons: null });
});
