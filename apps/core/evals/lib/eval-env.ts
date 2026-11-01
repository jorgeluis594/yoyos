import { z } from "zod";

/** Run settings read from `apps/core/.env` and the shell (the shell wins). Keys are read here and never printed. */
const evalEnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  CLAUDE_API_KEY: z.string().optional(),
  EVAL_CLAUDE_MODEL: z.string().default("claude-sonnet-5-5"),
  /** Hard cap on cases per run, spread over the passes; unset runs every case. */
  EVAL_MAX_CASES: z.coerce.number().int().positive().optional(),
  /** Comma-separated case ids (base ids also select their paraphrases); unset runs every case. */
  EVAL_CASES: z.string().optional(),
  /** How many times the whole selected set runs (1–5); every run is scored and the report gives mean, min and max per metric. */
  EVAL_REPEATS: z.coerce.number().int().min(1).max(5).default(3),
  /**
   * Absolute path of a folder outside the repository with `catalog.json` and `cases.json` (evals/README.md «Private files format»).
   * When set, only those cases run, against the private company, and every record, judge and classifier output stays in `<dir>/runs/`.
   */
  EVAL_PRIVATE_DIR: z.string().optional(),
  /** Skips the generated paraphrases, for a cheaper run on the base cases only. */
  EVAL_SKIP_PARAPHRASES: z.enum(["0", "1"]).default("0"),
  /** Runs only the dev split (tuning) or the frozen test split (cases/split.ts); `all` runs both. */
  EVAL_SPLIT: z.enum(["dev", "test", "all"]).default("all"),
  /** `fake` scripts every stage answer from the case expectations: no key, no database and no model call. */
  EVAL_MODELS: z.enum(["real", "fake"]).default("real"),
  /**
   * The reader the message suites run: `staged` is the production `applyChatMessage` over the three stages, scored per stage from its reading trace;
   * `legacy` is the single-call reader of before the stages, run read-only (it can no longer apply a message) for the E1 cost and latency baseline.
   * The shadow is off in both. T17 removes `legacy`.
   */
  EVAL_READER: z.enum(["staged", "legacy"]).default("staged"),
  /** Must be `1` for any run that can call a model; `run-evals.sh` prints the estimate and stops without it (lib/paid-gate.ts). */
  EVAL_PAID: z.enum(["0", "1"]).default("0"),
  /** `1` runs the seed bank (cases/seed-bank.ts) instead of every case; with a private folder, the private cases listed in its `seed-bank.json`. */
  EVAL_SEED_BANK: z.enum(["0", "1"]).default("0"),
  /** Output of `verdicts:report` (JSON, lib/verdicts.ts) to embed in the report as seller label counts. */
  EVAL_VERDICTS_FROM: z.string().optional(),
  CI: z.string().optional(),
});

export type EvalEnv = z.output<typeof evalEnvSchema>;

/**
 * `.env` values under the shell's, except `EVAL_PAID`, which only the real shell can set: a paid run is a decision of whoever types the command,
 * never of a file (evals/README.md). A `.env` line for it is dropped here, and a shell value is kept as it is.
 */
export function fileAndShellEnv(fileEnv: Readonly<Record<string, string>>, shellEnv: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  return { ...Object.fromEntries(Object.entries(fileEnv).filter(([name]) => name !== "EVAL_PAID")), ...shellEnv };
}

export function readEvalEnv(env: Readonly<Record<string, string | undefined>> = process.env): EvalEnv {
  return evalEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
}

/** Why the model suites cannot run, or null when they can. Fake mode needs nothing, not even a free CI. */
export function modelSuitesBlocker(env: EvalEnv): string | null {
  if (env.EVAL_MODELS === "fake") return null;
  if (env.CI) return "Model evals skipped: they never run in CI.";
  if (env.EVAL_PAID !== "1") return "Model evals skipped: a run that calls models is paid, set EVAL_PAID=1 (or EVAL_MODELS=fake for the free scripted run).";
  const missing = [env.OPENAI_API_KEY ? null : "OPENAI_API_KEY", env.CLAUDE_API_KEY ? null : "CLAUDE_API_KEY"].filter(Boolean);
  return missing.length ? `Model evals skipped: set ${missing.join(" and ")} in apps/core/.env (see evals/README.md).` : null;
}
