import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "vite";
import type { TestProject } from "vitest/node";
import { imagesDirOf, localImagesDirOf, readImageManifest } from "@core/evals/fixtures/image-manifest";
import { readRecords, resultsDirOf, runDir } from "@core/evals/lib/case-record";
import { createClaude, type ErrorGroups } from "@core/evals/lib/claude";
import { fileAndShellEnv, modelSuitesBlocker, readEvalEnv } from "@core/evals/lib/eval-env";
import { installModelMeter, metered, type ModelCall } from "@core/evals/lib/model-meter";
import { buildReport, formatGateSummary, formatSummary, type EvalReport } from "@core/evals/lib/report";
import { writePrivateRunSummary } from "@core/evals/lib/private-run-summary";
import { readVerdictFile, summarizeVerdicts } from "@core/evals/lib/verdicts";
import { privateDirOf } from "@core/evals/cases/private";

declare module "vitest" {
  export interface ProvidedContext {
    evalRunId: string;
  }
}

/** At most this many failures go to the classifier, to bound its prompt. */
const maxClassifiedFailures = 150;

async function classify(failures: EvalReport["failures"], env: ReturnType<typeof readEvalEnv>): Promise<Readonly<{ groups: ErrorGroups["groups"]; calls: readonly ModelCall[] }>> {
  // Fake mode and runs without the key call no model.
  if (env.EVAL_MODELS === "fake" || !failures.length || !env.CLAUDE_API_KEY) return { groups: [], calls: [] };
  const claude = createClaude({ apiKey: env.CLAUDE_API_KEY, model: env.EVAL_CLAUDE_MODEL });
  const prompt = JSON.stringify({ failures: failures.slice(0, maxClassifiedFailures) }, null, 1);
  try {
    const { value, calls } = await metered("classifier", () => claude.classify(prompt));
    return { groups: value.groups, calls };
  } catch (cause) {
    console.warn(`Error classification failed: ${(cause as Error).message}`);
    return { groups: [], calls: [] };
  }
}

/** Gives the run an id, and after the last suite turns the case records into one timestamped JSON report. */
export default function setup(project: TestProject) {
  // A bad verdicts file stops the run before any model is called, not after it (evals/lib/verdicts.ts).
  const verdictsPath = fileAndShellEnv(loadEnv("evals", process.cwd(), ""), process.env).EVAL_VERDICTS_FROM;
  const verdictFile = verdictsPath ? readVerdictFile(verdictsPath) : null;
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  project.provide("evalRunId", runId);
  installModelMeter();

  return async () => {
    // The workers get `.env` through the config's `env`, so the shell and `.env` decide here too.
    const shellAndFile = fileAndShellEnv(loadEnv("evals", process.cwd(), ""), process.env);
    const resultsDir = resultsDirOf(shellAndFile);
    const records = await readRecords(runId, resultsDir);
    if (!records.length) return;
    const env = readEvalEnv(shellAndFile);
    const imagesDir = imagesDirOf(shellAndFile);
    const verdicts = verdictFile ? summarizeVerdicts(verdictFile) : null;
    const meta = { runId, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      settings: { models: env.EVAL_MODELS, seedBank: env.EVAL_SEED_BANK === "1", claudeModel: env.EVAL_CLAUDE_MODEL, maxCases: env.EVAL_MAX_CASES ?? "all", cases: env.EVAL_CASES ?? "all", repeats: env.EVAL_REPEATS,
        skipParaphrases: env.EVAL_SKIP_PARAPHRASES === "1", split: env.EVAL_SPLIT, privateRun: Boolean(shellAndFile.EVAL_PRIVATE_DIR), imagesDir, photoManifest: readImageManifest(imagesDir) !== null,
        localPhotos: readImageManifest(localImagesDirOf(shellAndFile))?.entries.length ?? 0, blocker: modelSuitesBlocker(env) } };
    const draft = buildReport(records, meta, [], [], verdicts);
    const classified = await classify(draft.failures, env);
    const report = buildReport(records, meta, classified.calls, classified.groups, verdicts);
    // A private run (EVAL_PRIVATE_DIR) keeps everything in `<dir>/runs/` and prints aggregate lines only.
    const privateRun = Boolean(shellAndFile.EVAL_PRIVATE_DIR);
    await mkdir(resultsDir, { recursive: true });
    const path = join(resultsDir, `${runId}.json`);
    // The classifier's calls are kept so the report can be rebuilt from the file (lib/rebuild.ts).
    await writeFile(path, `${JSON.stringify({ report, records, extraCalls: classified.calls }, null, 2)}\n`);
    await rm(runDir(runId, resultsDir), { recursive: true, force: true });
    console.log(`\n${privateRun ? formatGateSummary(report) : formatSummary(report, path)}`);
    // The ids of the failed cases and the type of each failure, under the private folder; nothing of them reaches the console.
    if (privateRun) console.log(`Failed case ids and failure types: ${writePrivateRunSummary(privateDirOf(shellAndFile.EVAL_PRIVATE_DIR!), runId, records)}`);
  };
}
