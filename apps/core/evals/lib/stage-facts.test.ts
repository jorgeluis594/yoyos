import { expect, test } from "vitest";
import { decisionOf, expectedStagesOf, scoreStages, type StageAnswer } from "@core/evals/lib/stage-facts";
import { messageExpectation } from "@core/evals/cases/schema";
import { ignoredRequestOf } from "@core/evals/lib/metrics";

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

test("a step whose only expectation is a silent decision asks nothing: no intent, not a request that could be ignored", () => {
  expect(expectedStagesOf(expectation({ notice: null, decision: "silent" }))).toMatchObject({ intent: "no_intent", requested: false, decision: "silent" });
  expect(expectedStagesOf(expectation({ notice: null, decision: "silent", stages: { intent: "requests" } }))).toMatchObject({ intent: "requests", requested: true });
  expect(expectedStagesOf(expectation({ notice: null, decision: "silent", order: [] }))).toMatchObject({ intent: "requests", requested: true });
  expect(expectedStagesOf(expectation({ notice: "not_applied", decision: "urgent" }))).toMatchObject({ intent: "requests", requested: true });
  expect(expectedStagesOf(expectation({ notice: null, decision: "doubtful", order: [] }))).toMatchObject({ intent: "requests", requested: true });
});

test("a silent step the reader left alone is neither an ignored request nor a wrong intent", () => {
  const expected = expectedStagesOf(expectation({ notice: null, decision: "silent" }));
  const facts = scoreStages(expected, { intent: "no_intent", fields: null, product: null, decision: "silent", changeApplied: false, marked: false, point: false, noticed: false,
    changedNotice: false, orderMatches: null, readingMs: 900, queuedMs: 0, stageCostsUsd: {} });
  expect(facts).toMatchObject({ intent: true, requested: false });
  expect(ignoredRequestOf(facts)).toBe(false);
});

test("«listo» with pendings left is urgent, as the production reader treats it: a problem of the message, not an informative notice", () => {
  expect(decisionOf(expectation({ notice: "ready_with_pendings" }))).toBe("urgent");
  expect(decisionOf(expectation({ notice: null, outcomes: ["ready_with_pendings"] }))).toBe("urgent");
  expect(decisionOf(expectation({ notice: "ready_with_pendings", outcomes: ["pending_created", "ready_with_pendings"] }))).toBe("urgent");
  expect(decisionOf(expectation({ notice: "ready", outcomes: ["ready"] }))).toBe("notice");
});

test("an urgent notice that goes out makes the decision urgent even beside a pending; with no notice stated a pending's own point is the pending", () => {
  expect(decisionOf(expectation({ notice: "not_clear", outcomes: ["pending_created", "not_clear"] }))).toBe("urgent");
  expect(decisionOf(expectation({ notice: "several_problems", outcomes: ["pending_created", "variant_missing", "invalid_action"] }))).toBe("urgent");
  expect(decisionOf(expectation({ notice: "variant_missing" }))).toBe("urgent");
  expect(decisionOf(expectation({ outcomes: ["pending_created", "variant_missing"] }))).toBe("pending");
  expect(decisionOf(expectation({ outcomes: ["pending_created", "unclear_item"] }))).toBe("urgent");
});

test("compares the fields folding case and accents, in names and values", () => {
  const expected = expectedStagesOf(expectation({ notice: null, outcomes: ["added"], stages: { fields: { quantity: "1", Talla: "M", Color: "Crema" } } }));
  expect(scoreStages(expected, answer({ fields: { quantity: "1", talla: "m", Color: "CREMÁ" } })).fields).toBe(true);
  expect(scoreStages(expected, answer({ fields: { quantity: "1", Talla: "M", Color: "Negro" } })).fields).toBe(false);
  expect(scoreStages(expected, answer({ fields: { quantity: "1", Talla: "M" } })).fields).toBe(false);
});
