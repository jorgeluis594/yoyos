import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import { defineTool, defineToolRegistry } from "@core/src/shared/ai-tools/application/tool-registry";
import { addShownProducts, chatToolOffers, hasReadableText, toolsFor } from "@core/src/features/orders/application/chat-message-actions";
import type { ChatContextItem, ChatToolContext, ChatToolDependencies } from "@core/src/features/orders/application/chat-tool-types";
import {
  changeItemQuantity, isChangeRequested, itemQuestionValues, priceHintOf, removeItem, setItemMentionedPrice, toChangeVariantResolution, toMentionedPriceArgs,
} from "@core/src/features/orders/application/chat-text-actions";
import type { CatalogItem } from "@core/src/features/products/domain/image-identification";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item: CatalogItem = { variantId: id(1) as VariantId, productName: "Polo", variantAttributes: { Talla: "M" }, sku: null, unitPrice: { amount: 35, currency: "PEN" } };
const productId = id(2) as ProductId;
const signal = new AbortController().signal;

const deps: ChatToolDependencies = {
  loadSellableVariants: async () => ok([]), identifyProductsInText: async () => ok([]), findTopTextCandidate: async () => ok(null),
  resolveVariant: async ({ product }) => ok({ kind: "resolved", item: product.variants[0] ?? item }),
};
const context: ChatToolContext = { kind: "photo_product", caption: "x", items: [], shown: [{ product: { productId, name: "Polo", variants: [item] }, preselectedVariantId: null,
  identification: { method: "visual", productId, confidence: 0.9 } }] };
const line = (label: string, quantity = 1): ChatContextItem =>
  ({ label, variantId: item.variantId, productId, productName: "Polo", variantAttributes: { Talla: "M" }, quantity, unitPrice: item.unitPrice });
const textContext = (items: readonly ChatContextItem[]): ChatToolContext => ({ kind: "text", caption: "quítalo", items, shown: [] });

describe("chat actions offered for a message", () => {
  // toolsFor reads only the names, so any tool registered under each action's name stands for it.
  const registry = defineToolRegistry(Object.keys(chatToolOffers).map((name) =>
    defineTool<ChatToolContext, unknown, never, never>({ name, description: name, args: { kind: "none" }, schema: () => { throw new Error("unused"); }, resolve: async () => ok([]) })));

  test("offers each tool only for the kinds of message it serves", () => {
    const names = (kind: ChatToolContext["kind"]) => toolsFor(registry, { kind, items: [] }).map(({ name }) => name).sort();
    expect(names("photo_product")).toEqual(["add_shown_product", "add_shown_product_with_details", "decline_shown_product", "no_intent"]);
    expect(names("photo_not_product")).toEqual(["no_intent", "report_request_with_non_product_image"]);
  });

  test("offers the item tools only when the open order has items, and the reports of a change without order or of a variant without product otherwise", () => {
    const names = (items: ChatToolContext["items"]) => toolsFor(registry, { kind: "text", items }).map(({ name }) => name).sort();
    expect(names([line("I1")])).toEqual(["add_products", "change_item_quantity", "change_item_variant", "mark_order_ready", "no_intent", "remove_item",
      "report_unnamed_add", "set_item_mentioned_price"]);
    expect(names([])).toEqual(["add_products", "mark_order_ready", "no_intent", "report_item_change_without_order", "report_unnamed_add", "report_variant_without_product"]);
  });

  test("asks for an unnamed reference only when the order has two or more items, since with one it means that item", () => {
    expect(itemQuestionValues(textContext([line("I1")]))).toEqual(["I1", "not_in_order"]);
    expect(itemQuestionValues(textContext([line("I1"), line("I2")]))).toEqual(["I1", "I2", "unnamed", "not_in_order", "ambiguous"]);
  });
});

