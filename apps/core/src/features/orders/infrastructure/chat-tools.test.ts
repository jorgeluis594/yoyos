import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import type { ChatToolActions } from "@core/src/features/orders/application/chat-message-actions";
import type { ChatContextItem, ChatToolContext } from "@core/src/features/orders/application/chat-tool-types";
import { createChatToolRegistry } from "@core/src/features/orders/infrastructure/chat-tools";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (label: string): ChatContextItem => ({ label, variantId: id(1) as VariantId, productId: id(2) as ProductId, productName: "Polo",
  variantAttributes: { Talla: "M" }, quantity: 1, unitPrice: { amount: 35, currency: "PEN" } });
const signal = new AbortController().signal;

/** Fake actions that record the typed input each tool hands them. */
function recording() {
  const calls: Array<readonly [string, unknown]> = [];
  const action = (name: string) => async (...args: unknown[]) => { calls.push([name, args.length === 3 ? args[0] : null]); return ok([]); };
  const names = ["addShownProduct", "addShownProductWithDetails", "declineShownProduct", "reportRequestWithNonProductImage", "noIntent", "addProducts", "removeItem",
    "changeItemQuantity", "changeItemVariant", "setItemMentionedPrice", "markOrderReady", "reportVariantWithoutProduct", "reportUnnamedAdd", "reportItemChangeWithoutOrder"];
  return { calls, actions: Object.fromEntries(names.map((name) => [name, action(name)])) as unknown as ChatToolActions };
}

const { calls, actions } = recording();
const registry = createChatToolRegistry(actions);
const photo: ChatToolContext = { kind: "photo_product", caption: "x", items: [], shown: [] };
const oneItem: ChatToolContext = { kind: "text", caption: "x", items: [line("I1")], shown: [] };
const twoItems: ChatToolContext = { kind: "text", caption: "x", items: [line("I1"), line("I2")], shown: [] };
const contexts = [photo, { ...photo, kind: "text" as const }, oneItem, twoItems];

type Json = Record<string, unknown>;
/** OpenAI strict function tools: additionalProperties false and every property required, at every object level. */
function strictViolations(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((entry, index) => strictViolations(entry, `${path}[${index}]`));
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Json;
  const violations = Object.entries(node).flatMap(([key, value]) => strictViolations(value, `${path}.${key}`));
  if (node.properties && typeof node.properties === "object") {
    if (node.additionalProperties !== false) violations.push(`${path}: additionalProperties`);
    const missing = Object.keys(node.properties).filter((name) => !(node.required as string[] | undefined)?.includes(name));
    if (missing.length > 0) violations.push(`${path}: not required ${missing.join(",")}`);
  }
  return violations;
}

/**
 * Extracted fields whose meaning the tool's own description gives instead of a field description. Adding one would change the text
 * the models get, which the model-text snapshot keeps byte-identical; a new field without a description fails until it is listed here.
 */
const describedByTool: Readonly<Record<string, readonly string[]>> = {
  add_shown_product_with_details: ["variantWords", "quantity", "perEach"],
  add_products: ["lines"],
  change_item_quantity: ["quantity"],
};

