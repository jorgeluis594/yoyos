import { beforeAll, expect, inject } from "vitest";
import { createHarness, createJudge, describeEval, type JsonValue } from "vitest-evals";
import { allCases, casesOfPass, imageManifest, selectCases } from "@core/evals/cases";
import { loadPrivateData } from "@core/evals/cases/private";
import { committedCatalog } from "@core/evals/fixtures/catalog";
import { runsOf } from "@core/evals/lib/runs";
import { labelledRuns, redacted, summaryOf } from "@core/evals/lib/suite-output";
import type { EvalCase, EvalPass } from "@core/evals/cases/schema";
import type { CaseRecord } from "@core/evals/lib/case-record";
import { createClaude } from "@core/evals/lib/claude";
import { diagnosticsOn, modelSuitesBlocker, readEvalEnv } from "@core/evals/lib/eval-env";
import { evalCompanyId, privateCompanyId, seedEvalCatalog } from "@core/evals/lib/eval-catalog";
import { installModelMeter } from "@core/evals/lib/model-meter";
import { createProductionPath } from "@core/evals/lib/production";
import type { RunCaseContext } from "@core/evals/lib/run-case";

type RunCase<Case extends EvalCase> = (context: RunCaseContext, testCase: Case, repeat: number) => Promise<CaseRecord | readonly CaseRecord[]>;

/** Shows each case's verdict in the vitest-evals report: the share of exact-match fields that passed, and Claude's reason when it judged. */
const CaseJudge = createJudge("CaseJudge", ({ output }) => {
  const record = output as unknown as CaseRecord;
  // A private run's judge reason is empty here (redacted): it stays in the records under `<dir>/runs/`.
  const fields = Object.entries(record.fields).filter(([, value]) => value !== null);
  const failed = fields.filter(([, value]) => value === false).map(([name]) => name);
  const exact = record.error ? `Error: ${record.error}` : failed.length ? `Wrong: ${failed.join(", ")}` : "All fields match";
  return { score: record.passed ? 1 : fields.length ? (fields.length - failed.length) / fields.length : 0,
    metadata: { rationale: record.judge?.reason ? `${exact}. Claude judge: ${record.judge.pass ? "pass" : "fail"} (${record.judge.score}) ${record.judge.reason}` : exact } };
});

/**
 * One eval suite per pass over the real production path. Skips with a message when a provider key is missing; otherwise seeds the
 * eval catalog in the test database before its first case. With `EVAL_PRIVATE_DIR` it runs only the private cases of the pass, against
 * the private catalog, and the report of the run carries opaque labels and scores only (lib/suite-output.ts).
 */
export function defineModelSuite<Pass extends EvalPass>(name: string, pass: Pass, runCase: RunCase<Extract<EvalCase, { pass: Pass }>>,
  options: Readonly<{ indexPhotos: boolean; photosRequired?: boolean }>): void {
  const env = readEvalEnv();
  const privateRun = env.EVAL_PRIVATE_DIR !== undefined;
  const privateData = privateRun ? loadPrivateData(env.EVAL_PRIVATE_DIR!) : null;
  const blocker = modelSuitesBlocker(env)
    ?? (options.photosRequired && !imageManifest && !privateRun ? "Image evals skipped: no photo manifest (evals/fixtures/images/README.md, EVAL_IMAGES_DIR)." : null);
  if (blocker) console.warn(`${name}: ${blocker}`);
  const cases = casesOfPass(privateData ? privateData.cases : selectCases(allCases, { maxCases: env.EVAL_MAX_CASES, ids: env.EVAL_CASES?.split(",").map((id) => id.trim()),
    skipParaphrases: env.EVAL_SKIP_PARAPHRASES === "1", split: env.EVAL_SPLIT === "all" ? undefined : env.EVAL_SPLIT }), pass);
  const runs = labelledRuns(runsOf(cases, env.EVAL_REPEATS, env.EVAL_REPEAT_TAGS), privateRun);
  let context: RunCaseContext | null = null;

  const harness = createHarness<(typeof runs)[number], JsonValue>({
    name: `yoyos-${pass}`,
    run: async ({ input }) => {
      if (!context) throw new Error("The eval context was not prepared");
      const ran = await runCase(context, input.testCase, input.repeat);
      const records = Array.isArray(ran) ? ran : [ran as CaseRecord];
      const record = summaryOf(records);
      const shown = privateRun ? redacted(record) : record;
      const usage = record.calls.filter(({ role }) => role === "system");
      return {
        output: shown as unknown as JsonValue,
        events: [
          { type: "message", role: "user", content: shown.input },
          { type: "message", role: "assistant", content: shown.signature },
        ],
        usage: { inputTokens: usage.reduce((sum, call) => sum + call.inputTokens, 0), outputTokens: usage.reduce((sum, call) => sum + call.outputTokens, 0) },
      };
    },
  });

  describeEval(name, { harness, judges: [CaseJudge], judgeThreshold: null, skipIf: () => blocker !== null || cases.length === 0 }, (it) => {
    beforeAll(async () => {
      installModelMeter();
      const diagnostics = diagnosticsOn(env);
      const path = createProductionPath(process.env, { diagnostics });
      if (privateData) await seedEvalCatalog(privateData.catalog, privateCompanyId, null);
      else await seedEvalCatalog(committedCatalog, evalCompanyId, options.indexPhotos ? path.embedder : null);
      context = { runId: inject("evalRunId"), path, scope: privateData ? "private" : "eval", claude: createClaude({ apiKey: env.CLAUDE_API_KEY!, model: env.EVAL_CLAUDE_MODEL }), diagnostics };
    }, 600_000);

    it.for(runs)("$label", async (caseRun, { run }) => {
      const result = await run(caseRun);
      const record = result.output as unknown as CaseRecord;
      // Only the scored run asserts; repeats feed the flip check.
      if (caseRun.repeat > 0) return;
      expect(record.error, privateRun ? "error" : record.error ?? "").toBeNull();
      expect(record.passed, privateRun ? "not right" : `${record.input} → ${record.signature}`).toBe(true);
    });
  });
}
