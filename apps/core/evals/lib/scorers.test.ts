import { describe, expect, test } from "vitest";
import { repeatedNoticeProducts, scoreImage, scoreMessage, unitPricesIntact, type ActualLine, type MessageActual } from "@core/evals/lib/scorers";
import { after, line, L_NEGRO, M_NEGRO } from "@core/evals/cases/builders";

const added = (quantity: number, mentionedPrice: ActualLine["mentionedPrice"] = null, unitPrice = 35): ActualLine =>
  ({ product: "polo-basico", variant: { Color: "Negro", Talla: "L" }, quantity, unitPrice, mentionedPrice });

const actual = (fields: Partial<MessageActual>): MessageActual => ({ outcomes: [], notice: null, noticeProducts: [], order: [], ...fields });

describe("scoreMessage", () => {
  const expectation = { notice: null, outcomes: ["added" as const], order: [after("polo-basico", L_NEGRO, 3, { amount: 50, units: 3 })] };

  test("scores a message by its order and notice kind", () => {
    const scored = scoreMessage(actual({ outcomes: ["added"], order: [added(3, { amount: 50, units: 3 })] }), [expectation], []);

    expect(scored).toMatchObject({ passed: true, expectationIndex: 0, ignoredActions: 0, wrongSilentChange: false, extraNotice: false, expectedSilent: true,
      fields: { notice: true, outcome: true, product: true, variant: true, quantity: true, mentionedPrice: true, unitPrice: true } });

    const noticed = scoreMessage(actual({ notice: "variant_missing", order: [] }), [{ notice: "variant_missing" }], []);
    expect(noticed).toMatchObject({ passed: true, fields: { notice: true, outcome: null } });
    expect(scoreMessage(actual({ notice: "not_clear" }), [{ notice: "variant_missing" }], []).fields.notice).toBe(false);
  });

  test("reads a size taken as a quantity as a wrong variant and quantity, with the product still right", () => {
    const scored = scoreMessage(actual({ outcomes: ["added"], order: [{ ...added(3), variant: M_NEGRO }] }), [expectation], []);

    expect(scored.passed).toBe(false);
    expect(scored.fields).toMatchObject({ product: true, variant: false, quantity: false, mentionedPrice: false });
  });

  test("a price per unit where the buyer said a bundle price fails only the mentioned price", () => {
    const scored = scoreMessage(actual({ outcomes: ["added"], order: [added(3, { amount: 16.67, units: 1 })] }), [expectation], []);

    expect(scored.fields).toMatchObject({ quantity: true, mentionedPrice: false });
  });

  test("without an expected order the initial order must stay as it was", () => {
    const initial = [line("polo-basico", M_NEGRO, 2)];
    const unchanged = { notice: "variant_only" as const, outcomes: ["variant_only" as const] };

    expect(scoreMessage(actual({ notice: "variant_only", outcomes: ["variant_only"], order: [{ ...added(2), variant: M_NEGRO }] }), [unchanged], initial).passed).toBe(true);
    expect(scoreMessage(actual({ outcomes: ["variant_changed"], order: [added(2)] }), [unchanged], initial).fields).toMatchObject({ notice: false, outcome: false, variant: false });
  });

  test("passes when any acceptable expectation matches, and reports that one", () => {
    const scored = scoreMessage(actual({ outcomes: ["no_intent"] }), [{ notice: "ready", outcomes: ["ready"] }, { notice: null, outcomes: ["no_intent"] }], []);

    expect(scored).toMatchObject({ passed: true, expectationIndex: 1 });
  });

  test("no longer accepts ambiguous intent for an expected no intent", () => {
    expect(scoreMessage(actual({ outcomes: ["ambiguous_intent"] }), [{ notice: null, outcomes: ["no_intent"] }], []).passed).toBe(false);
    expect(scoreMessage(actual({ outcomes: ["no_intent"] }), [{ notice: null, outcomes: ["no_intent"] }], []).passed).toBe(true);
  });

  test("outcomes are a multiset", () => {
    const two = { outcomes: ["added" as const, "added" as const] };

    expect(scoreMessage(actual({ outcomes: ["added"] }), [two], []).fields.outcome).toBe(false);
    expect(scoreMessage(actual({ outcomes: ["added", "added"] }), [two], []).fields.outcome).toBe(true);
  });

  test("a changed unit price fails the case whatever else matches", () => {
    const scored = scoreMessage(actual({ outcomes: ["added"], order: [added(3, { amount: 50, units: 3 }, 1)] }), [expectation], []);

    expect(scored).toMatchObject({ passed: false, fields: { quantity: true, unitPrice: false } });
  });

  test("counts a removal applied and a ready lost without a notice as one ignored action", () => {
    const initial = [line("polo-basico", M_NEGRO, 1), line("gorra-trucker", { Color: "Negro" }, 1)];
    const expected = { notice: "ready" as const, outcomes: ["removed" as const, "ready" as const], order: [after("polo-basico", M_NEGRO, 1)] };
    const kept = [{ ...added(1), variant: M_NEGRO }];

    expect(scoreMessage(actual({ outcomes: ["removed"], order: kept }), [expected], initial)).toMatchObject({ passed: false, ignoredActions: 1 });
    // The same miss with a notice for the message is not silent.
    expect(scoreMessage(actual({ outcomes: ["removed"], notice: "only_item_kept", order: kept }), [expected], initial).ignoredActions).toBe(0);
    // Nothing applied and no notice: both asked actions are ignored.
    const untouched = [{ ...added(1), variant: M_NEGRO }, { ...added(1), product: "gorra-trucker", variant: { Color: "Negro" } }];
    expect(scoreMessage(actual({ outcomes: ["no_intent"], order: untouched }), [expected], initial).ignoredActions).toBe(2);
  });

  test("counts ignored actions from the order and notice when an expectation states no outcomes", () => {
    const initial = [line("polo-basico", M_NEGRO, 1)];
    const expected = { notice: null, order: [after("polo-basico", M_NEGRO, 1), after("gorra-trucker", { Color: "Negro" }, 2)] };
    const unchanged = [{ ...added(1), variant: M_NEGRO }];

    expect(scoreMessage(actual({ order: unchanged }), [expected], initial).ignoredActions).toBe(1);
    expect(scoreMessage(actual({ order: unchanged }), [{ notice: "ready" }], initial).ignoredActions).toBe(1);
    expect(scoreMessage(actual({ notice: "not_clear", order: unchanged }), [expected], initial).ignoredActions).toBe(0);
  });

  test("a wrong change without a notice is a wrong silent change, and a notice where none was due an extra notice", () => {
    expect(scoreMessage(actual({ order: [added(1)] }), [{ notice: null, order: [] }], []))
      .toMatchObject({ wrongSilentChange: true, extraNotice: false });
    expect(scoreMessage(actual({ notice: "not_applied", order: [] }), [{ notice: null, order: [] }], []))
      .toMatchObject({ wrongSilentChange: false, extraNotice: true, expectedSilent: true });
    expect(scoreMessage(actual({ notice: "ready" }), [{ notice: "ready" }], [])).toMatchObject({ extraNotice: false, expectedSilent: false });
  });
});

