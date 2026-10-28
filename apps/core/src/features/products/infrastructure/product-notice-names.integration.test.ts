import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";
import { findProductNoticeNames } from "@core/src/features/products/infrastructure/product-notice-names";
import type { ProductId } from "@core/src/features/products/domain/product";

async function withProduct(variants: readonly Record<string, string>[], check: (productId: ProductId, companyId: string) => Promise<void>) {
  const companyId = randomUUID();
  const productId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Names", country: "PE" } });
    await seedProduct({ id: productId, name: "Polo básico", qrCode: productId, variants: variants.map((attributes) => ({ attributes, salePrice: 10 })) });
  });
  try {
    await withTenantIsolation(companyId, () => check(productId as ProductId, companyId));
  } finally {
    await withTenantIsolation(companyId, async () => {
      await deleteSeededProducts();
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
}

// Product screens show the options in their saved order, so a notice names the attributes the way the seller already sees them.
test("names the product's attributes in the order product screens show them, once each and in lower case", async () => {
  await withProduct([{ Talla: "M", Color: "Negro" }, { Talla: "L", Color: "Rojo" }], async (productId) => {
    const found = await findProductNoticeNames([productId]);
    expect(found).toEqual({ success: true, data: new Map([[productId, { name: "Polo básico", attributeNames: ["talla", "color"] }]]) });
  });
});

test("reads nothing for a product that does not exist or from another company", async () => {
  await withProduct([{ Talla: "M" }], async (productId) => {
    expect(await findProductNoticeNames([randomUUID() as ProductId])).toEqual({ success: true, data: new Map() });
    expect(await findProductNoticeNames([])).toEqual({ success: true, data: new Map() });
    expect(await withTenantIsolation(randomUUID(), () => findProductNoticeNames([productId]))).toEqual({ success: true, data: new Map() });
  });
});
