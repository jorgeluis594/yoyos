import { expect, test } from "vitest";
import { messageRecord } from "@core/evals/lib/record-fixture";
import { buildReport, formatSummary } from "@core/evals/lib/report";
import type { ReportVerdictLabelsOutput } from "@core/src/features/orders/application/report-verdict-labels";
import { parseVerdictFile, summarizeVerdicts } from "@core/evals/lib/verdicts";

const meta = { runId: "run", startedAt: "2026-10-31T00:00:00.000Z", finishedAt: "2026-10-31T00:10:00.000Z", settings: {} };
const file = {
  rows: [
    { decision: "doubtful", doubtKind: "variant_changed", verdict: "kept", strength: "strong", count: 4 },
    { decision: "doubtful", doubtKind: "quantity_set", verdict: "undone", strength: "strong", count: 1 },
    { decision: "applied", doubtKind: null, verdict: "quantity_changed", strength: "strong", count: 2 },
    { decision: "applied", doubtKind: null, verdict: "kept", strength: "weak", count: 30 },
    { decision: "applied", doubtKind: null, verdict: "not_reviewed", strength: null, count: 9 },
  ],
  unverdicted: 12,
};

test("embeds verdict label counts with weak labels apart", () => {
  const summary = summarizeVerdicts(parseVerdictFile(file));
  const report = buildReport([messageRecord()], meta, [], [], summary);

  expect(report.verdicts).toEqual({ strong: { total: 7, byDecision: { applied: 2, doubtful: 5 } }, weak: { total: 30, byDecision: { applied: 30 } }, unlabelled: 9, unverdicted: 12 });
  expect(formatSummary(report, "p")).toContain("Seller verdict labels: 7 strong (applied 2, doubtful 5), 30 weak apart (applied 30), 9 not reviewed, 12 without verdict");
  expect(buildReport([messageRecord()], meta).verdicts).toBeNull();
});

test("refuses a verdict file with text or ids in it", () => {
  expect(() => parseVerdictFile({ ...file, rows: [{ ...file.rows[0], text: "quiero una gorra" }] })).toThrow();
  expect(() => parseVerdictFile({ rows: [], unverdicted: -1 })).toThrow();
});

test("pins the verdict file shape T19 emits and names no value of a bad file", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readVerdictFile } = await import("@core/evals/lib/verdicts");
  const dir = mkdtempSync(join(tmpdir(), "verdicts-"));
  const write = (content: string) => { const path = join(dir, "v.json"); writeFileSync(path, content); return path; };

  expect(readVerdictFile(write(JSON.stringify({ rows: [{ decision: "applied", doubtKind: null, verdict: "kept", strength: "weak", count: 1 }], unverdicted: 0 }))).unverdicted).toBe(0);
  expect(() => readVerdictFile(write(JSON.stringify({ rows: [], unverdicted: 0, since: "2026-01-01" })))).toThrow("does not match");
  expect(() => readVerdictFile(write('{"rows": [secret-text'))).toThrow("not valid JSON");
  expect(() => readVerdictFile(write('{"rows": [secret-text'))).not.toThrow(/secret/);
});

test("accepts the output the verdicts report prints, as typed by the report use case", () => {
  const printed: ReportVerdictLabelsOutput = { rows: [
    { decision: "doubtful", doubtKind: "variant_changed", verdict: "kept", count: 3, strength: "strong" },
    { decision: "applied", doubtKind: null, verdict: "kept", count: 7, strength: "weak" },
  ], unverdicted: 2 };
  const summary = summarizeVerdicts(parseVerdictFile(JSON.parse(JSON.stringify(printed))));
  expect(summary).toMatchObject({ strong: { total: 3 }, weak: { total: 7 }, unverdicted: 2 });
});