describe("chat tool definitions", () => {
  test("describe every tool, every extracted field and every Decision question", () => {
    const undescribed = new Set<string>();
    for (const context of contexts) {
      for (const tool of registry.tools) {
        expect(tool.description.trim(), tool.name).not.toBe("");
        const questions = tool.args.kind === "none" ? [] : tool.args.questions?.(context) ?? [];
        for (const question of questions) {
          expect(question.instructions.trim(), `${tool.name}:${question.name}`).not.toBe("");
          for (const choice of question.choices) expect(choice.description?.trim(), `${tool.name}:${question.name}:${String(choice.value)}`).toBeTruthy();
        }
        const asked = new Set(questions.map(({ name }) => name));
        const properties = (tool.jsonSchema(context).properties ?? {}) as Record<string, Json>;
        for (const [field, schema] of Object.entries(properties)) {
          if (!asked.has(field) && !schema.description && !(schema.anyOf as Json[] | undefined)?.some((entry) => entry.description)) undescribed.add(`${tool.name}.${field}`);
        }
      }
    }
    expect([...undescribed].sort()).toEqual(Object.entries(describedByTool).flatMap(([tool, fields]) => fields.map((field) => `${tool}.${field}`)).sort());
  });

  test("build strict function schemas for every tool and context", () => {
    for (const context of contexts) {
      for (const tool of registry.tools) expect(strictViolations(tool.jsonSchema(context)), tool.name).toEqual([]);
    }
  });

  test("ask whether the message named the item only when the order has a single item", () => {
    const fields = (context: ChatToolContext) => Object.keys((registry.get("remove_item")!.jsonSchema(context) as { properties: Json }).properties);
    expect(fields(oneItem)).toEqual(["item", "amount", "reference"]);
    expect(fields(twoItems)).toEqual(["item", "amount"]);
  });

  test("reject arguments the schema does not allow, such as a quantity below one or a label outside the order", async () => {
    const details = registry.get("add_shown_product_with_details")!;
    expect(await details.parseAndResolve({ variantWords: [], quantity: 0, perEach: false, mentionedPrice: null }, photo, signal))
      .toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
    expect(await details.parseAndResolve({ variantWords: ["a", "b", "c", "d", "e", "f"], quantity: null, perEach: false, mentionedPrice: null }, photo, signal))
      .toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
    expect(await registry.get("change_item_quantity")!.parseAndResolve({ item: { value: "I3", confidence: 1 }, quantity: 2 }, twoItems, signal))
      .toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
  });
});

describe("chat tool arguments", () => {
  const price = { amount: "45", units: 1, currency: "PEN" } as const;
  const sure = (value: string) => ({ value, confidence: 0.9 });

  test.each([
    ["add_shown_product_with_details", photo, { variantWords: ["XS"], quantity: 2, perEach: true, mentionedPrice: price },
      "addShownProductWithDetails", { variantWords: ["XS"], quantity: 2, perEach: true, mentionedPrice: price }],
    ["add_products", { ...photo, kind: "text" }, { lines: [{ productMention: "casaca", variantWords: ["L"], quantity: null, mentionedPrice: null }] },
      "addProducts", { lines: [{ productMention: "casaca", variantWords: ["L"], quantity: null, mentionedPrice: null }] }],
    ["remove_item", twoItems, { item: sure("I2"), amount: sure("one") }, "removeItem", { item: sure("I2"), amount: sure("one") }],
    ["remove_item", oneItem, { item: sure("I1"), reference: sure("unnamed"), amount: sure("all") }, "removeItem", { item: sure("I1"), reference: sure("unnamed"), amount: sure("all") }],
    ["change_item_quantity", twoItems, { item: sure("unnamed"), quantity: 0 }, "changeItemQuantity", { item: sure("unnamed"), quantity: 0 }],
    ["change_item_variant", oneItem, { item: sure("I1"), reference: null, change: sure("requested"), variantWords: ["celeste"], mentionedPrice: null },
      "changeItemVariant", { item: sure("I1"), change: sure("requested"), variantWords: ["celeste"], mentionedPrice: null }],
    ["set_item_mentioned_price", twoItems, { item: sure("I1"), mentionedPrice: price }, "setItemMentionedPrice", { item: sure("I1"), mentionedPrice: price }],
  ] as const)("map validated %s arguments to the typed input of its action", async (tool, context, raw, action, input) => {
    calls.length = 0;
    expect(await registry.get(tool)!.parseAndResolve(raw, context as ChatToolContext, signal)).toEqual(ok([]));
    expect(calls).toEqual([[action, input]]);
  });

  test.each([
    ["add_shown_product", "addShownProduct"], ["decline_shown_product", "declineShownProduct"], ["report_request_with_non_product_image", "reportRequestWithNonProductImage"],
    ["no_intent", "noIntent"], ["mark_order_ready", "markOrderReady"], ["report_variant_without_product", "reportVariantWithoutProduct"],
    ["report_unnamed_add", "reportUnnamedAdd"], ["report_item_change_without_order", "reportItemChangeWithoutOrder"],
  ] as const)("run %s's action without arguments", async (tool, action) => {
    calls.length = 0;
    expect(await registry.get(tool)!.parseAndResolve({}, photo, signal)).toEqual(ok([]));
    expect(calls.map(([name]) => name)).toEqual([action]);
  });
});
