import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { summarizeSoldVariants, type SoldVariantsSummary } from "@core/src/features/orders/application/summarize-sold-variants";
import { findVariantSaleDates } from "@core/src/features/orders/application/find-variant-sale-dates";
import type { CompanyId, UserId } from "@core/src/features/orders/domain/order";

const access = { companyId: "company-1" as CompanyId, userId: "user-1" as UserId };
const window = { from: new Date("2026-10-01T05:00:00Z"), before: new Date("2026-11-01T05:00:00Z") };

test("reads the sold variants of the window for the caller's company", async () => {
  const summary: SoldVariantsSummary = { variants: [], currencies: [{ currency: "PEN", orders: 2, units: 3, amount: { amount: 90, currency: "PEN" } }] };
  const readSoldVariants = vi.fn(async () => ok(summary));
  expect(await summarizeSoldVariants({ window, variantIds: ["v1"] }, access, { readSoldVariants })).toEqual({ success: true, data: summary });
  expect(readSoldVariants).toHaveBeenCalledWith({ window, variantIds: ["v1"] }, "company-1");
});

test("returns the persistence failure of the sold variants read instead of an empty ranking", async () => {
  const failure = { success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" } };
  expect(await summarizeSoldVariants({ window }, access, { readSoldVariants: async () => failure })).toEqual(failure);
});

test("finds the sale dates of the given variants and reads nothing for an empty list", async () => {
  const dates = [{ variantId: "v1", soldInWindow: false, lastBefore: new Date("2026-08-14T15:00:00Z"), firstAfter: null }];
  const readSaleDates = vi.fn(async () => ok(dates));
  expect(await findVariantSaleDates({ window, variantIds: ["v1"], needFirstAfter: true }, access, { readSaleDates })).toEqual({ success: true, data: dates });
  expect(readSaleDates).toHaveBeenCalledWith({ window, variantIds: ["v1"], needFirstAfter: true }, "company-1");
  readSaleDates.mockClear();
  expect(await findVariantSaleDates({ window, variantIds: [], needFirstAfter: false }, access, { readSaleDates })).toEqual({ success: true, data: [] });
  expect(readSaleDates).not.toHaveBeenCalled();
});
