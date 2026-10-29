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
/** No tokenizer is installed, so tokens are estimated from characters at the rate the design uses for a priced line (about 3 characters a token), which errs high. */
const charsPerToken = 3;
const tokensOf = (text: string) => Math.ceil(text.length / charsPerToken);

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
    variantAttributes: { Talla: sizes[index % sizes.length]!, Color: colors[index % colors.length]! }, quantity: 1 + (index % 4), unitPrice: { amount: 45.5, currency: "PEN" },
  }));
  const pendings: ReadingPending[] = Array.from({ length: 10 }, (_, index) => ({
    ref: `Q${index + 1}`, pending: pending(index + 1, { subject: { kind: "product", candidates: [productId(index + 1), productId(index + 2), productId(index + 3), productId(index + 4)] }, quantity: 2 as PositiveInteger }),
  }));
  return { kind: "text", text: "quiero la polera negra en M ".repeat(80).slice(0, 2000), items, pendings, products, truncated: false };
}

const requestText = (reading: ChatReadingContext) => [readerInstructions, JSON.stringify(readerJsonSchema), describeReadingContext(reading)].join("\n");

/** The four contexts the pinned file records. */
const polo = readingProduct(1, "Polo básico", [[{ Talla: "S", Color: "Negro" }, 40], [{ Talla: "M", Color: "Negro" }, 40], [{ Talla: "M", Color: "Blanco" }, 42]]);
const gorra = readingProduct(2, "Gorra", [[{}, 15]]);
const casaca = readingProduct(3, "Casaca", [[{ Talla: "S" }, 100], [{ Talla: "M" }, 120]], { sellable: false });
const item = (ref: string, over: Partial<ReadingItem>): ReadingItem => ({ ref, variantId: id(1) as VariantId, productId: productId(3), productName: "Casaca", variantAttributes: { Talla: "M" }, quantity: 1, unitPrice: { amount: 120, currency: "PEN" }, ...over });
const contexts: Readonly<Record<string, ChatReadingContext>> = {
  text_without_order: context({ text: "hola, quiero 2 polos negros", products: [polo, gorra] }),
  text_with_items_and_pendings: context({
    text: "el segundo en M, y quita la casaca", products: [polo, gorra, casaca],
    items: [item("I1", {}), item("I2", { productId: productId(1), productName: "Polo básico", variantAttributes: { Talla: "S", Color: "Negro" }, quantity: 2, unitPrice: { amount: 40, currency: "PEN" } })],
    pendings: [{ ref: "Q1", pending: pending(1, { known: { Color: "Negro" }, quantity: 2 as PositiveInteger }) }, { ref: "Q2", pending: pending(2, { subject: { kind: "product", candidates: [productId(1), productId(2)] } }) }],
  }),
  product_photo: context({ kind: "photo_product", text: "me interesa 3", products: [{ ...polo, shown: true, shownVariantId: polo.variants[1]!.variantId }] }),
  non_product_photo: context({ kind: "photo_not_product", text: "así lo quiero" }),
};

test("pins every model-facing text, the one schema and the request settings of the reader", async () => {
  // Any change of the instructions, the schema, the settings or the context text fails here and is reviewed as a change of what the model reads.
  const pinned = {
    model: "gpt-6-luna", settings: readerRequestSettings, instructions: readerInstructions, jsonSchema: readerJsonSchema,
    contexts: Object.fromEntries(Object.entries(contexts).map(([name, reading]) => [name, describeReadingContext(reading)])),
  };
  await expect(`${JSON.stringify(pinned, null, 2)}\n`).toMatchFileSnapshot("chat-reader.model-text.json");
});

test("keeps the worst-case context with per-combination prices within the token limit derived from the cost bound", () => {
  const maxProducts = 24; // READER_MAX_PRODUCTS, lowered only when this test or the reasoning measurement says so
  const tokens = tokensOf(requestText(worstCaseContext(maxProducts)));
  const costUsd = (tokens * price.input + (answerTokens + measuredReasoningTokens) * price.output) / 1_000_000;
  // The measured size is recorded here; a failing count is fixed by lowering READER_MAX_PRODUCTS (each product is about 480 tokens), never by raising the limit.
  console.info(`reader worst case: ${tokens} estimated input tokens, limit ${inputTokenLimit}, estimated cost US$${costUsd.toFixed(5)}`);
  expect(tokens).toBeLessThanOrEqual(inputTokenLimit);
  expect(costUsd).toBeLessThanOrEqual(costBoundUsd);
});

test("renders the same instructions and schema whatever the context", () => {
  for (const reading of Object.values(contexts)) expect(requestText(reading).startsWith(`${readerInstructions}\n${JSON.stringify(readerJsonSchema)}\n`)).toBe(true);
});
