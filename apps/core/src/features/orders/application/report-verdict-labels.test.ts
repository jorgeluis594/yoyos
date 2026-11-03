import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { reportVerdictLabels, type VerdictCountRow } from "@core/src/features/orders/application/report-verdict-labels";

const since = new Date("2026-10-01T00:00:00Z");
const until = new Date("2026-11-01T00:00:00Z");
const rows: VerdictCountRow[] = [
  { decision: "doubtful", doubtKind: "variant_changed", verdict: "kept", count: 3 },
  { decision: "applied", doubtKind: null, verdict: "kept", count: 10 },
  { decision: "applied", doubtKind: null, verdict: "removed", count: 2 },
  { decision: "doubtful", doubtKind: "quantity_set", verdict: "quantity_changed", count: 1 },
  { decision: "doubtful", doubtKind: "removed", verdict: "undone", count: 4 },
  { decision: "doubtful", doubtKind: "removed", verdict: "not_reviewed", count: 5 },
  { decision: "doubtful", doubtKind: "removed", verdict: null, count: 6 },
];

test("labels each row with its strength and counts the unverdicted apart", async () => {
  const countVerdicts = vi.fn(async () => ok(rows));
  const result = await reportVerdictLabels({ since, until }, { countVerdicts });
  expect(countVerdicts).toHaveBeenCalledWith(since, until);
  expect(result).toEqual(ok({
    rows: [
      { decision: "doubtful", doubtKind: "variant_changed", verdict: "kept", count: 3, strength: "strong" },
      { decision: "applied", doubtKind: null, verdict: "kept", count: 10, strength: "weak" },
      { decision: "applied", doubtKind: null, verdict: "removed", count: 2, strength: "strong" },
      { decision: "doubtful", doubtKind: "quantity_set", verdict: "quantity_changed", count: 1, strength: "strong" },
      { decision: "doubtful", doubtKind: "removed", verdict: "undone", count: 4, strength: "strong" },
      { decision: "doubtful", doubtKind: "removed", verdict: "not_reviewed", count: 5, strength: null },
    ],
    unverdicted: 6,
  }));
});

test.each([
  ["inverted", until, since],
  ["empty", since, since],
  ["longer than 366 days", new Date("2025-10-01T00:00:00Z"), until],
  ["invalid date", new Date("nope"), until],
])("refuses a %s window before reading", async (_name, from, to) => {
  const countVerdicts = vi.fn(async () => ok(rows));
  const result = await reportVerdictLabels({ since: from, until: to }, { countVerdicts });
  expect(result).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(countVerdicts).not.toHaveBeenCalled();
});

test("accepts a window of exactly 366 days", async () => {
  const result = await reportVerdictLabels({ since: new Date("2025-10-31T00:00:00Z"), until: new Date("2026-11-01T00:00:00Z") }, { countVerdicts: async () => ok([]) });
  expect(result).toEqual(ok({ rows: [], unverdicted: 0 }));
});

test("passes a persistence failure through", async () => {
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
  expect(await reportVerdictLabels({ since, until }, { countVerdicts: async () => failure })).toEqual(failure);
});
