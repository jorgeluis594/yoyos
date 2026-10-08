import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
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
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 1, agency: { enabled: false }, couriers: [], home: { enabled: true },
      store: { enabled: true, pickupPoint: { name: "Pickup", address: "Street", instructions: null } } } })).ok()).toBe(true);
    const zones = [8, 12].map((amount, index) => ({ kind: "new", name: `Zone ${index}`, enabled: true, districtCodes: ["040110"], price: { amount, currency: "PEN" } }));
    expect((await page.request.put("/api/delivery-settings/zones", { data: { method: "home", expectedVersion: 2, zones } })).ok()).toBe(true);
    await page.goto(url);
    await page.getByRole("button", { name: "Editar entrega", exact: true }).click();
    await page.getByLabel("Modalidad de entrega", { exact: true }).selectOption("home");
    await page.getByLabel("Departamento", { exact: true }).selectOption("04");
    await page.getByLabel("Provincia", { exact: true }).selectOption("0401");
    await page.getByLabel("Distrito", { exact: true }).selectOption("040110");
    const tariff = page.getByLabel("Tarifa de entrega", { exact: true });
    await browserExpect(tariff.locator("option")).toHaveCount(3);
    const rateId = await tariff.locator("option").nth(1).getAttribute("value");
    if (!rateId) throw new Error("Expected explicit rate");
    await tariff.selectOption(rateId);
    await page.getByLabel("Dirección de entrega", { exact: true }).fill("Preserved street");
    const storedZones = await (await page.request.get("/api/delivery-settings/zones")).json();
    expect((await page.request.put("/api/delivery-settings/zones", { data: { method: "home", expectedVersion: storedZones.version,
      zones: storedZones.zones.map((zone: { id: string; name: string; enabled: boolean; districtCodes: string[]; price: { amount: number; currency: string } }) => ({ kind: "existing", id: zone.id, name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes, price: { ...zone.price, amount: zone.price.amount + 2 } })) } })).ok()).toBe(true);
    await page.getByRole("button", { name: "Guardar entrega", exact: true }).click();
    await browserExpect(page.getByRole("alert")).toContainText("La tarifa cambió");
    await browserExpect(page.getByLabel("Dirección de entrega", { exact: true })).toHaveValue("Preserved street");
    await browserExpect(tariff).toHaveValue("");
    await browserExpect(page.getByRole("button", { name: "Guardar entrega", exact: true })).toBeDisabled();
    const afterConflict = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(afterConflict).toMatchObject({ delivery: { method: "store" }, total: { amount: 10 } });
    await browserExpect(tariff.locator("option")).toHaveCount(3);
    const refreshedRate = await tariff.locator("option").nth(1).getAttribute("value");
    if (!refreshedRate) throw new Error("Expected fresh rate");
    expect(refreshedRate).not.toBe(rateId);
    await tariff.selectOption(refreshedRate);
    for (const [width, height, label] of [[1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/rated-seller-editor-${label}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "Guardar entrega", exact: true }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Entrega guardada." })).toBeVisible();
    const finalOrder = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(finalOrder.delivery).toMatchObject({ method: "home", destination: { address: "Preserved street", districtCode: "040110" }, pricing: { rateId: refreshedRate } });
    expect(finalOrder.deliveryCharge.amount).toBeGreaterThan(0);
    expect(finalOrder.total.amount).toBe(10 + finalOrder.deliveryCharge.amount);
  } finally {
    await page.goto("/");
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
