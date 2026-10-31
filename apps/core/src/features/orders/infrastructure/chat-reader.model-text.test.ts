import { countTokens, encode } from "gpt-tokenizer/encoding/o200k_base";
import { expect, test, vi } from "vitest";
vi.mock("@core/src/composition/event-bus", () => ({ applicationEventBus: () => ({ publishEvent: vi.fn() }) }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({
  getCompanyId: () => "00000000-0000-4000-8000-000000000001", withTenantIsolation: (_company: string, work: () => unknown) => work() }));
import { createVisualSearch } from "@core/src/features/products/composition";
import type { ChatReadingContext, ReadingItem, ReadingPending, ReadingProduct } from "@core/src/features/orders/domain/chat-reading";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { productOptionLimits } from "@core/src/features/products/domain/product-structure";
import { priceOf } from "@core/src/shared/infrastructure/model-prices";
import { context, id, pending, productId, readingProduct } from "@core/src/features/orders/infrastructure/chat-reading-fixtures";
import { createFitReadingContext, messageCostBoundUsd, readerOutputTokenLimit, readerTokenBudget, requestTextOf } from "@core/src/features/orders/infrastructure/chat-reader-budget";
import { describeReadingContext } from "@core/src/features/orders/infrastructure/chat-reader-context-text";
import { readerSettingBounds } from "@core/src/features/orders/infrastructure/chat-message-limits-env";
import { readChatReaderEnv } from "@core/src/features/orders/infrastructure/chat-reader-env";
import { readerJsonSchema } from "@core/src/features/orders/infrastructure/chat-reader-schema";
import { readerInstructions } from "@core/src/features/orders/infrastructure/chat-reader-text";
import { readerRequestSettings } from "@core/src/features/orders/infrastructure/openai-chat-reader";

const model = "gpt-6-luna";
const price = priceOf(model)!;
/** The photo stages' live reserve with the default settings: the local embedder (default) and the OpenAI describer. */
const reserves = {
  localEmbedder: createVisualSearch({ OPENAI_API_KEY: "key" }).photoStagesReserveUsd,
  openAiDescriber: createVisualSearch({ OPENAI_API_KEY: "key", IMAGE_EMBEDDER_PROVIDER: "openai" }).photoStagesReserveUsd,
};
/**
 * No tokenizer is published for gpt-6-luna. o200k_base is the encoding gpt-tokenizer maps to gpt-5.6-luna, the closest model it lists.
 * The count leaves out the few tokens of message framing the API adds.
 */
const tokenizer = "o200k_base (gpt-tokenizer 4.0.3, as for gpt-5.6-luna; no tokenizer is published for gpt-6-luna)";
const tokensOf = (text: string) => countTokens(text);
const costUsd = (inputTokens: number, reserveUsd = 0) => (inputTokens * price.input + readerOutputTokenLimit * price.output) / 1_000_000 + reserveUsd;

const budgets = { local: readerTokenBudget({ photoStagesReserveUsd: reserves.localEmbedder }), openAi: readerTokenBudget({ photoStagesReserveUsd: reserves.openAiDescriber }) };
const fitWith = (budget: typeof budgets.local) => createFitReadingContext({ budget });
const fittedRequestTokens = (reading: ChatReadingContext) => tokensOf(requestTextOf(describeReadingContext(reading)));

const sizes = ["XS", "S", "M", "L", "XL", "XXL", "28", "30", "32", "34", "36", "38"];
const colors = ["Negro", "Blanco", "Rojo", "Azul", "Verde", "Gris"];
const sellable = (n: number, name: string) => readingProduct(n, name, sizes.flatMap((Talla, row) => colors.map((Color, column): [Record<string, string>, number] => [{ Talla, Color }, 30 + row + column / 10 + n / 100])));

/** The synthetic catalog of PR #248: products of 6 × 12 values with a price per combination, 40 items, 10 doubtful pendings of 4 candidates, 2,000 characters. */
function syntheticCatalogContext(maxProducts: number): ChatReadingContext {
  const products: ReadingProduct[] = Array.from({ length: maxProducts }, (_, index) => sellable(index + 1, `Polera con capucha modelo ${index + 1}`));
  const items: ReadingItem[] = Array.from({ length: 40 }, (_, index) => ({
    ref: `I${index + 1}`, variantId: id(9000 + index) as VariantId, productId: productId((index % maxProducts) + 1), productName: `Polera con capucha modelo ${(index % maxProducts) + 1}`,
    variantAttributes: { Talla: sizes[index % sizes.length]!, Color: colors[index % colors.length]! }, quantity: 1 + (index % 4), unitPrice: { amount: 45.5, currency: "PEN" }, photoJustSent: false,
  }));
  const pendings: ReadingPending[] = Array.from({ length: 10 }, (_, index) => ({
    ref: `Q${index + 1}`, photoJustSent: false, pending: pending(index + 1, { subject: { kind: "product", candidates: [productId(index + 1), productId(index + 2), productId(index + 3), productId(index + 4)] }, quantity: 2 as PositiveInteger }),
  }));
  return { kind: "text", text: "quiero la polera negra en M ".repeat(80).slice(0, 2000), latestOrder: "open", items, pendings, products, photoJustSent: null, truncated: false };
}

type Script = "latin" | "cjk" | "emoji" | "cjkSupplementary";
const scripts: readonly Script[] = ["latin", "cjk", "emoji", "cjkSupplementary"];
/** Characters that tokenize badly on purpose: random-looking letters, CJK of the basic plane, emoji and CJK of a supplementary plane. */
const codePointOf = (script: Script, n: number): number => ({
  latin: () => 0x61 + (n % 26), cjk: () => 0x4e00 + ((n * 7919) % 20_000), emoji: () => 0x1f300 + ((n * 31) % 700), cjkSupplementary: () => 0x20000 + ((n * 7919) % 40_000),
})[script]();
const word = (script: Script, seed: number, codePoints: number) => Array.from({ length: codePoints }, (_, index) => String.fromCodePoint(codePointOf(script, seed * 131 + index * 17 + index * index))).join("");
/** A text of at most `units` UTF-16 units. */
function textOf(script: Script, units: number): string {
  let out = "";
  for (let index = 0; ; index += 1) {
    const next = String.fromCodePoint(codePointOf(script, 5000 + index));
    if (out.length + next.length > units) return out;
    out += next;
  }
}

type Shape = "no_sold_list" | "sold_list";
/** Option value counts: 3 × 30 (27,000 combinations, no sold list) or 12 × 12 × 13 (1,872 combinations, 100 sold, the «Sold combinations» list is rendered). */
const shapeSizes: Readonly<Record<Shape, readonly number[]>> = { no_sold_list: [30, 30, 30], sold_list: [12, 12, 13] };
const nameLength = 200; // Product.name VarChar(200)

/** One product at `productOptionLimits`: 3 options of values of 30 code points, 100 variants with a different price each, a 200-character name. */
function limitProduct(n: number, script: Script, shape: Shape): ReadingProduct {
  const optionNames = Array.from({ length: productOptionLimits.options }, (_, index) => word(script, 10 + index, productOptionLimits.nameLength));
  const sizesOf = shapeSizes[shape];
  const values = sizesOf.map((count, option) => Array.from({ length: count }, (_, index) => word(script, 100 + option * 40 + index, productOptionLimits.nameLength)));
  const combinations = Array.from({ length: productOptionLimits.variants }, (_, k): [Record<string, string>, number] => {
    const pick = [k % sizesOf[0]!, Math.floor(k / sizesOf[0]!) % sizesOf[1]!, (k * 7) % sizesOf[2]!];
    return [Object.fromEntries(optionNames.map((name, option) => [name, values[option]![pick[option]!]!])), 10 + k + n / 100];
  });
  return readingProduct(n, word(script, 1000 + n, nameLength), combinations, { attributes: optionNames.map((name, option) => ({ name, values: values[option]! })) });
}

/** READER_MAX_PRODUCTS products, READER_MAX_ITEMS items and 10 pendings with those names and values, and a text of READER_MAX_TEXT_CHARS units. */
function domainWorstContext(script: Script, shape: Shape, kind: "text" | "photo_product"): ChatReadingContext {
  const count = readerSettingBounds.READER_MAX_PRODUCTS;
  const products = Array.from({ length: count }, (_, index) => limitProduct(index + 1, script, shape));
  const withShown = products.map((product, index) => (kind === "photo_product" && index === 0 ? { ...product, shown: true, shownVariantId: product.variants[0]!.variantId } : product));
  const first = products[0]!;
  const items: ReadingItem[] = Array.from({ length: readerSettingBounds.READER_MAX_ITEMS }, (_, index) => {
    const product = products[index % count]!;
    const variant = product.variants[index % product.variants.length]!;
    return { ref: `I${index + 1}`, variantId: variant.variantId, productId: product.productId, productName: product.name, variantAttributes: variant.variantAttributes, quantity: 99, unitPrice: variant.unitPrice, photoJustSent: false };
  });
  const pendings: ReadingPending[] = Array.from({ length: 10 }, (_, index) => ({
    ref: `Q${index + 1}`, photoJustSent: false,
    pending: index % 2 === 0
      ? pending(index + 1, { subject: { kind: "product", candidates: [products[index % count]!.productId, products[(index + 1) % count]!.productId, products[(index + 2) % count]!.productId, products[(index + 3) % count]!.productId] }, quantity: 99 as PositiveInteger })
      : pending(index + 1, { subject: { kind: "variant", productId: products[index % count]!.productId }, known: first.variants[0]!.variantAttributes, quantity: 99 as PositiveInteger }),
  }));
  return { kind, text: textOf(script, readerSettingBounds.READER_MAX_TEXT_CHARS), latestOrder: "open", items, pendings, products: withShown, photoJustSent: null, truncated: false };
}

/** Common catalog shapes: few combinations, one price a product. */
const realisticShapes: readonly [Record<string, string>[], number][] = [
  [["S", "M", "L"].flatMap((Talla) => ["Negro", "Blanco"].map((Color) => ({ Talla, Color }))), 45],
  [["S", "M", "L", "XL"].map((Talla) => ({ Talla })), 79],
  [["Negro", "Rojo", "Crudo"].map((Color) => ({ Color })), 38],
  [[{}], 25],
];
const realisticProduct = (n: number) => {
  const [combinations, price] = realisticShapes[n % realisticShapes.length]!;
  return readingProduct(n, `Producto de catálogo ${n}`, combinations.map((attributes): [Record<string, string>, number] => [attributes, price]));
};

/** A usual message: the 8 text candidates plus the products of 3 items and 1 pending, a short text. */
function realisticContext(kind: "text" | "photo_product" = "text"): ChatReadingContext {
  const products = Array.from({ length: 12 }, (_, index) => realisticProduct(index + 1));
  const items: ReadingItem[] = [1, 2, 3].map((n) => ({
    ref: `I${n}`, variantId: products[n - 1]!.variants[0]!.variantId, productId: productId(n), productName: products[n - 1]!.name,
    variantAttributes: products[n - 1]!.variants[0]!.variantAttributes, quantity: n as PositiveInteger, unitPrice: products[n - 1]!.variants[0]!.unitPrice, photoJustSent: false,
  }));
  const pendings: ReadingPending[] = [{ ref: "Q1", photoJustSent: false, pending: pending(1, { subject: { kind: "variant", productId: productId(5) }, known: { Color: "Negro" } }) }];
  const shown = kind === "photo_product" ? products.map((product, index) => (index === 6 ? { ...product, shown: true, shownVariantId: product.variants[0]!.variantId } : product)) : products;
  return { kind, text: "hola, me separas el negro en M y otra gorra porfa", latestOrder: "open", items, pendings, products: shown, photoJustSent: null, truncated: false };
}

/** A strict 10-action answer of realistic values, every action with the eleven fields the strict schema requires. */
const noFields = { product: null, pendingProduct: null, attributes: null, quantity: null, price: null, pending: null, item: null, amount: null, mode: null, pendings: null };
const tenActionAnswer = {
  outcome: "actions", moreActions: true, actions: [
    { ...noFields, kind: "add", product: { kind: "ref", ref: "P1", refs: null }, attributes: [{ name: "Talla", value: "M" }, { name: "Color", value: "Negro" }], quantity: 2, price: { amount: "45", currency: "PEN", per: "unit" } },
    { ...noFields, kind: "add", product: { kind: "ref", ref: "P4", refs: null }, attributes: [{ name: "Talla", value: "L" }], quantity: 1 },
    { ...noFields, kind: "add", product: { kind: "one_of", ref: null, refs: ["P2", "P3"] }, attributes: [{ name: "Color", value: "Rojo" }], quantity: 3 },
    { ...noFields, kind: "complete_pending", pending: "Q1", pendingProduct: null, attributes: [{ name: "Color", value: "Blanco" }], quantity: 1 },
    { ...noFields, kind: "decline_pending", pending: "Q2" },
    { ...noFields, kind: "remove", item: { kind: "ref", ref: "I3" }, amount: "one" },
    { ...noFields, kind: "change_quantity", item: { kind: "ref", ref: "I1" }, mode: "set", quantity: 4 },
    { ...noFields, kind: "change_variant", item: { kind: "ref", ref: "I2" }, attributes: [{ name: "Talla", value: "XL" }] },
    { ...noFields, kind: "set_price", item: { kind: "ref", ref: "I4" }, price: { amount: "38", currency: "PEN", per: "unit" } },
    { ...noFields, kind: "ready" },
  ],
};

/** The contexts the pinned file records. */
const polo = readingProduct(1, "Polo básico", [[{ Talla: "S", Color: "Negro" }, 40], [{ Talla: "M", Color: "Negro" }, 40], [{ Talla: "M", Color: "Blanco" }, 42]]);
const gorra = readingProduct(2, "Gorra", [[{}, 15]]);
const casaca = readingProduct(3, "Casaca", [[{ Talla: "S" }, 100], [{ Talla: "M" }, 120]], { sellable: false });
const item = (ref: string, over: Partial<ReadingItem>): ReadingItem => ({ ref, variantId: id(1) as VariantId, productId: productId(3), productName: "Casaca", variantAttributes: { Talla: "M" }, quantity: 1, unitPrice: { amount: 120, currency: "PEN" }, photoJustSent: false, ...over });
const contexts: Readonly<Record<string, ChatReadingContext>> = {
  text_without_order: context({ text: "hola, quiero 2 polos negros", products: [polo, gorra] }),
  text_with_items_and_pendings: context({
    text: "el segundo en M, y quita la casaca", latestOrder: "open", products: [polo, gorra, casaca],
    items: [item("I1", {}), item("I2", { productId: productId(1), productName: "Polo básico", variantAttributes: { Talla: "S", Color: "Negro" }, quantity: 2, unitPrice: { amount: 40, currency: "PEN" } })],
    pendings: [{ ref: "Q1", photoJustSent: false, pending: pending(1, { known: { Color: "Negro" }, quantity: 2 as PositiveInteger }) }, { ref: "Q2", photoJustSent: false, pending: pending(2, { subject: { kind: "product", candidates: [productId(1), productId(2)] } }) }],
  }),
  product_photo: context({ kind: "photo_product", text: "me interesa 3", products: [{ ...polo, shown: true, shownVariantId: polo.variants[1]!.variantId }] }),
  non_product_photo: context({ kind: "photo_not_product", text: "así lo quiero" }),
  photo_just_sent_with_closed_latest_order: context({
    text: "quiero 3", latestOrder: "closed", products: [polo, casaca],
    pendings: [{ ref: "Q1", photoJustSent: true, pending: pending(1, { known: { Color: "Negro" } }) }],
  }),
};

const syntheticAtLimit = syntheticCatalogContext(readerSettingBounds.READER_MAX_PRODUCTS);
const outcomeOf = (reading: ChatReadingContext, budget = budgets.local) => {
  const result = fitWith(budget)(reading);
  return "code" in result ? { fits: false as const, countedInputTokens: result.countedInputTokens } : { fits: true as const, kept: result.context.products.length, dropped: result.droppedProducts, countedInputTokens: result.countedInputTokens };
};
const worstCaseKeys = scripts.flatMap((script) => (["no_sold_list", "sold_list"] as const).flatMap((shape) => (["text", "photo_product"] as const).map((kind) => ({ script, shape, kind }))));
const worstCases = worstCaseKeys.map((key) => ({ key, reading: domainWorstContext(key.script, key.shape, key.kind) }));
const perPart = (reading: ChatReadingContext) => ({
  instructions: tokensOf(readerInstructions), schema: tokensOf(JSON.stringify(readerJsonSchema)), context: tokensOf(describeReadingContext(reading)), total: fittedRequestTokens(reading),
});

test("pins every model-facing text, the one schema, the request settings, the budget and the measured sizes of the reader", async () => {
  // Any change of the instructions, the schema, the settings, the context text, the budget or the measured sizes fails here and is reviewed as a change of what the model reads.
  const usual = realisticContext();
  const pinned = {
    model, settings: readerRequestSettings, instructions: readerInstructions, jsonSchema: readerJsonSchema,
    contexts: Object.fromEntries(Object.entries(contexts).map(([name, reading]) => [name, describeReadingContext(reading)])),
    budget: { tokenizer, bound: messageCostBoundUsd, reserves, localEmbedder: budgets.local, openAiDescriber: budgets.openAi },
    size: {
      fixedPart: { instructions: tokensOf(readerInstructions), schema: tokensOf(JSON.stringify(readerJsonSchema)) },
      answerOfTenActions: tokensOf(JSON.stringify(tenActionAnswer)),
      usualCase: { text: { ...perPart(usual), ...outcomeOf(usual) }, photo: { ...perPart(realisticContext("photo_product")), ...outcomeOf(realisticContext("photo_product"), budgets.openAi) } },
      syntheticCatalogOfPr248: { unfitted: perPart(syntheticAtLimit), fitted: outcomeOf(syntheticAtLimit) },
      domainWorstCases: Object.fromEntries(worstCases.map(({ key, reading }) => [`${key.script}/${key.shape}/${key.kind}`, outcomeOf(reading, key.kind === "text" ? budgets.local : budgets.openAi)])),
    },
  };
  await expect(`${JSON.stringify(pinned, null, 2)}\n`).toMatchFileSnapshot("chat-reader.model-text.json");
});

test("the input budget plus the answer limit cost at most US$0.003", () => {
  for (const budget of [budgets.local, budgets.openAi]) {
    expect(costUsd(budget.textInputTokens)).toBeLessThanOrEqual(messageCostBoundUsd);
    // One token more would break the bound: the budget is the largest that keeps it.
    expect(costUsd(budget.textInputTokens + 1)).toBeGreaterThan(messageCostBoundUsd);
    expect(budget.textInputTokens).toBe(30_000 - 5 * budget.maxOutputTokens);
  }
});

test("the photo budget plus the answer limit plus any admitted reserve cost at most US$0.003", () => {
  for (const reserve of [0, reserves.localEmbedder, reserves.openAiDescriber, 0.0017]) {
    const budget = readerTokenBudget({ photoStagesReserveUsd: reserve });
    expect(costUsd(budget.photoInputTokens, reserve)).toBeLessThanOrEqual(messageCostBoundUsd + 1e-12);
    expect(costUsd(budget.photoInputTokens + 1, reserve)).toBeGreaterThan(messageCostBoundUsd);
    expect(budget.photoInputTokens).toBe(Math.floor(budget.textInputTokens - (reserve * 1_000_000) / price.input));
  }
});

test("every domain worst case, in Latin, CJK, emoji and supplementary-plane names, as a text and as a captioned photo, fits its budget or is context_too_large", () => {
  expect(worstCases).toHaveLength(16);
  for (const { key, reading } of worstCases) {
    const budget = key.kind === "text" ? budgets.local.textInputTokens : budgets.openAi.photoInputTokens;
    const result = fitWith(key.kind === "text" ? budgets.local : budgets.openAi)(reading);
    const name = `${key.script}/${key.shape}/${key.kind}`;
    if ("code" in result) {
      expect(result.code, name).toBe("CONTEXT_TOO_LARGE");
      continue;
    }
    // Counted again, whole and without an early exit.
    expect(fittedRequestTokens(result.context), name).toBeLessThanOrEqual(budget);
    expect(result.countedInputTokens, name).toBeLessThanOrEqual(budget);
    expect(costUsd(budget, key.kind === "text" ? 0 : reserves.openAiDescriber), name).toBeLessThanOrEqual(messageCostBoundUsd + 1e-12);
    if (key.kind === "photo_product") expect(result.context.products.some(({ shown }) => shown), name).toBe(true);
  }
});

test("the synthetic catalog of PR #248 keeps at least 16 products within the budget", () => {
  const result = outcomeOf(syntheticAtLimit);
  expect(result.fits).toBe(true);
  expect(result.fits && result.kept).toBeGreaterThanOrEqual(16);
});

test("a strict 10-action answer of realistic values takes at most 900 tokens", () => {
  expect(tokensOf(JSON.stringify(tenActionAnswer))).toBeLessThanOrEqual(900);
  expect(tenActionAnswer.actions).toHaveLength(10);
});

test("the reader model of the configuration has a price", () => {
  expect(priceOf(readChatReaderEnv({}).AI_READER_MODEL)).toEqual({ input: 0.1, output: 0.5 });
});

test("the usual case drops no product and costs at most US$0.003", () => {
  const text = outcomeOf(realisticContext());
  const photo = outcomeOf(realisticContext("photo_product"), budgets.openAi);
  expect(text).toMatchObject({ fits: true, dropped: 0 });
  expect(photo).toMatchObject({ fits: true, dropped: 0 });
  expect(costUsd(text.countedInputTokens)).toBeLessThanOrEqual(messageCostBoundUsd);
  expect(costUsd(photo.countedInputTokens, reserves.openAiDescriber)).toBeLessThanOrEqual(messageCostBoundUsd);
});

test("encodes the same text the request count measures", () => {
  // Guards the helper of this file against drifting from the budget's own count.
  expect(encode(requestTextOf("x")).length).toBe(tokensOf(requestTextOf("x")));
});
