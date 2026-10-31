import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { ProductId } from "@core/src/features/products/domain/product";
import { listStockedForAssistant, type StockedProduct } from "@core/src/features/products/application/list-stocked-for-assistant";

const product = (name: string, total: number, createdAt: string): StockedProduct => ({
  id: name as ProductId, name, createdAt: new Date(createdAt), stock: { total, soldOut: 0, low: 0, onlyLevel: null }, variantIds: total > 0 ? [`${name}-v`] : [],
});
const createdBefore = new Date("2026-11-01T05:00:00Z");

test("counts the matching products and the ones with stock, and checks those with stock created before the cutoff", async () => {
  const products = [product("Polo", 20, "2026-01-01"), product("Chompa", 5, "2026-11-02"), product("Short", 0, "2026-01-01"), product("Casaca", 4, "2026-10-31T23:00:00Z")];
  const readStocked = vi.fn(async () => ok({ storeHasProducts: true, products }));
  const result = await listStockedForAssistant({ createdBefore, text: " ca " }, { readStocked });
  expect(readStocked).toHaveBeenCalledWith({ createdBefore, text: "ca" });
  expect(result).toEqual({ success: true, data: { storeHasProducts: true, matching: 4, withStock: 3, checked: [products[0], products[3]] } });
});

test("tells a store without products apart from a text that matches none", async () => {
  expect(await listStockedForAssistant({ createdBefore }, { readStocked: async () => ok({ storeHasProducts: false, products: [] }) }))
    .toEqual({ success: true, data: { storeHasProducts: false, matching: 0, withStock: 0, checked: [] } });
  expect(await listStockedForAssistant({ createdBefore, text: "zapato" }, { readStocked: async () => ok({ storeHasProducts: true, products: [] }) }))
    .toEqual({ success: true, data: { storeHasProducts: true, matching: 0, withStock: 0, checked: [] } });
});

test("returns the read failure instead of an empty list", async () => {
  const failure = { success: false as const, error: { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" } };
  expect(await listStockedForAssistant({ createdBefore }, { readStocked: async () => failure })).toEqual(failure);
});
