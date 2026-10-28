import { describe, expect, test } from "vitest";
import type { ToolCallPlan } from "@core/src/shared/ai-tools/application/orchestrate";
import { variantOnlyRule } from "@core/src/features/orders/application/chat-message-interpreter";

type CallsPlan = Extract<ToolCallPlan, { kind: "calls" }>;

const plan = (...calls: CallsPlan["calls"]): CallsPlan => ({ kind: "calls", calls, extraction: true });
const variantCall = (change?: unknown) => ({ tool: "change_item_variant", args: { item: { value: "I1", confidence: 0.95 }, variantWords: ["L"], mentionedPrice: null, ...(change === undefined ? {} : { change }) } });
const report = { tool: "report_variant_without_product", args: {} };
const add = { tool: "add_products", args: { lines: [] } };

describe("variantOnlyRule", () => {
  test("keeps a variant change the buyer explicitly requested at the item gate", () => {
    const requested = variantCall({ value: "requested", confidence: 0.8 });
    expect(variantOnlyRule(plan(requested)).calls).toEqual([requested]);
  });

  test("turns a variant change into the variant-only report when the answer is only named, unsure or missing", () => {
    for (const change of [{ value: "only_named", confidence: 0.99 }, { value: "requested", confidence: 0.79 }, undefined, { value: "other", confidence: 1 }]) {
      expect(variantOnlyRule(plan(variantCall(change))).calls).toEqual([report]);
    }
  });

  test("keeps the other calls of the message next to the report", () => {
    expect(variantOnlyRule(plan(add, variantCall({ value: "only_named", confidence: 0.9 }))).calls).toEqual([add, report]);
  });

  test("two variant calls that are not explicit requests give one report", () => {
    const only = variantCall({ value: "only_named", confidence: 0.9 });
    expect(variantOnlyRule(plan(only, add, only)).calls).toEqual([report, add]);
  });

  test("a requested change and an only-named one keep the change and add one report", () => {
    const requested = variantCall({ value: "requested", confidence: 0.95 });
    expect(variantOnlyRule(plan(requested, variantCall({ value: "only_named", confidence: 0.9 }))).calls).toEqual([requested, report]);
  });
});
