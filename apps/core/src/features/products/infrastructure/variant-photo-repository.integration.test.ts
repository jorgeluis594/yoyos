import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findVariantImages } from "@core/src/features/products/infrastructure/variant-photo-repository";
import type { VariantId } from "@core/src/features/products/domain/product";

const when = new Date("2026-01-01T00:00:00.000Z");

async function addProduct(name: string, status: "active" | "inactive", variantStatus: "active" | "inactive", imageId: string | null) {
  const id = randomUUID();
  const variantId = randomUUID();
  await prisma.product.create({ data: { id, name, currency: "PEN", qrCode: randomUUID(), status, imageId, createdAt: when, updatedAt: when } });
  await prisma.productVariant.create({ data: { id: variantId, productId: id, attributes: {}, salePrice: 10, qrCode: randomUUID(), status: variantStatus } });
  return variantId as VariantId;
}

async function addImage() {
  const id = randomUUID();
  await prisma.image.create({ data: { id, storageKey: `images/${id}` } });
  return id;
}

test("returns the product image of each variant, including inactive products", async () => {
  const company = randomUUID();
  try {
    await withTenantIsolation(company, async () => await prisma.company.create({ data: { id: company, name: company, country: "PE" } }));
    const { withPhoto, withoutPhoto, inactive, imageId, inactiveImageId } = await withTenantIsolation(company, async () => {
      const imageId = await addImage();
      const inactiveImageId = await addImage();
      return { imageId, inactiveImageId, withPhoto: await addProduct("Polo básico", "active", "active", imageId),
        withoutPhoto: await addProduct("Taza blanca", "active", "active", null), inactive: await addProduct("Archivada", "inactive", "inactive", inactiveImageId) };
    });
    const result = await withTenantIsolation(company, () => findVariantImages([withPhoto, withoutPhoto, inactive]));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect([...result.data].sort((a, b) => a.variantId.localeCompare(b.variantId))).toEqual([
      { variantId: withPhoto, imageId }, { variantId: withoutPhoto, imageId: null }, { variantId: inactive, imageId: inactiveImageId },
    ].sort((a, b) => a.variantId.localeCompare(b.variantId)));
  } finally {
    await withTenantIsolation(company, async () => {
      await prisma.productVariant.deleteMany({});
      await prisma.product.deleteMany({});
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
      const variant = await addProduct("Polo básico", "active", "active", await addImage());
      const { productId } = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant }, select: { productId: true } });
      return { variant, productId, replacement: await addImage() };
    });
    await withTenantIsolation(company, () => prisma.product.update({ where: { id: productId }, data: { imageId: replacement } }));
    expect(await withTenantIsolation(company, () => findVariantImages([variant]))).toEqual({ success: true, data: [{ variantId: variant, imageId: replacement }] });
  } finally {
    await withTenantIsolation(company, async () => {
      await prisma.productVariant.deleteMany({});
      await prisma.product.deleteMany({});
      await prisma.image.deleteMany({});
      await prisma.company.delete({ where: { id: company } });
    });
  }
});

test("does not return variants of another company", async () => {
  const [mine, other] = [randomUUID(), randomUUID()];
  try {
    for (const id of [mine, other]) await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: id, country: "PE" } }));
    const foreign = await withTenantIsolation(other, async () => addProduct("Foreign", "active", "active", await addImage()));
    const result = await withTenantIsolation(mine, () => findVariantImages([foreign]));
    expect(result).toEqual({ success: true, data: [] });
  } finally {
    for (const id of [mine, other]) await withTenantIsolation(id, async () => {
      await prisma.productVariant.deleteMany({});
      await prisma.product.deleteMany({});
      await prisma.image.deleteMany({});
      await prisma.company.delete({ where: { id } });
    });
  }
});
