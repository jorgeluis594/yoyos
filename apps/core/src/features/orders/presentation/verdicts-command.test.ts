import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { ReportVerdictLabelsOutput } from "@core/src/features/orders/application/report-verdict-labels";
import { hashToken, parseTraceReaders } from "@core/src/features/orders/presentation/trace-reader-token";
import { runVerdictsReport } from "@core/src/features/orders/presentation/verdicts-command";

const readers = parseTraceReaders(`Ana:${hashToken("ana-token")}`);
const report: ReportVerdictLabelsOutput = { rows: [{ decision: "applied", doubtKind: null, verdict: "kept", count: 4, strength: "weak" }], unverdicted: 2 };

function run(token: string | null, overrides: Partial<Parameters<typeof runVerdictsReport>[0]> = {}) {
  const reportLabels = vi.fn(async () => ok(report));
  const out: string[] = [];
  const errors: string[] = [];
  return { reportLabels, out, errors, result: runVerdictsReport({ args: ["--since", "2026-10-01", "--until", "2026-11-01"], readers, token: async () => token, report: reportLabels,
    print: (text) => out.push(text), fail: (text) => errors.push(text), ...overrides }) };
}

test("refuses a missing or unknown token before reporting anything", async () => {
  for (const token of [null, "nope"]) {
    const { reportLabels, out, result } = run(token);
    expect(await result).toBe(1);
    expect(reportLabels).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  }
});

test("rejects malformed arguments before asking for the token", async () => {
  const token = vi.fn(async () => "ana-token");
  for (const args of [["--since", "2026-10-01"], ["--since", "x", "--until", "y"], ["--since", "2026-10-01", "--until", "2026-11-01", "--company", "c"], []]) {
    const { reportLabels, result } = run("ana-token", { args, token });
    expect(await result).toBe(2);
    expect(reportLabels).not.toHaveBeenCalled();
  }
  expect(token).not.toHaveBeenCalled();
});

test("prints the labelled counts as JSON for the window", async () => {
  const { reportLabels, out, result } = run("ana-token");
  expect(await result).toBe(0);
  expect(reportLabels).toHaveBeenCalledWith({ since: new Date("2026-10-01T00:00:00Z"), until: new Date("2026-11-01T00:00:00Z") });
  expect(JSON.parse(out.join(""))).toEqual(report);
});

test("prints nothing and fails when the window is refused or the read fails", async () => {
  for (const code of ["INVALID_INPUT", "PERSISTENCE_UNAVAILABLE"] as const) {
    const out: string[] = [];
    const errors: string[] = [];
    const exit = await runVerdictsReport({ args: ["--since", "2026-10-01", "--until", "2026-11-01"], readers, token: async () => "ana-token",
      report: async () => err({ code, message: "x" }), print: (text) => out.push(text), fail: (text) => errors.push(text) });
    expect(exit).toBe(1);
    expect(out).toEqual([]);
    expect(errors.join("")).toContain(code);
  }
});
