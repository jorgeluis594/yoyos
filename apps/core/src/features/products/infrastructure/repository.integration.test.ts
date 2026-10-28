import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { CreateInput } from "@core/src/features/products/application/create";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import { ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

test("product persistence is atomic, isolated, and constrained", async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  const adminUrl = new URL(process.env.DATABASE_URL!);
  adminUrl.username = "core";
  adminUrl.password = "core";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
  try {
  const policies = await admin.$queryRaw<Array<{ tablename: string; qual: string | null; with_check: string | null }>>`SELECT tablename, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('Product', 'ProductVariant', 'ProductStock', 'ProductOption', 'ProductOptionValue', 'ProductVariantOptionValue')`;
  expect(policies).toHaveLength(6);
  expect(policies.every((policy) => policy.qual?.includes("app.company_id") && policy.with_check?.includes("app.company_id"))).toBe(true);
  const tables = await admin.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string; allowed: boolean }>>`SELECT relname, relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner, has_table_privilege('core_app', oid, 'SELECT') AND has_table_privilege('core_app', oid, 'INSERT') AND has_table_privilege('core_app', oid, 'UPDATE') AND has_table_privilege('core_app', oid, 'DELETE') AS allowed FROM pg_class WHERE relname IN ('Product', 'ProductVariant', 'ProductStock', 'ProductOption', 'ProductOptionValue', 'ProductVariantOptionValue')`;
  expect(tables).toHaveLength(6);
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
  const { productCreateDependencies, productGetDependencies } = await import("@core/src/features/products/product-editing");
  await expect(productRepository.get(randomUUID() as ProductId)).resolves.toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  const newDeps = (companyId: string) => ({ ...productCreateDependencies(companyId), findImages: async (ids: readonly ImageId[]) => ok(new Set((await prisma.image.findMany({ where: { id: { in: [...ids] } }, select: { id: true } })).map((row) => row.id as ImageId))), newId: randomUUID, clock: () => new Date("2026-09-24T00:00:00.000Z"), publishProductPhotosAdded: async () => ok(undefined) });
  const create = (companyId: string, input: CreateInput, overrides: Partial<ReturnType<typeof newDeps>> = {}) => createProduct(input, { companyId: companyId as CompanyId }, { ...newDeps(companyId), ...overrides });
  const detail = (id: ProductId, resolveImages: typeof productGetDependencies.resolveImages = async () => ok({ images: [], failures: [] })) => getProduct(id, { ...productGetDependencies, resolveImages });
  const base = (sku?: string): CreateInput => ({ name: "Camisa", currency: "PEN", photoIds: [], options: [], variants: [{ values: [], salePrice: 19.99, purchasePrice: 0, ...(sku === undefined ? {} : { sku }), initialStock: 4 }] });
  try {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
    await withTenantIsolation(companyB, async () => await prisma.image.create({ data: { id: imageId, storageKey: "image" } }));

    await withTenantIsolation(companyA, async () => {
      const seeded = await seedProduct({ name: "Camisa", variants: [
        { attributes: { color: "azul" }, sku: "A-1", salePrice: 19.99, purchasePrice: 0, stock: 4 },
        { attributes: { color: "rojo" }, salePrice: 999999999.99, stock: 0 },
      ] });
      const first = { success: true as const, data: seeded.productId as ProductId };
      companyAProductId = first.data;
      const result = await detail(first.data);
      expect(result.success && result.data?.product.variants).toEqual(expect.arrayContaining([
        expect.objectContaining({ sku: "A-1", salePrice: { amount: 19.99, currency: "PEN" }, purchasePrice: { amount: 0, currency: "PEN" }, stock: expect.objectContaining({ quantity: 4 }) }),
        expect.objectContaining({ salePrice: { amount: 999999999.99, currency: "PEN" }, stock: expect.objectContaining({ quantity: 0 }) }),
      ]));
      expect(await create(companyA, { ...base(), photoIds: [imageId] })).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR", issues: [{ scope: "photo", index: 0, reason: "PHOTO_NOT_FOUND" }] } });
      const [dupeA, dupeB] = await Promise.all([
        create(companyA, base("race")),
        create(companyA, base(" RACE ")),
      ]);
      expect([dupeA.success, dupeB.success].sort()).toEqual([false, true]);
      // Whichever lost either saw the other's committed SKU (a typed issue) or hit the unique index at insert time.
      const loser = [dupeA, dupeB].find((item) => !item.success);
      expect(loser).toMatchObject({ success: false });
      expect(loser && !loser.success && (loser.error.code === "DUPLICATE_SKU" || loser.error.code === "VALIDATION_ERROR" && loser.error.issues.some((issue) => issue.reason === "DUPLICATE_SKU"))).toBe(true);
      expect(await create(companyA, base())).toMatchObject({ success: true });
      expect(await create(companyA, base())).toMatchObject({ success: true });
      const largeStock = await create(companyA, { ...base(), variants: [{ values: [], salePrice: 1, initialStock: Number.MAX_SAFE_INTEGER }] });
      expect(largeStock.success).toBe(true);
      if (largeStock.success) {
        const loaded = await productRepository.get(largeStock.data);
        expect(loaded.success && loaded.data?.variants[0].stock.quantity).toBe(Number.MAX_SAFE_INTEGER);
      }
      if (!result.success || !result.data) throw new Error("Product was not loaded");
      await expect(prisma.productStock.update({ where: { variantId: result.data.product.variants[0].id }, data: { quantity: -1n } })).rejects.toThrow(/ProductStock_quantity_nonnegative/);
      const directVariant = () => ({ id: randomUUID(), productId: first.data, combinationKey: randomUUID(), salePrice: 1, qrCode: randomUUID(), status: "active" });
      await expect(prisma.productVariant.create({ data: { ...directVariant(), salePrice: 0 } })).rejects.toThrow(/ProductVariant_sale_price_valid/);
      await expect(prisma.productVariant.create({ data: { ...directVariant(), purchasePrice: -1 } })).rejects.toThrow(/ProductVariant_purchase_price_valid/);
      await expect(prisma.productVariant.create({ data: { ...directVariant(), salePrice: 1_000_000_000 } })).rejects.toThrow(/numeric field overflow/);
      await expect(prisma.productVariant.create({ data: { ...directVariant(), sku: "X".repeat(101) } })).rejects.toThrow(/too long for the column/);
      await expect(prisma.product.create({ data: { id: randomUUID(), name: "X".repeat(201), currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date() } })).rejects.toThrow(/too long for the column/);
      const rollbackId = randomUUID() as ProductId;
      const repeatedQr = randomUUID();
      // The variant reuses the id of a stored one: the product row is written first, then the variant insert fails and rolls it back.
      const suppliedIds = [rollbackId, result.data!.product.variants[0].id, repeatedQr, randomUUID()];
      await expect(create(companyA, base(), { newId: () => suppliedIds.shift()! as ReturnType<typeof randomUUID> })).resolves.toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(await prisma.product.findFirst({ where: { id: rollbackId } })).toBeNull();
      const loadedFirst = await productRepository.get(first.data);
      expect(loadedFirst.success && loadedFirst.data).not.toBeNull();
      expect(await (await import("@core/src/shared/images/infrastructure/image-repository")).imageRepository.find(imageId)).toEqual({ success: true, data: null });
    });

    await withTenantIsolation(companyB, async () => {
      expect(await productRepository.get(companyAProductId!)).toEqual({ success: true, data: null });
      const sameSku = await create(companyB, base("a-1"));
      expect(sameSku.success).toBe(true);
      if (!sameSku.success) throw new Error("Product was not created");
      foreignProductId = sameSku.data;
      const loadedSameSku = await productRepository.get(sameSku.data);
      if (!loadedSameSku.success || !loadedSameSku.data) throw new Error("Product was not loaded");
      foreignVariantId = loadedSameSku.data.variants[0].id;
      const imageProduct = await create(companyB, { ...base(), photoIds: [imageId] });
      expect(imageProduct.success).toBe(true);
      if (imageProduct.success) {
        const withImage = await detail(imageProduct.data, async (ids) => ok({ images: ids.map((id) => ({ id, url: "https://example.test/image" })), failures: [] }));
        expect(withImage.success && withImage.data?.photos).toEqual([{ id: imageId, url: "https://example.test/image" }]);
      }
    });

    await withTenantIsolation(companyA, async () => {
      const foreign = await prisma.product.findFirst({ where: { companyId: companyB } });
      expect(foreign).toBeNull();
      expect(await detail(foreignProductId!)).toEqual({ success: true, data: null });
      const productId = randomUUID();
      const variantId = randomUUID();
      await expect(prisma.product.create({ data: { id: productId, name: "Wrong image", currency: "PEN", qrCode: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date() } })).resolves.toBeDefined();
      await expect(prisma.productPhoto.create({ data: { productId, imageId, position: 0 } })).rejects.toThrow(/ProductPhoto_companyId_imageId_fkey/);
      await expect(prisma.productVariant.create({ data: { id: variantId, productId: foreignProductId!, combinationKey: randomUUID(), salePrice: 1, qrCode: randomUUID(), status: "active" } })).rejects.toThrow(/ProductVariant_companyId_productId_fkey/);
      await expect(prisma.productStock.create({ data: { variantId: foreignVariantId!, quantity: 1n } })).rejects.toThrow(/ProductStock_pkey/);
    });
  } finally {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany({ where: { companyId: id } });
      await prisma.company.deleteMany({ where: { id } });
    });
  }
  } finally {
    await admin.$disconnect();
  }
});

