type Clock = () => number;

const deadlines = new WeakMap<AbortSignal, number>();

/**
 * The reading budget (`READER_READING_BUDGET_MS`): one signal for the whole reading that aborts with the job signal and when the budget
 * ends. Stages read what is left of it through `remainingMsOf`, so the port signatures stay `(…, signal)`.
 */
export function createReadingDeadline(budgetMs: number, now: Clock = Date.now, jobSignal?: AbortSignal): Readonly<{ signal: AbortSignal }> {
  const budget = AbortSignal.timeout(budgetMs);
  const signal = jobSignal ? AbortSignal.any([jobSignal, budget]) : AbortSignal.any([budget]);
  deadlines.set(signal, now() + budgetMs);
  return { signal };
}

/** Milliseconds left of the reading budget the signal carries; infinite for a signal without one. */
export function remainingMsOf(signal: AbortSignal, now: Clock = Date.now): number {
  const deadline = deadlines.get(signal);
  return deadline === undefined ? Infinity : Math.max(0, deadline - now());
}
