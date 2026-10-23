import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import { createChatToolRegistry, hasReadableText, toChangeVariantResolution, toolsForKind, type ChatToolContext, type ChatToolDependencies } from "@core/src/features/orders/application/chat-message-tools";
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
    const names = (kind: ChatToolContext["kind"]) => toolsForKind(registry, kind).map(({ name }) => name).sort();
    expect(names("photo_product")).toEqual(["add_shown_product", "add_shown_product_with_details", "decline_shown_product", "no_intent"]);
    expect(names("photo_not_product")).toEqual(["no_intent", "report_request_with_non_product_image"]);
    expect(names("text")).toEqual(["add_products", "change_item_quantity", "change_item_variant", "mark_order_ready", "no_intent", "remove_item",
      "report_unnamed_add", "report_variant_without_product", "set_item_mentioned_price"]);
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
      const done = await registry.get("add_shown_product_with_details")!.parseAndResolve({ variantWords: [], quantity: 2, perEach, mentionedPrice: { amount: "20", units: 1, currency: "order_currency" } },
        many, new AbortController().signal);
      return done.success ? done.data.map((action) => action.kind === "add" ? [action.quantity, action.mentionedPrice] : action.kind) : done;
    };
    expect(await run(true)).toEqual([[2, null], [2, null]]);
    expect(await run(false)).toEqual([[1, null], [1, null]]);
  });

  test("drops a price stated in another currency instead of failing the message", async () => {
    const done = await registry.get("add_shown_product_with_details")!.parseAndResolve({ variantWords: [], quantity: null, perEach: false,
      mentionedPrice: { amount: "20", units: 1, currency: "other" } }, context, new AbortController().signal);
    expect(done).toMatchObject({ success: true, data: [{ kind: "add", mentionedPrice: null, quantity: 1 }] });
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
