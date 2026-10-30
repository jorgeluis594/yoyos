/** Failure vocabulary shared by capabilities (infrastructure) and the use cases that react to them, so application code never imports infrastructure. */

/** A statement-level database error (or a data fault) that a savepoint can undo; the producer's transaction stays valid. */
export type ContainedErrorCode = "LOCK_TIMEOUT" | "STATEMENT_TIMEOUT" | "DEADLOCK" | "DATABASE_ERROR";
export type ContainedFailureCode = ContainedErrorCode | "INVALID_STORED_DATA" | "UNEXPECTED_ROW_COUNT";
export type ContainedFailure = Readonly<{ code: "CONTAINED_FAILURE"; errorCode: ContainedFailureCode; stage?: string; message: string; cause?: unknown;
  /** Work done before the failure that the outcome may still report (candidates a restock had listed). */
  candidates?: number }>;

/** The only other failure a capability returns instead of throwing: it ends the whole transaction (Prisma timeout, lost connection). */
export type TransactionEndingError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string; transactionEnding: true }>;
