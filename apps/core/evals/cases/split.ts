import { createHash } from "node:crypto";

/**
 * Dev and frozen test splits of the eval cases: prompts are tuned on `dev` only, and `test` is read once, after tuning. A case's
 * split is a stable hash of its base id, so adding or removing a case never moves another one, and a paraphrase follows its base.
 */

export const splits = ["dev", "test"] as const;
export type EvalSplit = (typeof splits)[number];

/** Share of base ids in the frozen test split, in percent. */
export const testSharePercent = 30;

export function splitOf(baseId: string): EvalSplit {
  const bucket = createHash("sha256").update(baseId).digest().readUInt32BE(0) % 100;
  return bucket < testSharePercent ? "test" : "dev";
}

/** The split of a case or of the base case it paraphrases. */
export const splitOfCase = (testCase: Readonly<{ id: string; paraphraseOf?: string }>): EvalSplit => splitOf(testCase.paraphraseOf ?? testCase.id);
