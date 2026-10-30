import { describe, expect, test } from "vitest";
import { needsJudge, parseCases, type MessageCase, type MessageExpectation } from "@core/evals/cases/schema";
import { shippedExpectations } from "@core/evals/lib/shipped-expectations";
import { scoreMessage, type MessageActual } from "@core/evals/lib/scorers";
import { after, line, L_NEGRO } from "@core/evals/cases/builders";

const both = { paymentRequest: true, closedOrderLine: true };
const noPayment = { paymentRequest: false, closedOrderLine: true };
const noClosedLine = { paymentRequest: true, closedOrderLine: false };

const actual = (fields: Partial<MessageActual>): MessageActual => ({ outcomes: [], notice: null, noticeProducts: [], order: [], ...fields });
const payment: MessageExpectation = { notice: "payment_request", outcomes: ["payment_requested"] };
const generic = actual({ notice: "not_applied", outcomes: ["request_not_allowed"] });
const paymentNotice = actual({ notice: "payment_request", outcomes: ["payment_requested"] });
const score = (given: MessageActual, expectations: readonly MessageExpectation[], features: Parameters<typeof scoreMessage>[4]) =>
  scoreMessage(given, expectations, [], "eval", features);

describe("the payment fallback scoring rule", () => {
  test("a conversation step expecting the payment notice is right with the generic body when the payment action is not shipped, and wrong when it is", () => {
    expect(score(generic, [payment], noPayment).passed).toBe(true);
    expect(score(paymentNotice, [payment], noPayment).passed).toBe(false);
    expect(score(paymentNotice, [payment], both).passed).toBe(true);
    expect(score(generic, [payment], both).passed).toBe(false);
  });

  test("a message case expecting the payment outcome alone is rewritten the same way", () => {
    const outcomeOnly: MessageExpectation = { outcomes: ["payment_requested", "added"], order: [after("polo-basico", L_NEGRO, 1)] };
    const order = [{ product: "polo-basico" as const, variant: L_NEGRO, quantity: 1, unitPrice: 35, mentionedPrice: null }];

    expect(shippedExpectations([outcomeOnly], noPayment)[0]!.outcomes).toEqual(["request_not_allowed", "added"]);
    expect(score(actual({ outcomes: ["request_not_allowed", "added"], order }), [outcomeOnly], noPayment).fields.outcome).toBe(true);
    expect(score(actual({ outcomes: ["payment_requested", "added"], order }), [outcomeOnly], noPayment).fields.outcome).toBe(false);
  });

  test("a private message case expecting order_closed also accepts the generic body when the closed-order line is not shipped", () => {
    const closed: MessageExpectation = { notice: "order_closed", outcomes: ["order_closed"] };
    const initial = [line("polo-basico", L_NEGRO, 2)];
    const order = [{ product: "polo-basico" as const, variant: L_NEGRO, quantity: 2, unitPrice: 35, mentionedPrice: null }];
    const genericBody = actual({ notice: "not_applied", outcomes: ["order_closed"], order });
    const withoutOutcomes = actual({ notice: "not_applied", outcomes: ["request_not_allowed"], order });

    expect(scoreMessage(withoutOutcomes, [closed], initial, "eval", noClosedLine)).toMatchObject({ passed: true, expectationIndex: 1 });
    expect(scoreMessage(genericBody, [closed], initial, "eval", noClosedLine).passed).toBe(true);
    expect(scoreMessage(withoutOutcomes, [closed], initial, "eval", both).passed).toBe(false);
    // The generic body still has to leave the order as expected.
    expect(scoreMessage(actual({ notice: "not_applied", order: [{ ...order[0]!, quantity: 5 }] }), [closed], initial, "eval", noClosedLine).passed).toBe(false);
    // The expected order of the closed expectation carries to the alternative.
    expect(shippedExpectations([{ notice: "order_closed", order: [after("polo-basico", L_NEGRO, 2)] }], noClosedLine)[1]).toEqual({ notice: "not_applied", order: [after("polo-basico", L_NEGRO, 2)] });
  });

  test("the fallback alternative never makes a case eligible for the judge", () => {
    const [closedCase] = parseCases([{ id: "shipped-a", pass: "interpretation", criterion: 1, kind: "closed", input: { text: "hola" }, expected: [{ notice: "order_closed" }] }]) as [MessageCase];

    expect(needsJudge(closedCase)).toBe(false);
    expect(shippedExpectations(closedCase.expected, noClosedLine)).toHaveLength(2);
    expect(needsJudge(closedCase)).toBe(false);
  });

  test("leaves expectations untouched when both features ship, and leaves other expectations alone when they do not", () => {
    const other: MessageExpectation = { notice: "ready", outcomes: ["ready"] };

    expect(shippedExpectations([payment, other], both)).toEqual([payment, other]);
    expect(shippedExpectations([other], { paymentRequest: false, closedOrderLine: false })).toEqual([other]);
  });
});
