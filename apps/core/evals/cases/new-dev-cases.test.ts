import { describe, expect, test } from "vitest";
import { allCases } from "@core/evals/cases";
import { newDevInterpretationCases } from "@core/evals/cases/interpretation";
import { newDevConversationCases } from "@core/evals/cases/conversations";
import { splitOf, splitOfCase } from "@core/evals/cases/split";
import { isMessageStep, type EvalCase } from "@core/evals/cases/schema";

const newIds = [...newDevInterpretationCases, ...newDevConversationCases].map(({ id }) => id);
const newCases = allCases.filter(({ id }) => newIds.includes(id));

/** The notices and outcomes of every expectation of a case, one entry per alternative. */
const expectationsOf = (testCase: EvalCase) => {
  if (testCase.pass === "conversation") return testCase.steps.filter(isMessageStep).map((step) => step.expected);
  return testCase.pass === "image" ? [] : testCase.expected;
};

describe("new dev cases of the message-to-order delta", () => {
  test("every case id added by this task falls in the dev split", () => {
    expect(newIds.length).toBeGreaterThan(40);
    for (const id of newIds) expect(splitOf(id), id).toBe("dev");
    for (const testCase of newCases) expect(splitOfCase(testCase), testCase.id).toBe("dev");
  });

  test("the new cases are all parsed by the case tables, with unique ids", () => {
    expect(newCases.map(({ id }) => id).sort()).toEqual([...newIds].sort());
    expect(new Set(newIds).size).toBe(newIds.length);
  });

  test("a case whose wording names no product is tagged unnamed-wording, at least ten of them", () => {
    const tagged = newCases.filter(({ tags }) => tags.includes("unnamed-wording"));

    expect(tagged.length).toBeGreaterThanOrEqual(10);
  });

  test("question captions carry their tag", () => {
    expect(newCases.filter(({ tags }) => tags.includes("question-caption")).length).toBeGreaterThanOrEqual(2);
  });

  test("no case lists not_applied as an alternative of a payment-request or closed-order expectation", () => {
    for (const testCase of newCases) {
      const expectations = expectationsOf(testCase);
      const mentionsFamily = expectations.some(({ notice }) => notice === "payment_request" || notice === "order_closed");
      if (!mentionsFamily || testCase.pass === "conversation") continue;
      const alternatives = expectations as readonly { notice?: string | null }[];
      expect(alternatives.length, testCase.id).toBe(1);
      expect(alternatives.some(({ notice }) => notice === "not_applied"), testCase.id).toBe(false);
    }
  });

  test("every family of the rules sheet has a case", () => {
    const families = ["no-intent-caption", "question-caption", "payment-request", "payment-boundary", "payment-with-pending", "payment-closed",
      "embedded-instruction", "named-quantity", "pending-quantity", "photo-quantity", "decline", "price", "emoji", "closed-order"];
    const kinds = new Set(newCases.map(({ kind }) => kind));

    for (const family of families) expect(kinds.has(family), family).toBe(true);
  });
});
