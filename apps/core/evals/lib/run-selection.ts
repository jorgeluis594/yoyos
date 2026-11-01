import { allCases, selectCases } from "@core/evals/cases";
import { loadPrivateData, type PrivateData } from "@core/evals/cases/private";
import { privateSeedIds, resolveSeedBank } from "@core/evals/cases/seed-bank";
import type { EvalCase } from "@core/evals/cases/schema";
import type { EvalEnv } from "@core/evals/lib/eval-env";

/** The cases a run covers, shared by the suites and the paid gate so the estimate counts what will run. */
export type RunSelection = Readonly<{ cases: readonly EvalCase[]; privateData: PrivateData | null }>;

/**
 * What the legacy baseline can read: the single-call reader cannot apply a message, so it reads the text messages of the message passes apart. Conversations
 * (state carried from message to message) and photo messages are left out; the image pass does not use the reader and stays. The staged reader runs everything.
 */
export function readerCasesOf(cases: readonly EvalCase[], reader: EvalEnv["EVAL_READER"]): readonly EvalCase[] {
  if (reader === "staged") return cases;
  return cases.filter((testCase) => testCase.pass === "image" || (testCase.pass !== "conversation" && testCase.input.text !== undefined));
}

export function selectionOf(env: Pick<EvalEnv, "EVAL_PRIVATE_DIR" | "EVAL_SEED_BANK" | "EVAL_MAX_CASES" | "EVAL_CASES" | "EVAL_SKIP_PARAPHRASES" | "EVAL_SPLIT" | "EVAL_READER">): RunSelection {
  const selected = selectionBeforeReader(env);
  return { ...selected, cases: readerCasesOf(selected.cases, env.EVAL_READER) };
}

function selectionBeforeReader(env: Pick<EvalEnv, "EVAL_PRIVATE_DIR" | "EVAL_SEED_BANK" | "EVAL_MAX_CASES" | "EVAL_CASES" | "EVAL_SKIP_PARAPHRASES" | "EVAL_SPLIT">): RunSelection {
  const privateData = env.EVAL_PRIVATE_DIR !== undefined ? loadPrivateData(env.EVAL_PRIVATE_DIR) : null;
  if (privateData) {
    if (env.EVAL_SEED_BANK !== "1") return { cases: privateData.cases, privateData };
    const ids = new Set(privateSeedIds(privateData.dir));
    return { cases: privateData.cases.filter(({ id }) => ids.has(id)), privateData };
  }
  if (env.EVAL_SEED_BANK === "1") {
    const { cases, missing } = resolveSeedBank(allCases, [], []);
    if (missing.length) throw new Error(`The seed bank names cases that do not exist: ${missing.join(", ")}`);
    return { cases, privateData };
  }
  return { cases: selectCases(allCases, { maxCases: env.EVAL_MAX_CASES, ids: env.EVAL_CASES?.split(",").map((id) => id.trim()), skipParaphrases: env.EVAL_SKIP_PARAPHRASES === "1",
    split: env.EVAL_SPLIT === "all" ? undefined : env.EVAL_SPLIT }), privateData };
}
