import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findVariantImages } from "@core/src/features/products/infrastructure/variant-photo-repository";
import type { VariantId } from "@core/src/features/products/domain/product";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

const when = new Date("2026-01-01T00:00:00.000Z");

async function addProduct(name: string, imageId: string | null) {
  const id = randomUUID();
  const variantId = randomUUID();
  await seedProduct({ id, name, imageId, createdAt: when, updatedAt: when, variants: [{ id: variantId, salePrice: 10 }] });
  return variantId as VariantId;
}

async function addImage() {
  const id = randomUUID();
  await prisma.image.create({ data: { id, storageKey: `images/${id}` } });
  return id;
}

test("returns the product image of each variant", async () => {
  const company = randomUUID();
  try {
    await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
    const { withPhoto, withoutPhoto, imageId } = await withTenantIsolation(company, async () => {
      const imageId = await addImage();
      return { imageId, withPhoto: await addProduct("Polo básico", imageId),
        withoutPhoto: await addProduct("Taza blanca", null) };
    });
    const result = await withTenantIsolation(company, () => findVariantImages([withPhoto, withoutPhoto]));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect([...result.data].sort((a, b) => a.variantId.localeCompare(b.variantId))).toEqual([
      { variantId: withPhoto, imageId }, { variantId: withoutPhoto, imageId: null }
    ].sort((a, b) => a.variantId.localeCompare(b.variantId)));
  } finally {
    await withTenantIsolation(company, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany({});
      await prisma.company.delete({ where: { id: company } });
    });
  }
});

test("returns the new image after the product image is replaced", async () => {
  const company = randomUUID();
  try {
    await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
    const { variant, productId, replacement } = await withTenantIsolation(company, async () => {
      const variant = await addProduct("Polo básico", await addImage());
      const { productId } = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant }, select: { productId: true } });
      return { variant, productId, replacement: await addImage() };
    });
    await withTenantIsolation(company, async () => await prisma.product.update({ where: { id: productId }, data: { imageId: replacement } }));
    expect(await withTenantIsolation(company, () => findVariantImages([variant]))).toEqual({ success: true, data: [{ variantId: variant, imageId: replacement }] });
  } finally {
    await withTenantIsolation(company, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany({});
      await prisma.company.delete({ where: { id: company } });
    });
  }
});

test("does not return variants of another company", async () => {
  const [mine, other] = [randomUUID(), randomUUID()];
  try {
    for (const id of [mine, other]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
    const foreign = await withTenantIsolation(other, async () => addProduct("Foreign", await addImage()));
    const result = await withTenantIsolation(mine, () => findVariantImages([foreign]));
    expect(result).toEqual({ success: true, data: [] });
  } finally {
    for (const id of [mine, other]) await withTenantIsolation(id, async () => {
      await deleteSeededProducts();
      await prisma.image.deleteMany({});
      await prisma.company.delete({ where: { id } });
    });
  }
});
