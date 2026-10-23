import { log } from "@core/src/shared/infrastructure/logger";

type Window = { windowStart: number; count: number };

// shortcut: per process, resets on deploy; move to PostgreSQL or Redis when there is more than one web instance.
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now, onFirstRejection?: (key: string) => void) {
  const windows = new Map<string, Window>();
  return (key: string): boolean => {
    const at = now();
    for (const [stale, window] of windows) if (at - window.windowStart >= windowMs) windows.delete(stale);
    const window = windows.get(key) ?? { windowStart: at, count: 0 };
    window.count += 1;
    windows.set(key, window);
    if (window.count === limit + 1) onFirstRejection?.(key);
    return window.count <= limit;
  };
}

const configuredLimit = (name: string, fallback: number) => {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
};

/** Continuar requests per client IP in a 10-minute fixed window. */
export const allowCatalogOrder = createRateLimiter(configuredLimit("CATALOG_ORDER_RATE_LIMIT", 20), 10 * 60_000);

/** Availability checks per seller (user id) in a one-minute fixed window; only the first rejection per window is logged, with the request's company. */
export const allowSubdomainCheck = createRateLimiter(configuredLimit("CATALOG_SUBDOMAIN_CHECK_RATE_LIMIT", 60), 60_000, Date.now,
  (userId) => log.warn({ event: "catalog_subdomain_check_rate_limited", userId }, "catalog_subdomain_check_rate_limited"));
