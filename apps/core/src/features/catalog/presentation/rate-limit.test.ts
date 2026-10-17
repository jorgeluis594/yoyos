import { expect, test } from "vitest";
import { createRateLimiter } from "@core/src/features/catalog/presentation/rate-limit";

test("allows 20 Continuar per client in 10 minutes and rejects the 21st until the window passes", () => {
  let now = 0;
  const allow = createRateLimiter(20, 10 * 60_000, () => now);
  for (let attempt = 0; attempt < 20; attempt++) expect(allow("203.0.113.7")).toBe(true);
  expect(allow("203.0.113.7")).toBe(false);
  expect(allow("198.51.100.2")).toBe(true);
  now = 10 * 60_000;
  expect(allow("203.0.113.7")).toBe(true);
});
