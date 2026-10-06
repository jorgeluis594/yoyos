import { startMobileWeb } from "@core/tests/e2e/mobile-web";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("seller ships or delivers directly, refreshes details and list, and preserves payments", async ({ page }) => {
  const email = `fulfillment-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Fulfillment", country: "PE" });
    const tenantId = companyId;
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await products.create({ name: "Fulfillment product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 5 }] });
      if (!product.success) throw new Error("Product setup failed");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, agency: { enabled: false }, couriers: [],
      home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } } })).ok()).toBe(true);
    for (const mode of ["shipment", "handover", "pickup"] as const) {
      const orderId = crypto.randomUUID();
      expect((await page.request.post("/api/orders", { data: { id: orderId, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
      if (mode === "pickup") {
        expect((await page.request.put(`/api/orders/${orderId}/delivery`, { data: {
          delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, chargeDeliveryToCustomer: false,
        } })).ok()).toBe(true);
      }
      await page.goto(`/es-PE/orders/${orderId}`);
      await browserExpect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toBeDisabled();
      await browserExpect(page.getByRole("button", { name: "Marcar entregado", exact: true })).toBeDisabled();
      await browserExpect(page.getByText("Se requiere el pago completo antes de enviar o entregar.").first()).toBeVisible();
      const pay = async () => {
        const response = await page.request.post(`/api/orders/${orderId}/payments`, { data: {
          paymentId: crypto.randomUUID(), amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false,
        } });
        expect(response.ok()).toBe(true);
        return (await response.json()).order;
      };
      const paid = await pay();
      await page.reload();
      if (mode === "shipment") {
        // A concurrent payment void must be rejected by the authoritative operation.
        expect((await page.request.post(`/api/orders/${orderId}/payments/${paid.payments[0].id}/void`)).ok()).toBe(true);
        await page.getByRole("button", { name: "Marcar enviado", exact: true }).click();
        await browserExpect(page.getByRole("alert")).toContainText("Se requiere el pago completo");
        expect((await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).deliveryStatus).toBe("pending");
        await pay();
        await page.reload();
      }
      const before = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
      const stockBefore = await withTenantIsolation(tenantId, async () => await prisma.productStock.findUniqueOrThrow({ where: { variantId } }));
      if (mode === "shipment") {
        await page.getByRole("button", { name: "Marcar enviado", exact: true }).click();
        await browserExpect(page.getByRole("status")).toHaveText("Pedido marcado como enviado.");
        await browserExpect(page.getByText("Entrega: Despachada", { exact: true })).toBeVisible();
        await browserExpect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toBeDisabled();
        expect((await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).payments).toEqual(before.payments);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: "/tmp/order-fulfillment-desktop.png", fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: "/tmp/order-fulfillment-mobile.png", fullPage: true });
      }
      await page.getByRole("button", { name: "Marcar entregado", exact: true }).click();
      await browserExpect(page.getByRole("status")).toHaveText("Pedido marcado como entregado.");
      await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
      await browserExpect(page.getByRole("button", { name: "Marcar entregado", exact: true })).toBeDisabled();
      const after = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
      expect(after.payments).toEqual(before.payments);
      expect(after).toMatchObject({ status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", completedAt: expect.any(String) });
      const stockAfter = await withTenantIsolation(tenantId, async () => await prisma.productStock.findUniqueOrThrow({ where: { variantId } }));
      expect(stockAfter.quantity).toBe(stockBefore.quantity);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("link", { name: "Ver ventas", exact: true }).click();
      await browserExpect(page.getByRole("row").filter({ has: page.getByText(`Pedido #${after.number}`, { exact: true }) }).locator("summary")).toHaveAttribute("aria-label", "Completado");
    }
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

test("mobile fulfillment refreshes details and history through the real API", async ({ page }) => {
  const mobile = await startMobileWeb();
  const coreOrigin = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;
  const email = `mobile-fulfillment-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Mobile seller", companyName: "Mobile fulfillment", country: "PE" });
    const tenantId = companyId;
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await products.create({ name: "Mobile fulfillment product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!product.success) throw new Error("Product setup failed");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const shipFirst of [true, false]) {
      const orderId = crypto.randomUUID();
      const created = await page.request.post(`${coreOrigin}/api/orders`, { data: { id: orderId, contactId: null, items: [{ variantId, quantity: 1 }],
        payments: [{ paymentId: crypto.randomUUID(), amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false }] } });
      expect(created.status()).toBe(201);
      const before = await created.json();
      await page.goto(`${mobile.origin}/orders`, { timeout: 90000 });
      await browserExpect(page.getByText(new RegExp(`Pedido #${before.number} ·`))).toBeVisible({ timeout: 90000 });
      await page.getByText(new RegExp(`Pedido #${before.number} ·`)).click();
      await browserExpect(page.getByText("Orden activa", { exact: true })).toBeVisible();
      if (shipFirst) {
        await page.getByRole("button", { name: "Marcar enviado", exact: true }).click();
        await browserExpect(page.getByText("Pedido marcado como enviado.", { exact: true })).toBeVisible();
        await browserExpect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toBeDisabled();
        const shipped = await (await page.request.get(`${coreOrigin}/api/orders/${orderId}/aggregate`)).json();
        expect(shipped.deliveryStatus).toBe("shipped");
        expect(shipped.payments).toEqual(before.payments);
      }
      await page.getByRole("button", { name: "Marcar entregado", exact: true }).click();
      await browserExpect(page.getByText("Pedido marcado como entregado.", { exact: true })).toBeVisible();
      await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
      const after = await (await page.request.get(`${coreOrigin}/api/orders/${orderId}/aggregate`)).json();
      expect(after.payments).toEqual(before.payments);
      expect(after).toMatchObject({ status: "completed", deliveryStatus: "delivered", stockDeducted: true });
      await page.getByRole("button", { name: "Volver a ventas", exact: true }).click();
      const row = page.getByRole("button").filter({ hasText: `Pedido #${before.number} ·` });
      await browserExpect(row).toContainText("Venta completada");
    }
  } finally {
    await mobile.close();
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
}, 180000);
