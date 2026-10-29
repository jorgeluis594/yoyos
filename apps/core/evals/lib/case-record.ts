import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EvalPass } from "@core/evals/cases/schema";
import type { JudgeVerdict } from "@core/evals/lib/claude";
import type { ModelCall } from "@core/evals/lib/model-meter";
import type { FieldScores } from "@core/evals/lib/scorers";
import { privateDirOf } from "@core/evals/cases/private";

/** What one run of one case (or one message of a conversation) left: scores, the actual result, latency and model calls. Plain JSON. */
export type CaseRecord = Readonly<{
  /** A conversation's record is one message: `<conversation id>#<message number>`. */
  caseId: string;
  /** The base case a paraphrase rewrites, or the conversation id. */
  baseId: string;
  pass: EvalPass;
  /** 0 for conversations, which have none. */
  criterion: number;
  kind: string;
  tags: readonly string[];
  /** 0 for the scored run; repeated cases add 1, 2… */
  repeat: number;
  passed: boolean;
  exactPassed: boolean;
  fields: FieldScores;
  expectationIndex: number;
  judge: JudgeVerdict | null;
  /** What the message was, for the reader calls the design allows it (technical design §8); null outside message passes. */
  messageKind: "text" | "photo" | "photo_caption" | null;
  conversationId: string | null;
  /** The message number inside its conversation, from 1. */
  step: number | null;
  /** How the message misled the seller (lib/scorers.ts `MessageScored`); all neutral outside message passes. */
  ignoredActions: number;
  wrongSilentChange: boolean;
  extraNotice: boolean;
  expectedSilent: boolean;
  /** The products the message's notice names; a conversation checks that no product is named by two notices. */
  noticeProducts: readonly string[];
  expectsRepeatNotice: boolean;
  /** The chat's order before the message, so a rebuild can rescore. */
  previousOrder: readonly Readonly<{ product: string; variant: Readonly<Record<string, string>>; quantity: number }>[];
  input: string;
  expected: unknown;
  actual: unknown;
  /** Compact form of the actual result: two runs with different signatures flipped. */
  signature: string;
  /** Visual-search certainties with the production gate each one meets or misses (lib/production.ts `Certainty`). */
  certainties: readonly Readonly<{ source: string; confidence: number; gate: number; pick?: string | null; detail?: string }>[];
  /** The scored model step alone: no chat creation, order seeding or earlier retried attempts. */
  latencyMs: number;
  /** Retried attempts before the scored one (retryable failures, as the queue would retry). */
  retries: number;
  calls: readonly ModelCall[];
  error: string | null;
}>;

/** Where a run leaves its files: `eval-results/`, or `<EVAL_PRIVATE_DIR>/runs/` in a private run. */
export const resultsDirOf = (env: Readonly<Record<string, string | undefined>> = process.env): string =>
  env.EVAL_PRIVATE_DIR ? join(privateDirOf(env.EVAL_PRIVATE_DIR), "runs") : resultsDir;
export const resultsDir = resolve(import.meta.dirname, "../../eval-results");
export const runDir = (runId: string, root: string = resultsDirOf()) => join(root, ".runs", runId);

export async function appendRecord(runId: string, record: CaseRecord): Promise<void> {
  const dir = runDir(runId);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "records.jsonl"), `${JSON.stringify(record)}\n`);
}

export async function readRecords(runId: string): Promise<readonly CaseRecord[]> {
  try {
    const text = await readFile(join(runDir(runId), "records.jsonl"), "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as CaseRecord);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}
