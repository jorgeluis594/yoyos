import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { CreateInput } from "@core/src/features/products/application/create";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import { ok } from "@shared/functional";

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
  const companyA = randomUUID();
  const companyB = randomUUID();
  const imageId = randomUUID() as ImageId;
  let foreignProductId: ProductId | undefined;
  let companyAProductId: ProductId | undefined;
  let foreignVariantId: VariantId | undefined;
  const { prisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");
  const { productRepository } = await import("@core/src/features/products/infrastructure/repository");
  const { createProduct } = await import("@core/src/features/products/application/create");
  const { getProduct } = await import("@core/src/features/products/application/get");
  await expect(productRepository.get(randomUUID() as ProductId)).resolves.toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  const newDeps = () => ({ repository: productRepository, findImage: async (id: ImageId) => ok(!!(await prisma.image.findUnique({ where: { id } }))), newId: randomUUID, clock: () => new Date("2026-09-24T00:00:00.000Z") });
  const base = (sku?: string): CreateInput => ({ name: "Camisa", currency: "PEN", variants: [{ attributes: {}, salePrice: 19.99, purchasePrice: 0, ...(sku === undefined ? {} : { sku }), initialStock: 4 }] });
  try {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
    await withTenantIsolation(companyB, async () => await prisma.image.create({ data: { id: imageId, storageKey: "image" } }));

    await withTenantIsolation(companyA, async () => {
      const first = await createProduct({ ...base(" A-1 "), variants: [
        { attributes: { color: "azul" }, sku: " A-1 ", salePrice: 19.99, purchasePrice: 0, initialStock: 4 },
        { attributes: { color: "rojo" }, salePrice: 999999999.99, initialStock: 0 },
      ] }, newDeps());
      expect(first.success).toBe(true);
      if (!first.success) return;
      companyAProductId = first.data;
      const result = await getProduct(first.data, { repository: productRepository, resolveImage: async () => null });
      expect(result.success && result.data?.product.variants).toEqual(expect.arrayContaining([
        expect.objectContaining({ sku: "A-1", salePrice: { amount: 19.99, currency: "PEN" }, purchasePrice: { amount: 0, currency: "PEN" }, stock: expect.objectContaining({ quantity: 4 }) }),
        expect.objectContaining({ salePrice: { amount: 999999999.99, currency: "PEN" }, stock: expect.objectContaining({ quantity: 0 }) }),
      ]));
      expect(await createProduct({ ...base(), imageId }, newDeps())).toMatchObject({ success: false, error: { code: "IMAGE_NOT_FOUND" } });
      const [dupeA, dupeB] = await Promise.all([
        createProduct(base("race"), newDeps()),
        createProduct(base(" RACE "), newDeps()),
      ]);
      expect([dupeA.success, dupeB.success].sort()).toEqual([false, true]);
      expect([dupeA, dupeB].find((item) => !item.success)).toMatchObject({ success: false, error: { code: "DUPLICATE_SKU" } });
      expect(await createProduct(base(), newDeps())).toMatchObject({ success: true });
      expect(await createProduct(base(), newDeps())).toMatchObject({ success: true });
      const largeStock = await createProduct({ ...base(), variants: [{ attributes: {}, salePrice: 1, initialStock: Number.MAX_SAFE_INTEGER }] }, newDeps());
      expect(largeStock.success).toBe(true);
      if (largeStock.success) {
        const loaded = await productRepository.get(largeStock.data);
        expect(loaded.success && loaded.data?.variants[0].stock.quantity).toBe(Number.MAX_SAFE_INTEGER);
      }
      if (!result.success || !result.data) throw new Error("Product was not loaded");
      await expect(prisma.productStock.update({ where: { variantId: result.data.product.variants[0].id }, data: { quantity: -1n } })).rejects.toThrow();
      const directVariant = () => ({ id: randomUUID(), productId: first.data, attributes: {}, salePrice: 1, qrCode: randomUUID(), status: "active" });
      await expect(prisma.productVariant.create({ data: { ...directVariant(), salePrice: 0 } })).rejects.toThrow();
      await expect(prisma.productVariant.create({ data: { ...directVariant(), purchasePrice: -1 } })).rejects.toThrow();
      await expect(prisma.productVariant.create({ data: { ...directVariant(), salePrice: 1_000_000_000 } })).rejects.toThrow();
      await expect(prisma.productVariant.create({ data: { ...directVariant(), sku: "X".repeat(101) } })).rejects.toThrow();
      await expect(prisma.product.create({ data: { id: randomUUID(), name: "X".repeat(201), currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date() } })).rejects.toThrow();
      const rollbackId = randomUUID() as ProductId;
      const repeatedQr = randomUUID();
      const suppliedIds = [rollbackId, randomUUID(), repeatedQr, randomUUID(), repeatedQr, randomUUID()];
      await expect(createProduct({ ...base(), variants: [
        { attributes: { color: "azul" }, salePrice: 1 },
        { attributes: { color: "rojo" }, salePrice: 2 },
      ] }, { ...newDeps(), newId: () => suppliedIds.shift()! })).rejects.toThrow();
      expect(await prisma.product.findFirst({ where: { id: rollbackId } })).toBeNull();
      const loadedFirst = await productRepository.get(first.data);
      expect(loadedFirst.success && loadedFirst.data).not.toBeNull();
      expect(await (await import("@core/src/shared/images/infrastructure/image-repository")).imageRepository.find(imageId)).toEqual({ success: true, data: null });
    });

    await withTenantIsolation(companyB, async () => {
      expect(await productRepository.get(companyAProductId!)).toEqual({ success: true, data: null });
      const sameSku = await createProduct(base("a-1"), newDeps());
      expect(sameSku.success).toBe(true);
      if (!sameSku.success) throw new Error("Product was not created");
      foreignProductId = sameSku.data;
      const loadedSameSku = await productRepository.get(sameSku.data);
      if (!loadedSameSku.success || !loadedSameSku.data) throw new Error("Product was not loaded");
      foreignVariantId = loadedSameSku.data.variants[0].id;
      const imageProduct = await createProduct({ ...base(), imageId }, newDeps());
      expect(imageProduct.success).toBe(true);
      if (imageProduct.success) {
        const detail = await getProduct(imageProduct.data, { repository: productRepository, resolveImage: async (id) => ({ id, url: "https://example.test/image" }) });
        expect(detail.success && detail.data?.image?.url).toBe("https://example.test/image");
      }
    });

    await withTenantIsolation(companyA, async () => {
      const foreign = await prisma.product.findFirst({ where: { companyId: companyB } });
      expect(foreign).toBeNull();
      expect(await getProduct(foreignProductId!, { repository: productRepository, resolveImage: async () => null })).toEqual({ success: true, data: null });
      const productId = randomUUID();
      const variantId = randomUUID();
      await expect(prisma.product.create({ data: { id: productId, name: "Wrong image", imageId, currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date() } })).rejects.toThrow();
      await expect(prisma.productVariant.create({ data: { id: variantId, productId: foreignProductId!, attributes: {}, salePrice: 1, qrCode: randomUUID(), status: "active" } })).rejects.toThrow();
      await expect(prisma.productStock.create({ data: { variantId: foreignVariantId!, quantity: 1n } })).rejects.toThrow();
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
