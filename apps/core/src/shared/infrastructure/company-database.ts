import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import type { AppError, Result } from "@shared/result";
import { prisma } from "./prisma.js";

type OperationResult = Result<unknown, AppError>;
type TransactionScope = {
  companyId: string;
  tx: Prisma.TransactionClient;
  aborted: boolean;
  abortCause?: unknown;
  active: boolean;
};

const companyContext = new AsyncLocalStorage<string>();
const transactionContext = new AsyncLocalStorage<TransactionScope>();

export function withCompanyContext<T>(companyId: string, callback: () => T): T {
  const scope = transactionContext.getStore();
  if (scope?.active && scope.companyId !== companyId) {
    throw new Error("Cannot change company during a transaction");
  }
  return companyContext.run(companyId, callback);
}

function currentCompanyId(): string {
  const companyId = companyContext.getStore();
  if (!companyId) throw new Error("Company context is required");
  return companyId;
}

export async function withinTransaction<R extends OperationResult>(
  callback: () => Promise<R> | R,
): Promise<R> {
  const companyId = currentCompanyId();
  const scope = transactionContext.getStore();

  if (scope?.active) {
    if (scope.companyId !== companyId) throw new Error("Cannot change company during a transaction");
    if (scope.aborted) throw new Error("Transaction was already aborted");
    try {
      const result = await callback();
      if (!result.success) {
        scope.aborted = true;
        scope.abortCause ??= result;
      }
      return result;
    } catch (error) {
      scope.aborted = true;
      scope.abortCause ??= error;
      throw error;
    }
  }

  let failedResult: R | undefined;
  const rollback = new Error("Rollback requested by failed Result");
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      const activeScope: TransactionScope = { companyId, tx, aborted: false, active: true };
      try {
        const result = await transactionContext.run(activeScope, callback);
        if (!result.success) failedResult = result;
        if (activeScope.aborted || failedResult) {
          rollback.cause = activeScope.abortCause ?? failedResult;
          throw rollback;
        }
        return result;
      } finally {
        activeScope.active = false;
      }
    });
  } catch (error) {
    if (error === rollback) {
      if (failedResult) return failedResult;
      throw new Error("Transaction aborted by a nested operation", { cause: error });
    }
    throw error;
  }
}

export function withCompanyDatabase<R extends OperationResult>(
  callback: (tx: Prisma.TransactionClient, companyId: string) => Promise<R> | R,
): Promise<R> {
  return withinTransaction(() => {
    const scope = transactionContext.getStore();
    if (!scope?.active) throw new Error("Transaction context is required");
    return callback(scope.tx, scope.companyId);
  });
}
