import { expect, test } from "vitest";
import { stockDeductionRecoveryPolicy } from "@core/src/composition/scheduled-jobs";
import { err, ok } from "@shared/functional";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import { STOCK_DEDUCTION_RECOVERY_CRON, STOCK_DEDUCTION_RECOVERY_LAST_PASS_START_MS, STOCK_DEDUCTION_RECOVERY_PASS_BUDGET, STOCK_DEDUCTION_RECOVERY_PASS_OFFSETS_MS, recoverDueStockDeductions, type RecoverDueStockDeductionsDependencies } from "@core/src/features/orders/application/recover-due-stock-deductions";

const company = (n: number) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}` as CompanyId;
const order = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}` as OrderId;
const deducted: DeductionOutcome = { kind: "deducted", stock: new Map(), deductedAt: new Date("2026-09-30T12:00:00Z") };

function fixture(overdue: Record<string, OrderId[]>, outcomes: (companyId: CompanyId, orderId: OrderId) => DeductionOutcome = () => deducted, options: Partial<RecoverDueStockDeductionsDependencies> = {}) {
  let now = 0;
  const published: [CompanyId, OrderId][] = [];
  const logs: [string, string, Record<string, unknown>][] = [];
  const waits: number[] = [];
  const quarantined = new Map<OrderId, number>();
  let sequence = 0;
  const handled = new Set<OrderId>();
  const deps: RecoverDueStockDeductionsDependencies = {
    listCompaniesWithOverdueStockDeductions: async () => ok(Object.keys(overdue).filter((id) => overdue[id]!.some((orderId) => !handled.has(orderId))) as CompanyId[]),
    listOverdueOrderIds: async (companyId, limit, exclude) => ok((overdue[companyId] ?? []).filter((id) => !exclude.includes(id) && !handled.has(id)).slice(0, limit)),
    publishOverdueInOwnTransaction: async (companyId, orderId) => { published.push([companyId, orderId]); const outcome = outcomes(companyId, orderId); if (outcome.kind === "deducted") handled.add(orderId); return ok(outcome); },
    quarantine: { list: (at) => [...quarantined].filter(([, until]) => until > at.getTime()).map(([id]) => id),
      add: (id, at) => { const fresh = (quarantined.get(id) ?? 0) <= at.getTime(); quarantined.set(id, at.getTime() + 10 * 60_000); return fresh; } },
    wait: async (ms, signal) => { waits.push(ms); if (signal.aborted) return "aborted"; now += ms; return "elapsed"; },
    passSequence: () => sequence++,
    log: (level, event, fields) => logs.push([level, event, fields]),
    passOffsetsMs: [0, 20_000, 40_000], lastPassStartMs: 45_000, passBudget: { maxOrders: 200, maxMs: 10_000 },
    clock: () => new Date(now), ...options,
  };
  return { deps, published, logs, waits, advance: (ms: number) => { now += ms; } };
}
const run = (f: ReturnType<typeof fixture>, signal = new AbortController().signal) => recoverDueStockDeductions(signal, f.deps);

test("publishes one overdue event per candidate, oldest first within each company", async () => {
  const f = fixture({ [company(1)]: [order(1), order(2)], [company(2)]: [order(3)] }, () => ({ kind: "short", shortItems: [{ variantId: "v" as never, available: 0 as never }] }), { passOffsetsMs: [0] });
  const result = await run(f);
  expect(f.published).toEqual([[company(1), order(1)], [company(1), order(2)], [company(2), order(3)]]);
  expect(result).toMatchObject({ success: true, data: [{ pass: 1, companies: 2, candidates: 3, short: 3 }] });
});

test("runs three passes twenty seconds apart and skips a pass that would start after forty-five seconds", async () => {
  const f = fixture({ [company(1)]: [order(1)] }, () => ({ kind: "not_due" }));
  expect(await run(f)).toMatchObject({ success: true, data: [{ pass: 1 }, { pass: 2 }, { pass: 3 }] });
  expect(f.waits).toEqual([20_000, 20_000]);
  const slow = fixture({ [company(1)]: [order(1)] }, () => ({ kind: "not_due" }));
  const list = slow.deps.listCompaniesWithOverdueStockDeductions;
  // The first pass takes 50 s, so the second (offset 20 s) and third (40 s) start late; the third starts after 45 s and is skipped.
  const result = await run({ ...slow, deps: { ...slow.deps, listCompaniesWithOverdueStockDeductions: async () => { slow.advance(50_000); return list(); } } });
  expect(result).toMatchObject({ success: true, data: [{ pass: 1 }] });
});

test("shares each pass's order budget across companies and rotates the first company", async () => {
  const many = (base: number) => Array.from({ length: 6 }, (_, index) => order(base + index));
  const f = fixture({ [company(1)]: many(10), [company(2)]: many(30) }, () => ({ kind: "not_due" }), { passOffsetsMs: [0, 1], passBudget: { maxOrders: 4, maxMs: 10_000 } });
  const result = await run(f);
  expect(f.published.slice(0, 4).map(([id]) => id)).toEqual([company(1), company(1), company(2), company(2)]);
  expect(f.published.slice(4).map(([id]) => id)).toEqual([company(2), company(2), company(1), company(1)]);
  expect(result).toMatchObject({ success: true, data: [{ candidates: 4, budgetExhausted: true }, { candidates: 4 }] });
});

