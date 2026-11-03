import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import { deleteExpiredMessageTraces } from "@core/src/features/orders/application/delete-expired-message-traces";
import type { CompanyId } from "@core/src/features/orders/domain/order";

const cutoff = new Date("2026-10-10T09:00:00Z");
const [a, b] = ["company-a", "company-b"] as CompanyId[];
const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });

test("keeps deleting a company's batches until both tables come back short", async () => {
  const left = new Map([[a, { traces: 1200, texts: 3 }]]);
  const result = await deleteExpiredMessageTraces({ cutoff, batchSize: 500 }, {
    listCompaniesWithExpiredMessageTraces: async () => ok([a]),
    deleteExpiredMessageTraces: async (companyId, _cutoff, limit) => {
      const pending = left.get(companyId)!;
      const batch = { traces: Math.min(pending.traces, limit), texts: Math.min(pending.texts, limit) };
      left.set(companyId, { traces: pending.traces - batch.traces, texts: pending.texts - batch.texts });
      return ok(batch);
    },
  });
  expect(result).toEqual(ok({ companies: 1, deletedTraces: 1200, deletedTexts: 3, failedCompanies: 0 }));
});

test("keeps going while only the masked texts fill a batch", async () => {
  const batches = [{ traces: 0, texts: 2 }, { traces: 0, texts: 1 }];
  const result = await deleteExpiredMessageTraces({ cutoff, batchSize: 2 }, {
    listCompaniesWithExpiredMessageTraces: async () => ok([a]),
    deleteExpiredMessageTraces: async () => ok(batches.shift()!),
  });
  expect(result).toEqual(ok({ companies: 1, deletedTraces: 0, deletedTexts: 3, failedCompanies: 0 }));
});

test("continues with the next company when one company fails", async () => {
  const result = await deleteExpiredMessageTraces({ cutoff, batchSize: 500 }, {
    listCompaniesWithExpiredMessageTraces: async () => ok([a, b]),
    deleteExpiredMessageTraces: async (companyId) => companyId === a ? failure : ok({ traces: 1, texts: 1 }),
  });
  expect(result).toEqual(ok({ companies: 2, deletedTraces: 1, deletedTexts: 1, failedCompanies: 1 }));
});

test("fails without deleting when the company listing fails", async () => {
  expect(await deleteExpiredMessageTraces({ cutoff, batchSize: 500 }, {
    listCompaniesWithExpiredMessageTraces: async () => failure,
    deleteExpiredMessageTraces: async () => { throw new Error("must not delete"); },
  })).toEqual(failure);
});
