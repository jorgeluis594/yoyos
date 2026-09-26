import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { listProducts } from "@core/src/features/products/application/list";
import { productRepository } from "@core/src/features/products/infrastructure/repository";

test("catalog searches distinct products and summarizes all variants within the company", async () => {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const when = new Date("2026-01-01T00:00:00.000Z");
  const add = async (name: string, variants: { sku?: string; price: number; stock: number }[]) => {
    const id = randomUUID();
    await prisma.product.create({ data: { id, name, currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: when, updatedAt: when } });
    for (const variant of variants) {
      const variantId = randomUUID();
      await prisma.productVariant.create({ data: { id: variantId, productId: id, attributes: {}, sku: variant.sku, salePrice: variant.price, qrCode: randomUUID(), status: "active" } });
      await prisma.productStock.create({ data: { variantId, quantity: BigInt(variant.stock) } });
    }
    return id;
  };
  try {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
    const ids = await withTenantIsolation(companyA, async () => [
      await add("Camisa", [{ sku: "MATCH-M", price: 20, stock: 2 }, { sku: "MATCH-L", price: 25, stock: 3 }, { sku: "OTHER", price: 30, stock: 4 }]),
      await add("Match equal", [{ price: 10, stock: 1 }, { price: 10, stock: 2 }]),
      await add("Unrelated", [{ sku: "SOLO", price: 5, stock: 0 }]),
    ]);
    await withTenantIsolation(companyB, () => add("Match foreign", [{ sku: "MATCH-SECRET", price: 1, stock: 100 }]));
    await withTenantIsolation(companyA, async () => {
      const match = await listProducts({ search: " mAtCh ", pageSize: 1 }, productRepository);
      expect(match.success).toBe(true);
      if (!match.success) return;
      expect(match.data.total).toBe(2);
      expect(match.data.items).toHaveLength(1);
      const next = await listProducts({ search: "match", page: 2, pageSize: 1 }, productRepository);
      expect(next.success).toBe(true);
      if (!next.success) return;
      expect([match.data.items[0].id, next.data.items[0].id]).toEqual([ids[0], ids[1]].sort());
      const all = [...match.data.items, ...next.data.items];
      expect(all.find((item) => item.id === ids[0])).toMatchObject({ variantCount: 3, minSalePrice: { amount: 20, currency: "PEN" }, hasDifferentPrices: true, totalStock: 9 });
      expect(all.find((item) => item.id === ids[1])).toMatchObject({ variantCount: 2, minSalePrice: { amount: 10 }, hasDifferentPrices: false, totalStock: 3 });
      expect(all.every((item) => item.sku === undefined)).toBe(true);
      const empty = await listProducts({ search: "secret" }, productRepository);
      expect(empty).toMatchObject({ success: true, data: { items: [], total: 0 } });
      expect(await listProducts({ search: "%" }, productRepository)).toMatchObject({ success: true, data: { items: [], total: 0 } });
      expect(await listProducts({ search: "_" }, productRepository)).toMatchObject({ success: true, data: { items: [], total: 0 } });
      const third = await listProducts({ page: 3, pageSize: 1 }, productRepository);
      expect(third).toMatchObject({ success: true, data: { total: 3, items: [{ id: [...ids].sort()[2] }] } });
      const unrelated = await listProducts({ search: "unrelated" }, productRepository);
      expect(unrelated).toMatchObject({ success: true, data: { total: 1, items: [{ id: ids[2], variantCount: 1, sku: "SOLO", hasDifferentPrices: false, totalStock: 0 }] } });
      expect(await listProducts({ search: "solo" }, productRepository)).toMatchObject({ success: true, data: { total: 1, items: [{ id: ids[2] }] } });
    });
  } finally {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
      await prisma.productStock.deleteMany({ where: { companyId: id } });
      await prisma.productVariant.deleteMany({ where: { companyId: id } });
      await prisma.product.deleteMany({ where: { companyId: id } });
      await prisma.company.deleteMany({ where: { id } });
    });
  }
});
