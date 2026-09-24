import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { CreateInput } from "@core/src/features/products/application/create";
import type { CompanyId, ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";

test("product persistence is atomic, isolated, and constrained", async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  const adminUrl = new URL(process.env.DATABASE_URL!);
  adminUrl.username = "core";
  adminUrl.password = "core";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  try {
  const policies = await admin.$queryRaw<Array<{ tablename: string; qual: string | null; with_check: string | null }>>`SELECT tablename, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('Product', 'ProductVariant', 'ProductStock')`;
  expect(policies).toHaveLength(3);
  expect(policies.every((policy) => policy.qual?.includes("app.company_id") && policy.with_check?.includes("app.company_id"))).toBe(true);
  const tables = await admin.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string; allowed: boolean }>>`SELECT relname, relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner, has_table_privilege('core_app', oid, 'SELECT') AND has_table_privilege('core_app', oid, 'INSERT') AND has_table_privilege('core_app', oid, 'UPDATE') AND has_table_privilege('core_app', oid, 'DELETE') AS allowed FROM pg_class WHERE relname IN ('Product', 'ProductVariant', 'ProductStock')`;
  expect(tables).toHaveLength(3);
  expect(tables.every((table) => table.relrowsecurity && table.relforcerowsecurity && table.allowed && table.owner !== "core_app")).toBe(true);
  const companyA = randomUUID() as CompanyId;
  const companyB = randomUUID() as CompanyId;
  const imageId = randomUUID() as ImageId;
  let foreignProductId: ProductId | undefined;
  let foreignVariantId: VariantId | undefined;
  const { prisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");
  const { productRepository } = await import("@core/src/features/products/infrastructure/repository");
  const { createProduct } = await import("@core/src/features/products/application/create");
  const { getProduct } = await import("@core/src/features/products/application/get");
  await expect(productRepository.get(companyA, randomUUID() as ProductId)).rejects.toThrow("Company context is required");
  const newDeps = () => ({ repository: productRepository, findImage: async (companyId: CompanyId, id: ImageId) => !!(await prisma.image.findFirst({ where: { companyId, id } })), newId: randomUUID, clock: () => new Date("2026-09-24T00:00:00.000Z") });
  const base = (sku?: string): CreateInput => ({ name: "Camisa", currency: "PEN", variants: [{ attributes: {}, salePrice: 19.99, purchasePrice: 0, ...(sku === undefined ? {} : { sku }), initialStock: 4 }] });
  try {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
    await withTenantIsolation(companyB, async () => await prisma.image.create({ data: { id: imageId, companyId: companyB, storageKey: "image" } }));

    await withTenantIsolation(companyA, async () => {
      const first = await createProduct(companyA, { ...base(" A-1 "), variants: [
        { attributes: { color: "azul" }, sku: " A-1 ", salePrice: 19.99, purchasePrice: 0, initialStock: 4 },
        { attributes: { color: "rojo" }, salePrice: 999999999.99, initialStock: 0 },
      ] }, newDeps());
      expect(first.success).toBe(true);
      if (!first.success) return;
      const result = await getProduct(companyA, first.data, { repository: productRepository, resolveImage: async () => null });
      expect(result.success && result.data?.product.variants).toEqual(expect.arrayContaining([
        expect.objectContaining({ sku: "A-1", salePrice: { amount: 19.99, currency: "PEN" }, purchasePrice: { amount: 0, currency: "PEN" }, stock: expect.objectContaining({ quantity: 4 }) }),
        expect.objectContaining({ salePrice: { amount: 999999999.99, currency: "PEN" }, stock: expect.objectContaining({ quantity: 0 }) }),
      ]));
      expect(await createProduct(companyA, { ...base(), imageId }, newDeps())).toMatchObject({ success: false, error: { code: "IMAGE_NOT_FOUND" } });
      const [dupeA, dupeB] = await Promise.all([
        createProduct(companyA, base("race"), newDeps()),
        createProduct(companyA, base(" RACE "), newDeps()),
      ]);
      expect([dupeA.success, dupeB.success].sort()).toEqual([false, true]);
      expect([dupeA, dupeB].find((item) => !item.success)).toMatchObject({ success: false, error: { code: "DUPLICATE_SKU" } });
      expect(await createProduct(companyA, base(), newDeps())).toMatchObject({ success: true });
      expect(await createProduct(companyA, base(), newDeps())).toMatchObject({ success: true });
      const largeStock = await createProduct(companyA, { ...base(), variants: [{ attributes: {}, salePrice: 1, initialStock: Number.MAX_SAFE_INTEGER }] }, newDeps());
      expect(largeStock.success).toBe(true);
      if (largeStock.success) expect((await productRepository.get(companyA, largeStock.data))?.variants[0].stock.quantity).toBe(Number.MAX_SAFE_INTEGER);
      if (!result.success || !result.data) throw new Error("Product was not loaded");
      await expect(prisma.productStock.update({ where: { variantId: result.data.product.variants[0].id }, data: { quantity: -1n } })).rejects.toThrow();
      const directVariant = () => ({ id: randomUUID(), companyId: companyA, productId: first.data, attributes: {}, salePrice: 1, qrCode: randomUUID(), status: "active" });
      await expect(prisma.productVariant.create({ data: { ...directVariant(), salePrice: 0 } })).rejects.toThrow();
      await expect(prisma.productVariant.create({ data: { ...directVariant(), purchasePrice: -1 } })).rejects.toThrow();
      await expect(prisma.productVariant.create({ data: { ...directVariant(), salePrice: 1_000_000_000 } })).rejects.toThrow();
      await expect(prisma.productVariant.create({ data: { ...directVariant(), sku: "X".repeat(101) } })).rejects.toThrow();
      await expect(prisma.product.create({ data: { id: randomUUID(), companyId: companyA, name: "X".repeat(201), currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date() } })).rejects.toThrow();
      const rollbackId = randomUUID() as ProductId;
      const repeatedQr = randomUUID();
      const suppliedIds = [rollbackId, randomUUID(), repeatedQr, randomUUID(), repeatedQr, randomUUID()];
      await expect(createProduct(companyA, { ...base(), variants: [
        { attributes: { color: "azul" }, salePrice: 1 },
        { attributes: { color: "rojo" }, salePrice: 2 },
      ] }, { ...newDeps(), newId: () => suppliedIds.shift()! })).rejects.toThrow();
      expect(await prisma.product.findFirst({ where: { id: rollbackId } })).toBeNull();
      expect(await productRepository.get(companyA, first.data)).not.toBeNull();
      await expect(productRepository.get(companyB, first.data)).rejects.toThrow("Company context mismatch");
    });

    await withTenantIsolation(companyB, async () => {
      const sameSku = await createProduct(companyB, base("a-1"), newDeps());
      expect(sameSku.success).toBe(true);
      if (!sameSku.success) throw new Error("Product was not created");
      foreignProductId = sameSku.data;
      foreignVariantId = (await productRepository.get(companyB, sameSku.data))!.variants[0].id;
      const imageProduct = await createProduct(companyB, { ...base(), imageId }, newDeps());
      expect(imageProduct.success).toBe(true);
      if (imageProduct.success) {
        const detail = await getProduct(companyB, imageProduct.data, { repository: productRepository, resolveImage: async (_companyId, id) => ({ id, url: "https://example.test/image" }) });
        expect(detail.success && detail.data?.image?.url).toBe("https://example.test/image");
      }
    });

    await withTenantIsolation(companyA, async () => {
      const foreign = await prisma.product.findFirst({ where: { companyId: companyB } });
      expect(foreign).toBeNull();
      expect(await getProduct(companyA, foreignProductId!, { repository: productRepository, resolveImage: async () => null })).toEqual({ success: true, data: null });
      const productId = randomUUID();
      const variantId = randomUUID();
      await expect(prisma.product.create({ data: { id: productId, companyId: companyA, name: "Wrong image", imageId, currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date() } })).rejects.toThrow();
      await expect(prisma.productVariant.create({ data: { id: variantId, companyId: companyA, productId: foreignProductId!, attributes: {}, salePrice: 1, qrCode: randomUUID(), status: "active" } })).rejects.toThrow();
      await expect(prisma.productStock.create({ data: { variantId: foreignVariantId!, companyId: companyA, quantity: 1n } })).rejects.toThrow();
    });
  } finally {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
      await prisma.productStock.deleteMany({ where: { companyId: id } });
      await prisma.productVariant.deleteMany({ where: { companyId: id } });
      await prisma.product.deleteMany({ where: { companyId: id } });
      await prisma.image.deleteMany({ where: { companyId: id } });
      await prisma.company.deleteMany({ where: { id } });
    });
  }
  } finally {
    await admin.$disconnect();
  }
});
