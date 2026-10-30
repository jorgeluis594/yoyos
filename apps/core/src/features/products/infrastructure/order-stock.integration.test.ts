import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { deductStockBulk, findVariantStock, lockVariantStock } from "@core/src/features/products/infrastructure/order-stock";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";

async function withStock<T>(stocks: number[], status: "active" | "inactive", work: (companyId: string, variants: VariantId[]) => Promise<T>) {
  const companyId = randomUUID();
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }); });
  return withTenantIsolation(companyId, async () => {
    const seeded = await seedProduct({ variants: stocks.map((stock, index) => ({ attributes: { Talla: `T${index}` }, stock, status })) });
    return work(companyId, [...seeded.variantIds].sort() as VariantId[]);
  });
}
const quantity = (map: ReadonlyMap<VariantId, unknown>, id: VariantId) => Number(map.get(id));

test("locks stock rows in variant order and skips rows held by another transaction", async () => {
  await withStock([5, 6], "active", async (companyId, [first, second]) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
    const holder = withTenantIsolation(companyId, () => withinTransaction(async () => {
      await lockVariantStock([first], "wait");
      locked();
      await held;
      return ok(null);
    }));
    await lockedPromise;
    try {
      const seen = await withinTransaction(async () => {
        const skipped = await lockVariantStock([second, first], "skip_locked");
        return ok(skipped.success ? [...skipped.data.keys()] : "failed");
      });
      expect(seen).toEqual({ success: true, data: [second] });
      const all = await withinTransaction(async () => {
        const rows = await lockVariantStock([second, first].reverse(), "skip_locked");
        return ok(rows.success ? [...rows.data.keys()] : "failed");
      }, { lockTimeoutMs: 200 });
      expect(all).toEqual({ success: true, data: [second] });
    } finally { release(); await holder; }
    const free = await withinTransaction(async () => {
      const rows = await lockVariantStock([second, first], "wait");
      return ok(rows.success ? [...rows.data.keys()] : "failed");
    });
    expect(free).toEqual({ success: true, data: [first, second] });
  });
});

test("the bulk decrement changes every row or none", async () => {
  await withStock([5, 3], "active", async (_companyId, [first, second]) => {
    const line = (variantId: VariantId, n: number) => ({ variantId, quantity: n as PositiveInteger });
    const short = await withinTransaction(async () => {
      const count = await deductStockBulk([line(first, 2), line(second, 4)]);
      const stock = await findVariantStock([first, second]);
      return ok({ count, first: stock.success ? quantity(stock.data, first) : -1, second: stock.success ? quantity(stock.data, second) : -1 });
    });
    expect(short).toEqual({ success: true, data: { count: { success: true, data: 0 }, first: 5, second: 3 } });
    const enough = await withinTransaction(async () => {
      const count = await deductStockBulk([line(first, 2), line(second, 3)]);
      const stock = await findVariantStock([first, second]);
      return ok({ count, first: stock.success ? quantity(stock.data, first) : -1, second: stock.success ? quantity(stock.data, second) : -1 });
    });
    expect(enough).toEqual({ success: true, data: { count: { success: true, data: 2 }, first: 3, second: 0 } });
  });
});

test("reads stock of inactive variants", async () => {
  await withStock([4], "inactive", async (_companyId, [variantId]) => {
    const stock = await findVariantStock([variantId]);
    expect(stock.success && quantity(stock.data, variantId)).toBe(4);
  });
});
