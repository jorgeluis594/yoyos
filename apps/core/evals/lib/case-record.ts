import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EvalPass } from "@core/evals/cases/schema";
import type { JudgeVerdict } from "@core/evals/lib/claude";
import type { ModelCall } from "@core/evals/lib/model-meter";
import type { FieldScores, NoticeError } from "@core/evals/lib/scorers";

/** What one run of one case left: scores, the actual result, observed certainties, latency and model calls. Plain JSON. */
export type CaseRecord = Readonly<{
  caseId: string;
  baseId: string;
  pass: EvalPass;
  criterion: number;
  kind: string;
  tags: readonly string[];
  /** 0 for the scored run; consistency cases add 1, 2… */
  repeat: number;
  passed: boolean;
  exactPassed: boolean;
  fields: FieldScores;
  expectationIndex: number;
  judge: JudgeVerdict | null;
  noticeError: NoticeError;
  /** The tools of the first acceptable expectation, for accuracy per tool; `-` when unscored. */
  expectedTool: string;
  input: string;
  expected: unknown;
  actual: unknown;
  /** Compact form of the actual result: two runs with different signatures flipped. */
  signature: string;
  /** Model certainties with the production gate each one meets or misses (lib/production.ts `Certainty`). */
  certainties: readonly Readonly<{ source: string; confidence: number; gate: number; detail?: string }>[];
  /** What the models decided: Decision answers (action, top predicates, choices), extracted tool arguments and text choices. */
  trace: Readonly<{ decisions: readonly unknown[]; extracted: readonly unknown[]; textChoices: readonly unknown[] }>;
  /** The scored model step alone: no chat creation, order seeding or earlier retried attempts. */
  latencyMs: number;
  /** Retried attempts before the scored one (retryable failures, as the queue would retry). */
  retries: number;
  calls: readonly ModelCall[];
  error: string | null;
}>;

export const resultsDir = resolve(import.meta.dirname, "../../eval-results");
export const runDir = (runId: string) => join(resultsDir, ".runs", runId);

export async function appendRecord(runId: string, record: CaseRecord): Promise<void> {
  await mkdir(runDir(runId), { recursive: true });
  await appendFile(join(runDir(runId), "records.jsonl"), `${JSON.stringify(record)}\n`);
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
