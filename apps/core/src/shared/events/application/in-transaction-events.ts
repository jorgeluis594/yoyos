import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CompanyId } from "@shared/identity";
import type { ContainedFailure } from "@core/src/shared/infrastructure/persistance";

/**
 * Events whose handler runs synchronously inside the producer's open transaction.
 * An explicit exception to "events after commit" (docs/event-bus.md, "In-transaction events"): only for handlers that write to the
 * same database, are idempotent under the row locks they take, and perform no external I/O.
 * Each feature declares its events by merging into this interface: `{ [name]: { payload: P; outcome: O } }`.
 */
export interface InTransactionEvents {}
type Payload<N extends keyof InTransactionEvents> = InTransactionEvents[N] extends { payload: infer P } ? P : never;
type Outcome<N extends keyof InTransactionEvents> = InTransactionEvents[N] extends { outcome: infer O } ? O : never;
/** Exactly one handler per event: a missing or extra handler is a compile error. */
export type InTransactionRegistry<E> = Readonly<{ [N in keyof InTransactionEvents]: (payload: Payload<N>) => Promise<Result<Outcome<N>, E>> }>;

export type InTransactionPublisherDependencies<E> = Readonly<{
  requireTransaction: (companyId: CompanyId) => void;
  withinSavepoint: <T, F>(work: () => Promise<Result<T, F>>, options: Readonly<{ limitMs: (elapsedMs: number) => number }>) => Promise<Result<T, F | ContainedFailure>>;
  /** The outcome the producer sees when the savepoint contained a statement-level failure of the handler. */
  containedOutcome: <N extends keyof InTransactionEvents>(name: N, payload: Payload<N>, failure: ContainedFailure) => Outcome<N>;
  /** A handler returned a transaction-ending error: the producer will roll back. */
  onTransactionEnding?: (name: keyof InTransactionEvents, error: E) => void;
}>;

/** Listener statement and lock timeouts: below the 5000 ms Prisma timer, so contention ends as a contained timeout, never as P2028. */
export const listenerLimitMs = (elapsedMs: number) => Math.min(1000, 4000 - elapsedMs);

function isContainedFailure(error: unknown): error is ContainedFailure {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "CONTAINED_FAILURE";
}

export function createInTransactionPublisher<E>(registry: InTransactionRegistry<E>, deps: InTransactionPublisherDependencies<E>) {
  return async function publish<N extends keyof InTransactionEvents>(name: N, payload: Payload<N> & Readonly<{ companyId: CompanyId }>): Promise<Result<Outcome<N>, E>> {
    deps.requireTransaction(payload.companyId);
    const handler = registry[name] as (payload: Payload<N>) => Promise<Result<Outcome<N>, E>>;
    const result = await deps.withinSavepoint(() => handler(payload), { limitMs: listenerLimitMs });
    if (result.success) return result;
    if (isContainedFailure(result.error)) return ok(deps.containedOutcome(name, payload, result.error));
    deps.onTransactionEnding?.(name, result.error);
    return { success: false, error: result.error };
  };
}
