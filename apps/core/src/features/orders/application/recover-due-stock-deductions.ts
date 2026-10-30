import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type RecoveryPassOutput = Readonly<{ pass: number; companies: number; candidates: number; deducted: number; short: number;
  notDue: number; skippedLocked: number; failed: number; quarantined: number; failedCompanies: number; budgetExhausted: boolean;
  listCompaniesMs: number; durationMs: number }>;
export type RecoveryLog = (level: "info" | "warn" | "error", event: string, fields: Readonly<Record<string, unknown>>) => void;
export type RecoverDueStockDeductionsDependencies = Readonly<{
  /** Definer function: company ids that have overdue orders (full due rule and fit); one statement. */
  listCompaniesWithOverdueStockDeductions: () => Promise<Result<readonly CompanyId[], PersistenceError>>;
  /** Full due rule and fit, partial index, createdAt, id order, under RLS in its own tenant transaction; ids in `exclude` are left out. */
  listOverdueOrderIds: (companyId: CompanyId, limit: number, exclude: readonly OrderId[]) => Promise<Result<readonly OrderId[], PersistenceError>>;
  /** Own tenant transaction { timeout 3000, lockTimeoutMs 1000, statementTimeoutMs 1000 }: lock the order FOR NO KEY UPDATE SKIP LOCKED, publish order_stock_deduction_overdue. */
  publishOverdueInOwnTransaction: (companyId: CompanyId, orderId: OrderId) => Promise<Result<DeductionOutcome, PersistenceError>>;
  /** Worker-local quarantine of orders whose last outcome was a data fault; ephemeral, never persisted. */
  quarantine: Readonly<{ list: (now: Date) => readonly OrderId[]; add: (id: OrderId, now: Date) => boolean }>;
  wait: (ms: number, signal: AbortSignal) => Promise<"elapsed" | "aborted">;
  /** Increases by one on every pass of this worker; the company that goes first rotates with it. */
  passSequence: () => number;
  log: RecoveryLog;
  passOffsetsMs: readonly number[];
  lastPassStartMs: number;
  passBudget: Readonly<{ maxOrders: number; maxMs: number }>;
  clock: () => Date;
}>;

/** Initial values, adjustable. */
export const STOCK_DEDUCTION_RECOVERY_CRON = "* * * * *";
export const STOCK_DEDUCTION_RECOVERY_PASS_OFFSETS_MS = [0, 20_000, 40_000] as const;
export const STOCK_DEDUCTION_RECOVERY_LAST_PASS_START_MS = 45_000;
export const STOCK_DEDUCTION_RECOVERY_PASS_BUDGET = { maxOrders: 200, maxMs: 10_000 } as const;
export const STOCK_DEDUCTION_FAILURE_QUARANTINE_MINUTES = 10;

const dataFaults = new Set(["INVALID_STORED_DATA", "UNEXPECTED_ROW_COUNT"]);
type Counts = { candidates: number; deducted: number; short: number; notDue: number; skippedLocked: number; failed: number; quarantined: number; failedCompanies: number };

/** One run of the recovery job: up to three passes that re-publish the due, fitting and still undeducted orders, oldest first within each company. */
export async function recoverDueStockDeductions(signal: AbortSignal, deps: RecoverDueStockDeductionsDependencies): Promise<Result<readonly RecoveryPassOutput[], PersistenceError>> {
  const runStart = deps.clock().getTime();
  const outputs: RecoveryPassOutput[] = [];
  let listingFailure: PersistenceError | null = null;
  for (const [index, offset] of deps.passOffsetsMs.entries()) {
    const delay = runStart + offset - deps.clock().getTime();
    if (delay > 0 && await deps.wait(delay, signal) === "aborted") break;
    if (signal.aborted) break;
    if (deps.clock().getTime() - runStart > deps.lastPassStartMs) continue;
    const pass = await runPass(index + 1, signal, deps);
    if (pass.success) outputs.push(pass.data); else listingFailure = pass.error;
  }
  return outputs.length === 0 && listingFailure ? err(listingFailure) : ok(outputs);
}