test("unit prices are intact only for catalog variants at their catalog price", () => {
  expect(unitPricesIntact([added(1)])).toBe(true);
  expect(unitPricesIntact([added(1, null, 0)])).toBe(false);
  expect(unitPricesIntact([{ ...added(1), variant: { Talla: "XXL", Color: "Negro" } }])).toBe(false);
  expect(unitPricesIntact([{ ...added(1), product: null }])).toBe(false);
});

describe("scoreImage", () => {
  test("a photo is identified when it yields exactly the expected product", () => {
    expect(scoreImage({ kind: "found", products: ["polo-basico"], colors: [null] }, [{ kind: "found", product: "polo-basico" }]).passed).toBe(true);
    expect(scoreImage({ kind: "found", products: ["polo-premium"], colors: [null] }, [{ kind: "found", product: "polo-basico" }]).passed).toBe(false);
  });

  test("a QR label must also yield the variant of its color", () => {
    const label = [{ kind: "found" as const, product: "polo-basico", color: "Negro" }];

    expect(scoreImage({ kind: "found", products: ["polo-basico"], colors: ["Negro"] }, label)).toMatchObject({ passed: true, fields: { identification: true, color: true } });
    expect(scoreImage({ kind: "found", products: ["polo-basico"], colors: ["Blanco"] }, label)).toMatchObject({ passed: false, fields: { identification: true, color: false } });
    expect(scoreImage({ kind: "not_found", reason: "low_confidence" }, label).fields).toEqual({ identification: false, color: false });
  });

  test("a hard negative passes as not found and fails when matched", () => {
    expect(scoreImage({ kind: "not_found", reason: "low_confidence" }, [{ kind: "not_found" }]).passed).toBe(true);
    expect(scoreImage({ kind: "found", products: ["polo-basico"], colors: [null] }, [{ kind: "not_found" }]).passed).toBe(false);
  });
});

describe("repeatedNoticeProducts", () => {
  const step = (noticeProducts: readonly string[], expectsRepeatNotice = false) => ({ noticeProducts, expectsRepeatNotice });

  test("flags a conversation with two notices for one product unless the case expects it", () => {
    expect(repeatedNoticeProducts([step(["gorra"]), step([]), step(["gorra", "polo"])])).toEqual(["gorra"]);
    expect(repeatedNoticeProducts([step(["gorra"]), step(["gorra"], true)])).toEqual([]);
    expect(repeatedNoticeProducts([step(["gorra", "gorra"]), step(["polo"])])).toEqual([]);
  });
});
