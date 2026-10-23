import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findProductNoticeNames } from "@core/src/features/products/infrastructure/product-notice-names";
import type { ProductId } from "@core/src/features/products/domain/product";

async function withProduct(variants: readonly Record<string, string>[], check: (productId: ProductId, companyId: string) => Promise<void>) {
  const companyId = randomUUID();
  const productId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Names", country: "PE" } });
    await prisma.product.create({ data: { id: productId, name: "Polo básico", currency: "PEN", qrCode: productId, status: "active", createdAt: new Date(), updatedAt: new Date() } });
    for (const attributes of variants) {
      const id = randomUUID();
      await prisma.productVariant.create({ data: { id, productId, attributes, salePrice: 10, qrCode: id, status: "active" } });
    }
  });
  try {
    await withTenantIsolation(companyId, () => check(productId as ProductId, companyId));
  } finally {
    await withTenantIsolation(companyId, async () => {
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
}

// ProductVariant.attributes is jsonb, which stores keys by length and then bytes. Product screens show that same order,
// so a notice names the attributes the way the seller already sees them: Talla and Color read back as «color», «talla».
test("names the product's attributes in the order product screens show them, once each and in lower case", async () => {
  await withProduct([{ Talla: "M", Color: "Negro" }, { Talla: "L", Color: "Rojo" }], async (productId) => {
    const found = await findProductNoticeNames([productId]);
    expect(found).toEqual({ success: true, data: new Map([[productId, { name: "Polo básico", attributeNames: ["color", "talla"] }]]) });
  });
});

test("reads nothing for a product that does not exist or from another company", async () => {
  await withProduct([{ Talla: "M" }], async (productId) => {
    expect(await findProductNoticeNames([randomUUID() as ProductId])).toEqual({ success: true, data: new Map() });
    expect(await findProductNoticeNames([])).toEqual({ success: true, data: new Map() });
    expect(await withTenantIsolation(randomUUID(), () => findProductNoticeNames([productId]))).toEqual({ success: true, data: new Map() });
  });
});
