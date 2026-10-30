import { describe, expect, test } from "vitest";
import type { ChatReadingContext, ReadingItem, ReadingPending } from "@core/src/features/orders/domain/chat-reading";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { context, id, pending, productId, readingProduct } from "@core/src/features/orders/infrastructure/chat-reading-fixtures";
import { createFitReadingContext, readerOutputTokenLimit, readerTokenBudget, requestTextOf, type Tokenizer } from "@core/src/features/orders/infrastructure/chat-reader-budget";
import { describeReadingContext, productBlock } from "@core/src/features/orders/infrastructure/chat-reader-context-text";

/** One token per character, so a block's size is its length and the spy knows exactly what was counted. */
function spyTokenizer() {
  const counted: { text: string; limit: number }[] = [];
  const tokenizer: Tokenizer = {
    count: (text) => text.length,
    within: (text, limit) => { counted.push({ text, limit }); return text.length <= limit ? text.length : false; },
  };
  return { tokenizer, counted };
}
/** With one token per character: the instructions and the schema, then the part never cut (the shown products included) and the other blocks, as the first pass counts them. */
const fixedChars = requestTextOf("").length;
const firstPass = (reading: ChatReadingContext, kept: ChatReadingContext["products"]) =>
  fixedChars + describeReadingContext({ ...reading, products: reading.products.filter(({ shown }) => shown) }).length
  + kept.filter(({ shown }) => !shown).reduce((total, entry) => total + productBlock(entry).length + 1, 0);
const settings = (budget: number) => ({ maxOutputTokens: 1000, tokenizerRatio: 1, textInputTokens: budget, photoInputTokens: budget });

const product = (n: number, name = `Producto ${n}`) => readingProduct(n, name, [[{ Talla: "M" }, 40 + n]]);
const line = (ref: string, n: number, over: Partial<ReadingItem> = {}): ReadingItem => ({ ref, variantId: id(100 + n) as VariantId, productId: productId(n), productName: `Producto ${n}`, variantAttributes: { Talla: "M" }, quantity: 1, unitPrice: { amount: 40 + n, currency: "PEN" }, photoJustSent: false, ...over });
const withProducts = (products: ChatReadingContext["products"], over: Partial<ChatReadingContext> = {}) => context({ text: "quiero uno", products, ...over });

describe("readerTokenBudget", () => {
  test("derives the text and photo input budgets from the cost bound, the prices and the photo reserve", () => {
    const budget = readerTokenBudget({ photoStagesReserveUsd: 0.00099 });
    expect(budget.maxOutputTokens).toBe(readerOutputTokenLimit);
    expect(readerOutputTokenLimit).toBe(1000);
    expect(budget.tokenizerRatio).toBe(1);
    expect(budget.textInputTokens).toBe(25_000);
    expect(budget.photoInputTokens).toBe(15_100);
    expect(readerTokenBudget({ photoStagesReserveUsd: 0.00125 }).photoInputTokens).toBe(12_500);
    expect(readerTokenBudget({ photoStagesReserveUsd: 0 }).photoInputTokens).toBe(25_000);
  });

  test("a reserve that leaves a photo budget under 8,000 tokens fails at startup", () => {
    expect(() => readerTokenBudget({ photoStagesReserveUsd: 0.00170 })).not.toThrow();
    expect(() => readerTokenBudget({ photoStagesReserveUsd: 0.00171 })).toThrow(/8,000/);
  });

  test("a reader model with no price fails at startup", () => {
    expect(() => readerTokenBudget({ photoStagesReserveUsd: 0, model: "unpriced-model" })).toThrow(/price/);
  });

  test("divides the budget by the tokenizer ratio", () => {
    expect(readerTokenBudget({ photoStagesReserveUsd: 0, tokenizerRatio: 1.25 }).textInputTokens).toBe(20_000);
  });
});

