import { beforeAll, expect, inject } from "vitest";
import { createHarness, createJudge, describeEval, type JsonValue } from "vitest-evals";
import { allCases, casesOfPass, imageManifest, selectCases } from "@core/evals/cases";
import type { EvalCase, EvalPass } from "@core/evals/cases/schema";
import type { CaseRecord } from "@core/evals/lib/case-record";
import { createClaude } from "@core/evals/lib/claude";
import { modelSuitesBlocker, readEvalEnv } from "@core/evals/lib/eval-env";
import { seedEvalCatalog } from "@core/evals/lib/eval-catalog";
import { installModelMeter } from "@core/evals/lib/model-meter";
import { createProductionPath } from "@core/evals/lib/production";
import type { RunCaseContext } from "@core/evals/lib/run-case";

type CaseRun<Case extends EvalCase> = Readonly<{ testCase: Case; repeat: number; label: string }>;
type RunCase<Case extends EvalCase> = (context: RunCaseContext, testCase: Case, repeat: number) => Promise<CaseRecord>;

/** The scored run of every selected case, then the extra runs of the `consistency` cases. */
function runsOf<Case extends EvalCase>(cases: readonly Case[], repeats: number): readonly CaseRun<Case>[] {
  const first = cases.map((testCase) => ({ testCase, repeat: 0, label: testCase.id }));
  const again = cases.filter(({ tags }) => tags.includes("consistency"))
    .flatMap((testCase) => Array.from({ length: repeats - 1 }, (_, index) => ({ testCase, repeat: index + 1, label: `${testCase.id} (repeat ${index + 1})` })));
  return [...first, ...again];
}

/** Shows each case's verdict in the vitest-evals report: the share of exact-match fields that passed, and Claude's reason when it judged. */
const CaseJudge = createJudge("CaseJudge", ({ output }) => {
  const record = output as unknown as CaseRecord;
  const fields = Object.entries(record.fields).filter(([, value]) => value !== null);
  const failed = fields.filter(([, value]) => value === false).map(([name]) => name);
  const exact = record.error ? `Error: ${record.error}` : failed.length ? `Wrong: ${failed.join(", ")}` : "All fields match";
  return { score: record.passed ? 1 : fields.length ? (fields.length - failed.length) / fields.length : 0,
    metadata: { rationale: record.judge ? `${exact}. Claude judge: ${record.judge.pass ? "pass" : "fail"} (${record.judge.score}) ${record.judge.reason}` : exact } };
});

/**
 * One eval suite per pass over the real production path. Skips with a message when a provider key is missing; otherwise seeds the
 * eval catalog in the test database before its first case.
 */
export function defineModelSuite<Pass extends EvalPass>(name: string, pass: Pass, runCase: RunCase<Extract<EvalCase, { pass: Pass }>>,
  options: Readonly<{ indexPhotos: boolean; photosRequired?: boolean }>): void {
  const env = readEvalEnv();
  const blocker = modelSuitesBlocker(env)
    ?? (options.photosRequired && !imageManifest ? "Image evals skipped: no photo manifest (evals/fixtures/images/README.md, EVAL_IMAGES_DIR)." : null);
  if (blocker) console.warn(`${name}: ${blocker}`);
  const cases = casesOfPass(selectCases(allCases, { maxCases: env.EVAL_MAX_CASES, ids: env.EVAL_CASES?.split(",").map((id) => id.trim()),
    skipParaphrases: env.EVAL_SKIP_PARAPHRASES === "1" }), pass);
  let context: RunCaseContext | null = null;

  const harness = createHarness<CaseRun<Extract<EvalCase, { pass: Pass }>>, JsonValue>({
    name: `yoyos-${pass}`,
    run: async ({ input }) => {
      if (!context) throw new Error("The eval context was not prepared");
      const record = await runCase(context, input.testCase, input.repeat);
      const usage = record.calls.filter(({ role }) => role === "system");
      return {
        output: record as unknown as JsonValue,
        events: [
          { type: "message", role: "user", content: record.input },
          ...(Array.isArray((record.actual as { tools?: unknown }).tools) ? ((record.actual as { tools: string[] }).tools).map((tool, index) =>
            ({ type: "tool_call" as const, id: `call_${index}`, name: tool, arguments: {} })) : []),
          { type: "message", role: "assistant", content: record.signature },
        ],
        usage: { inputTokens: usage.reduce((sum, call) => sum + call.inputTokens, 0), outputTokens: usage.reduce((sum, call) => sum + call.outputTokens, 0) },
      };
    },
  });

  describeEval(name, { harness, judges: [CaseJudge], judgeThreshold: null, skipIf: () => blocker !== null || cases.length === 0 }, (it) => {
    beforeAll(async () => {
      installModelMeter();
      const path = createProductionPath(process.env);
      await seedEvalCatalog(options.indexPhotos ? path.embedder : null);
      context = { runId: inject("evalRunId"), path, claude: createClaude({ apiKey: env.CLAUDE_API_KEY!, model: env.EVAL_CLAUDE_MODEL }) };
    }, 600_000);

    it.for(runsOf(cases, env.EVAL_REPEATS))("$label", async (caseRun, { run }) => {
      const result = await run(caseRun);
      const record = result.output as unknown as CaseRecord;
      // Only the scored run asserts; repeats feed the consistency check.
      if (caseRun.repeat > 0) return;
      expect(record.error, record.error ?? "").toBeNull();
      expect(record.passed, `${record.input} → ${record.signature}`).toBe(true);
    });
  });
}
