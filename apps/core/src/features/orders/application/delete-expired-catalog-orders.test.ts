import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { deleteExpiredCatalogOrders } from "@core/src/features/orders/application/delete-expired-catalog-orders";
import type { CompanyId } from "@core/src/features/orders/domain/order";

const cutoff = new Date("2026-10-10T09:00:00Z");
const [a, b] = ["company-a", "company-b"] as CompanyId[];
const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });

test("cleanup continues with the next company when one company fails", async () => {
  const calls: string[] = [];
  const pending = new Map([[b, 501]]);
  const result = await deleteExpiredCatalogOrders({ cutoff }, {
    listCompaniesWithExpiredCatalogOrders: async () => ok([a, b]),
    deleteExpiredCatalogOrders: async (companyId, given, limit) => {
      calls.push(companyId);
      expect(given).toBe(cutoff);
      if (companyId === a) return failure;
      const left = pending.get(companyId) ?? 0;
      pending.set(companyId, Math.max(left - limit, 0));
      return ok(Math.min(left, limit));
    },
  });
  expect(result).toEqual(ok({ companies: 2, deleted: 501, failedCompanies: 1 }));
  expect(calls).toEqual([a, b, b]);
});

test("cleanup fails without deleting when the company listing fails", async () => {
  expect(await deleteExpiredCatalogOrders({ cutoff }, {
    listCompaniesWithExpiredCatalogOrders: async () => failure,
    deleteExpiredCatalogOrders: async () => { throw new Error("must not delete"); },
  })).toEqual(failure);
});