describe("fitReadingContext", () => {
  test("keeps products in priority order while they fit the budget and drops the rest from the first that does not fit", () => {
    const { tokenizer } = spyTokenizer();
    const reading = withProducts([product(1), product(2), product(3), product(4)]);
    const budget = firstPass(reading, reading.products.slice(0, 3)) - 1;
    const fit = createFitReadingContext({ budget: settings(budget), tokenizer });
    const result = fit(reading);
    expect("code" in result).toBe(false);
    if ("code" in result) return;
    expect(result.context.products.map(({ ref }) => ref)).toEqual(["P1", "P2"]);
    expect(result.droppedProducts).toBe(2);
    expect(result.context.truncated).toBe(true);
    expect(result.countedInputTokens).toBeLessThanOrEqual(budget);
  });

  test("drops nothing and leaves truncated as it was when everything fits", () => {
    const { tokenizer } = spyTokenizer();
    const fit = createFitReadingContext({ budget: settings(1_000_000), tokenizer });
    const reading = withProducts([product(1), product(2)], { truncated: true });
    const result = fit(reading);
    expect(result).toMatchObject({ droppedProducts: 0, context: { truncated: true } });
    expect(result).toMatchObject({ context: { products: reading.products } });
  });

  test("drops not-sellable candidates first, then text candidates, items' products and pendings' candidates, never the shown product", () => {
    // The context lists products in selection order: shown, variant pendings, doubtful candidates, items, text candidates, not-sellable candidates.
    const shown = { ...product(1), shown: true };
    const variantPending = product(2);
    const doubtful = product(3);
    const itemProduct = product(4);
    const textCandidate = product(5);
    const notSellable = readingProduct(6, "Producto 6", [[{ Talla: "M" }, 46]], { sellable: false });
    const ordered = [shown, variantPending, doubtful, itemProduct, textCandidate, notSellable];
    const reading = withProducts(ordered, { kind: "photo_product", items: [line("I1", 4)], pendings: [{ ref: "Q1", photoJustSent: false, pending: pending(1, { subject: { kind: "variant", productId: productId(2) } }) }] });
    const { tokenizer } = spyTokenizer();
    const dropped: string[][] = [];
    for (const count of [6, 5, 4, 3, 2, 1]) {
      // The exact size of the request with these products listed: items and pendings name them by reference, which the first pass has not seen yet.
      const budget = requestTextOf(describeReadingContext({ ...reading, products: ordered.slice(0, count) })).length;
      const fit = createFitReadingContext({ budget: settings(budget), tokenizer });
      const result = fit(reading);
      if ("code" in result) throw new Error("did not fit");
      dropped.push(ordered.map(({ ref }) => ref).filter((ref) => !result.context.products.some((kept) => kept.ref === ref)));
      expect(result.context.products[0]?.ref).toBe(shown.ref);
    }
    expect(dropped).toEqual([[], ["P6"], ["P5", "P6"], ["P4", "P5", "P6"], ["P3", "P4", "P5", "P6"], ["P2", "P3", "P4", "P5", "P6"]]);
  });

  test("does not tokenize product blocks after the first that does not fit", () => {
    const { tokenizer, counted } = spyTokenizer();
    const big = readingProduct(2, "Producto 2", Array.from({ length: 40 }, (_, index) => [{ Talla: `T${index}` }, 40 + index] as [Record<string, string>, number]));
    const reading = withProducts([product(1), big, product(3), product(4)]);
    const budget = firstPass(reading, [reading.products[0]!]) + 200;
    const result = createFitReadingContext({ budget: settings(budget), tokenizer })(reading);
    if ("code" in result) throw new Error("did not fit");
    expect(result.context.products.map(({ ref }) => ref)).toEqual(["P1"]);
    const tokenized = counted.map(({ text }) => text);
    expect(tokenized.some((text) => text.includes("Producto 3") || text.includes("Producto 4"))).toBe(false);
    expect(tokenized.some((text) => text.includes(productBlock(big)))).toBe(true);
    // Each call stops at what is left of the budget.
    expect(counted.every(({ limit }) => limit <= budget)).toBe(true);
  });

  test("a part never cut that is over the budget is context_too_large without tokenizing any product", () => {
    const { tokenizer, counted } = spyTokenizer();
    const items = Array.from({ length: 40 }, (_, index) => line(`I${index + 1}`, index + 1, { productName: "N".repeat(200) }));
    const reading = withProducts([product(1), product(2)], { items });
    const result = createFitReadingContext({ budget: settings(fixedChars + 1000), tokenizer })(reading);
    expect(result).toMatchObject({ code: "CONTEXT_TOO_LARGE" });
    expect(counted.some(({ text }) => text.includes("Producto 1"))).toBe(false);
  });

  test("never drops an item, a pending or the text", () => {
    const { tokenizer } = spyTokenizer();
    const reading = withProducts([product(1), product(2), product(3)], {
      text: "t".repeat(300), items: [line("I1", 1), line("I2", 2)],
      pendings: [{ ref: "Q1", photoJustSent: false, pending: pending(1, { subject: { kind: "product", candidates: [productId(2), productId(3)] }, quantity: 2 as PositiveInteger }) } satisfies ReadingPending],
    });
    const result = createFitReadingContext({ budget: settings(firstPass(reading, []) + 10), tokenizer })(reading);
    if ("code" in result) throw new Error("did not fit");
    expect(result.context.products).toEqual([]);
    expect(result.context.items).toEqual(reading.items);
    expect(result.context.pendings).toEqual(reading.pendings);
    expect(result.context.text).toBe(reading.text);
  });

  test("each product block is counted with its separator", () => {
    const { tokenizer, counted } = spyTokenizer();
    const reading = withProducts([product(1), product(2)]);
    createFitReadingContext({ budget: settings(1_000_000), tokenizer })(reading);
    const texts = counted.map(({ text }) => text);
    expect(texts).toContain(`\n${productBlock(product(1))}`);
    expect(texts).toContain(`\n${productBlock(product(2))}`);
  });

  test("when the whole rendered request is still over the budget, products are dropped from the tail until it fits", () => {
    // A tokenizer that counts the blocks lightly but the whole request heavily: the sum of the parts under-counts the joined text.
    const calls: string[] = [];
    const tokenizer: Tokenizer = {
      count: (text) => text.length,
      within: (text, limit) => {
        const size = text.includes("Buyer's message:") ? text.length + (text.match(/Producto \d/g)?.length ?? 0) * 500 : text.length;
        calls.push(text);
        return size <= limit ? size : false;
      },
    };
    const reading = withProducts([product(1), product(2), product(3)]);
    const budget = firstPass(reading, reading.products) + 600;
    const result = createFitReadingContext({ budget: settings(budget), tokenizer })(reading);
    if ("code" in result) throw new Error("did not fit");
    expect(result.context.products.length).toBeLessThan(3);
    expect(result.droppedProducts).toBe(3 - result.context.products.length);
    expect(result.countedInputTokens).toBeLessThanOrEqual(budget);
    expect(calls.filter((text) => text.includes("Buyer's message:")).length).toBeGreaterThan(1);
  });

  test("a photo context uses the text budget reduced by the photo stages' reserve", () => {
    const { tokenizer } = spyTokenizer();
    const fit = createFitReadingContext({ budget: { ...settings(fixedChars + 100_000), photoInputTokens: fixedChars + 100 }, tokenizer });
    const products = [product(1), product(2), product(3)];
    const asText = fit(withProducts(products, { kind: "text" }));
    const asPhoto = fit(withProducts(products, { kind: "photo_not_product" }));
    if ("code" in asText) throw new Error("text did not fit");
    expect(asText.droppedProducts).toBe(0);
    expect(asPhoto).toMatchObject({ code: "CONTEXT_TOO_LARGE" });
  });

  test("never drops the shown product, even when it is not first", () => {
    const { tokenizer } = spyTokenizer();
    const shown = { ...product(3), shown: true };
    const reading = withProducts([product(1), product(2), shown], { kind: "photo_product" });
    const budget = firstPass(reading, [shown]) + 5;
    const result = createFitReadingContext({ budget: settings(budget), tokenizer })(reading);
    if ("code" in result) throw new Error("did not fit");
    expect(result.context.products.map(({ ref }) => ref)).toEqual(["P3"]);
  });
});
