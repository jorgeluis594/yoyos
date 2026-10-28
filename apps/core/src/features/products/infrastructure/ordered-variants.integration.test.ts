import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findOrderedVariantIds } from "@core/src/features/products/infrastructure/ordered-variants";
import type { VariantId } from "@core/src/features/products/domain/product";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

async function fixture() {
  const companyId = randomUUID();
  const variantIds = [randomUUID(), randomUUID()];
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Ordered variants test", country: "PE" } });
    await seedProduct({ id: randomUUID(), name: "Sample product", variants: variantIds.map((id, index) => ({
      id, attributes: { Size: index ? "L" : "M" }, sku: `SKU-${id}`, salePrice: 0.1, stock: 3n })) });
  });
  return { companyId, variantIds, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await deleteSeededProducts();
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

test("findOrderedVariantIds counts unconfirmed catalog orders", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    const sold = a.variantIds[0] as VariantId;
    const unsold = a.variantIds[1] as VariantId;
    await withTenantIsolation(a.companyId, async () => {
      expect(await findOrderedVariantIds([sold, unsold])).toEqual(ok(new Set()));
      expect(await findOrderedVariantIds([])).toEqual(ok(new Set()));
      const orderId = randomUUID();
      // An open catalog order: nobody has confirmed checkout yet.
      await prisma.order.create({ data: { id: orderId, number: 2001n, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date(), fromCatalog: true, sellerId: null, checkoutEnabledAt: new Date() } });
      await prisma.orderItem.create({ data: { orderId, variantId: sold, productName: "Sample product", variantAttributes: {}, quantity: 1n, unitPrice: 10, subtotal: 10 } });
      expect(await findOrderedVariantIds([sold, unsold, randomUUID() as VariantId])).toEqual(ok(new Set([sold])));
    });
    await withTenantIsolation(b.companyId, async () => expect(await findOrderedVariantIds([sold])).toEqual(ok(new Set())));
  } finally { await a.cleanup(); await b.cleanup(); }
});