async function withSeededVariants(run: (ctx: { mine: { id: string; qrCode: string }; foreign: { id: string; qrCode: string }; companyA: string; find: (codes: string[]) => Promise<unknown>; withTenantIsolation: <T>(id: string, fn: () => Promise<T>) => Promise<T> }) => Promise<void>) {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  const { prisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");
  const { findSellableVariantsByQrCodes } = await import("@core/src/features/products/infrastructure/order-stock");
  const companyA = randomUUID();
  const companyB = randomUUID();
  const seed = (attributes: Record<string, string>) => {
    const productId = randomUUID();
    const variant = { id: randomUUID(), qrCode: randomUUID() };
    return { ...variant, productId, create: async () => {
      await seedProduct({ id: productId, name: "Camisa", variants: [{ ...variant, attributes, sku: "CAM-1", salePrice: 19.99 }] });
    } };
  };
  const mine = seed({ color: "azul" });
  const foreign = seed({});
  try {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
    await withTenantIsolation(companyA, mine.create);
    await withTenantIsolation(companyB, foreign.create);
    await run({ mine, foreign, companyA, find: (codes) => findSellableVariantsByQrCodes(codes), withTenantIsolation });
  } finally {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => {
      await deleteSeededProducts();
      await prisma.company.deleteMany({ where: { id } });
    });
  }
}

