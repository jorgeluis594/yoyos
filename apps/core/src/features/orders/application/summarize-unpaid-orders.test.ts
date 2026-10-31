import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { summarizeUnpaidOrders, type UnpaidSummary } from "@core/src/features/orders/application/summarize-unpaid-orders";
import type { CompanyId, UserId } from "@core/src/features/orders/domain/order";

const access = { companyId: "company-1" as CompanyId, userId: "user-1" as UserId };

test("summarizes the unpaid orders of the caller's company", async () => {
  const summary: UnpaidSummary = { count: 2, withPendingReport: 1, owed: [{ amount: 150, currency: "PEN" }] };
  const summarizeUnpaid = vi.fn(async () => ok(summary));
  expect(await summarizeUnpaidOrders({}, access, summarizeUnpaid)).toEqual({ success: true, data: summary });
  expect(summarizeUnpaid).toHaveBeenCalledWith("company-1");
});

test("returns a persistence failure instead of an empty summary", async () => {
  const failure = { success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" } };
  expect(await summarizeUnpaidOrders({}, access, async () => failure)).toEqual(failure);
});