async function runPass(pass: number, signal: AbortSignal, deps: RecoverDueStockDeductionsDependencies): Promise<Result<RecoveryPassOutput, PersistenceError>> {
  const started = deps.clock().getTime();
  const sequence = deps.passSequence();
  const listed = await deps.listCompaniesWithOverdueStockDeductions();
  const listCompaniesMs = deps.clock().getTime() - started;
  if (!listed.success) {
    deps.log("error", "stock_deduction_recovery_failed", { stage: "list_companies", errorCode: listed.error.code });
    return listed;
  }
  const counts: Counts = { candidates: 0, deducted: 0, short: 0, notDue: 0, skippedLocked: 0, failed: 0, quarantined: 0, failedCompanies: 0 };
  const companies = listed.data;
  const share = Math.max(1, Math.floor(deps.passBudget.maxOrders / Math.max(1, companies.length)));
  const rotated = companies.length === 0 ? [] : [...companies.slice(sequence % companies.length), ...companies.slice(0, sequence % companies.length)];
  let remaining = deps.passBudget.maxOrders;
  let budgetExhausted = false;
  const processed = new Set<OrderId>();
  const outOfBudget = () => remaining <= 0 || deps.clock().getTime() - started >= deps.passBudget.maxMs;

  const serve = async (companyId: CompanyId, limit: number): Promise<number> => {
    const ids = await deps.listOverdueOrderIds(companyId, limit, [...deps.quarantine.list(deps.clock()), ...processed]);
    if (!ids.success) {
      counts.failedCompanies += 1;
      deps.log("error", "stock_deduction_recovery_failed", { stage: "list_orders", errorCode: ids.error.code, companyId });
      return 0;
    }
    for (const orderId of ids.data) {
      if (signal.aborted) break;
      if (outOfBudget()) { budgetExhausted = true; break; }
      remaining -= 1;
      counts.candidates += 1;
      processed.add(orderId);
      await recoverOrder(companyId, orderId, counts, deps);
    }
    return ids.data.length;
  };

  const filled: CompanyId[] = [];
  for (const companyId of rotated) {
    if (signal.aborted) break;
    if (outOfBudget()) { budgetExhausted = true; break; }
    const limit = Math.min(remaining, share);
    if (await serve(companyId, limit) === limit) filled.push(companyId);
  }
  // Budget a company did not use goes to the companies that still had more, in the same rotation.
  for (const companyId of filled) {
    if (signal.aborted || remaining <= 0) break;
    if (outOfBudget()) { budgetExhausted = true; break; }
    await serve(companyId, remaining);
  }
  // A company that filled its whole share may have more: with the budget spent, those candidates wait for the next pass.
  if (remaining <= 0 && filled.length > 0) budgetExhausted = true;
  const durationMs = deps.clock().getTime() - started;
  const output: RecoveryPassOutput = { pass, companies: companies.length, ...counts, budgetExhausted, listCompaniesMs, durationMs };
  deps.log(durationMs > 3000 || listCompaniesMs > 1000 || budgetExhausted ? "warn" : "info", "stock_deduction_recovery_pass_completed", output);
  return ok(output);
}

async function recoverOrder(companyId: CompanyId, orderId: OrderId, counts: Counts, deps: RecoverDueStockDeductionsDependencies) {
  const published = await deps.publishOverdueInOwnTransaction(companyId, orderId);
  if (!published.success) {
    counts.failed += 1;
    deps.log("error", "stock_deduction_recovery_failed", { stage: "publish", errorCode: published.error.code, companyId });
    return;
  }
  const outcome = published.data;
  switch (outcome.kind) {
    case "deducted": counts.deducted += 1; deps.log("warn", "stock_deduction_recovered", { companyId, orderId }); return;
    case "short": counts.short += 1; return;
    case "not_due": counts.notDue += 1; return;
    case "skipped_locked": counts.skippedLocked += 1; return;
    case "failed":
      counts.failed += 1;
      // A data fault needs manual diagnosis: it is left alone for ten minutes and reported once per quarantine. Database errors are retried by the next pass.
      if (dataFaults.has(outcome.errorCode) && deps.quarantine.add(orderId, deps.clock())) {
        counts.quarantined += 1;
        deps.log("error", "stock_deduction_failed", { companyId, orderId, trigger: "order_stock_deduction_overdue", stage: outcome.stage, errorCode: outcome.errorCode });
      }
      return;
  }
}
