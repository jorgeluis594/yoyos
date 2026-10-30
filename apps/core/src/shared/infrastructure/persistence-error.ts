import { Prisma } from "@prisma/client";
import type { ContainedErrorCode, ContainedFailure, TransactionEndingError } from "@core/src/shared/application/contained-failure";

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

/**
 * What a capability returns for a failed statement: a transaction-ending error, or a contained failure the savepoint can undo.
 * Anything that is not a database failure is rethrown. `stage` is filled in by the use case that knows which step failed.
 */
export function persistenceFailureResult(cause: unknown, message: string): TransactionEndingError | ContainedFailure {
  const kind = classifyPersistenceFailure(cause);
  if (kind === undefined) throw cause;
  if (kind.kind === "transaction_ending") return { code: "PERSISTENCE_UNAVAILABLE", message, transactionEnding: true };
  return { code: "CONTAINED_FAILURE", errorCode: kind.errorCode, message, cause };
}

/** For a read made outside any savepoint: a failed statement already ended the transaction, so every database failure ends it. */
export function transactionEndingOrThrow(cause: unknown, message: string): TransactionEndingError {
  if (classifyPersistenceFailure(cause) === undefined) throw cause;
  return { code: "PERSISTENCE_UNAVAILABLE", message, transactionEnding: true };
}
