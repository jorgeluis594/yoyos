import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { expect, test } from "vitest";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ReadingInput } from "@core/src/features/orders/domain/reader/readings";
import { modelTextOf } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { contextMessage, item, pending, readingInput } from "@core/src/features/orders/infrastructure/reader/stages/intent/intent-test-support";
import { promptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";

const version = promptRegistry.intent["intent-v1"]!;
/** No tokenizer is published for gpt-6-luna; o200k_base is the closest encoding gpt-tokenizer lists. */
const tokenizer = "o200k_base (gpt-tokenizer, as for gpt-5.6-luna; no tokenizer is published for gpt-6-luna)";
const tokensOf = (text: string) => encode(text).length;
/** The provider caches a prefix of at least this many tokens. */
const cacheablePrefixTokens = 1024;

/** The domain limits at their full size, in a Latin and in a worst-case script (about 2 tokens per character). */
const fullInput = (character: string): ReadingInput => readingInput({
  current: { messageId: "current" as never, kind: "text", text: character.repeat(2000) },
  context: Array.from({ length: 12 }, (_, index) => contextMessage(index + 1, { text: character.repeat(500) })),
  items: Array.from({ length: 40 }, (_, index) => item(index + 1, { productName: character.repeat(200),
    variantAttributes: { [character.repeat(30)]: character.repeat(30), [`${character.repeat(29)}b`]: character.repeat(30), [`${character.repeat(29)}c`]: character.repeat(30) } })),
  pendings: Array.from({ length: 10 }, (_, index) => pending(index + 1, { productIds: ["a", "b", "c", "d"] as ProductId[], known: { Talla: "M" }, doubtful: true })),
});
const usual = readingInput({
  current: { messageId: "current" as never, kind: "text", text: "listo, eso es todo" },
  context: [contextMessage(1, { direction: "outgoing", text: "Tu pedido: 2 polos básicos en M. ¿Algo más?" }), contextMessage(2, { text: "no" })],
  items: [item(1, { productName: "Polo básico", variantAttributes: { Talla: "M" } })],
});

const sizeOf = (input: ReadingInput) => { const rendered = version.renderInput(input); return { characters: rendered.length, tokens: tokensOf(rendered) }; };

test("pins the intent instructions, schema, settings and reference input sizes of intent-v1", async () => {
  const size = { tokenizer, instructionsTokens: tokensOf(version.instructions), usual: sizeOf(usual), fullLatin: sizeOf(fullInput("a")), fullWorstScript: sizeOf(fullInput("語")) };
  await expect(`${JSON.stringify({ ...modelTextOf(version), size }, null, 2)}\n`).toMatchFileSnapshot("intent.v1.model-text.json");
});

test("keeps the instructions past the provider's cacheable prefix, so every message after the first reads them from cache", () => {
  expect(tokensOf(version.instructions)).toBeGreaterThanOrEqual(cacheablePrefixTokens);
});

test("keeps a full input at the budget under the 48k-token window in the worst script", () => {
  expect(sizeOf(fullInput("語")).characters).toBeLessThanOrEqual(24_000);
  expect(sizeOf(fullInput("語")).tokens).toBeLessThanOrEqual(48_000);
});
