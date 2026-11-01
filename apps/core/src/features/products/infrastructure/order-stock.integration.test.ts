import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import { deductStockBulk, findOfferedVariants, findSellableVariants, findSellableVariantStock, findVariantStock, lockVariantStock, searchSaleCatalog } from "@core/src/features/products/infrastructure/order-stock";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";

async function withStock<T>(stocks: number[], status: "active" | "inactive", work: (companyId: string, variants: VariantId[]) => Promise<T>) {
  const companyId = randomUUID();
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }); });
  return withTenantIsolation(companyId, async () => {
    const seeded = await seedProduct({ variants: stocks.map((stock, index) => ({ attributes: { Talla: `T${index}` }, stock, status })) });
    // Seed order, so variants[i] is the one seeded with stocks[i].
    return work(companyId, [...seeded.variantIds] as VariantId[]);
  });
}
const quantity = (map: ReadonlyMap<VariantId, unknown>, id: VariantId) => Number(map.get(id));

test("locks stock rows in variant order and skips rows held by another transaction", async () => {
  await withStock([5, 6], "active", async (companyId, seeded) => {
    const [first, second] = [...seeded].sort() as [VariantId, VariantId];
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

test("filters the sale catalog to products with an active variant in stock", async () => {
  await withStock([0, 0], "active", async () => {
    const tag = randomUUID().slice(0, 8);
    await seedProduct({ name: `Sin stock ${tag}`, variants: [{ attributes: { Talla: "S" }, stock: 0 }] });
    const mixed = await seedProduct({ name: `Mixto ${tag}`, variants: [{ attributes: { Talla: "S" }, stock: 0 }, { attributes: { Talla: "M" }, stock: 4 }] });
    await seedProduct({ name: `Inactivo ${tag}`, variants: [{ attributes: { Talla: "S" }, stock: 5, status: "inactive" }, { attributes: { Talla: "M" }, stock: 0 }] });
    const all = await searchSaleCatalog(tag);
    expect(all.success && all.data.map((product) => product.name)).toEqual([`Inactivo ${tag}`, `Mixto ${tag}`, `Sin stock ${tag}`]);
    const filtered = await searchSaleCatalog(tag, undefined, { inStock: true });
    expect(filtered.success && filtered.data.map((product) => product.name)).toEqual([`Mixto ${tag}`]);
    // The matching product keeps all its active variants, including the one without stock.
    expect(filtered.success && filtered.data[0].variants.map((variant) => variant.stock).sort()).toEqual([0, 4]);
    expect(filtered.success && filtered.data[0].id).toBe(mixed.productId);
  });
});

test("reads the stock of active variants and leaves deactivated ones out", async () => {
  await withStock([4], "active", async (_companyId, [active]) => {
    const inactive = await seedProduct({ variants: [{ attributes: { Talla: "S" }, stock: 7, status: "inactive" }] });
    const empty = await seedProduct({ variants: [{ attributes: { Talla: "S" }, stock: 0 }] });
    const ids = [active, ...inactive.variantIds, ...empty.variantIds] as VariantId[];
    const stock = await findSellableVariantStock(ids);
    expect(stock.success && Object.fromEntries(stock.data)).toEqual({ [active]: 4, [empty.variantIds[0]]: 0 });
    expect(await findSellableVariantStock([])).toEqual(ok(new Map()));
  });
});

test("a hidden product's variants are sellable but not offered", async () => {
  const companyId = randomUUID();
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }); });
  await withTenantIsolation(companyId, async () => {
    const visible = await seedProduct({ variants: [{ stock: 4 }] });
    const hidden = await seedProduct({ hidden: true, variants: [{ stock: 2 }] });
    const ids = [visible.variantIds[0], hidden.variantIds[0]];
    const sellable = await findSellableVariants(ids);
    expect(sellable.success && sellable.data.map((item) => item.variantId).sort()).toEqual([...ids].sort());
    const offered = await findOfferedVariants(ids);
    expect(offered.success && offered.data.map((item) => item.variantId)).toEqual([visible.variantIds[0]]);
  });
});
