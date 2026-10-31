import { allCases, selectCases } from "@core/evals/cases";
import { loadPrivateData } from "@core/evals/cases/private";
import { readEvalEnv } from "@core/evals/lib/eval-env";
import { paidGateText } from "@core/evals/lib/paid-gate";

/**
 * `pnpm exec tsx evals/scripts/paid-gate.ts`, called first by `run-evals.sh`: prints the estimate of the selected run and exits 1 unless the run is
 * paid on purpose (`EVAL_PAID=1`) or free (`EVAL_MODELS=fake`). It calls no model.
 */
const env = readEvalEnv({ ...process.env });
const cases = env.EVAL_PRIVATE_DIR ? loadPrivateData(env.EVAL_PRIVATE_DIR).cases : selectCases(allCases, { maxCases: env.EVAL_MAX_CASES, ids: env.EVAL_CASES?.split(",").map((id) => id.trim()),
  skipParaphrases: env.EVAL_SKIP_PARAPHRASES === "1", split: env.EVAL_SPLIT === "all" ? undefined : env.EVAL_SPLIT });
const gate = paidGateText({ cases, runs: env.EVAL_REPEATS, env: process.env });
console.log(gate.text);
process.exit(gate.allowed ? 0 : 1);
