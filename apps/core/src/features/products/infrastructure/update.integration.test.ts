import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { createProduct, type CreateInput } from "@core/src/features/products/application/create";
import { updateProduct } from "@core/src/features/products/application/update";
import { productRepository } from "@core/src/features/products/infrastructure/repository";
import type { CompanyId, ProductId, VariantId } from "@core/src/features/products/domain/product";

test("product updates persist effective changes, ignore no-ops, and roll back atomically", async () => {
  expect(process.env.DATABASE_URL, "run sh scripts/run-tests.sh integration").toBeTruthy();
  const companyA = randomUUID() as CompanyId;
  const companyB = randomUUID() as CompanyId;
  const deps = {
    repository: productRepository,
    findImage: async () => true,
    clock: () => new Date("2026-12-01T00:00:00.000Z"),
  };
  const createDeps = { ...deps, newId: randomUUID, clock: () => new Date("2026-09-24T00:00:00.000Z") };
  const base: CreateInput = { name: "Camisa", description: "Algodón", currency: "PEN", variants: [
    { attributes: { Talla: "M" }, sku: "CAM-M", salePrice: 20, purchasePrice: 0, initialStock: 4 },
    { attributes: { Talla: "L" }, sku: "CAM-L", salePrice: 25, initialStock: 6 },
  ] };
  try {
    for (const id of [companyA, companyB]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
    await withTenantIsolation(companyA, async () => {
      const created = await createProduct(companyA, base, createDeps);
      expect(created.success).toBe(true);
      if (!created.success) return;
      const id = created.data;
      const before = (await productRepository.get(companyA, id))!;
      const medium = before.variants.find((variant) => variant.sku === "CAM-M")!;
      const large = before.variants.find((variant) => variant.sku === "CAM-L")!;

      const edited = await updateProduct(companyA, id, {
        name: "  Camisa nueva  ", description: null,
        variants: [{ id: medium.id, sku: "cam-m-2", purchasePrice: null }, { id: large.id, salePrice: 26 }],
      }, deps);
      expect(edited).toEqual({ success: true, data: id });
      const after = (await productRepository.get(companyA, id))!;
      expect(after).toMatchObject({
        name: "Camisa nueva", currency: "PEN", qrCode: before.qrCode, createdAt: before.createdAt,
        updatedAt: new Date("2026-12-01T00:00:00.000Z"),
      });
      expect(after.description).toBeUndefined();
      const editedMedium = after.variants.find((variant) => variant.id === medium.id)!;
      expect(editedMedium).toMatchObject({ sku: "cam-m-2", salePrice: { amount: 20 }, stock: { quantity: 4 }, qrCode: medium.qrCode, attributes: { Talla: "M" } });
      expect(editedMedium.purchasePrice).toBeUndefined();
      const editedLarge = after.variants.find((variant) => variant.id === large.id)!;
      expect(editedLarge).toMatchObject({ sku: "CAM-L", salePrice: { amount: 26, currency: "PEN" }, stock: { quantity: 6 } });

      expect(await updateProduct(companyA, id, {}, deps)).toEqual({ success: true, data: id });
      expect(await updateProduct(companyA, id, { name: "Camisa nueva", variants: [{ id: medium.id, sku: "CAM-M-2" }] }, deps)).toEqual({ success: true, data: id });
      expect((await productRepository.get(companyA, id))!.updatedAt).toEqual(new Date("2026-12-01T00:00:00.000Z"));

      expect(await updateProduct(companyA, id, { description: "Nueva" }, deps)).toEqual({ success: true, data: id });
      const withDescription = (await productRepository.get(companyA, id))!;
      expect(withDescription.description).toBe("Nueva");
      expect(await updateProduct(companyA, id, { variants: [{ id: medium.id, purchasePrice: 0 }] }, deps)).toEqual({ success: true, data: id });
      expect((await productRepository.get(companyA, id))!.variants.find((variant) => variant.id === medium.id)!.purchasePrice).toEqual({ amount: 0, currency: "PEN" });

      const foreign = await updateProduct(companyA, id, { variants: [{ id: randomUUID() as VariantId, salePrice: 1 }] }, deps);
      expect(foreign).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });

      const rollback = await updateProduct(companyA, id, {
        name: "No debe persistir",
        variants: [{ id: medium.id, sku: "CAM-L" }],
      }, deps);
      expect(rollback).toMatchObject({ success: false, error: { code: "DUPLICATE_SKU" } });
      const rolledBack = (await productRepository.get(companyA, id))!;
      expect(rolledBack.name).toBe("Camisa nueva");
      expect(rolledBack.updatedAt).toEqual(new Date("2026-12-01T00:00:00.000Z"));
      expect(rolledBack.variants.find((variant) => variant.id === medium.id)!.sku).toBe("cam-m-2");

      const missing = await updateProduct(companyA, randomUUID() as ProductId, { name: "Fantasma" }, deps);
      expect(missing).toMatchObject({ success: false, error: { code: "PRODUCT_NOT_FOUND" } });
    });

    let foreignProductId: ProductId | undefined;
    let foreignVariantId: VariantId | undefined;
    await withTenantIsolation(companyB, async () => {
      const sameSku = await createProduct(companyB, { ...base, variants: [{ attributes: {}, sku: "CAM-M", salePrice: 5 }] }, createDeps);
      expect(sameSku).toMatchObject({ success: true });
      const absent = await createProduct(companyB, { ...base, variants: [{ attributes: { Talla: "M" }, salePrice: 5 }, { attributes: { Talla: "L" }, salePrice: 6 }] }, createDeps);
      expect(absent).toMatchObject({ success: true });
      if (!sameSku.success) throw new Error("Product was not created");
      foreignProductId = sameSku.data;
      foreignVariantId = (await productRepository.get(companyB, sameSku.data))!.variants[0].id;
    });

    await withTenantIsolation(companyA, async () => {
      expect(await updateProduct(companyA, foreignProductId!, { name: "Intruso" }, deps)).toMatchObject({ success: false, error: { code: "PRODUCT_NOT_FOUND" } });
      expect(await updateProduct(companyA, foreignProductId!, { variants: [{ id: foreignVariantId!, salePrice: 1 }] }, deps)).toMatchObject({ success: false, error: { code: "PRODUCT_NOT_FOUND" } });
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
