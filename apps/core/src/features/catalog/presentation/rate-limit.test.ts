import { expect, test, vi } from "vitest";
import { log } from "@core/src/shared/infrastructure/logger";
import { allowCatalogOrder, allowCatalogOrderCheck, allowSubdomainCheck, createRateLimiter } from "@core/src/features/catalog/presentation/rate-limit";

test("allows 20 Continuar per client in 10 minutes and rejects the 21st until the window passes", () => {
  let now = 0;
  const allow = createRateLimiter(20, 10 * 60_000, () => now);
  for (let attempt = 0; attempt < 20; attempt++) expect(allow("203.0.113.7")).toBe(true);
  expect(allow("203.0.113.7")).toBe(false);
  expect(allow("198.51.100.2")).toBe(true);
  now = 10 * 60_000;
  expect(allow("203.0.113.7")).toBe(true);
});

test("the subdomain check limiter counts per user and refuses the 61st call in a minute", () => {
  for (let attempt = 0; attempt < 60; attempt++) expect(allowSubdomainCheck("user-1")).toBe(true);
  expect(allowSubdomainCheck("user-1")).toBe(false);
  expect(allowSubdomainCheck("user-2")).toBe(true);
});

test("reports only the first rejection per key per window", () => {
  let now = 0;
  const rejected: string[] = [];
  const allow = createRateLimiter(2, 1_000, () => now, (key) => rejected.push(key));
  for (let attempt = 0; attempt < 6; attempt++) allow("user-1");
  allow("user-2"); allow("user-2"); allow("user-2");
  expect(rejected).toEqual(["user-1", "user-2"]);
  now = 1_000;
  for (let attempt = 0; attempt < 4; attempt++) allow("user-1");
  expect(rejected).toEqual(["user-1", "user-2", "user-1"]);
});

test("check_order requests do not consume the Continuar budget", () => {
  for (let attempt = 0; attempt < 120; attempt++) expect(allowCatalogOrderCheck("203.0.113.9")).toBe(true);
  expect(allowCatalogOrderCheck("203.0.113.9")).toBe(false);
  expect(allowCatalogOrder("203.0.113.9")).toBe(true);
});

test("logs catalog_order_check_rate_limited once for the first rejection of an IP", () => {
  const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  for (let attempt = 0; attempt < 125; attempt++) allowCatalogOrderCheck("203.0.113.10");
  expect(warn.mock.calls.filter(([fields]) => (fields as { event?: string }).event === "catalog_order_check_rate_limited")).toHaveLength(1);
  warn.mockRestore();
});
