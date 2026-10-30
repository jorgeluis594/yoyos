import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { expect, test } from "vitest";
import type { ChatReadingContext, ReadingItem, ReadingPending, ReadingProduct } from "@core/src/features/orders/domain/chat-reading";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { context, id, pending, productId, readingProduct } from "@core/src/features/orders/infrastructure/chat-reading-fixtures";
import { describeReadingContext } from "@core/src/features/orders/infrastructure/chat-reader-context-text";
import { readerJsonSchema } from "@core/src/features/orders/infrastructure/chat-reader-schema";
import { readerInstructions } from "@core/src/features/orders/infrastructure/chat-reader-text";
import { readerRequestSettings } from "@core/src/features/orders/infrastructure/openai-chat-reader";

/** USD per million tokens of gpt-6-luna, as in `evals/lib/model-meter.ts`. */
const price = { input: 0.1, output: 0.5 };
const costBoundUsd = 0.003;
/** The 10-action answer of §10.1: about 100 tokens an action. Reasoning tokens measured at the pinned effort are added when they are recorded. */
const answerTokens = 1000;
const measuredReasoningTokens = 0;
/**
 * No tokenizer is published for gpt-6-luna. o200k_base is the encoding gpt-tokenizer maps to gpt-5.6-luna, the closest model it lists.
 * The count leaves out the few tokens of message framing the API adds.
 */
const tokenizer = "o200k_base (gpt-tokenizer 4.0.3, as for gpt-5.6-luna; no tokenizer is published for gpt-6-luna)";
const tokensOf = (text: string) => encode(text).length;
/** The earlier estimate, kept only to report how far it was from the count. */
const charsPerToken = 3;
const estimatedTokensOf = (text: string) => Math.ceil(text.length / charsPerToken);

/** The most input tokens that keep input plus the answer, reasoning included, at or under the cost bound. */
const inputTokenLimit = Math.floor((costBoundUsd * 1_000_000 - (answerTokens + measuredReasoningTokens) * price.output) / price.input);

const sizes = ["XS", "S", "M", "L", "XL", "XXL", "28", "30", "32", "34", "36", "38"];
const colors = ["Negro", "Blanco", "Rojo", "Azul", "Verde", "Gris"];
const sellable = (n: number, name: string) => readingProduct(n, name, sizes.flatMap((Talla, row) => colors.map((Color, column): [Record<string, string>, number] => [{ Talla, Color }, 30 + row + column / 10 + n / 100])));

