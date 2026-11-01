import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DecisionKind, EvalPass } from "@core/evals/cases/schema";
import type { JudgeVerdict } from "@core/evals/lib/claude";
import type { ModelCall } from "@core/evals/lib/model-meter";
import type { FieldScores } from "@core/evals/lib/scorers";
import { privateDirOf } from "@core/evals/cases/private";

/**
 * What the scoring of one message states for the v2 metrics (lib/metrics.ts). `null` is a stage the case does not state. Only the staged
 * path and the fake mode fill it (T16 wires the staged pipeline); older records have none and keep the gate flags.
 */
export type StageFacts = Readonly<{
  intent: boolean | null;
  fields: boolean | null;
  resolution: boolean | null;
  decision: boolean | null;
  decisionExpected: DecisionKind;
  decisionActual: DecisionKind;
  /** The buyer asked for something (a request, «listo» or a payment request). */
  requested: boolean;
  /** What the message left: a change in the order, a «Con duda» mark, a «Por resolver» point, a seller notice. */
  changeApplied: boolean;
  marked: boolean;
  point: boolean;
  noticed: boolean;
  /** The order after the message equals the expected one; null when the case states no order. */
  orderMatches: boolean | null;
  /** The notice was «Pedido #N cambió»: counted apart from the urgent ones. */
  changedNotice: boolean;
  /** From the start of the reading to the decision, without the wait behind earlier messages of the chat, which is `queuedMs`. */
  readingMs: number;
  queuedMs: number;
  /** Cost of each stage in US$ (`intent`, `extraction`, `confirming_extraction`, `resolution`, `confirming_resolution`, `photo_qr`, `photo_visual`). */
  stageCostsUsd: Readonly<Record<string, number>>;
}>;

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
  /** The v2 metric inputs; absent in records of the legacy reader path. */
  facts?: StageFacts;
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

export async function readRecords(runId: string, root: string = resultsDirOf()): Promise<readonly CaseRecord[]> {
  try {
    const text = await readFile(join(runDir(runId, root), "records.jsonl"), "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as CaseRecord);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}
