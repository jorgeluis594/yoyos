import { describe, expect, test } from "vitest";
import { noticeErrorOf, scoreImage, scoreMessage, scoreText, unitPricesIntact, type ActualLine } from "@core/evals/lib/scorers";
import { after, line, L_NEGRO, M_NEGRO } from "@core/evals/cases/builders";

const added = (quantity: number, mentionedPrice: ActualLine["mentionedPrice"] = null, unitPrice = 35): ActualLine =>
  ({ product: "polo-basico", variant: { Color: "Negro", Talla: "L" }, quantity, unitPrice, mentionedPrice });

describe("scoreMessage", () => {
  const expectation = { tools: ["add_products"], outcomes: ["added" as const], order: [after("polo-basico", L_NEGRO, 3, { amount: 50, units: 3 })] };

  test("passes when tool, outcomes, product, variant, quantity and mentioned price all match, in any attribute order", () => {
    const scored = scoreMessage({ tools: ["add_products"], outcomes: ["added"], order: [added(3, { amount: 50, units: 3 })] }, [expectation], []);

    expect(scored).toEqual({ passed: true, expectationIndex: 0,
      fields: { tool: true, outcome: true, product: true, variant: true, quantity: true, mentionedPrice: true, unitPrice: true } });
  });

  test("reads a size taken as a quantity as a wrong variant and quantity, with the product still right", () => {
    const scored = scoreMessage({ tools: ["add_products"], outcomes: ["added"], order: [{ ...added(3), variant: M_NEGRO }] }, [expectation], []);

    expect(scored.passed).toBe(false);
    expect(scored.fields).toMatchObject({ product: true, variant: false, quantity: false, mentionedPrice: false });
  });

  test("a price per unit where the buyer said a bundle price fails only the mentioned price", () => {
    const scored = scoreMessage({ tools: ["add_products"], outcomes: ["added"], order: [added(3, { amount: 16.67, units: 1 })] }, [expectation], []);

    expect(scored.fields).toMatchObject({ quantity: true, mentionedPrice: false });
  });

  test("without an expected order the initial order must stay as it was", () => {
    const initial = [line("polo-basico", M_NEGRO, 2)];
    const unchanged = { tools: ["report_variant_without_product"], outcomes: ["variant_only" as const] };

    expect(scoreMessage({ tools: ["report_variant_without_product"], outcomes: ["variant_only"], order: [{ ...added(2), variant: M_NEGRO }] }, [unchanged], initial).passed).toBe(true);
    expect(scoreMessage({ tools: ["change_item_variant"], outcomes: ["variant_changed"], order: [added(2)] }, [unchanged], initial).fields)
      .toMatchObject({ tool: false, outcome: false, variant: false });
  });

  test("an expectation without tools leaves the tool unscored", () => {
    expect(scoreMessage({ tools: ["set_item_mentioned_price"], outcomes: ["no_intent"], order: [] }, [{ outcomes: ["no_intent"] }], []).fields.tool).toBeNull();
  });

  test("passes when any acceptable expectation matches, and reports that one", () => {
    const scored = scoreMessage({ tools: ["no_intent"], outcomes: ["no_intent"], order: [] },
      [{ tools: ["mark_order_ready"], outcomes: ["no_intent"] }, { tools: ["no_intent"], outcomes: ["no_intent"] }], []);

    expect(scored).toMatchObject({ passed: true, expectationIndex: 1 });
  });

  test("an ambiguous intent satisfies an expectation of no purchase intent, and nothing else", () => {
    const noIntent = { tools: ["no_intent"], outcomes: ["no_intent" as const] };

    expect(scoreMessage({ tools: [], outcomes: ["ambiguous_intent"], order: [] }, [noIntent], []).passed).toBe(true);
    expect(scoreMessage({ tools: [], outcomes: ["ambiguous_intent"], order: [] }, [{ tools: ["mark_order_ready"], outcomes: ["ready"] }], []).passed).toBe(false);
  });

  test("tools are a set and outcomes a multiset", () => {
    const two = { tools: ["add_products"], outcomes: ["added" as const, "added" as const] };

    expect(scoreMessage({ tools: ["add_products", "add_products"], outcomes: ["added"], order: [] }, [two], []).fields).toMatchObject({ tool: true, outcome: false });
  });

  test("a changed unit price fails the case whatever else matches", () => {
    const scored = scoreMessage({ tools: ["add_products"], outcomes: ["added"], order: [added(3, { amount: 50, units: 3 }, 1)] }, [expectation], []);

    expect(scored).toMatchObject({ passed: false, fields: { quantity: true, unitPrice: false } });
  });
});

