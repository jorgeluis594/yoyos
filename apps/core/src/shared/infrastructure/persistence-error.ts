import { Prisma } from "@prisma/client";

export function isPersistenceFailure(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError
    || cause instanceof Prisma.PrismaClientUnknownRequestError
    || cause instanceof Prisma.PrismaClientInitializationError
    || (cause instanceof Error && cause.name === "DriverAdapterError" && typeof cause.cause === "object" && cause.cause !== null);
}

/** Prisma timeouts and PostgreSQL lock conflicts are the transaction's to report: the editing writes rethrow them instead of answering with a result. */
export function transactionFailureStage(error: unknown): "transaction_timeout" | "lock_conflict" | undefined {
  const text = (value: unknown) => {
    let meta = "";
    try { meta = JSON.stringify((value as { meta?: unknown } | null)?.meta ?? {}); } catch { /* circular driver detail: the message is enough */ }
    return `${value instanceof Error ? value.message : ""} ${meta}`;
  };
  const code = (value: unknown) => typeof value === "object" && value !== null && "code" in value && typeof value.code === "string" ? value.code : undefined;
  const causes = [error, error instanceof Error ? error.cause : undefined];
  if (causes.some((item) => code(item) === "P2028")) return "transaction_timeout";
  if (causes.some((item) => code(item) === "P2034" || /40P01|55P03|deadlock detected|lock timeout/i.test(text(item)))) return "lock_conflict";
  if (causes.some((item) => /57014|statement timeout/i.test(text(item)))) return "transaction_timeout";
  return undefined;
}

export type ContainedErrorCode = "LOCK_TIMEOUT" | "STATEMENT_TIMEOUT" | "DEADLOCK" | "DATABASE_ERROR";
export type PersistenceFailureClass = Readonly<{ kind: "transaction_ending" }> | Readonly<{ kind: "contained"; errorCode: ContainedErrorCode }>;

const closedConnection = /connection (terminated|closed|ended)|ECONNRESET|terminating connection|server closed the connection|transaction already closed|57P0[123]|0800[036]/i;

/**
 * Splits database failures in two. Transaction-ending: Prisma's interactive timeout (P2028) or a lost connection; the whole transaction has to roll back.
 * Contained: any statement-level error, which a savepoint can undo. Not a database failure: undefined.
 */
export function classifyPersistenceFailure(error: unknown): PersistenceFailureClass | undefined {
  if (!isPersistenceFailure(error)) return undefined;
  const text = (value: unknown) => {
    let meta = "";
    try { meta = JSON.stringify((value as { meta?: unknown } | null)?.meta ?? {}); } catch { /* circular driver detail: the message is enough */ }
    return `${value instanceof Error ? value.message : ""} ${meta}`;
  };
  const code = (value: unknown) => typeof value === "object" && value !== null && "code" in value && typeof value.code === "string" ? value.code : undefined;
  const causes = [error, error instanceof Error ? error.cause : undefined];
  if (causes.some((item) => code(item) === "P2028" || closedConnection.test(text(item)))) return { kind: "transaction_ending" };
  if (causes.some((item) => /55P03|lock timeout/i.test(text(item)))) return { kind: "contained", errorCode: "LOCK_TIMEOUT" };
  if (causes.some((item) => /57014|statement timeout/i.test(text(item)))) return { kind: "contained", errorCode: "STATEMENT_TIMEOUT" };
  if (causes.some((item) => code(item) === "P2034" || /40P01|deadlock detected/i.test(text(item)))) return { kind: "contained", errorCode: "DEADLOCK" };
  return { kind: "contained", errorCode: "DATABASE_ERROR" };
}

/** The only failure a stock or order capability returns instead of throwing: it ends the whole transaction. */
export type TransactionEndingError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string; transactionEnding: true }>;

/** Statement-level database errors are thrown so the surrounding savepoint (or transaction) can contain them; transaction-ending ones are returned. */
export function transactionEndingOrThrow(cause: unknown, message: string): TransactionEndingError {
  if (classifyPersistenceFailure(cause)?.kind === "transaction_ending") return { code: "PERSISTENCE_UNAVAILABLE", message, transactionEnding: true };
  throw cause;
}

export type ContainedFailureCode = ContainedErrorCode | "INVALID_STORED_DATA" | "UNEXPECTED_ROW_COUNT";

/** Thrown by a savepoint handler to roll the savepoint back and report a contained failure (data fault or statement-level error) with the stage it happened in. */
export class ContainedFailureSignal extends Error {
  constructor(readonly errorCode: ContainedFailureCode, readonly stage: string, readonly origin?: unknown) {
    super(`Contained failure ${errorCode} at ${stage}`);
    this.name = "ContainedFailureSignal";
  }
}

/** Runs one step of a savepoint handler: a contained database error becomes a signal that names the stage; anything else passes through. */
export async function atStage<T>(stage: string, step: () => Promise<T>): Promise<T> {
  try { return await step(); }
  catch (cause) {
    const kind = classifyPersistenceFailure(cause);
    if (kind?.kind === "contained") throw new ContainedFailureSignal(kind.errorCode, stage, cause);
    throw cause;
  }
}
