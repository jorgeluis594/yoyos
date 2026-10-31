import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, inActiveTransaction, prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure, transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import { isStatementTimeout } from "@core/src/features/products/infrastructure/statement-timeout";
import type { AssistantReadError, AssistantSnapshot } from "@core/src/features/products/application/assistant-read";

export type { AssistantReadError, AssistantSnapshot };

/** `maxStatements × statementTimeoutMs + maxWait` must stay within `timeout`, so the statement limit always fires before the Prisma timer. */
export const assistantReadBudget = { maxWait: 1000, timeout: 5000, statementTimeoutMs: 350, maxStatements: 11 } as const;

export type AssistantReadOperation = "search" | "detail";

const messages = {
  STATEMENT_TIMEOUT: "A product read exceeded its time limit",
  TRANSACTION_TIMEOUT: "The product read transaction timed out",
  PERSISTENCE_UNAVAILABLE: "Unable to read products",
} as const;

/** The failure a thrown error stands for; anything that is not a database failure is rethrown. */
export function assistantReadFailure(cause: unknown): AssistantReadError & Readonly<{ code: "STATEMENT_TIMEOUT" | "TRANSACTION_TIMEOUT" | "PERSISTENCE_UNAVAILABLE" }> {
  if (isStatementTimeout(cause)) return { code: "STATEMENT_TIMEOUT", message: messages.STATEMENT_TIMEOUT };
  if (transactionFailureStage(cause) === "transaction_timeout") return { code: "TRANSACTION_TIMEOUT", message: messages.TRANSACTION_TIMEOUT };
  if (isPersistenceFailure(cause)) return { code: "PERSISTENCE_UNAVAILABLE", message: messages.PERSISTENCE_UNAVAILABLE };
  throw cause;
}

/**
 * One repeatable-read snapshot with the budget, `jit` off and a statement timeout; inside an open transaction it joins it,
 * and the outer snapshot reports the failure. A thrown timeout becomes a result and is logged once as `product_search_failed`.
 */
export function assistantSnapshot(operation: AssistantReadOperation): AssistantSnapshot {
  return async <T, E>(read: () => Promise<Result<T, E>>): Promise<Result<T, E | AssistantReadError>> => {
    if (inActiveTransaction()) return read();
    const started = performance.now();
    try {
      return await withinTransaction(async () => {
        await prisma.$queryRaw`SELECT set_config('jit', 'off', true)`;
        return read();
      }, { isolationLevel: "RepeatableRead", maxWait: assistantReadBudget.maxWait, timeout: assistantReadBudget.timeout, statementTimeoutMs: assistantReadBudget.statementTimeoutMs });
    } catch (cause) {
      const failure = assistantReadFailure(cause);
      log.error({ event: "product_search_failed", companyId: getCompanyId(), operation, errorCode: failure.code, durationMs: Math.round(performance.now() - started), err: cause }, "product_search_failed");
      return err(failure);
    }
  };
}
