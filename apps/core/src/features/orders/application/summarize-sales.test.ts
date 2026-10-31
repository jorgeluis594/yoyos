import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { summarizeSales, type SalesSummary } from "@core/src/features/orders/application/summarize-sales";
import type { CompanyId, UserId } from "@core/src/features/orders/domain/order";

const access = { companyId: "company-1" as CompanyId, userId: "user-1" as UserId };
const window = (from: string, before: string) => ({ from: new Date(from), before: new Date(before) });
const input = { current: window("2026-10-01T05:00:00Z", "2026-11-01T05:00:00Z"), previous: window("2026-09-01T05:00:00Z", "2026-10-01T05:00:00Z") };

test("passes both windows to one read and returns its figures and storeHasOrders", async () => {
  const summary: SalesSummary = { current: [], previous: [], pendingReports: { reports: 0, orders: 0 }, storeHasOrders: true };
  const readFigures = vi.fn(async () => ok(summary));
  expect(await summarizeSales(input, access, { readFigures })).toEqual({ success: true, data: summary });
  expect(readFigures).toHaveBeenCalledTimes(1);
  expect(readFigures).toHaveBeenCalledWith(input, "company-1");
});

test("answers the persistence failure of its read without a partial summary", async () => {
  const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" };
  expect(await summarizeSales(input, access, { readFigures: async () => err(failure) })).toEqual({ success: false, error: failure });
});