test("quarantines an order with a data fault and logs it once per quarantine", async () => {
  const fault: DeductionOutcome = { kind: "failed", stage: "lock_stock", errorCode: "INVALID_STORED_DATA" };
  const f = fixture({ [company(1)]: [order(1)] }, () => fault);
  const result = await run(f);
  expect(f.published).toHaveLength(1);
  expect(result).toMatchObject({ success: true, data: [{ failed: 1, quarantined: 1 }, { candidates: 0 }, { candidates: 0 }] });
  expect(f.logs.filter(([, event]) => event === "stock_deduction_failed")).toHaveLength(1);
});

test("retries a contended order on the next pass without quarantine", async () => {
  const contended: DeductionOutcome = { kind: "failed", stage: "lock_stock", errorCode: "LOCK_TIMEOUT" };
  const f = fixture({ [company(1)]: [order(1)] }, () => contended);
  const result = await run(f);
  expect(f.published).toHaveLength(3);
  expect(result).toMatchObject({ success: true, data: [{ failed: 1, quarantined: 0 }, { failed: 1 }, { failed: 1 }] });
  expect(f.logs.some(([, event]) => event === "stock_deduction_failed")).toBe(false);
});

test("counts each outcome and logs only deducted orders as recovered", async () => {
  const outcomes: DeductionOutcome[] = [deducted, { kind: "short", shortItems: [{ variantId: "v" as never, available: 0 as never }] }, { kind: "not_due" }, { kind: "skipped_locked" }];
  const f = fixture({ [company(1)]: [order(1), order(2), order(3), order(4)] }, (_company, id) => outcomes[Number(id.slice(-2)) - 1]!, { passOffsetsMs: [0] });
  expect(await run(f)).toMatchObject({ success: true, data: [{ candidates: 4, deducted: 1, short: 1, notDue: 1, skippedLocked: 1 }] });
  expect(f.logs.filter(([, event]) => event === "stock_deduction_recovered")).toEqual([["warn", "stock_deduction_recovered", { companyId: company(1), orderId: order(1) }]]);
  expect(f.logs.find(([, event]) => event === "stock_deduction_recovery_pass_completed")?.[0]).toBe("info");
});

test("stops when the signal aborts or the pass budget is spent", async () => {
  const controller = new AbortController();
  const f = fixture({ [company(1)]: [order(1), order(2), order(3)] }, () => ({ kind: "not_due" }), { passOffsetsMs: [0, 20_000] });
  const publish = f.deps.publishOverdueInOwnTransaction;
  const aborting = { ...f.deps, publishOverdueInOwnTransaction: async (companyId: CompanyId, orderId: OrderId) => { controller.abort(); return publish(companyId, orderId); } };
  const result = await recoverDueStockDeductions(controller.signal, aborting);
  expect(f.published).toHaveLength(1);
  expect(result).toMatchObject({ success: true, data: [{ candidates: 1 }] });
  const budget = fixture({ [company(1)]: [order(1), order(2), order(3)] }, () => ({ kind: "not_due" }), { passOffsetsMs: [0], passBudget: { maxOrders: 2, maxMs: 10_000 } });
  expect(await run(budget)).toMatchObject({ success: true, data: [{ candidates: 2, budgetExhausted: true }] });
  expect(budget.logs.find(([, event]) => event === "stock_deduction_recovery_pass_completed")?.[0]).toBe("warn");
});

test("keeps going after a failed order and fails only when listing companies fails", async () => {
  const f = fixture({ [company(1)]: [order(1), order(2)] }, () => deducted, { passOffsetsMs: [0] });
  let first = true;
  const publish = f.deps.publishOverdueInOwnTransaction;
  const flaky = { ...f.deps, publishOverdueInOwnTransaction: async (companyId: CompanyId, orderId: OrderId) => {
    if (first) { first = false; return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }); }
    return publish(companyId, orderId);
  } };
  expect(await recoverDueStockDeductions(new AbortController().signal, flaky)).toMatchObject({ success: true, data: [{ candidates: 2, failed: 1, deducted: 1 }] });
  const down = { ...f.deps, listCompaniesWithOverdueStockDeductions: async () => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }) };
  expect(await recoverDueStockDeductions(new AbortController().signal, down)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  // One failed listing does not stop the other passes.
  let calls = 0;
  const partial = { ...f.deps, passOffsetsMs: [0, 20_000], listCompaniesWithOverdueStockDeductions: async () => (calls++ === 0 ? err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" }) : ok([] as CompanyId[])) };
  expect(await recoverDueStockDeductions(new AbortController().signal, partial)).toMatchObject({ success: true, data: [{ pass: 2 }] });
});

test("the schedule recovers a due order within one minute: every pass is at most twenty seconds from the next and a run ends before the next one starts", () => {
  expect(STOCK_DEDUCTION_RECOVERY_CRON).toBe("* * * * *");
  const offsets = STOCK_DEDUCTION_RECOVERY_PASS_OFFSETS_MS;
  const starts = [...offsets, 60_000 + offsets[0]];
  const longestWait = Math.max(...starts.slice(1).map((start, index) => start - starts[index]!));
  expect(longestWait).toBeLessThanOrEqual(20_000);
  // An order that becomes due right after a pass starts waits for the next pass, which can itself run up to its time budget.
  expect(longestWait + STOCK_DEDUCTION_RECOVERY_PASS_BUDGET.maxMs).toBeLessThanOrEqual(60_000);
  expect(STOCK_DEDUCTION_RECOVERY_LAST_PASS_START_MS + STOCK_DEDUCTION_RECOVERY_PASS_BUDGET.maxMs).toBeLessThan(stockDeductionRecoveryPolicy.expireInSeconds! * 1000);
  expect(Math.max(...offsets)).toBeLessThanOrEqual(STOCK_DEDUCTION_RECOVERY_LAST_PASS_START_MS);
});
