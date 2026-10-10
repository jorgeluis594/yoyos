import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { listProducts as listWith, type ListInput } from "@core/src/features/products/application/list";
import { productRepository } from "@core/src/features/products/infrastructure/repository";

const listProducts = (input: ListInput) => listWith(input, { repository: productRepository });

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
      const match = await listProducts({ search: " mAtCh ", pageSize: 1 });
      expect(match.success).toBe(true);
      if (!match.success) return;
      expect(match.data.total).toBe(2);
      expect(match.data.items).toHaveLength(1);
      const next = await listProducts({ search: "match", page: 2, pageSize: 1 });
      expect(next.success).toBe(true);
      if (!next.success) return;
      expect([match.data.items[0].id, next.data.items[0].id]).toEqual([ids[0], ids[1]].sort());
      const all = [...match.data.items, ...next.data.items];
      expect(all.find((item) => item.id === ids[0])).toMatchObject({ variantCount: 3, minSalePrice: { amount: 20, currency: "PEN" }, hasDifferentPrices: true, totalStock: 9 });
      expect(all.find((item) => item.id === ids[1])).toMatchObject({ variantCount: 2, minSalePrice: { amount: 10 }, hasDifferentPrices: false, totalStock: 3 });
      expect(all.every((item) => item.sku === undefined)).toBe(true);
      const empty = await listProducts({ search: "secret" });
      expect(empty).toMatchObject({ success: true, data: { items: [], total: 0 } });
      expect(await listProducts({ search: "%" })).toMatchObject({ success: true, data: { items: [], total: 0 } });
      expect(await listProducts({ search: "_" })).toMatchObject({ success: true, data: { items: [], total: 0 } });
      const third = await listProducts({ page: 3, pageSize: 1 });
      expect(third).toMatchObject({ success: true, data: { total: 3, items: [{ id: [...ids].sort()[2] }] } });
      const unrelated = await listProducts({ search: "unrelated" });
      expect(unrelated).toMatchObject({ success: true, data: { total: 1, items: [{ id: ids[2], variantCount: 1, sku: "SOLO", hasDifferentPrices: false, totalStock: 0 }] } });
      expect(await listProducts({ search: "solo" })).toMatchObject({ success: true, data: { total: 1, items: [{ id: ids[2] }] } });
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

test("catalog filters by total stock, sorts by name and keeps image references", async () => {
  const company = randomUUID();
  const when = new Date("2026-01-01T00:00:00.000Z");
  const add = async (name: string, stocks: number[], createdAt: Date, imageId?: string) => {
    const id = randomUUID();
    await prisma.product.create({ data: { id, name, imageId, currency: "PEN", qrCode: randomUUID(), status: "active", createdAt, updatedAt: createdAt } });
    for (const quantity of stocks) {
      const variantId = randomUUID();
      await prisma.productVariant.create({ data: { id: variantId, productId: id, attributes: {}, salePrice: 10, qrCode: randomUUID(), status: "active" } });
      await prisma.productStock.create({ data: { variantId, quantity: BigInt(quantity) } });
    }
    return id;
  };
  try {
    await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
    const imageId = randomUUID();
    const ids = await withTenantIsolation(company, async () => {
      await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}.webp` } });
      return {
        bolso: await add("Bolso", [0, 0], when),
        anillo: await add("Anillo", [0, 4], new Date(when.getTime() + 1000), imageId),
        casaca: await add("Casaca", [3], new Date(when.getTime() + 2000)),
      };
    });
    await withTenantIsolation(company, async () => {
      const idsOf = (input: ListInput) => listProducts(input).then((result) => result.success ? result.data.items.map((item) => item.id) : result);
      expect(await idsOf({})).toEqual([ids.casaca, ids.anillo, ids.bolso]);
      expect(await idsOf({ sort: "name" })).toEqual([ids.anillo, ids.bolso, ids.casaca]);
      expect(await idsOf({ stock: "in_stock", sort: "name" })).toEqual([ids.anillo, ids.casaca]);
      expect(await listProducts({ stock: "sold_out" })).toMatchObject({ success: true, data: { total: 1, items: [{ id: ids.bolso, totalStock: 0 }] } });
      const page = await productRepository.list({ search: "anillo", sort: "recent", page: 1, pageSize: 20 });
      expect(page).toMatchObject({ success: true, data: { items: [{ id: ids.anillo, imageId }] } });
    });
  } finally {
    await withTenantIsolation(company, async () => {
      await prisma.productStock.deleteMany({ where: { companyId: company } });
      await prisma.productVariant.deleteMany({ where: { companyId: company } });
      await prisma.product.deleteMany({ where: { companyId: company } });
      await prisma.image.deleteMany({ where: { companyId: company } });
      await prisma.company.deleteMany({ where: { id: company } });
    });
  }
});

test("catalog sorts names case- and accent-insensitively for Spanish speakers with stable pages", async () => {
  const company = randomUUID();
  const when = new Date("2026-01-01T00:00:00.000Z");
  const add = async (name: string) => {
    const id = randomUUID();
    await prisma.product.create({ data: { id, name, currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: when, updatedAt: when } });
    const variantId = randomUUID();
    await prisma.productVariant.create({ data: { id: variantId, productId: id, attributes: {}, salePrice: 10, qrCode: randomUUID(), status: "active" } });
    await prisma.productStock.create({ data: { variantId, quantity: 1n } });
    return id;
  };
  try {
    await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
    await withTenantIsolation(company, async () => {
      for (const name of ["Zapato", "ñandú", "Bolso", "zapato", "Árbol", "nube", "anillo", "Bolso"]) await add(name);
      const names = (input: ListInput) => listProducts(input).then((result) => result.success ? result.data.items.map((item) => item.name) : result);
      const expected = ["anillo", "Árbol", "Bolso", "Bolso", "nube", "ñandú", "zapato", "Zapato"];
      expect(await names({ sort: "name" })).toEqual(expected);
      const pages = await Promise.all([1, 2, 3].map((page) => listProducts({ sort: "name", page, pageSize: 3 })));
      expect(pages.map((page) => page.success && page.data.total)).toEqual([8, 8, 8]);
      const paged = pages.flatMap((page) => page.success ? page.data.items : []);
      expect(paged.map((item) => item.name)).toEqual(expected);
      expect(new Set(paged.map((item) => item.id)).size).toBe(8);
      const bolsos = paged.filter((item) => item.name === "Bolso").map((item) => item.id);
      expect(bolsos).toEqual([...bolsos].sort());
    });
  } finally {
    await withTenantIsolation(company, async () => {
      await prisma.productStock.deleteMany({ where: { companyId: company } });
      await prisma.productVariant.deleteMany({ where: { companyId: company } });
      await prisma.product.deleteMany({ where: { companyId: company } });
      await prisma.company.deleteMany({ where: { id: company } });
    });
  }
});
