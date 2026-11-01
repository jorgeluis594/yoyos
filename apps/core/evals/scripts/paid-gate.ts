import { readEvalEnv } from "@core/evals/lib/eval-env";
import { readVerdictFile } from "@core/evals/lib/verdicts";
import { paidGateText } from "@core/evals/lib/paid-gate";
import { selectionOf } from "@core/evals/lib/run-selection";

/**
 * `pnpm exec tsx evals/scripts/paid-gate.ts`, called first by `run-evals.sh`: prints the estimate of the selected run and exits 1 unless the run is
 * paid on purpose (`EVAL_PAID=1`) or free (`EVAL_MODELS=fake`). It calls no model.
 */
const env = readEvalEnv({ ...process.env });
// A bad verdicts file fails here, before any paid call, not after the run.
if (env.EVAL_VERDICTS_FROM) readVerdictFile(env.EVAL_VERDICTS_FROM);
const { cases } = selectionOf(env);
const gate = paidGateText({ cases, runs: env.EVAL_REPEATS, env: process.env });
console.log(gate.text);
process.exit(gate.allowed ? 0 : 1);