/** The worst case of §10.1 at the ceiling in force: products of 6 × 12 values with a price per combination, 40 items, 10 doubtful pendings of 4 candidates, 2,000 characters. */
function worstCaseContext(maxProducts: number): ChatReadingContext {
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
function realisticContext(): ChatReadingContext {
  const products = Array.from({ length: 12 }, (_, index) => realisticProduct(index + 1));
  const items: ReadingItem[] = [1, 2, 3].map((n) => ({
    ref: `I${n}`, variantId: products[n - 1]!.variants[0]!.variantId, productId: productId(n), productName: products[n - 1]!.name,
    variantAttributes: products[n - 1]!.variants[0]!.variantAttributes, quantity: n as PositiveInteger, unitPrice: products[n - 1]!.variants[0]!.unitPrice, photoJustSent: false,
  }));
  const pendings: ReadingPending[] = [{ ref: "Q1", photoJustSent: false, pending: pending(1, { subject: { kind: "variant", productId: productId(5) }, known: { Color: "Negro" } }) }];
  return { kind: "text", text: "hola, me separas el negro en M y otra gorra porfa", latestOrder: "open", items, pendings, products, photoJustSent: null, truncated: false };
}

const requestText = (reading: ChatReadingContext) => [readerInstructions, JSON.stringify(readerJsonSchema), describeReadingContext(reading)].join("\n");

/** Tokens of each part the model reads; framing is what the join and the context headings add beyond the parts. */
function breakdown(reading: ChatReadingContext, count: (text: string) => number) {
  const describe = (over: Partial<ChatReadingContext>) => count(describeReadingContext({ ...reading, ...over }));
  const bare = describe({ products: [], items: [], pendings: [], text: "" });
  const withCatalog = describe({ items: [], pendings: [], text: "" });
  const withText = describe({ items: [], pendings: [] });
  const parts = {
    instructions: count(readerInstructions), schema: count(JSON.stringify(readerJsonSchema)),
    catalog: withCatalog - bare, orderAndPendings: describe({}) - withText, message: withText - withCatalog,
  };
  const total = count(requestText(reading));
  const costUsd = (total * price.input + (answerTokens + measuredReasoningTokens) * price.output) / 1_000_000;
  return { ...parts, framing: total - Object.values(parts).reduce((sum, tokens) => sum + tokens, 0), total, costUsd: Number(costUsd.toFixed(6)),
    marginUsd: Number((costBoundUsd - costUsd).toFixed(6)), withinBound: total <= inputTokenLimit };
}

/** The four contexts the pinned file records. */
const polo = readingProduct(1, "Polo básico", [[{ Talla: "S", Color: "Negro" }, 40], [{ Talla: "M", Color: "Negro" }, 40], [{ Talla: "M", Color: "Blanco" }, 42]]);
const gorra = readingProduct(2, "Gorra", [[{}, 15]]);
const casaca = readingProduct(3, "Casaca", [[{ Talla: "S" }, 100], [{ Talla: "M" }, 120]], { sellable: false });
const item = (ref: string, over: Partial<ReadingItem>): ReadingItem => ({ ref, variantId: id(1) as VariantId, productId: productId(3), productName: "Casaca", variantAttributes: { Talla: "M" }, quantity: 1, unitPrice: { amount: 120, currency: "PEN" }, photoJustSent: false, ...over });
const contexts: Readonly<Record<string, ChatReadingContext>> = {
  text_without_order: context({ text: "hola, quiero 2 polos negros", products: [polo, gorra] }),
  text_with_items_and_pendings: context({
    text: "el segundo en M, y quita la casaca", products: [polo, gorra, casaca],
    items: [item("I1", {}), item("I2", { productId: productId(1), productName: "Polo básico", variantAttributes: { Talla: "S", Color: "Negro" }, quantity: 2, unitPrice: { amount: 40, currency: "PEN" } })],
    pendings: [{ ref: "Q1", photoJustSent: false, pending: pending(1, { known: { Color: "Negro" }, quantity: 2 as PositiveInteger }) }, { ref: "Q2", photoJustSent: false, pending: pending(2, { subject: { kind: "product", candidates: [productId(1), productId(2)] } }) }],
  }),
  product_photo: context({ kind: "photo_product", text: "me interesa 3", products: [{ ...polo, shown: true, shownVariantId: polo.variants[1]!.variantId }] }),
  non_product_photo: context({ kind: "photo_not_product", text: "así lo quiero" }),
};

const maxProducts = 24; // READER_MAX_PRODUCTS, lowered only when the size test or the reasoning measurement says so
const sizeCases = { worstCase: worstCaseContext(maxProducts), realistic: realisticContext() };
const measured = Object.fromEntries(Object.entries(sizeCases).map(([name, reading]) => [name, { tokens: breakdown(reading, tokensOf), charactersOver3: breakdown(reading, estimatedTokensOf) }]));
const worstCase = measured.worstCase!.tokens;
const realistic = measured.realistic!.tokens;

test("pins every model-facing text, the one schema, the request settings and the worst-case size of the reader", async () => {
  // Any change of the instructions, the schema, the settings, the context text or the worst-case size fails here and is reviewed as a change of what the model reads.
  const pinned = {
    model: "gpt-6-luna", settings: readerRequestSettings, instructions: readerInstructions, jsonSchema: readerJsonSchema,
    contexts: Object.fromEntries(Object.entries(contexts).map(([name, reading]) => [name, describeReadingContext(reading)])),
    size: { tokenizer, maxProducts, inputTokenLimit, answerTokens: answerTokens + measuredReasoningTokens, costBoundUsd, ...measured },
  };
  await expect(`${JSON.stringify(pinned, null, 2)}\n`).toMatchFileSnapshot("chat-reader.model-text.json");
});

test("reports the worst-case context with per-combination prices against the token limit derived from the cost bound", () => {
  // Counted with the tokenizer it is over the bound; the pinned file reports it and Todoist task 6hrqHJghCXGwX26V decides the limit.
  // This only fails if it grows past what is pinned, so it never hides a larger overrun.
  expect(worstCase.total).toBeLessThanOrEqual(29_860);
});

test("keeps a usual catalog context, few combinations and shared prices, within the token limit derived from the cost bound", () => {
  // A failing count is fixed by lowering READER_MAX_PRODUCTS, never by raising the limit.
  expect(realistic.total).toBeLessThanOrEqual(inputTokenLimit);
  expect(realistic.costUsd).toBeLessThanOrEqual(costBoundUsd);
});
