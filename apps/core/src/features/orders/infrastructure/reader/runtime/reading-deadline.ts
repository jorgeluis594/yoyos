type Clock = () => number;

/** Ids for the logs; never text. */
export type ReadingLogMeta = Readonly<{ companyId?: string; messageId?: string }>;

const readings = new WeakMap<AbortSignal, Readonly<{ deadline: number; meta: ReadingLogMeta }>>();

/**
 * The reading budget (`READER_READING_BUDGET_MS`): one signal for the whole reading that aborts with the job signal and when the budget
 * ends. Stages read what is left of it through `remainingMsOf` and the ids for their logs through `logMetaOf`, so the port signatures stay
 * `(…, signal)`.
 */
export function createReadingDeadline(budgetMs: number, meta: ReadingLogMeta, now: Clock = Date.now, jobSignal?: AbortSignal): Readonly<{ signal: AbortSignal }> {
  const budget = AbortSignal.timeout(budgetMs);
  const signal = jobSignal ? AbortSignal.any([jobSignal, budget]) : AbortSignal.any([budget]);
  readings.set(signal, { deadline: now() + budgetMs, meta });
  return { signal };
}

/** A signal that also aborts with `extra` and keeps the budget and log ids of `reading` (a plain `AbortSignal.any` would lose them). */
export function withAbort(reading: AbortSignal, extra: AbortSignal): AbortSignal {
  const derived = AbortSignal.any([reading, extra]);
  const carried = readings.get(reading);
  if (carried) readings.set(derived, carried);
  return derived;
}

/** Milliseconds left of the reading budget the signal carries; infinite for a signal without one. */
export function remainingMsOf(signal: AbortSignal, now: Clock = Date.now): number {
  const carried = readings.get(signal);
  return carried === undefined ? Infinity : Math.max(0, carried.deadline - now());
}

/** The company and message ids of the reading the signal carries; empty for a plain signal. */
export const logMetaOf = (signal: AbortSignal): ReadingLogMeta => readings.get(signal)?.meta ?? {};
