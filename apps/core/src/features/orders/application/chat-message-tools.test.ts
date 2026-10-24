import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import { createChatToolRegistry, hasReadableText, toChangeVariantResolution, toolsFor, type ChatToolContext, type ChatToolDependencies } from "@core/src/features/orders/application/chat-message-tools";
import { priceHintOf, toMentionedPriceArgs } from "@core/src/features/orders/application/chat-text-tools";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item: CatalogItem = { variantId: id(1) as VariantId, productName: "Polo", variantAttributes: { Talla: "M" }, sku: null, unitPrice: { amount: 35, currency: "PEN" } };
const productId = id(2) as ProductId;

const deps: ChatToolDependencies = {
  loadSellableVariants: async () => ok([]), identifyProductsInText: async () => ok([]), findTopTextCandidate: async () => ok(null),
  resolveVariant: async ({ product }) => ok({ kind: "resolved", item: product.variants[0] ?? item }),
};
const registry = createChatToolRegistry(deps);
const context: ChatToolContext = { kind: "photo_product", caption: "x", items: [], shown: [{ product: { productId, name: "Polo", variants: [item] }, preselectedVariantId: null,
  identification: { method: "visual", productId, confidence: 0.9 } }] };

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

describe("chat tool registry", () => {
  test("offers each tool only for the kinds of message it serves", () => {
    const names = (kind: ChatToolContext["kind"]) => toolsFor(registry, { kind, items: [] }).map(({ name }) => name).sort();
    expect(names("photo_product")).toEqual(["add_shown_product", "add_shown_product_with_details", "decline_shown_product", "no_intent"]);
    expect(names("photo_not_product")).toEqual(["no_intent", "report_request_with_non_product_image"]);
  });

  test("offers the item tools only when the open order has items, and the report of a change without order otherwise", () => {
    const orderItem = { label: "I1", variantId: item.variantId, productId, productName: "Polo", variantAttributes: { Talla: "M" }, quantity: 1, unitPrice: item.unitPrice };
    const names = (items: ChatToolContext["items"]) => toolsFor(registry, { kind: "text", items }).map(({ name }) => name).sort();
    expect(names([orderItem])).toEqual(["add_products", "change_item_quantity", "change_item_variant", "mark_order_ready", "no_intent", "remove_item",
      "report_unnamed_add", "report_variant_without_product", "set_item_mentioned_price"]);
    expect(names([])).toEqual(["add_products", "mark_order_ready", "no_intent", "report_item_change_without_order", "report_unnamed_add", "report_variant_without_product"]);
  });

  test("asks for an unnamed reference only when the order has two or more items, since with one it means that item", () => {
    const line = (label: string) => ({ label, variantId: item.variantId, productId, productName: "Polo", variantAttributes: { Talla: "M" }, quantity: 1, unitPrice: item.unitPrice });
    const itemChoices = (items: ChatToolContext["items"]) => ["remove_item", "change_item_quantity", "change_item_variant", "set_item_mentioned_price"].map((name) => {
      const args = registry.get(name)!.args;
      const question = args.kind === "none" ? undefined : args.questions?.({ kind: "text", caption: "quítalo", items, shown: [] }).find((entry) => entry.name === "item");
      return question?.choices.map(({ value }) => value);
    });
    for (const choices of itemChoices([line("I1")])) expect(choices).toEqual(["I1", "not_in_order"]);
    for (const choices of itemChoices([line("I1"), line("I2")])) expect(choices).toEqual(["I1", "I2", "unnamed", "not_in_order", "ambiguous"]);
  });

  test("builds a strict function schema for the tool with extracted arguments", () => {
    const tool = registry.get("add_shown_product_with_details")!;
    const schema = tool.jsonSchema(context);
    expect(strictViolations(schema)).toEqual([]);
    expect(Object.keys((schema as { properties: Json }).properties).sort()).toEqual(["mentionedPrice", "perEach", "quantity", "variantWords"]);
  });

  test("rejects arguments the schema does not allow, such as a quantity below one", async () => {
    const tool = registry.get("add_shown_product_with_details")!;
    expect(await tool.parseAndResolve({ variantWords: [], quantity: 0, perEach: false, mentionedPrice: null }, context, new AbortController().signal))
      .toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
    expect(await tool.parseAndResolve({ variantWords: ["a", "b", "c", "d", "e", "f"], quantity: null, perEach: false, mentionedPrice: null }, context, new AbortController().signal))
      .toMatchObject({ success: false, error: { code: "INVALID_AI_RESPONSE" } });
  });

  test("spreads «2 de cada uno» over every product of the photo but not a bare quantity", async () => {
    const second = { ...item, variantId: id(3) as VariantId, productName: "Gorra" };
    const many: ChatToolContext = { ...context, shown: [context.shown[0]!, { product: { productId: id(4) as ProductId, name: "Gorra", variants: [second] }, preselectedVariantId: null,
      identification: { method: "visual", productId: id(4) as ProductId, confidence: 0.9 } }] };
    const run = async (perEach: boolean) => {
      const done = await registry.get("add_shown_product_with_details")!.parseAndResolve({ variantWords: [], quantity: 2, perEach, mentionedPrice: { amount: "20", units: 1, currency: "not_named" } },
        many, new AbortController().signal);
      return done.success ? done.data.map((action) => action.kind === "add" ? [action.quantity, action.mentionedPrice] : action.kind) : done;
    };
    expect(await run(true)).toEqual([[2, null], [2, null]]);
    expect(await run(false)).toEqual([[1, null], [1, null]]);
  });

  test("drops a price stated in another currency instead of failing the message", async () => {
    const priced = (currency: string) => registry.get("add_shown_product_with_details")!.parseAndResolve({ variantWords: [], quantity: null, perEach: false,
      mentionedPrice: { amount: "20", units: 1, currency } }, context, new AbortController().signal);
    expect(await priced("other")).toMatchObject({ success: true, data: [{ kind: "add", mentionedPrice: null, quantity: 1 }] });
    expect(await priced("USD")).toMatchObject({ success: true, data: [{ kind: "add", mentionedPrice: null }] });
    expect(await priced("PEN")).toMatchObject({ success: true, data: [{ kind: "add", mentionedPrice: { amount: { amount: 20, currency: "PEN" }, units: 1 } }] });
  });

  test("hints the unit amount with the currency the buyer named, unless it is not the open order's or cannot be named", () => {
    const stated = (amount: string, units: number, currency: "not_named" | "PEN" | "USD" | "other") => ({ amount, units, currency });
    expect(priceHintOf(stated("35", 1, "PEN"), null)).toEqual({ priceHint: 35, priceHintCurrency: "PEN" });
    expect(priceHintOf(stated("35", 1, "PEN"), "PEN")).toEqual({ priceHint: 35, priceHintCurrency: "PEN" });
    expect(priceHintOf(stated("60", 4, "not_named"), "PEN")).toEqual({ priceHint: 15, priceHintCurrency: null });
    expect(priceHintOf(stated("12", 1, "USD"), "PEN")).toEqual({ priceHint: null, priceHintCurrency: null });
    expect(priceHintOf(stated("12", 1, "other"), null)).toEqual({ priceHint: null, priceHintCurrency: null });
    expect(priceHintOf(stated("0", 1, "not_named"), null)).toEqual({ priceHint: null, priceHintCurrency: null });
    expect(priceHintOf(null, "PEN")).toEqual({ priceHint: null, priceHintCurrency: null });
  });

  test("keeps a price whose currency is not named or is the item's, and marks any other to be dropped", () => {
    const stated = (currency: Parameters<typeof toMentionedPriceArgs>[0]["currency"]) => toMentionedPriceArgs({ amount: "20", units: 1, currency }, "PEN").currency;
    expect([stated("not_named"), stated("PEN"), stated("USD"), stated("BRL"), stated("other")]).toEqual(["order_currency", "order_currency", "other", "other", "other"]);
  });
});

describe("chat message helpers", () => {
  test("reads a caption only when it has a letter or a digit", () => {
    expect(hasReadableText("2 en talla M")).toBe(true);
    expect(hasReadableText("👍")).toBe(false);
    expect(hasReadableText("  ...  ")).toBe(false);
    expect(hasReadableText(null)).toBe(false);
  });

  test("maps the products' variant resolution to the order domain's, naming the product of a failed one", () => {
    expect(toChangeVariantResolution({ kind: "resolved", item }, productId)).toEqual({ kind: "resolved", item });
    expect(toChangeVariantResolution({ kind: "missing", attributeNames: ["Talla"] }, productId)).toEqual({ kind: "missing", productId });
    expect(toChangeVariantResolution({ kind: "not_available" }, productId)).toEqual({ kind: "not_available", productId });
  });
});
