import { browserExpect, expect, openOptions, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { productEditing } from "@core/src/features/products/product-editing";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { chooseDistrict } from "@core/tests/e2e/district-combobox";

test("save_changes rejects an obsolete price without writes, answers the saved order and replaces a pickup from the open card", async ({ page }) => {
  const email = `rated-web-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Rated web", country: "PE" });
    const tenantId = companyId;
    const userId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
    const orderId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => {
      const product = await productEditing.create({ name: "Rated product", currency: "PEN", options: [], variants: [{ values: [], salePrice: 10, initialStock: 3 }] });
      if (!product.success) throw new Error("Expected product");
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } });
      expect(await orders.create({ id: orderId as OrderId, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] },
        { companyId: tenantId as CompanyId, userId: userId as UserId })).toMatchObject({ success: true });
    });
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, agency: { enabled: false }, home: { enabled: false },
      store: { enabled: true, pickupPoint: { name: "Pickup", address: "Street", instructions: null } } } })).ok()).toBe(true);
    const url = `/es-PE/orders/${orderId}`;
    const access = { companyId: tenantId as CompanyId, userId: userId as UserId };
    const revisionsOf = () => withTenantIsolation(tenantId, async () => {
      const found = await orders.getAggregate(orderId as OrderId, access);
      if (!found.success) throw new Error("Expected order");
      return orders.revisions(found.data);
    });
    const delivery = { method: "store", recipient: { name: "Recipient", phone: "999", identity: { kind: "absent" } } };
    const post = (data: unknown) => page.request.post(`${url}.data`, { data });
    const body = async (expectedPrice: { amount: number; currency: string }) => ({ operation: "save_changes",
      delivery: { base: (await revisionsOf()).delivery, change: { kind: "replace", selection: delivery, expectedPrice } } });
    // A body without an operation, and a malformed one, are refused as invalid input.
    const obsolete = await post({ delivery, obsoleteCharge: false });
    expect(obsolete.ok()).toBe(true);
    expect(await obsolete.text()).toContain("INVALID_INPUT");
    expect(await (await post({ operation: "save_changes", delivery: { base: "short", change: { kind: "replace", selection: delivery } } })).text()).toContain("INVALID_INPUT");
    // An outdated expected price answers the current price and writes nothing.
    const stale = await post(await body({ amount: 3, currency: "PEN" }));
    expect(stale.ok()).toBe(true);
    const staleText = await stale.text();
    expect(staleText).toContain("TOTAL_CHANGED");
    expect(staleText).toContain("currentPrice");
    expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toMatchObject({ delivery: null, total: { amount: 10 }, stockDeducted: false });
    // The fresh price saves the delivery and answers the new order with its revisions.
    const saved = await post(await body({ amount: 0, currency: "PEN" }));
    expect(saved.ok()).toBe(true);
    expect(await saved.text()).toContain("revisions");
    expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toMatchObject({ id: orderId, delivery: { method: "store", recordedBy: { kind: "seller", userId } },
      deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 }, total: { amount: 10 }, stockDeducted: false });
    // A stale revision answers the conflict when the requested state differs from the stored one; the same state is a repeat and succeeds.
    const other = { ...delivery, recipient: { ...delivery.recipient, name: "Someone else" } };
    const conflict = await post({ operation: "save_changes", delivery: { base: "A".repeat(43), change: { kind: "replace", selection: other, expectedPrice: { amount: 0, currency: "PEN" } } } });
    expect(await conflict.text()).toContain("ORDER_CHANGED");

    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 1, agency: { enabled: false }, home: { enabled: true },
      store: { enabled: true, pickupPoint: { name: "Pickup", address: "Street", instructions: null } } } })).ok()).toBe(true);
    const zones = [8, 12].map((amount, index) => ({ kind: "new", name: `Zone ${index}`, enabled: true, districtCodes: ["040110"],
      options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount, currency: "PEN" } }] }));
    expect((await page.request.put("/api/delivery-settings/zones", { data: { expectedVersion: 2, zones } })).ok()).toBe(true);
    await page.goto(url);
    // The pickup is replaced by a home delivery in the open card, with no «Editar entrega» step.
    await page.getByRole("tab", { name: "Domicilio" }).click();
    await chooseDistrict(page, "040110");
    const rates = await openOptions(page, "Tarifa de entrega");
    await browserExpect(rates).toHaveCount(2);
    await rates.first().click();
    await page.getByLabel("Dirección de entrega", { exact: true }).fill("Preserved street");
    await browserExpect(page.getByRole("button", { name: "Guardar cambios" }).first()).toBeEnabled();
    const storedZones = await (await page.request.get("/api/delivery-settings/zones")).json();
    expect((await page.request.put("/api/delivery-settings/zones", { data: { expectedVersion: storedZones.version,
      zones: storedZones.zones.map((zone: { id: string; name: string; enabled: boolean; districtCodes: string[]; options: { id: string; method: string; name: string; enabled: boolean; price: { amount: number; currency: string } }[] }) => ({
        kind: "existing", id: zone.id, name: zone.name, enabled: zone.enabled, districtCodes: zone.districtCodes,
        options: zone.options.map(option => ({ kind: "existing", ...option, price: { ...option.price, amount: option.price.amount + 2 } })) })) } })).ok()).toBe(true);
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).first().click();
    await browserExpect(page.getByRole("alert").filter({ hasText: "El precio de la entrega cambió a" })).toBeVisible();
    await browserExpect(page.getByLabel("Dirección de entrega", { exact: true })).toHaveValue("Preserved street");
    const afterConflict = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(afterConflict).toMatchObject({ delivery: { method: "store" }, total: { amount: 10 } });
    for (const [width, height, label] of [[1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/rated-seller-editor-${label}.png`, fullPage: true });
    }
    // The rate the seller chose belongs to the old quotation: picking the district again quotes it afresh, and the new rate saves at the new price.
    await chooseDistrict(page, "040103");
    await chooseDistrict(page, "040110");
    const refreshed = await openOptions(page, "Tarifa de entrega");
    await browserExpect(refreshed).toHaveCount(2);
    await refreshed.first().click();
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).first().click();
    await browserExpect(page.getByText("Cambios guardados.")).toBeVisible();
    const finalOrder = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(finalOrder.delivery).toMatchObject({ method: "home", destination: { address: "Preserved street", districtCode: "040110" }, pricing: { rateId: expect.any(String) } });
    expect(finalOrder.deliveryCharge.amount).toBeGreaterThan(0);
    expect(finalOrder.total.amount).toBe(10 + finalOrder.deliveryCharge.amount);
  } finally {
    await page.goto("about:blank");
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryOptionAgency.deleteMany(); await prisma.deliveryOption.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
