import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { appendRecord, readRecords, resultsDir, runDir } from "@core/evals/lib/case-record";
import { buildReport, formatGateSummary } from "@core/evals/lib/report";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { labelledRuns, redacted, summaryOf } from "@core/evals/lib/suite-output";
import { runsOf } from "@core/evals/lib/runs";

const dirs: string[] = [];
const previous = process.env.EVAL_PRIVATE_DIR;
afterEach(() => {
  if (previous === undefined) delete process.env.EVAL_PRIVATE_DIR; else process.env.EVAL_PRIVATE_DIR = previous;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const secret = messageRecord({ caseId: "pv-secret-case", baseId: "pv-secret-case", kind: "photo-size", input: "text «quiero la taza roja del cliente»", signature: "ready|ready|taza-roja",
  judge: { pass: false, score: 0.1, reason: "the buyer said taza roja" }, error: "taza roja failed", noticeProducts: ["taza-roja"] });
const meta = { runId: "run", startedAt: "", finishedAt: "", settings: {} };

test("writes the records of a private run only under the private folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "private-run-"));
  dirs.push(dir);
  process.env.EVAL_PRIVATE_DIR = dir;

  await appendRecord("run-1", secret);

  expect(runDir("run-1")).toBe(join(realpathSync(dir), "runs", ".runs", "run-1"));
  expect(existsSync(join(dir, "runs", ".runs", "run-1", "records.jsonl"))).toBe(true);
  expect(existsSync(join(resultsDir, ".runs", "run-1"))).toBe(false);
  expect(await readRecords("run-1")).toHaveLength(1);
  expect(readFileSync(join(dir, "runs", ".runs", "run-1", "records.jsonl"), "utf8")).toContain("pv-secret-case");
});

test("prints only aggregate lines with opaque labels in a private run", () => {
  const cases = [{ id: "pv-secret-case", tags: ["consistency"] }, { id: "pv-other", tags: [] }];
  const labels = labelledRuns(runsOf(cases, 2, ["consistency"]), true).map(({ label }) => label);
  const output = [formatGateSummary(buildReport([secret], meta)), JSON.stringify(redacted(secret)), JSON.stringify(redacted(summaryOf([secret]))), ...labels].join("\n");

  expect(labels).toEqual(["case 1", "case 2", "case 1 (repeat 1)"]);
  for (const leaked of ["pv-secret-case", "taza", "quiero", "the buyer said", "failed"]) expect(output).not.toContain(leaked);
  expect(formatGateSummary(buildReport([secret], meta))).toContain("whole run: right 0 of 1 scored messages (0.0%)");
  // Families are the rules sheet's categories, so they are part of the aggregate lines.
  expect(formatGateSummary(buildReport([secret], meta))).toContain("family photo-size: right 0 of 1 scored messages");
  // The report file does name cases; a private run writes it under the private folder and prints only the gate lines.
  expect(JSON.stringify(buildReport([secret], meta).failures)).toContain("pv-secret-case");
});

test("a public run keeps the case ids as labels", () => {
  expect(labelledRuns(runsOf([{ id: "int-a", tags: [] }], 1, []), false).map(({ label }) => label)).toEqual(["int-a"]);
});

test("a private run's stdout carries the new aggregate lines and no case id", () => {
  const outcome = { actual: { notice: "several_problems", outcomes: ["payment_requested", "variant_missing"], noticeProducts: ["taza-roja"], order: [] } };
  const records = [
    messageRecord({ caseId: "pv-secret-case", baseId: "pv-secret-case", kind: "photo-size", photoCase: true, tags: ["question-caption"], signature: "a", ...outcome }),
    messageRecord({ caseId: "pv-secret-case", baseId: "pv-secret-case", kind: "photo-size", photoCase: true, repeat: 1, signature: "b", ...outcome }),
    messageRecord({ caseId: "pv-other", baseId: "pv-other", kind: "text-size", signature: "a", ...outcome }),
  ];
  const text = formatGateSummary(buildReport(records, meta));

  expect(text).toContain("without photo cases: right 0 of 1 scored messages");
  expect(text).toContain("photo cases: right 0 of 1 scored messages");
  expect(text).toContain("Consistency: 0 of 1 repeated cases gave one result over 2 runs (0.0%)");
  expect(text).toContain("Silent adds on question captions: 0 of 1 messages");
  expect(text).toContain("Payment requests inside a several-problems count: 2 of 2");
  expect(text).toContain("Notices by kind: several_problems 2");
  expect(text).toContain("Reader features scored: payment request on, closed-order line on");
  for (const leaked of ["pv-secret-case", "pv-other", "taza"]) expect(text).not.toContain(leaked);
});
