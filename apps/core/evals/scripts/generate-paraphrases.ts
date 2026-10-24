import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import { baseCases } from "@core/evals/cases";
import { createClaude } from "@core/evals/lib/claude";
import { readEvalEnv } from "@core/evals/lib/eval-env";
import { installModelMeter, metered } from "@core/evals/lib/model-meter";

/**
 * Offline, run once by hand: asks Claude for paraphrases of every message case's buyer words and writes evals/cases/paraphrases.ts.
 * The output is reviewed and committed; evals never regenerate it. Run from apps/core: `pnpm exec tsx evals/scripts/generate-paraphrases.ts`.
 */

const perCase = 2;
const batchSize = 20;

const env = readEvalEnv({ ...loadEnv("evals", process.cwd(), ""), ...process.env });
if (!env.CLAUDE_API_KEY) throw new Error("Set CLAUDE_API_KEY in apps/core/.env");
installModelMeter();
const claude = createClaude({ apiKey: env.CLAUDE_API_KEY, model: env.EVAL_CLAUDE_MODEL });

const sources = baseCases.flatMap((testCase) => {
  if (testCase.pass !== "interpretation" && testCase.pass !== "end_to_end") return [];
  const words = testCase.input.text ?? testCase.input.caption;
  // Prompt injections stay as written: a rewrite could soften the attack.
  return words && !(testCase.tags ?? []).includes("injection") ? [{ id: testCase.id, message: words, photo: testCase.input.photo !== undefined }] : [];
});

const rewrites: { of: string; text: string }[] = [];
let calls = 0;
for (let start = 0; start < sources.length; start += batchSize) {
  const batch = sources.slice(start, start + batchSize);
  const prompt = JSON.stringify({ paraphrasesPerCase: perCase, cases: batch.map(({ id, message, photo }) => ({ id, message, ...(photo ? { context: "caption of a photo the buyer sent" } : {}) })) }, null, 1);
  const { value, calls: made } = await metered("generator", () => claude.paraphrase(prompt));
  calls += made.length;
  for (const source of batch) {
    const written = value.cases.find(({ id }) => id === source.id)?.paraphrases ?? [];
    for (const text of written.slice(0, perCase)) if (text.trim() && text.trim() !== source.message) rewrites.push({ of: source.id, text: text.trim() });
  }
}

const body = rewrites.map(({ of, text }) => `  { of: ${JSON.stringify(of)}, text: ${JSON.stringify(text)} },`).join("\n");
await writeFile(resolve(import.meta.dirname, "../cases/paraphrases.ts"), `// Generated once by evals/scripts/generate-paraphrases.ts with ${env.EVAL_CLAUDE_MODEL}, then reviewed by hand. Do not regenerate at eval time.
export const paraphrases: readonly Readonly<{ of: string; text: string }>[] = [
${body}
];
`);
console.log(`${rewrites.length} paraphrases of ${sources.length} cases written with ${calls} Claude calls.`);
