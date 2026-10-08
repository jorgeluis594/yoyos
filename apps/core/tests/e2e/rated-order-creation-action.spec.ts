import { expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";

test("web creation rejects a stale rate atomically and retries the same order with the reviewed full charge", async ({ page }) => {
  const email = `rated-create-web-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Rated creation", country: "PE" });
    const tenantId = companyId;
    const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await products.create({ name: "Product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!product.success) throw new Error("Expected product");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, home: { enabled: true }, agency: { enabled: false },
      store: { enabled: false, pickupPoint: null }, couriers: [] } })).ok()).toBe(true);
    const zone = { kind: "new", name: "Zone", enabled: true, districtCodes: ["040110"], price: { amount: 8, currency: "PEN" } };
    expect((await page.request.put("/api/delivery-settings/zones", { data: { method: "home", expectedVersion: 1, zones: [zone] } })).ok()).toBe(true);
    const quoted = await page.request.post("/api/quotations", { data: { destination: { country: "PE", districtCode: "040110" } } });
    const rate = (await quoted.json()).rates[0];
    const zones = await (await page.request.get("/api/delivery-settings/zones")).json();
    expect((await page.request.put("/api/delivery-settings/zones", { data: { method: "home", expectedVersion: 2,
      zones: [{ ...zone, kind: "existing", id: zones.zones[0].id, price: { amount: 10, currency: "PEN" } }] } })).ok()).toBe(true);
    const id = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    const request = { id, contactId: null, items: [{ variantId, quantity: 1 }],
      payments: [{ paymentId, amount: { amount: 18, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }],
      delivery: { delivery: { method: "home", rateId: rate.id, recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } },
        destination: { districtCode: "040110", address: "Preserved street", instructions: null } }, expectedPrice: rate.price } };
    const rejected = await page.request.post("/es-PE/orders/new.data", { form: { order: JSON.stringify(request) } });
    expect(rejected.ok()).toBe(true);
    expect(await rejected.text()).toContain("TOTAL_CHANGED");
    await withTenantIsolation(tenantId, async () => {
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity).toBe(3n);
    });
    const fresh = await page.request.post("/api/quotations", { data: { destination: { country: "PE", districtCode: "040110" } } });
    const freshRate = (await fresh.json()).rates[0];
    const saved = await page.request.post("/es-PE/orders/new", { maxRedirects: 0, form: { order: JSON.stringify({ ...request,
      payments: [{ ...request.payments[0], amount: { amount: 20, currency: "PEN" } }],
      delivery: { delivery: { ...request.delivery.delivery, rateId: freshRate.id }, expectedPrice: freshRate.price } }) } });
    expect(saved.status()).toBe(302);
    expect(saved.headers().location).toContain(`/orders/${id}`);
    const aggregate = await (await page.request.get(`/api/orders/${id}/aggregate`)).json();
    expect(aggregate).toMatchObject({ id, delivery: { method: "home", pricing: { rateId: freshRate.id }, recordedBy: { kind: "seller", userId: sellerId } },
      deliveryCharge: { amount: 10 }, itemsTotal: { amount: 10 }, total: { amount: 20 }, paidAmount: { amount: 20 }, stockDeducted: true });
    await withTenantIsolation(tenantId, async () => {
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.payment.count()).toBe(1);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity).toBe(2n);
    });
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryZone.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
