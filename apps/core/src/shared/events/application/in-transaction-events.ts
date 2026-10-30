import { ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import type { CompanyId } from "@shared/identity";
import type { ContainedFailure } from "@core/src/shared/application/contained-failure";

/**
 * Events whose handler runs synchronously inside the producer's open transaction.
 * An explicit exception to "events after commit" (docs/event-bus.md, "In-transaction events"): only for handlers that write to the
 * same database, are idempotent under the row locks they take, and perform no external I/O.
 * Each feature declares its events by merging into this interface: `{ [name]: { payload: P; outcome: O } }`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by declaration merging in each feature
export interface InTransactionEvents {}
type Payload<N extends keyof InTransactionEvents> = InTransactionEvents[N] extends { payload: infer P } ? P : never;
type Outcome<N extends keyof InTransactionEvents> = InTransactionEvents[N] extends { outcome: infer O } ? O : never;
/** Exactly one handler per event: a missing or extra handler is a compile error. */
export type InTransactionRegistry<E extends AppError> = Readonly<{ [N in keyof InTransactionEvents]: (payload: Payload<N>) => Promise<Result<Outcome<N>, E>> }>;

export type InTransactionPublisherDependencies = Readonly<{
  requireTransaction: (companyId: CompanyId) => void;
  withinSavepoint: <T, F extends AppError>(work: () => Promise<Result<T, F>>, options: Readonly<{ limitMs: (elapsedMs: number, transactionTimeoutMs: number) => number }>) => Promise<Result<T, F | ContainedFailure>>;
  /** The outcome the producer sees when the savepoint contained a statement-level failure of the handler. */
  containedOutcome: <N extends keyof InTransactionEvents>(name: N, payload: Payload<N>, failure: ContainedFailure) => Outcome<N>;
  /** A handler returned a transaction-ending error, or the savepoint rethrew one: the producer will roll back. */
  onTransactionEnding?: (name: keyof InTransactionEvents, payload: Readonly<{ companyId: CompanyId }>, error: unknown) => void;
}>;

/** Listener statement and lock timeouts: at most 1000 ms and always a second below the producer transaction's own timer (5000 ms by default, 3000 ms in recovery), so contention ends as a contained timeout, never as P2028. */
export const listenerLimitMs = (elapsedMs: number, transactionTimeoutMs: number) => Math.min(1000, transactionTimeoutMs - 1000 - elapsedMs);

function isContainedFailure(error: unknown): error is ContainedFailure {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "CONTAINED_FAILURE";
}

/** A contained failure becomes the event's `failed` outcome, so what the producer can receive as an error is what is left of E. */
export type PublishError<E> = Exclude<E, ContainedFailure>;

export function createInTransactionPublisher<E extends AppError>(registry: InTransactionRegistry<E>, deps: InTransactionPublisherDependencies) {
  return async function publish<N extends keyof InTransactionEvents>(name: N, payload: Payload<N> & Readonly<{ companyId: CompanyId }>): Promise<Result<Outcome<N>, PublishError<E>>> {
    deps.requireTransaction(payload.companyId);
    const handler = registry[name] as (payload: Payload<N>) => Promise<Result<Outcome<N>, E>>;
    let result;
    try { result = await deps.withinSavepoint(() => handler(payload), { limitMs: listenerLimitMs }); }
    catch (error) { deps.onTransactionEnding?.(name, payload, error); throw error; }
    if (result.success) return result;
    if (isContainedFailure(result.error)) return ok(deps.containedOutcome(name, payload, result.error));
    deps.onTransactionEnding?.(name, payload, result.error);
    return { success: false, error: result.error as PublishError<E> };
  };
}
