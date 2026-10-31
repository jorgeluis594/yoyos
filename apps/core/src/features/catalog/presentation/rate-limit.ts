import { log } from "@core/src/shared/infrastructure/logger";
import { createFixedWindowLimiter } from "@core/src/shared/infrastructure/fixed-window-limiter";

/** Boolean view of the shared fixed-window limiter, keeping the catalog's call shape. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now, onFirstRejection?: (key: string) => void) {
  const decide = createFixedWindowLimiter(limit, windowMs, now, onFirstRejection);
  return (key: string): boolean => decide(key).allowed;
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

/** `check_order` reads per client IP in a 10-minute fixed window, apart from `allowCatalogOrder` so a cheap read never spends the budget of the write that creates sales. Logs only the first rejection per IP per window; the request's company is bound by the route. */
export const allowCatalogOrderCheck = createRateLimiter(configuredLimit("CATALOG_ORDER_CHECK_RATE_LIMIT", 120), 10 * 60_000, Date.now,
  () => log.warn({ event: "catalog_order_check_rate_limited" }, "catalog_order_check_rate_limited"));
