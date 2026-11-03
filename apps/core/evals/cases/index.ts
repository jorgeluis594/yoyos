import { parseCases, passes, type EvalCase, type EvalCaseInput, type EvalPass } from "@core/evals/cases/schema";
import { interpretationCases } from "@core/evals/cases/interpretation";
import { holdoutV1Cases } from "@core/evals/cases/holdout-v1";
import { endToEndCaseIds, endToEndCasesFrom } from "@core/evals/cases/end-to-end";
import { imageCasesFrom } from "@core/evals/cases/identification";
import { conversationCases } from "@core/evals/cases/conversations";
import { withStageLabels } from "@core/evals/cases/stage-labels";
import { withPinnedMisses } from "@core/evals/cases/pinned-misses";
import { paraphrases } from "@core/evals/cases/paraphrases";
import { splitOfCase, type EvalSplit } from "@core/evals/cases/split";
import { readPhotoManifest, type ImageManifest } from "@core/evals/fixtures/image-manifest";

/** Every base case; the photo cases come from the photo manifest, and without one only the photo-free cases remain. */
export const baseCasesOf = (manifest: ImageManifest | null): readonly EvalCaseInput[] =>
  [...interpretationCases, ...holdoutV1Cases, ...imageCasesFrom(manifest), ...endToEndCasesFrom(manifest), ...conversationCases];

export const imageManifest = readPhotoManifest(process.env);
export const baseCases = baseCasesOf(imageManifest);

/** A paraphrase is its base case with the buyer's words replaced; it keeps the expectations and is tagged `paraphrase`. */
export function withParaphrases(cases: readonly EvalCaseInput[], rewrites: readonly Readonly<{ of: string; text: string }>[]): readonly EvalCaseInput[] {
  const counters = new Map<string, number>();
  const generated = rewrites.map((rewrite): EvalCaseInput => {
    const base = cases.find(({ id }) => id === rewrite.of);
    if (!base || (base.pass !== "interpretation" && base.pass !== "end_to_end")) throw new Error(`Paraphrase of unknown message case ${rewrite.of}`);
    const index = (counters.get(rewrite.of) ?? 0) + 1;
    counters.set(rewrite.of, index);
    const input = base.input.text !== undefined ? { ...base.input, text: rewrite.text } : { ...base.input, caption: rewrite.text };
    // Paraphrases are not repeated: consistency is measured on the base wording.
    const tags = [...(base.tags ?? []).filter((tag) => tag !== "consistency"), "paraphrase"];
    return { ...base, id: `${base.id}~p${index}`, input, tags, paraphraseOf: base.id };
  });
  return [...cases, ...generated];
}

/** Paraphrases of an end-to-end case whose photo the manifest lacks are dropped with it; any other unknown base id still throws. */
export function casesOf(manifest: ImageManifest | null): readonly EvalCase[] {
  const cases = baseCasesOf(manifest);
  const dropped = new Set(endToEndCaseIds().filter((id) => !cases.some((testCase) => testCase.id === id)));
  return parseCases(withPinnedMisses(withParaphrases(withStageLabels(cases), paraphrases.filter((rewrite) => !dropped.has(rewrite.of)))));
}

export const allCases: readonly EvalCase[] = casesOf(imageManifest);

export type Selection = Readonly<{ maxCases?: number; ids?: readonly string[]; skipParaphrases?: boolean; split?: EvalSplit }>;

/**
 * The cases of this run. Ids select a case and its paraphrases; a split keeps only its cases (cases/split.ts). The cap takes cases
 * round-robin over the passes, in table order, so a small debug run still touches every pass.
 */
export function selectCases(cases: readonly EvalCase[], selection: Selection): readonly EvalCase[] {
  const wanted = cases.filter((testCase) => (!selection.ids?.length || selection.ids.includes(testCase.id) || selection.ids.includes(testCase.paraphraseOf ?? ""))
    && !(selection.skipParaphrases && testCase.paraphraseOf) && (!selection.split || splitOfCase(testCase) === selection.split));
  if (selection.maxCases === undefined || wanted.length <= selection.maxCases) return wanted;
  const queues = passes.map((pass) => wanted.filter((testCase) => testCase.pass === pass));
  const picked: EvalCase[] = [];
  for (let round = 0; picked.length < selection.maxCases; round += 1) {
    for (const queue of queues) if (queue[round] && picked.length < selection.maxCases) picked.push(queue[round]!);
  }
  return cases.filter((testCase) => picked.includes(testCase));
}

export const casesOfPass = <Pass extends EvalPass>(cases: readonly EvalCase[], pass: Pass) =>
  cases.filter((testCase): testCase is Extract<EvalCase, { pass: Pass }> => testCase.pass === pass);
