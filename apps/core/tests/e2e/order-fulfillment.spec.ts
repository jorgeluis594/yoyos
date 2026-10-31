import { startMobileWeb } from "@core/tests/e2e/mobile-web";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { productEditing } from "@core/src/features/products/product-editing";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("seller ships or delivers directly, refreshes details and list, and preserves payments", async ({ page }) => {
  const email = `fulfillment-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Fulfillment", country: "PE" });
    const tenantId = companyId;
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await productEditing.create({ name: "Fulfillment product", currency: "PEN", options: [], variants: [{ values: [], salePrice: 10, initialStock: 5 }] });
      if (!product.success) throw new Error("Product setup failed");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, agency: { enabled: false },
      home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } } })).ok()).toBe(true);
    for (const mode of ["shipment", "handover", "pickup"] as const) {
      const orderId = crypto.randomUUID();
      expect((await page.request.post("/api/orders", { data: { id: orderId, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
      if (mode === "pickup") {
        expect((await page.request.put(`/api/orders/${orderId}/delivery`, { data: {
          delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" },
        } })).ok()).toBe(true);
      }
      await page.goto(`/es-PE/orders/${orderId}`);
      const statusCard = page.getByRole("region", { name: "Estado del pedido" });
      if (mode === "pickup") {
        await browserExpect(statusCard.getByRole("button", { name: "Marcar entregado", exact: true })).toBeDisabled();
        await browserExpect(statusCard.getByText("Registra al menos un pago para entregar. Puede ser un pago parcial.")).toBeVisible();
      } else {
        await browserExpect(statusCard.getByRole("button", { name: "Marcar enviado", exact: true })).toBeDisabled();
        await browserExpect(statusCard.getByRole("button", { name: "Entregar directamente", exact: true })).toBeDisabled();
        await browserExpect(statusCard.getByText("Registra al menos un pago para despachar. Puede ser un pago parcial.")).toBeVisible();
      }
      await browserExpect(statusCard.getByRole("button", { name: "Cancelar pedido", exact: true })).toBeEnabled();
      for (const operation of ["ship", "deliver"] as const) {
        const blocked = await page.request.post(`/api/orders/${orderId}/${operation}`);
        expect(blocked.status()).toBe(409);
        expect(await blocked.json()).toMatchObject({ code: "PAYMENT_REQUIRED" });
      }
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
        await browserExpect(page.getByRole("alert")).toContainText("Se requiere al menos un pago");
        expect((await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).deliveryStatus).toBe("pending");
        await pay();
        await page.reload();
      }
      const before = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
      const stockBefore = await withTenantIsolation(tenantId, async () => await prisma.productStock.findUniqueOrThrow({ where: { variantId } }));
      if (mode === "shipment") {
        await page.getByRole("button", { name: "Marcar enviado", exact: true }).click();
        await browserExpect(page.getByRole("status").filter({ hasText: "Pedido marcado como enviado." })).toBeVisible();
        await browserExpect(page.getByRole("group", { name: "Estado de la entrega: Enviada" })).toBeVisible();
        await browserExpect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toHaveCount(0);
        expect((await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).payments).toEqual(before.payments);
        for (const operation of ["ship", "cancel"] as const) {
          const blocked = await page.request.post(`/api/orders/${orderId}/${operation}`);
          expect(blocked.status()).toBe(409);
          expect(await blocked.json()).toMatchObject({ code: "INVALID_TRANSITION" });
        }
        await page.getByRole("link", { name: "Ver ventas", exact: true }).click();
        const shippedRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: `Pedido #${before.number}`, exact: true }) });
        await browserExpect(shippedRow.locator("summary").last()).toHaveAttribute("aria-label", /Estado de la entrega: Enviada/);
        await page.getByRole("link", { name: `Pedido #${before.number}`, exact: true }).click();
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: "/tmp/order-fulfillment-desktop.png", fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: "/tmp/order-fulfillment-mobile.png", fullPage: true });
      }
      await page.getByRole("button", { name: mode === "handover" ? "Entregar directamente" : "Marcar entregado", exact: true }).click();
      await browserExpect(page.getByRole("status").filter({ hasText: "Pedido marcado como entregado." })).toBeVisible();
      await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
      await browserExpect(page.getByRole("button", { name: "Marcar entregado", exact: true })).toHaveCount(0);
      const after = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
      expect(after.payments).toEqual(before.payments);
      expect(after).toMatchObject({ status: "completed", paymentStatus: "paid", deliveryStatus: "delivered", completedAt: expect.any(String) });
      for (const operation of ["ship", "deliver", "cancel"] as const) {
        const blocked = await page.request.post(`/api/orders/${orderId}/${operation}`);
        expect(blocked.status()).toBe(409);
        expect(await blocked.json()).toMatchObject({ code: "INVALID_TRANSITION" });
      }
      expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toEqual(after);
      const stockAfter = await withTenantIsolation(tenantId, async () => await prisma.productStock.findUniqueOrThrow({ where: { variantId } }));
      expect(stockAfter.quantity).toBe(stockBefore.quantity);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("link", { name: "Ver ventas", exact: true }).click();
      await browserExpect(page.getByRole("row").filter({ has: page.getByRole("link", { name: `Pedido #${after.number}`, exact: true }) }).locator("summary")).toHaveAttribute("aria-label", "Estado de la venta: Venta completada");
    }
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});

