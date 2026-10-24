import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "vite";
import type { TestProject } from "vitest/node";
import { imagesDirOf, localImagesDirOf, readImageManifest } from "@core/evals/fixtures/image-manifest";
import { readRecords, resultsDir, runDir } from "@core/evals/lib/case-record";
import { createClaude, type ErrorGroups } from "@core/evals/lib/claude";
import { modelSuitesBlocker, readEvalEnv } from "@core/evals/lib/eval-env";
import { installModelMeter, metered, type ModelCall } from "@core/evals/lib/model-meter";
import { buildReport, formatSummary, type EvalReport } from "@core/evals/lib/report";

declare module "vitest" {
  export interface ProvidedContext {
    evalRunId: string;
  }
}

/** At most this many failures go to the classifier, to bound its prompt. */
const maxClassifiedFailures = 150;

async function classify(failures: EvalReport["failures"], env: ReturnType<typeof readEvalEnv>): Promise<Readonly<{ groups: ErrorGroups["groups"]; calls: readonly ModelCall[] }>> {
  if (!failures.length || !env.CLAUDE_API_KEY) return { groups: [], calls: [] };
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
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  project.provide("evalRunId", runId);
  installModelMeter();

  return async () => {
    const records = await readRecords(runId);
    if (!records.length) return;
    const shellAndFile = { ...loadEnv("evals", process.cwd(), ""), ...process.env };
    const env = readEvalEnv(shellAndFile);
    const imagesDir = imagesDirOf(shellAndFile);
    const meta = { runId, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      settings: { claudeModel: env.EVAL_CLAUDE_MODEL, maxCases: env.EVAL_MAX_CASES ?? "all", cases: env.EVAL_CASES ?? "all", repeats: env.EVAL_REPEATS,
        skipParaphrases: env.EVAL_SKIP_PARAPHRASES === "1", imagesDir, photoManifest: readImageManifest(imagesDir) !== null,
        localPhotos: readImageManifest(localImagesDirOf(shellAndFile))?.entries.length ?? 0, blocker: modelSuitesBlocker(env) } };
    const draft = buildReport(records, meta);
    const classified = await classify(draft.failures, env);
    const report = buildReport(records, meta, classified.calls, classified.groups);
    await mkdir(resultsDir, { recursive: true });
    const path = join(resultsDir, `${runId}.json`);
    await writeFile(path, `${JSON.stringify({ report, records }, null, 2)}\n`);
    await rm(runDir(runId), { recursive: true, force: true });
    console.log(`\n${formatSummary(report, path)}`);
  };
}
