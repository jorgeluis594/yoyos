type Window = { windowStart: number; count: number };

// shortcut: per process, resets on deploy; move to PostgreSQL or Redis when there is more than one web instance.
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const windows = new Map<string, Window>();
  return (key: string): boolean => {
    const at = now();
    for (const [stale, window] of windows) if (at - window.windowStart >= windowMs) windows.delete(stale);
    const window = windows.get(key) ?? { windowStart: at, count: 0 };
    window.count += 1;
    windows.set(key, window);
    return window.count <= limit;
  };
}

const configured = Number(process.env.CATALOG_ORDER_RATE_LIMIT);
/** Continuar requests per client IP in a 10-minute fixed window. */
export const allowCatalogOrder = createRateLimiter(Number.isInteger(configured) && configured > 0 ? configured : 20, 10 * 60_000);
