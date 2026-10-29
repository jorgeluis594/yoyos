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
  /** How many times each repeated case runs; 1 turns the repeats off. */
  EVAL_REPEATS: z.coerce.number().int().min(1).max(5).default(3),
  /** Comma-separated tags: the cases with any of them run `EVAL_REPEATS` times (the first repetition is the one scored). */
  EVAL_REPEAT_TAGS: z.string().default("consistency").transform((tags) => tags.split(",").map((tag) => tag.trim()).filter(Boolean)),
  /**
   * Absolute path of a folder outside the repository with `catalog.json` and `cases.json` (evals/README.md «Private files format»).
   * When set, only those cases run, against the private company, and every record, judge and classifier output stays in `<dir>/runs/`.
   */
  EVAL_PRIVATE_DIR: z.string().optional(),
  /** Skips the generated paraphrases, for a cheaper run on the base cases only. */
  EVAL_SKIP_PARAPHRASES: z.enum(["0", "1"]).default("0"),
  /** Runs only the dev split (tuning) or the frozen test split (cases/split.ts); `all` runs both. */
  EVAL_SPLIT: z.enum(["dev", "test", "all"]).default("all"),
  CI: z.string().optional(),
});

export type EvalEnv = z.output<typeof evalEnvSchema>;

export function readEvalEnv(env: Readonly<Record<string, string | undefined>> = process.env): EvalEnv {
  return evalEnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
}

/** Why the model suites cannot run, or null when they can. */
export function modelSuitesBlocker(env: EvalEnv): string | null {
  if (env.CI) return "Model evals skipped: they never run in CI.";
  const missing = [env.OPENAI_API_KEY ? null : "OPENAI_API_KEY", env.CLAUDE_API_KEY ? null : "CLAUDE_API_KEY"].filter(Boolean);
  return missing.length ? `Model evals skipped: set ${missing.join(" and ")} in apps/core/.env (see evals/README.md).` : null;
}
