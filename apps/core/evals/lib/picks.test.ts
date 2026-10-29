import { describe, expect, test } from "vitest";
import type { CaseRecord } from "@core/evals/lib/case-record";
import { gradePick, pickOf } from "@core/evals/lib/picks";
import { messageRecord } from "@core/evals/lib/record-fixture";

const record = messageRecord;

const line = (product: string, variant: Record<string, string>) => ({ product, variant, quantity: 1, mentionedPrice: null });

describe("gradePick", () => {
  test("visual picks are right only for the expected product; a selfie's pick is wrong", () => {
    expect(gradePick({ source: "visual", confidence: 0.7, gate: 0.8, pick: "polo-rayas" }, record({ pass: "image", expected: [{ kind: "found", product: "polo-rayas" }] }))).toBe(true);
    expect(gradePick({ source: "visual", confidence: 0.83, gate: 0.8, pick: "chompa-tejida" }, record({ pass: "image", expected: [{ kind: "not_product" }] }))).toBe(false);
    expect(gradePick({ source: "visual", confidence: 0.83, gate: 0.8, pick: "chompa-tejida" }, record({ pass: "end_to_end", expected: [{ notice: null, outcomes: ["no_intent"] }] }))).toBe(false);
    expect(gradePick({ source: "visual_none", confidence: 0.99, gate: 0.8, pick: null }, record({ pass: "end_to_end", expected: [{ notice: null, outcomes: ["no_intent"] }] }))).toBe(true);
  });

  test("a visual «none» is right when the photo may end unidentified", () => {
    expect(gradePick({ source: "visual_none", confidence: 0.9, gate: 0.8, pick: null }, record({ pass: "image", expected: [{ kind: "not_product" }] }))).toBe(true);
    expect(gradePick({ source: "visual_none", confidence: 0.9, gate: 0.8, pick: null }, record({ pass: "image", expected: [{ kind: "found", product: "polo-basico" }, { kind: "not_found" }] }))).toBe(true);
    expect(gradePick({ source: "visual_none", confidence: 0.9, gate: 0.8, pick: null }, record({ pass: "image", expected: [{ kind: "found", product: "polo-rayas" }] }))).toBe(false);
  });

  test("a shows-product pick is graded in the image pass only, by whether the photo is a product", () => {
    const selfie = record({ pass: "image", expected: [{ kind: "not_product" }] });
    const product = record({ pass: "image", expected: [{ kind: "found", product: "polo-rayas" }] });

    expect(gradePick({ source: "shows_product", confidence: 0.2, gate: 0.5, pick: "not_product" }, selfie)).toBe(true);
    expect(gradePick({ source: "shows_product", confidence: 0.9, gate: 0.5, pick: "product" }, selfie)).toBe(false);
    expect(gradePick({ source: "shows_product", confidence: 0.9, gate: 0.5, pick: "product" }, product)).toBe(true);
    expect(gradePick({ source: "shows_product", confidence: 0.9, gate: 0.5, pick: "product" }, record({ pass: "image", expected: [{ kind: "not_found" }] }))).toBe(true);
    expect(gradePick({ source: "shows_product", confidence: 0.2, gate: 0.5, pick: "not_product" }, product)).toBe(false);
    expect(gradePick({ source: "shows_product", confidence: 0.2, gate: 0.5, pick: "not_product" }, record({ pass: "end_to_end", expected: [{ outcomes: ["no_intent"] }] }))).toBeNull();
  });

  test("records without a pick are ungraded, and so are conversation messages", () => {
    expect(gradePick({ source: "visual", confidence: 0.9, gate: 0.8, pick: "polo-rayas" }, record({ pass: "conversation" }))).toBeNull();
    expect(gradePick({ source: "visual", confidence: 0.9, gate: 0.8 }, record({ pass: "image", expected: [{ kind: "found", product: "polo-rayas" }] }))).toBeNull();
  });
});

test("older records give their pick in the detail", () => {
  expect(pickOf({ source: "visual", confidence: 0.9, gate: 0.8, detail: "gorra → gorra-trucker" })).toBe("gorra-trucker");
  expect(pickOf({ source: "visual_none", confidence: 0.9, gate: 0.8, detail: "gorra → none" })).toBeNull();
  expect(pickOf({ source: "visual", confidence: 0.9, gate: 0.8 })).toBeUndefined();
});
