import { expect, test } from "vitest";
import { decisionOf, expectedStagesOf, scoreStages, type StageAnswer } from "@core/evals/lib/stage-facts";
import { messageExpectation } from "@core/evals/cases/schema";

const expectation = (input: object) => messageExpectation.parse(input);

test("derives the decision of a relabelled case from its notice and outcomes, and lets a case state it", () => {
  expect(decisionOf(expectation({ notice: "payment_request", outcomes: ["payment_requested"] }))).toBe("urgent");
  expect(decisionOf(expectation({ notice: "variant_only", outcomes: ["variant_only"] }))).toBe("urgent");
  expect(decisionOf(expectation({ notice: "ready", outcomes: ["ready"] }))).toBe("notice");
  expect(decisionOf(expectation({ notice: null, outcomes: ["pending_created"] }))).toBe("pending");
  expect(decisionOf(expectation({ notice: null, outcomes: ["added"] }))).toBe("applied");
  expect(decisionOf(expectation({ notice: null, outcomes: ["no_intent"] }))).toBe("silent");
  expect(decisionOf(expectation({ notice: null, outcomes: ["variant_changed"], decision: "doubtful" }))).toBe("doubtful");
});

test("a problem outcome with no notice still expects the seller to be interrupted, unless a pending carries it", () => {
  for (const kind of ["unclear_item", "image_with_request", "variant_only", "no_open_order", "request_not_allowed", "reader_doubt", "invalid_action"] as const) {
    expect(decisionOf(expectation({ outcomes: [kind] })), kind).toBe("urgent");
  }
  expect(decisionOf(expectation({ outcomes: ["added", "unclear_item"] }))).toBe("urgent");
  expect(decisionOf(expectation({ outcomes: ["pending_created", "variant_missing"] }))).toBe("pending");
  expect(decisionOf(expectation({ outcomes: ["unclear_item"], decision: "applied" }))).toBe("applied");
});

test("derives the intent of a case and takes fields and product only where it states them", () => {
  expect(expectedStagesOf(expectation({ notice: null, outcomes: ["no_intent"] }))).toMatchObject({ intent: "no_intent", requested: false, fields: null, product: null });
  expect(expectedStagesOf(expectation({ notice: null, outcomes: ["added"] }))).toMatchObject({ intent: "requests", requested: true });
  expect(expectedStagesOf(expectation({ notice: null, outcomes: ["added"], stages: { fields: { Talla: "M" }, product: "polo-basico" } })))
    .toMatchObject({ fields: { Talla: "M" }, product: "polo-basico" });
});

const answer = (over: Partial<StageAnswer> = {}): StageAnswer => ({ intent: "requests", fields: { Talla: "M" }, product: "polo-basico", decision: "applied", changeApplied: true, marked: false,
  point: false, noticed: false, changedNotice: false, orderMatches: true, readingMs: 900, queuedMs: 40, stageCostsUsd: { intent: 0.0003 }, ...over });

test("scores each stage against the expectation and leaves unstated stages null", () => {
  const expected = expectedStagesOf(expectation({ notice: null, outcomes: ["added"], stages: { fields: { Talla: "M" }, product: "polo-basico" } }));

  expect(scoreStages(expected, answer())).toMatchObject({ intent: true, fields: true, resolution: true, decision: true, requested: true, readingMs: 900, queuedMs: 40 });
  expect(scoreStages(expected, answer({ intent: "no_intent", fields: { Talla: "L" }, product: "gorra-trucker", decision: "silent" })))
    .toMatchObject({ intent: false, fields: false, resolution: false, decision: false, decisionExpected: "applied", decisionActual: "silent" });
  expect(scoreStages(expectedStagesOf(expectation({ notice: null, outcomes: ["added"] })), answer())).toMatchObject({ fields: null, resolution: null });
});

test("states the count of changed lines, of those with no mark and of those silently wrong", () => {
  const expected = expectedStagesOf({ outcomes: ["added"] });
  expect(scoreStages(expected, answer({ changedLines: [{ marked: true, wrong: true }, { marked: false, wrong: false }, { marked: false, wrong: true }] })))
    .toMatchObject({ changedLines: 3, unmarkedLines: 2, silentLines: 1 });
  expect(scoreStages(expected, answer())).not.toHaveProperty("changedLines");
});

test("a pending that a decline ended is a change the buyer asked for", () => {
  expect(decisionOf({ outcomes: ["pending_ended"] })).toBe("applied");
});