test("unit prices are intact only for catalog variants at their catalog price", () => {
  expect(unitPricesIntact([added(1)])).toBe(true);
  expect(unitPricesIntact([added(1, null, 0)])).toBe(false);
  expect(unitPricesIntact([{ ...added(1), variant: { Talla: "XXL", Color: "Negro" } }])).toBe(false);
  expect(unitPricesIntact([{ ...added(1), product: null }])).toBe(false);
});

describe("scoreText", () => {
  test("a found product must be the expected one", () => {
    expect(scoreText({ kind: "found", product: "polo-basico" }, [{ kind: "found", product: "polo-basico" }]).passed).toBe(true);
    expect(scoreText({ kind: "found", product: "polo-basico-nino" }, [{ kind: "found", product: "polo-basico" }]).passed).toBe(false);
  });

  test("«Producto no claro» must name at least the expected candidates", () => {
    const expected = [{ kind: "not_clear" as const, products: ["gorra-trucker" as const, "gorra-snapback" as const] }];

    expect(scoreText({ kind: "not_clear", products: ["gorra-snapback", "gorra-trucker", "polo-basico"] }, expected).passed).toBe(true);
    expect(scoreText({ kind: "not_clear", products: ["gorra-snapback", "polo-basico"] }, expected).passed).toBe(false);
  });

  test("an error never passes", () => {
    expect(scoreText({ kind: "error", code: "INVALID_MATCHER_RESPONSE" }, [{ kind: "not_found" }]).passed).toBe(false);
  });
});

describe("scoreImage", () => {
  test("a photo is identified when it yields exactly the expected product", () => {
    expect(scoreImage({ kind: "found", products: ["polo-basico"], colors: [null] }, [{ kind: "found", product: "polo-basico" }]).passed).toBe(true);
    expect(scoreImage({ kind: "found", products: ["polo-premium"], colors: [null] }, [{ kind: "found", product: "polo-basico" }]).passed).toBe(false);
  });

  test("a QR label must also yield the variant of its color", () => {
    const label = [{ kind: "found" as const, product: "polo-basico" as const, color: "Negro" }];

    expect(scoreImage({ kind: "found", products: ["polo-basico"], colors: ["Negro"] }, label)).toMatchObject({ passed: true, fields: { identification: true, color: true } });
    expect(scoreImage({ kind: "found", products: ["polo-basico"], colors: ["Blanco"] }, label)).toMatchObject({ passed: false, fields: { identification: true, color: false } });
    expect(scoreImage({ kind: "not_found", reason: "low_confidence" }, label).fields).toEqual({ identification: false, color: false });
  });

  test("a hard negative passes as not found and fails when matched", () => {
    expect(scoreImage({ kind: "not_found", reason: "low_confidence" }, [{ kind: "not_found" }]).passed).toBe(true);
    expect(scoreImage({ kind: "found", products: ["polo-basico"], colors: [null] }, [{ kind: "not_found" }]).passed).toBe(false);
  });
});

describe("noticeErrorOf", () => {
  test("a problem notice where a change was expected is a false notice", () => {
    expect(noticeErrorOf(false, ["added"], ["variant_missing"])).toBe("false_notice");
  });

  test("a change without notice where a notice was expected is a silent error", () => {
    expect(noticeErrorOf(false, ["variant_only"], ["variant_changed"])).toBe("silent_error");
  });

  test("another change, or a change where nothing was expected, is a wrong silent change", () => {
    expect(noticeErrorOf(false, ["no_intent"], ["added"])).toBe("wrong_change");
    expect(noticeErrorOf(false, ["removed"], ["quantity_lowered"])).toBe("wrong_change");
  });

  test("nothing changed and no notice is a silent drop: a missed notice or a dropped request", () => {
    expect(noticeErrorOf(false, ["variant_only"], ["ambiguous_intent"])).toBe("missed_notice");
    expect(noticeErrorOf(false, ["added"], ["ambiguous_intent"])).toBe("dropped_request");
    expect(noticeErrorOf(false, ["ready"], ["ambiguous_intent"])).toBe("missed_notice");
    // Something changed, so it is not a drop: the lost «ready» counts as a wrong silent change.
    expect(noticeErrorOf(false, ["removed", "ready"], ["removed"])).toBe("wrong_change");
  });

  test("a passed case, or a miss where nothing was expected to change, misleads nobody", () => {
    expect(noticeErrorOf(true, ["added"], ["variant_missing"])).toBeNull();
    expect(noticeErrorOf(false, ["no_intent"], ["ambiguous_intent"])).toBeNull();
  });
});
