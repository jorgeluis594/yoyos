import { err } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { inActiveTransaction, prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure, transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import { isStatementTimeout } from "@core/src/shared/infrastructure/statement-timeout";

/** `maxStatements × statementTimeoutMs + maxWait` must stay within `timeout`, so the statement limit always fires before the Prisma timer. */
export type ReadBudget = Readonly<{ maxWait: number; timeout: number; statementTimeoutMs: number; maxStatements: number }>;

export type BudgetedReadError =
  | Readonly<{ code: "STATEMENT_TIMEOUT"; message: string }>
  | Readonly<{ code: "TRANSACTION_TIMEOUT"; message: string }>       // the Prisma timer or maxWait (P2028)
  | Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

const messages = {
  STATEMENT_TIMEOUT: "A read exceeded its time limit",
  TRANSACTION_TIMEOUT: "The read transaction timed out",
  PERSISTENCE_UNAVAILABLE: "Unable to read",
} as const;

/** The failure a thrown error stands for; anything that is not a database failure is rethrown. */
export function classifyReadFailure(cause: unknown): BudgetedReadError {
  if (isStatementTimeout(cause)) return { code: "STATEMENT_TIMEOUT", message: messages.STATEMENT_TIMEOUT };
  if (transactionFailureStage(cause) === "transaction_timeout") return { code: "TRANSACTION_TIMEOUT", message: messages.TRANSACTION_TIMEOUT };
  if (isPersistenceFailure(cause)) return { code: "PERSISTENCE_UNAVAILABLE", message: messages.PERSISTENCE_UNAVAILABLE };
  throw cause;
}

/**
 * One repeatable-read snapshot with the budget, `jit` off and a statement timeout; inside an open transaction it joins it,
 * and the outer snapshot reports the failure. A thrown database failure becomes a result and goes to `onFailure` once, with its duration;
 * the snapshot logs nothing by itself, each caller owns its event.
 */
export function budgetedSnapshot(budget: ReadBudget, onFailure?: (failure: BudgetedReadError, cause: unknown, durationMs: number) => void) {
  return async <T, E extends AppError>(read: () => Promise<Result<T, E>>): Promise<Result<T, E | BudgetedReadError>> => {
    if (inActiveTransaction()) return read();
    const started = performance.now();
    try {
      return await withinTransaction(async () => {
        await prisma.$queryRaw`SELECT set_config('jit', 'off', true)`;
        return read();
      }, { isolationLevel: "RepeatableRead", maxWait: budget.maxWait, timeout: budget.timeout, statementTimeoutMs: budget.statementTimeoutMs });
    } catch (cause) {
      const failure = classifyReadFailure(cause);
      onFailure?.(failure, cause, Math.round(performance.now() - started));
      return err(failure);
    }
  };
}
