import { isMessageStep, needsJudge, type EvalCase } from "@core/evals/cases/schema";

/**
 * The gate of every run that can call a model. Without `EVAL_PAID=1` the run prints this estimate and stops; `EVAL_MODELS=fake` is free and passes.
 * Each paid step (E1, E2, E3, H) needs the founder's approval of the estimate printed here.
 */

/** Reference cost of one text message through the three stages (technical design 6.9, before caching). */
export const referenceCostPerMessageUsd = 0.0012;
/** Reference cost of one Claude judge call (about 2k tokens in and 300 out at the Sonnet price in lib/model-meter.ts). */
export const judgeReferenceCostUsd = 0.009;
/** Extra cost of a photo message: the cascade (QR, then visual identification with its chooser) beside the stages (technical design 6.9). */
export const photoReferenceCostUsd = 0.001;
/** Ceiling of the one error-classifier call at the end of a run: 150 failures (global-setup `maxClassifiedFailures`), about 15k tokens in and 2k out at the Sonnet price. */
export const classifierReferenceCostUsd = 0.1;

export type RunEstimate = Readonly<{ messages: number; photos: number; judged: number; runs: number; systemUsd: number; judgeUsd: number; classifierUsd: number; totalUsd: number }>;

const messagesOf = (testCase: EvalCase): number => testCase.pass === "conversation" ? testCase.steps.filter(isMessageStep).length : 1;

const photosOf = (testCase: EvalCase): number => testCase.pass === "image" ? 1
  : testCase.pass === "conversation" ? testCase.steps.filter((step) => isMessageStep(step) && step.input.photo !== undefined).length : Number(testCase.input.photo !== undefined);

export function estimateRun({ cases, runs }: Readonly<{ cases: readonly EvalCase[]; runs: number }>): RunEstimate {
  const messages = cases.reduce((total, testCase) => total + messagesOf(testCase), 0);
  const photos = cases.reduce((total, testCase) => total + photosOf(testCase), 0);
  const judged = cases.filter(needsJudge).length;
  const systemUsd = (messages * referenceCostPerMessageUsd + photos * photoReferenceCostUsd) * runs;
  const judgeUsd = judged * runs * judgeReferenceCostUsd;
  const classifierUsd = cases.length ? classifierReferenceCostUsd : 0;
  return { messages, photos, judged, runs, systemUsd, judgeUsd, classifierUsd, totalUsd: systemUsd + judgeUsd + classifierUsd };
}

export type PaidGate = Readonly<{ allowed: boolean; text: string }>;

export function paidGateText({ cases, runs, env }: Readonly<{ cases: readonly EvalCase[]; runs: number; env: Readonly<Record<string, string | undefined>> }>): PaidGate {
  if (env.EVAL_MODELS === "fake") return { allowed: true, text: "Fake mode: scripted stage answers, no model call, no cost." };
  const estimate = estimateRun({ cases, runs });
  const text = [
    `Estimate: ${estimate.messages} messages × ${estimate.runs} runs × $${referenceCostPerMessageUsd}, plus ${estimate.photos} photo messages × ${estimate.runs} runs × $${photoReferenceCostUsd} for the photo cascade = $${estimate.systemUsd.toFixed(2)} for the system`,
    `plus ${estimate.judged} judged cases × ${estimate.runs} runs × $${judgeReferenceCostUsd} = $${estimate.judgeUsd.toFixed(2)} for the judge`,
    `plus up to $${estimate.classifierUsd.toFixed(2)} for the error classifier (once per run)`,
    `Total ≈ $${estimate.totalUsd.toFixed(2)}`,
  ].join("\n");
  return env.EVAL_PAID === "1" ? { allowed: true, text } : { allowed: false, text: `${text}\nNo model was called. A paid run needs the founder's approval of this estimate, then EVAL_PAID=1 (or EVAL_MODELS=fake for a free run).` };
}
