import { isMessageStep, needsJudge, type EvalCase } from "@core/evals/cases/schema";

/**
 * The gate of every run that can call a model. Without `EVAL_PAID=1` the run prints this estimate and stops; `EVAL_MODELS=fake` is free and passes.
 * Each paid step (E1, E2, E3, H) needs the founder's approval of the estimate printed here.
 */

/** Reference cost of one text message through the three stages (technical design 6.9, before caching). */
export const referenceCostPerMessageUsd = 0.0012;
/** Reference cost of one Claude judge call (about 2k tokens in and 300 out at the Sonnet price in lib/model-meter.ts). */
export const judgeReferenceCostUsd = 0.009;

export type RunEstimate = Readonly<{ messages: number; judged: number; runs: number; systemUsd: number; judgeUsd: number; totalUsd: number }>;

const messagesOf = (testCase: EvalCase): number => testCase.pass === "conversation" ? testCase.steps.filter(isMessageStep).length : 1;

export function estimateRun({ cases, runs }: Readonly<{ cases: readonly EvalCase[]; runs: number }>): RunEstimate {
  const messages = cases.reduce((total, testCase) => total + messagesOf(testCase), 0);
  const judged = cases.filter(needsJudge).length;
  const systemUsd = messages * runs * referenceCostPerMessageUsd;
  const judgeUsd = judged * runs * judgeReferenceCostUsd;
  return { messages, judged, runs, systemUsd, judgeUsd, totalUsd: systemUsd + judgeUsd };
}

export type PaidGate = Readonly<{ allowed: boolean; text: string }>;

export function paidGateText({ cases, runs, env }: Readonly<{ cases: readonly EvalCase[]; runs: number; env: Readonly<Record<string, string | undefined>> }>): PaidGate {
  if (env.EVAL_MODELS === "fake") return { allowed: true, text: "Fake mode: scripted stage answers, no model call, no cost." };
  const estimate = estimateRun({ cases, runs });
  const text = [
    `Estimate: ${estimate.messages} messages × ${estimate.runs} runs × $${referenceCostPerMessageUsd} = $${estimate.systemUsd.toFixed(2)} for the system`,
    `plus ${estimate.judged} judged cases × ${estimate.runs} runs × $${judgeReferenceCostUsd} = $${estimate.judgeUsd.toFixed(2)} for the judge`,
    `Total ≈ $${estimate.totalUsd.toFixed(2)}`,
  ].join("\n");
  return env.EVAL_PAID === "1" ? { allowed: true, text } : { allowed: false, text: `${text}\nNo model was called. A paid run needs the founder's approval of this estimate, then EVAL_PAID=1 (or EVAL_MODELS=fake for a free run).` };
}
