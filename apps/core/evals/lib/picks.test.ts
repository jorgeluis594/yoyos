import { describe, expect, test } from "vitest";
import type { CaseRecord } from "@core/evals/lib/case-record";
import { gradePick, pickOf } from "@core/evals/lib/picks";

const record = (over: Partial<CaseRecord>): CaseRecord => ({
  caseId: "a", baseId: "a", pass: "interpretation", criterion: 1, kind: "k", tags: [], repeat: 0, passed: false, exactPassed: false, fields: {}, expectationIndex: 0,
  judge: null, noticeError: null, expectedTool: "-", input: "text «x»", expected: [], actual: {}, signature: "", certainties: [],
  trace: { decisions: [], extracted: [], textChoices: [] }, latencyMs: 0, retries: 0, calls: [], error: null, ...over,
});

const line = (product: string, variant: Record<string, string>) => ({ product, variant, quantity: 1, mentionedPrice: null });

describe("gradePick", () => {
  test("an action pick is the expected tool, «several» for several tools, or no_intent", () => {
    const one = record({ expected: [{ tools: ["mark_order_ready"], outcomes: ["ready"] }] });
    const two = record({ expected: [{ tools: ["remove_item", "mark_order_ready"], outcomes: ["removed", "ready"] }] });

    expect(gradePick({ source: "action", confidence: 0.4, gate: 0.6, pick: "mark_order_ready" }, one)).toBe(true);
    expect(gradePick({ source: "action", confidence: 0.4, gate: 0.6, pick: "no_intent" }, one)).toBe(false);
    expect(gradePick({ source: "action", confidence: 0.5, gate: 0.6, pick: "several" }, two)).toBe(true);
    expect(gradePick({ source: "action", confidence: 0.5, gate: 0.6, pick: "x" }, record({ expected: [{ outcomes: ["no_intent"] }] }))).toBeNull();
  });

  test("text and variant picks are graded against the acceptable final orders", () => {
    const add = record({ expected: [{ tools: ["add_products"], outcomes: ["added"], order: [line("gorra-trucker", { Color: "Rojo" })] }] });

    expect(gradePick({ source: "text", confidence: 0.9, gate: 0.8, pick: "gorra-trucker" }, add)).toBe(true);
    expect(gradePick({ source: "text", confidence: 0.9, gate: 0.8, pick: "gorra-snapback" }, add)).toBe(false);
    expect(gradePick({ source: "text_none", confidence: 0.9, gate: 0.8, pick: null }, add)).toBe(false);
    expect(gradePick({ source: "variant", confidence: 0.9, gate: 0.8, pick: "Rojo" }, add)).toBe(true);
    expect(gradePick({ source: "text_none", confidence: 0.9, gate: 0.8, pick: null }, record({ expected: [{ outcomes: ["not_identified"] }] }))).toBe(true);
  });

  test("text pass picks follow the text expectation", () => {
    const unclear = record({ pass: "text", expected: [{ kind: "not_clear", products: ["gorra-trucker", "gorra-snapback"] }] });

    expect(gradePick({ source: "text_none", confidence: 0.91, gate: 0.8, pick: null }, unclear)).toBe(false);
    expect(gradePick({ source: "text", confidence: 0.6, gate: 0.8, pick: "gorra-snapback" }, unclear)).toBe(true);
    expect(gradePick({ source: "text_none", confidence: 0.9, gate: 0.8, pick: null }, record({ pass: "text", expected: [{ kind: "not_found" }] }))).toBe(true);
  });

  test("visual picks are right only for the expected product; a selfie's pick is wrong", () => {
    expect(gradePick({ source: "visual", confidence: 0.7, gate: 0.8, pick: "polo-rayas" }, record({ pass: "image", expected: [{ kind: "found", product: "polo-rayas" }] }))).toBe(true);
    expect(gradePick({ source: "visual", confidence: 0.83, gate: 0.8, pick: "chompa-tejida" }, record({ pass: "image", expected: [{ kind: "not_product" }] }))).toBe(false);
    expect(gradePick({ source: "visual", confidence: 0.83, gate: 0.8, pick: "chompa-tejida" }, record({ pass: "end_to_end", expected: [{ tools: [], outcomes: ["no_intent"] }] }))).toBe(false);
  });

  test("item choices and records without a pick are ungraded", () => {
    expect(gradePick({ source: "item", confidence: 0.9, gate: 0.8, detail: "remove_item:item=I1" }, record({}))).toBeNull();
    expect(gradePick({ source: "visual", confidence: 0.9, gate: 0.8 }, record({ pass: "image", expected: [{ kind: "found", product: "polo-rayas" }] }))).toBeNull();
  });
});

test("older records give their pick in the detail", () => {
  expect(pickOf({ source: "action", confidence: 0.5, gate: 0.6, detail: "add_products" })).toBe("add_products");
  expect(pickOf({ source: "text", confidence: 0.9, gate: 0.8, detail: "gorra → gorra-trucker" })).toBe("gorra-trucker");
  expect(pickOf({ source: "text_none", confidence: 0.9, gate: 0.8, detail: "gorra → none" })).toBeNull();
  expect(pickOf({ source: "visual", confidence: 0.9, gate: 0.8 })).toBeUndefined();
});
