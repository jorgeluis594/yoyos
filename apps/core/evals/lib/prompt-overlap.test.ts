import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { allCases } from "@core/evals/cases";
import { examplesOf, findOverlaps, overlapReason } from "@core/evals/lib/prompt-overlap";

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
  "src/features/orders/application/chat-text-tools.ts",
  "src/features/orders/application/chat-message-tools.ts",
  "src/features/orders/application/apply-chat-message.ts",
  "src/shared/ai-tools/infrastructure/decision-request-text.ts",
  "src/shared/ai-tools/infrastructure/openai-decision-client.ts",
  "src/shared/ai-tools/infrastructure/openai-tool-call-extractor.ts",
  "src/features/products/infrastructure/product-matching/openai-text-chooser.ts",
  "src/features/products/infrastructure/product-matching/openai-product-chooser.ts",
  "src/features/products/infrastructure/product-matching/product-chooser.ts",
];

/** The buyer's words of every eval case, paraphrases included. */
const evalInputs = [...new Set(allCases.flatMap((testCase) => {
  if (testCase.pass === "text") return [testCase.input.mention];
  if (testCase.pass === "image") return [];
  return [testCase.input.text, testCase.input.caption].filter((text): text is string => text !== undefined);
}))];

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

  test("discovers every known prompt file among the production sources", () => {
    expect(sourceFiles).toEqual(expect.arrayContaining(promptFiles));
  });

  test("no production prompt example copies or closely paraphrases an eval input", () => {
    const examples = sourceFiles.flatMap((file) => examplesOf(readFileSync(join(root, file), "utf8"), file));

    expect(examples.length).toBeGreaterThan(20);
    expect(findOverlaps(examples, evalInputs).map(({ example, input, reason }) => `${example.file}:${example.line} «${example.text}» ~ «${input}» (${reason})`)).toEqual([]);
  });
});
