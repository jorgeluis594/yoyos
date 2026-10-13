const baseDelayMs = 2_000;
const maxDelayMs = 5 * 60_000;

/** Exponential backoff with full jitter: a random wait up to min(cap, base·2^failures), never under one second. */
export function retryDelay(failures: number, random: () => number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, failures - 1));
  return Math.max(1_000, Math.round(random() * ceiling));
}

export type PendingOrderSyncSummary = Readonly<{ waiting: number }>;

type Timers = Readonly<{
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  random: () => number;
}>;

/**
 * Sends queued sales for one company at a time. While some remain waiting it retries with
 * `retryDelay`; `trigger` (app opened, back online, new sale queued) retries at once and resets the backoff.
 */
export function createPendingOrderSync(sync: (companyId: string) => Promise<PendingOrderSyncSummary>, timers: Timers,
  onSynced: (companyId: string) => void = () => {}) {
  let companyId = "";
  let failures = 0;
  let timer: unknown = null;
  let running = false;
  let again = false;
  const cancelTimer = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  const run = async (): Promise<void> => {
    if (!companyId) return;
    if (running) { again = true; return; }
    running = true; again = false; cancelTimer();
    const current = companyId;
    const summary = await sync(current).catch(() => ({ waiting: 1 }));
    running = false;
    if (current !== companyId) return run();
    onSynced(current);
    if (again) return run();
    if (!summary.waiting) { failures = 0; return; }
    failures += 1;
    timer = timers.setTimeout(() => { timer = null; void run(); }, retryDelay(failures, timers.random));
  };
  return {
    start: (next: string) => { if (next === companyId) return; companyId = next; failures = 0; void run(); },
    stop: () => { companyId = ""; failures = 0; cancelTimer(); },
    trigger: () => { failures = 0; void run(); },
  };
}
