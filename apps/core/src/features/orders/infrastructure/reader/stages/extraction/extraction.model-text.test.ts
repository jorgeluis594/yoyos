import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { describe, expect, test } from "vitest";
import type { ProductId } from "@core/src/features/products/domain/product";
import { createFakeStructuredModel } from "@core/src/features/orders/infrastructure/reader/runtime/fake-structured-model";
import { modelTextOf, pinnedModelTextPath } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";
import { createStageAdapter } from "@core/src/features/orders/infrastructure/reader/runtime/stage-adapter";
import { answerEntry, contextMessage, extractionInput, intent, item, pending, readingInput } from "@core/src/features/orders/infrastructure/reader/stages/extraction/extraction-test-support";
import { extractionVersions } from "@core/src/features/orders/infrastructure/reader/stages/extraction/versions";

/** No tokenizer is published for gpt-6-luna; o200k_base is the closest encoding gpt-tokenizer lists. */
const tokenizer = "o200k_base (gpt-tokenizer, as for gpt-5.6-luna; no tokenizer is published for gpt-6-luna)";
const tokensOf = (text: string) => encode(text).length;
/** The provider caches a prefix of at least this many tokens. */
const cacheablePrefixTokens = 1024;

const intents = [intent(1, "add", "quiero dos")];
/** The domain limits at their full size, in a Latin and in a worst-case script (about 2 tokens per character). */
const fullInput = (character: string) => extractionInput(readingInput({
  current: { messageId: "current" as never, kind: "text", text: character.repeat(2000) },
  context: Array.from({ length: 12 }, (_, index) => contextMessage(index + 1, { text: character.repeat(500) })),
  items: Array.from({ length: 40 }, (_, index) => item(index + 1, { productName: character.repeat(200),
    variantAttributes: { [character.repeat(30)]: character.repeat(30), [`${character.repeat(29)}b`]: character.repeat(30), [`${character.repeat(29)}c`]: character.repeat(30) } })),
  pendings: Array.from({ length: 10 }, (_, index) => pending(index + 1, { productIds: ["a", "b", "c", "d"] as ProductId[], known: { Talla: "M" }, doubtful: true })),
}), intents);
const usual = extractionInput(readingInput({
  current: { messageId: "current" as never, kind: "text", text: "me llevo dos de esos en azul" },
  context: [contextMessage(1, { direction: "outgoing", text: "Tenemos el polo básico en varios colores." })], items: [item(1)],
}), intents);

describe.each(["extraction-v1", "extraction_confirm-v1"])("%s", (key) => {
  const version = extractionVersions[key]!;
  const sizeOf = (input: typeof usual) => { const rendered = version.renderInput(input); return { characters: rendered.length, tokens: tokensOf(rendered) }; };

  test("pins the instructions, schema, settings and reference input sizes", async () => {
    const size = { tokenizer, instructionsTokens: tokensOf(version.instructions), usual: sizeOf(usual), fullLatin: sizeOf(fullInput("a")), fullWorstScript: sizeOf(fullInput("語")) };
    await expect(`${JSON.stringify({ ...modelTextOf(version), size }, null, 2)}\n`).toMatchFileSnapshot(pinnedModelTextPath(key));
  });

  test("keeps the instructions past the provider's cacheable prefix, so every message after the first reads them from cache", () => {
    expect(tokensOf(version.instructions)).toBeGreaterThanOrEqual(cacheablePrefixTokens);
  });

  test("keeps a full input at the budget under the 48k-token window in the worst script", () => {
    expect(sizeOf(fullInput("語")).characters).toBeLessThanOrEqual(24_000);
    expect(sizeOf(fullInput("語")).tokens).toBeLessThanOrEqual(48_000);
  });

  test("reads the fake model's scripted answer into extracted requests through the stage adapter", async () => {
    const fake = createFakeStructuredModel({ extraction: [{ json: { requests: [answerEntry("R1", { quantity: { value: 2, mode: "add", quote: { message: "current", text: "dos" } } })] } }] }, "test");
    const run = createStageAdapter({ config: { stage: "extraction", reading: key === "extraction-v1" ? "primary" : "confirming", provider: "fake", model: "fake", promptVersion: key as never, timeoutMs: 10_000 }, version, model: fake });

    const result = await run(usual, new AbortController().signal);

    expect(result).toMatchObject({ success: true, data: { value: [{ request: "R1", kind: "add", quantity: { value: 2, mode: "add" } }], call: { promptVersion: key, attempts: 1 } } });
    expect(fake.requests[0]).toMatchObject({ stage: "extraction", instructions: version.instructions, schemaName: "extraction_answer" });
    expect(fake.requests[0]?.input).toContain("R1 (add): «quiero dos»");
  });
});

test("says the same rules with different words in the two versions, over one schema", () => {
  const [primary, confirming] = [extractionVersions["extraction-v1"]!, extractionVersions["extraction_confirm-v1"]!];

  expect(confirming.instructions).not.toBe(primary.instructions);
  expect(confirming.jsonSchema).toBe(primary.jsonSchema);
  expect(confirming.reasoningEffort).toBe(primary.reasoningEffort);
});
