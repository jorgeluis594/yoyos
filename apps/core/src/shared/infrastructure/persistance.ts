import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { AppError, Result } from "@shared/result";

type TransactionScope = { companyId: string; tx: Prisma.TransactionClient; aborted: boolean; abortCause?: unknown; active: boolean; afterCommit: (() => void)[] };
type PrismaState = {
  base: PrismaClient;
  companies: AsyncLocalStorage<string>;
  transactions: AsyncLocalStorage<TransactionScope>;
};
/** The adapter ignores URL pool parameters, so the pool size comes from DATABASE_POOL_MAX (worker 24, web server unset = driver default 10). */
export function prismaPoolConfig(env: Record<string, string | undefined> = process.env): { connectionString: string; max?: number } {
  const connectionString = env.DATABASE_URL ?? "";
  const configured = env.DATABASE_POOL_MAX;
  if (configured === undefined || configured === "") return { connectionString };
  if (!/^[1-9][0-9]*$/.test(configured)) throw new Error("DATABASE_POOL_MAX must be a positive integer");
  return { connectionString, max: Number(configured) };
}

const globalPrisma = globalThis as typeof globalThis & { __yoyosPrisma?: PrismaState };
const { base, companies, transactions } = globalPrisma.__yoyosPrisma ??= {
  base: new PrismaClient({ adapter: new PrismaPg(prismaPoolConfig()) }),
  companies: new AsyncLocalStorage<string>(),
  transactions: new AsyncLocalStorage<TransactionScope>(),
};

export const systemPrisma = base;

export function withTenantIsolation<T>(companyId: string, callback: () => T): T {
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

export function requireActiveTransaction(companyId: string): void {
  const scope = transactions.getStore();
  if (!scope?.active || scope.aborted || scope.companyId !== companyId || getCompanyId() !== companyId)
    throw new Error("An active transaction for this company is required");
}

export function inActiveTransaction(): boolean {
  return transactions.getStore()?.active === true;
}

export function requireNoActiveTransaction(): void {
  if (transactions.getStore()?.active) throw new Error("Operation requires an independent transaction");
}

export function afterTransactionCommit(observe: () => void): void {
  const scope = transactions.getStore();
  if (scope?.active) scope.afterCommit.push(observe);
  else observe();
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

type OperationResult = Result<unknown, AppError>;

/** Lock the row selected by a parameterized query until the enclosing transaction ends. */
export async function withLockedForUpdate<Row, R extends OperationResult>(
  companyId: string,
  query: Prisma.Sql,
  callback: (row: Row | null) => Promise<R> | R,
): Promise<R> {
  requireActiveTransaction(companyId);
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`${query} FOR UPDATE`);
  return callback(rows[0] ?? null);
}

export type TransactionOptions = Readonly<{
  /** Prisma interactive-transaction timer, in milliseconds. */
  timeout?: number;
  maxWait?: number;
  isolationLevel?: "ReadCommitted" | "RepeatableRead" | "Serializable";
  /** Transaction-local PostgreSQL settings, sent in the same round-trip as the tenant context. */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}>;

async function openContext(tx: Prisma.TransactionClient, companyId: string, options: TransactionOptions) {
  // Only the limits the caller names are set; the other keeps the server value.
  const settings = [
    Prisma.sql`set_config('app.company_id', ${companyId}, true)`,
    ...options.lockTimeoutMs === undefined ? [] : [Prisma.sql`set_config('lock_timeout', ${`${options.lockTimeoutMs}ms`}, true)`],
    ...options.statementTimeoutMs === undefined ? [] : [Prisma.sql`set_config('statement_timeout', ${`${options.statementTimeoutMs}ms`}, true)`],
  ];
  await tx.$queryRaw(Prisma.sql`SELECT ${Prisma.join(settings)}`);
}

/** Options apply when this call opens the outermost transaction; inside an active one they are ignored. */
export async function withinTransaction<R extends OperationResult>(callback: () => Promise<R> | R, options: TransactionOptions = {}): Promise<R> {
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
  let committedResult: R;
  const afterCommit: (() => void)[] = [];
  const rollback = new Error("Rollback requested by failed Result");
  try {
    committedResult = await base.$transaction(async (tx) => {
      await openContext(tx, companyId, options);
      const activeScope: TransactionScope = { companyId, tx, aborted: false, active: true, afterCommit };
      try {
        const result = await transactions.run(activeScope, callback);
        if (!result.success) failedResult = result;
        if (activeScope.aborted || failedResult) { rollback.cause = activeScope.abortCause ?? failedResult; throw rollback; }
        return result;
      } finally { activeScope.active = false; }
    }, {
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      ...(options.maxWait === undefined ? {} : { maxWait: options.maxWait }),
      ...(options.isolationLevel === undefined ? {} : { isolationLevel: Prisma.TransactionIsolationLevel[options.isolationLevel] }),
    });
  } catch (error) {
    if (error === rollback) {
      if (failedResult) return failedResult;
      throw new Error("Transaction aborted by a nested operation", { cause: error });
    }
    throw error;
  }
  for (const observe of afterCommit) observe();
  return committedResult;
}

/** Runs several reads against one snapshot, so a concurrent commit cannot show up between two queries. Inside an active transaction it simply joins it. */
export async function withinReadSnapshot<T>(read: () => Promise<T>): Promise<T> {
  const result = await withinTransaction(async () => ({ success: true as const, data: await read() }), { isolationLevel: "RepeatableRead" });
  return result.data;
}