describe("chat item actions", () => {
  const sure = (value: string) => ({ value, confidence: 0.9 });

  test("changes nothing for an item choice below the item gate, and keeps an unsure unnamed reference unnamed", async () => {
    expect(await changeItemQuantity({ item: { value: "I1", confidence: 0.79 }, quantity: 3 }, textContext([line("I1"), line("I2")]), deps))
      .toEqual(ok([{ kind: "set_quantity", target: { kind: "unclear", namedItem: true, namedProductId: null }, quantity: 3 }]));
    expect(await changeItemQuantity({ item: { value: "unnamed", confidence: 0.5 }, quantity: 3 }, textContext([line("I1"), line("I2")]), deps))
      .toEqual(ok([{ kind: "set_quantity", target: { kind: "unclear", namedItem: false, namedProductId: null }, quantity: 3 }]));
  });

  test("names the only item of the order as an unnamed reference when the message did not name it", async () => {
    const single = textContext([line("I1")]);
    expect(await changeItemQuantity({ item: sure("I1"), reference: { value: "unnamed", confidence: 0.6 }, quantity: 2 }, single, deps))
      .toEqual(ok([{ kind: "set_quantity", target: { kind: "unnamed" }, quantity: 2 }]));
    expect(await changeItemQuantity({ item: sure("I1"), reference: { value: "named", confidence: 0.6 }, quantity: 2 }, single, deps))
      .toEqual(ok([{ kind: "set_quantity", target: { kind: "variant", variantId: item.variantId }, quantity: 2 }]));
  });

  test("names the product the text mentions for an item outside the order", async () => {
    const found: ChatToolDependencies = { ...deps, findTopTextCandidate: async () => ok({ productId, name: "Polo" }) };
    expect(await removeItem({ item: sure("not_in_order"), amount: { value: "all", confidence: 0.9 } }, textContext([line("I1"), line("I2")]), found))
      .toEqual(ok([{ kind: "remove", target: { kind: "unclear", namedItem: true, namedProductId: productId }, amount: "all" }]));
  });

  test("removes an item of a single unit however unsure the amount is, and leaves one of several units unclear", async () => {
    const remove = (quantity: number) => removeItem({ item: sure("I1"), amount: { value: "one", confidence: 0.5 } }, textContext([line("I1", quantity), line("I2")]), deps);
    expect(await remove(1)).toEqual(ok([{ kind: "remove", target: { kind: "variant", variantId: item.variantId }, amount: "one" }]));
    expect(await remove(3)).toEqual(ok([{ kind: "remove", target: { kind: "unclear", namedItem: true, namedProductId: null }, amount: "one" }]));
  });

  test("reads a stated price in the chosen item's currency and drops one in another currency", async () => {
    const price = (currency: "not_named" | "USD") => setItemMentionedPrice({ item: sure("I1"), mentionedPrice: { amount: "30", units: 1, currency } }, textContext([line("I1"), line("I2")]), deps);
    expect(await price("not_named")).toMatchObject(ok([{ kind: "set_mentioned_price", price: { amount: { amount: 30, currency: "PEN" }, units: 1 } }]));
    expect(await price("USD")).toMatchObject(ok([{ kind: "set_mentioned_price", price: null }]));
  });

  test("counts a variant change as requested only for a confident explicit request", () => {
    expect(isChangeRequested({ value: "requested", confidence: 0.8 })).toBe(true);
    for (const change of [{ value: "requested", confidence: 0.79 }, { value: "only_named", confidence: 1 }, { value: "requested", confidence: 1.2 },
      { value: "requested", confidence: "0.9" }, { value: "requested" }, null, undefined, "requested"]) {
      expect(isChangeRequested(change)).toBe(false);
    }
  });
});

describe("chat photo actions", () => {
  test("spreads «2 de cada uno» over every product of the photo but not a bare quantity", async () => {
    const second = { ...item, variantId: id(3) as VariantId, productName: "Gorra" };
    const many: ChatToolContext = { ...context, shown: [context.shown[0]!, { product: { productId: id(4) as ProductId, name: "Gorra", variants: [second] }, preselectedVariantId: null,
      identification: { method: "visual", productId: id(4) as ProductId, confidence: 0.9 } }] };
    const run = async (perEach: boolean) => {
      const done = await addShownProducts({ variantWords: [], quantity: 2, perEach, mentionedPrice: { amount: "20", units: 1, currency: "not_named" } }, many, deps, signal);
      return done.success ? done.data.map((action) => action.kind === "add" ? [action.quantity, action.mentionedPrice] : action.kind) : done;
    };
    expect(await run(true)).toEqual([[2, null], [2, null]]);
    expect(await run(false)).toEqual([[1, null], [1, null]]);
  });

  test("drops a price stated in another currency instead of failing the message", async () => {
    const priced = (currency: "other" | "USD" | "PEN") => addShownProducts({ variantWords: [], quantity: null, perEach: false,
      mentionedPrice: { amount: "20", units: 1, currency } }, context, deps, signal);
    expect(await priced("other")).toMatchObject({ success: true, data: [{ kind: "add", mentionedPrice: null, quantity: 1 }] });
    expect(await priced("USD")).toMatchObject({ success: true, data: [{ kind: "add", mentionedPrice: null }] });
    expect(await priced("PEN")).toMatchObject({ success: true, data: [{ kind: "add", mentionedPrice: { amount: { amount: 20, currency: "PEN" }, units: 1 } }] });
  });
});

describe("chat price helpers", () => {
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
