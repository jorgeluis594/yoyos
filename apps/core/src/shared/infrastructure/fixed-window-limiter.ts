import type { LimiterDecision } from "@core/src/shared/application/limiter-decision";

export type { LimiterDecision };

type Window = { windowStart: number; count: number };

export type FixedWindowLimiter = ((key: string) => LimiterDecision) & Readonly<{
  /** Windows currently held, stale ones included until the next sweep (tests and diagnostics). */
  size: () => number;
}>;

// shortcut: per process, resets on deploy; move to PostgreSQL or Redis when there is more than one web instance.
/**
 * Counts calls per key in fixed windows. Stale windows are swept at most once per window, not on every call.
 * `onFirstRejection` fires once per key per window, for callers that log the first refusal only.
 */
export function createFixedWindowLimiter(limit: number, windowMs: number, now: () => number = Date.now, onFirstRejection?: (key: string) => void): FixedWindowLimiter {
  const windows = new Map<string, Window>();
  let lastSweep = now();
  const decide = (key: string): LimiterDecision => {
    const at = now();
    if (at - lastSweep >= windowMs) {
      for (const [stale, window] of windows) if (at - window.windowStart >= windowMs) windows.delete(stale);
      lastSweep = at;
    }
    let window = windows.get(key);
    if (window === undefined || at - window.windowStart >= windowMs) {
      window = { windowStart: at, count: 0 };
      windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= limit) return { allowed: true };
    if (window.count === limit + 1) onFirstRejection?.(key);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.windowStart + windowMs - at) / 1000)) };
  };
  return Object.assign(decide, { size: () => windows.size });
}
