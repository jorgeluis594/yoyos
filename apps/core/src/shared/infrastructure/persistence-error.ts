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
