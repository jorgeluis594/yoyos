import { expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

test("private web rated pickup rejects an obsolete price without writes and returns the saved aggregate", async ({ page }) => {
  const email = `rated-web-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Rated web", country: "PE" });
    const tenantId = companyId;
    const userId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
    const orderId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => {
      const product = await products.create({ name: "Rated product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!product.success) throw new Error("Expected product");
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } });
      expect(await orders.create({ id: orderId as OrderId, contactId: null, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] },
        { companyId: tenantId as CompanyId, userId: userId as UserId })).toMatchObject({ success: true });
    });
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, agency: { enabled: false }, couriers: [], home: { enabled: false },
      store: { enabled: true, pickupPoint: { name: "Pickup", address: "Street", instructions: null } } } })).ok()).toBe(true);
    const url = `/es-PE/orders/${orderId}`;
    const delivery = { method: "store", recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } } };
    const stale = await page.request.post(`${url}.data`, { data: { delivery, expectedPrice: { amount: 3, currency: "PEN" } } });
    expect(stale.ok()).toBe(true);
    expect(await stale.text()).toContain("priceChanged");
    const unchanged = await page.request.get(`/api/orders/${orderId}/aggregate`);
    expect(await unchanged.json()).toMatchObject({ delivery: null, total: { amount: 10 }, stockDeducted: false });
    const saved = await page.request.post(`${url}.data`, { data: { delivery, expectedPrice: { amount: 0, currency: "PEN" } } });
    expect(saved.ok()).toBe(true);
    const aggregate = await page.request.get(`/api/orders/${orderId}/aggregate`);
    expect(await aggregate.json()).toMatchObject({ id: orderId, delivery: { method: "store", recordedBy: { kind: "seller", userId } },
      deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 }, total: { amount: 10 }, stockDeducted: false });
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