test("seller ships and delivers an order with a partial payment and it keeps a balance due", async ({ page }) => {
  const email = `partial-delivery-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Partial delivery", country: "PE" });
    const tenantId = companyId;
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await productEditing.create({ name: "Partial product", currency: "PEN", options: [], variants: [{ values: [], salePrice: 10, initialStock: 5 }] });
      if (!product.success) throw new Error("Product setup failed");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    const orderId = crypto.randomUUID();
    expect((await page.request.post("/api/orders", { data: { id: orderId, items: [{ variantId, quantity: 2 }] } })).status()).toBe(201);
    expect((await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId: crypto.randomUUID(),
      amount: { amount: 5, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } })).ok()).toBe(true);
    await page.goto(`/es-PE/orders/${orderId}`);
    const statusCard = page.getByRole("region", { name: "Estado del pedido" });
    await statusCard.getByRole("button", { name: "Marcar enviado", exact: true }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Pedido marcado como enviado." })).toBeVisible();
    await statusCard.getByRole("button", { name: "Marcar entregado", exact: true }).click();
    await browserExpect(page.getByRole("status").filter({ hasText: "Pedido marcado como entregado." })).toBeVisible();
    await browserExpect(statusCard.getByRole("button")).toHaveCount(0);
    const after = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(after).toMatchObject({ status: "active", paymentStatus: "pending", deliveryStatus: "delivered", stockDeducted: true, deliveredAt: expect.any(String), completedAt: null });
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(3n);
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
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
      const product = await productEditing.create({ name: "Mobile fulfillment product", currency: "PEN", options: [], variants: [{ values: [], salePrice: 10, initialStock: 3 }] });
      if (!product.success) throw new Error("Product setup failed");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    expect((await page.request.put(`${coreOrigin}/api/delivery-settings`, { data: { expectedVersion: 0, agency: { enabled: false },
      home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Store", address: "Lima", instructions: null } } } })).ok()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const shipFirst of [true, false]) {
      const orderId = crypto.randomUUID();
      const created = await page.request.post(`${coreOrigin}/api/orders`, { data: { id: orderId, items: [{ variantId, quantity: 1 }] } });
      expect(created.status()).toBe(201);
      const pending = await created.json();
      // Pickup orders are delivered straight from pending; the others ship first.
      if (!shipFirst) expect((await page.request.put(`${coreOrigin}/api/orders/${orderId}/delivery`, { data: {
        delivery: { method: "store", recipient: { name: "Ana", phone: "999", identity: { kind: "absent" } } }, expectedPrice: { amount: 0, currency: "PEN" },
      } })).ok()).toBe(true);
      await page.goto(`${mobile.origin}/orders`, { timeout: 90000 });
      await browserExpect(page.getByText(new RegExp(`#${pending.number} ·`))).toBeVisible({ timeout: 90000 });
      await page.getByText(new RegExp(`#${pending.number} ·`)).click();
      await browserExpect(page.getByText("Orden activa", { exact: true })).toBeVisible();
      const primary = page.getByRole("button", { name: shipFirst ? "Marcar como despachado" : "Marcar como entregado", exact: true });
      await browserExpect(primary).toBeDisabled();
      await browserExpect(page.getByText(shipFirst ? "Se requiere al menos un pago para despachar." : "Registra al menos un pago para entregar. Puede ser un pago parcial.").first()).toBeVisible();
      await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
      await page.getByRole("button", { name: /^Registrar .*\d/ }).click();
      await browserExpect(primary).toBeEnabled();
      const before = await (await page.request.get(`${coreOrigin}/api/orders/${orderId}/aggregate`)).json();
      expect(before.payments).toHaveLength(1);
      const stockBefore = await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity);
      if (shipFirst) {
        await page.getByRole("button", { name: "Marcar como despachado", exact: true }).click();
        await browserExpect(page.getByText("Pedido marcado como enviado.", { exact: true })).toBeVisible();
        await browserExpect(page.getByRole("button", { name: "Marcar como despachado", exact: true })).toHaveCount(0);
        const shipped = await (await page.request.get(`${coreOrigin}/api/orders/${orderId}/aggregate`)).json();
        expect(shipped.deliveryStatus).toBe("shipped");
        expect(shipped.payments).toEqual(before.payments);
        await browserExpect(page.getByText("Despachado", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Volver a pedidos", exact: true }).click();
        const row = page.getByRole("button").filter({ hasText: `#${before.number} ·` });
        await browserExpect(row).toContainText("Despachado");
        await row.click();
      }
      await page.getByRole("button", { name: "Marcar como entregado", exact: true }).click();
      await browserExpect(page.getByText("Pedido marcado como entregado.", { exact: true })).toBeVisible();
      await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
      const after = await (await page.request.get(`${coreOrigin}/api/orders/${orderId}/aggregate`)).json();
      expect(after.payments).toEqual(before.payments);
      expect(after).toMatchObject({ status: "completed", deliveryStatus: "delivered", stockDeducted: true });
      await browserExpect(page.getByRole("button", { name: "Marcar como despachado", exact: true })).toHaveCount(0);
      await browserExpect(page.getByRole("button", { name: "Marcar como entregado", exact: true })).toHaveCount(0);
      expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(stockBefore);
      if (shipFirst) await page.getByRole("button", { name: "Volver a pedidos", exact: true }).click();
      else await page.goto(`${mobile.origin}/orders`);
      const row = page.getByRole("button").filter({ hasText: `#${before.number} ·` });
      await browserExpect(row).toContainText("Completado");
    }
  } finally {
    await mobile.close();
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
}, 180000);