test("findSellableVariantsByQrCodes returns active variants with price, currency and qrCode", () => withSeededVariants(async ({ mine, companyA, find, withTenantIsolation }) => {
  await withTenantIsolation(companyA, async () => {
    expect(await find([mine.qrCode, randomUUID()])).toEqual({ success: true, data: [
      { variantId: mine.id, productId: expect.any(String), qrCode: mine.qrCode, productName: "Camisa", variantAttributes: { color: "azul" }, sku: "CAM-1", unitPrice: { amount: 19.99, currency: "PEN" } },
    ] });
  });
}));

test("findSellableVariantsByQrCodes does not see variants of another company", () => withSeededVariants(async ({ foreign, companyA, find, withTenantIsolation }) => {
  await withTenantIsolation(companyA, async () => {
    expect(await find([foreign.qrCode])).toEqual({ success: true, data: [] });
  });
}));

test("findSellableVariantsByQrCodes does not return a deactivated variant", () => withSeededVariants(async ({ mine, companyA, find, withTenantIsolation }) => {
  await withTenantIsolation(companyA, async () => {
    const inactive = { id: randomUUID(), qrCode: randomUUID() };
    await seedProduct({ variants: [{ ...inactive, attributes: { Color: "Rojo" }, status: "inactive" }, { attributes: { Color: "Azul" } }] });
    expect(await find([mine.qrCode, inactive.qrCode])).toMatchObject({ success: true, data: [{ variantId: mine.id }] });
  });
}));
