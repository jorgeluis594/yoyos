import { budgetedSnapshot, type BudgetedReadError, type ReadBudget } from "@core/src/shared/infrastructure/budgeted-snapshot";

/**
 * The budget of every sales tool, fixed here: `maxStatements × statementTimeoutMs + maxWait` is the transaction timer, so on every path the
 * statement limit fires before the Prisma timer. Only this file changes it; a tool whose measured count differs escalates instead of editing it.
 */
export const salesReadBudget = { maxWait: 1000, timeout: 10000, statementTimeoutMs: 1500, maxStatements: 6 } as const satisfies ReadBudget;

/** Counted as memory 03011cbe: overhead 2 (the tenant and timeout `set_config`, `jit` off), plus the storefront read where the tool reads the currency, plus its reads. */
export const salesPathStatements = { summary: 4, best_sellers: 5, unsold: 4 } as const;

export type SalesReadError = BudgetedReadError;

/** One repeatable-read snapshot with the sales budget; logs nothing, the composition guard owns the `sales_read_failed` event. */
export const salesSnapshot = budgetedSnapshot(salesReadBudget);
