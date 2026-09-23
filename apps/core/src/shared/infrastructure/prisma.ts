import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { AppError, Result } from "@shared/result";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }) });
type TransactionScope = { companyId: string; tx: Prisma.TransactionClient; aborted: boolean; abortCause?: unknown; active: boolean };
const companies = new AsyncLocalStorage<string>();
const transactions = new AsyncLocalStorage<TransactionScope>();

export function withCompanyContext<T>(companyId: string, callback: () => T): T {
  const scope = transactions.getStore();
  if (scope?.active && scope.companyId !== companyId) {
    const error = new Error("Cannot change company during a transaction");
    scope.aborted = true;
    scope.abortCause ??= error;
    throw error;
  }
  return companies.run(companyId, callback);
}

export function getCompanyId(): string {
  const companyId = companies.getStore();
  if (!companyId) throw new Error("Company context is required");
  return companyId;
}

async function execute<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const companyId = getCompanyId();
  const scope = transactions.getStore();
  if (scope?.active) {
    if (scope.companyId !== companyId) throw new Error("Cannot change company during a transaction");
    if (scope.aborted) throw new Error("Transaction was already aborted");
    try { return await callback(scope.tx); }
    catch (error) { scope.aborted = true; scope.abortCause ??= error; throw error; }
  }
  return base.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    return callback(tx);
  });
}

// Prisma's query callback retains the original client; dispatch explicitly through tx.
export const prisma = base.$extends({
  query: {
    async $allOperations({ model, operation, args }) {
      if (model && ["User", "Session", "Account", "Verification"].includes(model)) {
        throw new Error("Authentication models require authPrisma");
      }
      return execute(async (tx) => {
        const target = model ? (tx as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[model] : tx as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
        return model
          ? (target as Record<string, (args: unknown) => Promise<unknown>>)[operation](args)
          : (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[operation](...(Array.isArray(args) ? args : [args]));
      });
    },
  },
  client: {
    $transaction() { throw new Error("Use withinTransaction instead of prisma.$transaction"); },
  },
});

export const authPrisma = base.$extends({
  query: {
    async $allOperations({ model, args, query }) {
      if (!model || !["User", "Session", "Account", "Verification"].includes(model)) {
        throw new Error("authPrisma only permits authentication models; raw SQL and tenant queries are forbidden");
      }
      return query(args);
    },
  },
});

export async function createCompanyForUser(userId: string, name: string): Promise<{ companyId: string; created: boolean }> {
  const existing = await authPrisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
  if (!existing) throw new Error("Authenticated user no longer exists");
  if (existing.companyId) return { companyId: existing.companyId, created: false };

  const companyId = crypto.randomUUID();
  const alreadyLinked = new Error("Company was linked concurrently");
  try {
    await base.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      await tx.company.create({ data: { id: companyId, name } });
      const linked = await tx.user.updateMany({ where: { id: userId, companyId: null }, data: { companyId } });
      if (linked.count !== 1) throw alreadyLinked;
    });
    return { companyId, created: true };
  } catch (error) {
    if (error !== alreadyLinked) throw error;
    const user = await authPrisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
    if (!user?.companyId) throw new Error("Company link was lost after a concurrent request", { cause: error });
    return { companyId: user.companyId, created: false };
  }
}

type OperationResult = Result<unknown, AppError>;
export async function withinTransaction<R extends OperationResult>(callback: () => Promise<R> | R): Promise<R> {
  const companyId = getCompanyId();
  const scope = transactions.getStore();
  if (scope?.active) {
    if (scope.companyId !== companyId) throw new Error("Cannot change company during a transaction");
    if (scope.aborted) throw new Error("Transaction was already aborted");
    try {
      const result = await callback();
      if (!result.success) { scope.aborted = true; scope.abortCause ??= result; }
      return result;
    } catch (error) { scope.aborted = true; scope.abortCause ??= error; throw error; }
  }
  let failedResult: R | undefined;
  const rollback = new Error("Rollback requested by failed Result");
  try {
    return await base.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      const activeScope: TransactionScope = { companyId, tx, aborted: false, active: true };
      try {
        const result = await transactions.run(activeScope, callback);
        if (!result.success) failedResult = result;
        if (activeScope.aborted || failedResult) { rollback.cause = activeScope.abortCause ?? failedResult; throw rollback; }
        return result;
      } finally { activeScope.active = false; }
    });
  } catch (error) {
    if (error === rollback) {
      if (failedResult) return failedResult;
      throw new Error("Transaction aborted by a nested operation", { cause: error });
    }
    throw error;
  }
}
