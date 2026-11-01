import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { allCases } from "@core/evals/cases";
import { examplesOf, findOverlaps, normalizeText, overlapReason } from "@core/evals/lib/prompt-overlap";
import { promptRegistry, registeredVersions, type PromptRegistry } from "@core/src/features/orders/infrastructure/reader/runtime/prompt-registry";

const root = resolve(import.meta.dirname, "../..");

/**
 * Every production source file under src/, so a new tool, chooser or context text is checked without being listed by hand. Test files
 * and fakes are left out: they never reach a model and may quote eval inputs on purpose.
 */
const sourceFiles = readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" })
  .filter((file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$|(^|\/)test-|fixtures?\.ts$|contract\.ts$/.test(file))
  .map((file) => relative(root, join(root, "src", file)));

/** Files known to hold the text that reaches a model; the discovery above must include them. */
const promptFiles = [
  "src/features/orders/infrastructure/chat-reader-text.ts",
  "src/features/orders/infrastructure/chat-reader-context-text.ts",
  "src/features/orders/infrastructure/chat-reader-schema.ts",
  "src/features/orders/infrastructure/openai-chat-reader.ts",
  "src/features/products/infrastructure/product-matching/openai-product-chooser.ts",
  "src/features/products/infrastructure/product-matching/product-chooser.ts",
  "src/features/orders/infrastructure/reader/runtime/prompt-registry.ts",
  "src/features/orders/infrastructure/reader/stages/intent/versions.ts",
  "src/features/orders/infrastructure/reader/stages/extraction/versions.ts",
  "src/features/orders/infrastructure/reader/stages/resolution/versions.ts",
];

/** The buyer's words of every eval case, paraphrases and the messages of conversations included. */
const evalInputs = [...new Set(allCases.flatMap((testCase) => {
  if (testCase.pass === "image") return [];
  const inputs = testCase.pass === "conversation" ? testCase.steps.flatMap((step) => "input" in step ? [step.input] : []) : [testCase.input];
  return inputs.flatMap((input) => [input.text, input.caption]).filter((text): text is string => text !== undefined);
}))];

/** Every string in a JSON schema (descriptions, enum labels), which reaches the model as well. */
const stringsOf = (value: unknown): string[] => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(stringsOf) : [];

/** The instructions and the schema text of every registered stage version, as the string literals the model receives. */
const registeredExamples = (registry: PromptRegistry) => registeredVersions(registry).flatMap(({ stage, version, registered }) =>
  [registered.instructions, ...stringsOf(registered.jsonSchema)].flatMap((text) => examplesOf(`const text = ${JSON.stringify(text)};`, `${stage}/${version}`)));

describe("prompt overlap check", () => {
  test("finds quotes and parenthesised examples in string literals, not in comments", () => {
    const source = "// «quita la mochila»\nconst a = \"Remove it («saca el short», «bórralo»).\";\nconst b = `Unnamed (eso, ya no va) ${1}`;";

    expect(examplesOf(source, "x.ts").map(({ text }) => text)).toEqual(["saca el short", "bórralo", "eso", "ya no va"]);
  });

  test("flags copies, containment, shared three-word runs and near copies with another number, not shared rule templates", () => {
    expect(overlapReason("Quítalo", "quitalo")).toBe("same words");
    expect(overlapReason("saca la mochila", "porfa saca la mochila ya")).toBe("example inside the input");
    expect(overlapReason("me la guardas hasta el lunes", "si queda me la guardas hasta mañana")).toBe("shares «la guardas hasta»");
    expect(overlapReason("pásame 3 de esos", "pásame 2 de esos porfa")).toBe("example inside the input");
    expect(overlapReason("mandame tres de esas", "mándame 2 de esos")).toMatch(/similarity/);
    expect(overlapReason("a 45 soles", "2 polos a 20 soles")).toBeNull();
    expect(overlapReason("en XS", "en XL")).toBeNull();
    expect(overlapReason("déjalo en dos", "quiero 2 polos negros")).toBeNull();
    expect(overlapReason("eso", "listo, eso es todo")).toBeNull();
  });

  test("flags a short phrase inside an eval input for the staged reader, never a single word", () => {
    expect(overlapReason("déjalo en 4", "de los polos premium déjalo en 4 nomás")).toBeNull();
    expect(overlapReason("déjalo en 4", "de los polos premium déjalo en 4 nomás", { shortInside: true })).toBe("example inside the input");
    expect(overlapReason("lo quiero", "lo quiero en blanco", { shortInside: true })).toBe("example inside the input");
    expect(overlapReason("talla", "prefiero talla M", { shortInside: true })).toBeNull();
    expect(overlapReason("ponme 4 en total", "de los polos premium déjalo en 4 nomás", { shortInside: true })).toBeNull();
  });

  test("discovers every known prompt file among the production sources", () => {
    expect(sourceFiles).toEqual(expect.arrayContaining(promptFiles));
  });

  test("finds no production prompt quoting a conversation case", () => {
    const examples = sourceFiles.flatMap((file) => examplesOf(readFileSync(join(root, file), "utf8"), file));

    expect(examples.length).toBeGreaterThan(20);
    expect(findOverlaps(examples, evalInputs).map(({ example, input, reason }) => `${example.file}:${example.line} «${example.text}» ~ «${input}» (${reason})`)).toEqual([]);
  }, 30_000);

  test("never copies an eval input into a stage prompt", () => {
    expect(findOverlaps(registeredExamples(promptRegistry), evalInputs, { shortInside: true }).map(({ example, input, reason }) => `${example.file} «${example.text}» ~ «${input}» (${reason})`)).toEqual([]);
  });

  // A single word is never a copy for the guard, yet it can be the operative word of an eval case. Any new word shows up here for review;
  // generic attribute words («talla», «color», «cambia») are acceptable, a word that decides a case is not.
  test("lists the single-word examples of registered versions found in eval inputs, for review", () => {
    const wordsIn = (text: string) => normalizeText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const inputWords = new Set(evalInputs.flatMap(wordsIn));
    const singleWords = registeredExamples(promptRegistry).flatMap((example) => wordsIn(example.text).length === 1 ? wordsIn(example.text) : []);

    expect([...new Set(singleWords.filter((word) => inputWords.has(word)))].sort()).toEqual(["agregame", "cambia", "color", "confirmo", "m", "q", "talla"]);
  });

  test("flags an eval input copied into a registered version's instructions, whichever file the version lives in", () => {
    const [copied] = evalInputs;
    const registry = { intent: { "intent-v1": { stage: "intent", version: "intent-v1", instructions: `Rules (${copied})` } }, extraction: {}, resolution: {} } as unknown as PromptRegistry;

    expect(findOverlaps(registeredExamples(registry), evalInputs)).not.toEqual([]);
  });
});
