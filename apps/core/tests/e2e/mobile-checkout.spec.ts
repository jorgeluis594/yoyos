import { randomUUID } from "node:crypto";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { startMobileWeb } from "@core/tests/e2e/mobile-web";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("mobile seller copies checkout and sees the anonymous buyer confirmation in detail and history", async ({ page }) => {
  const mobile = await startMobileWeb();
  const email = `mobile-checkout-${randomUUID()}@example.test`;
  let companyId: string | undefined;
  const buyerContext = await page.context().browser()!.newContext();
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Mobile seller", companyName: "Mobile checkout", country: "PE" });
    const tenant = companyId;
    expect((await page.request.put("/api/delivery-settings", { data: {
      expectedVersion: 0, home: { enabled: false }, agency: { enabled: false }, couriers: [],
      store: { enabled: true, pickupPoint: { name: "Tienda", address: "Lima", instructions: null } },
    } })).status()).toBe(200);
    const product = await withTenantIsolation(tenant, () => products.create({ name: "Producto móvil", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] }));
    if (!product.success) throw new Error("Fixture product failed");
    const variantId = await withTenantIsolation(tenant, async () => (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id);
    await withTenantIsolation(tenant, async () => { await prisma.company.update({ where: { id: tenant }, data: { nextOrderNumber: 9999n } }); });
    const historical = randomUUID();
    expect((await page.request.post("/api/orders", { data: { id: historical, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    const id = randomUUID();
    expect((await page.request.post("/api/orders", { data: { id, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`${mobile.origin}/orders/${id}`, { timeout: 90_000 });
    await browserExpect(page.getByText("Pedido #10000", { exact: true })).toBeVisible({ timeout: 90000 });
    await browserExpect(page.getByText("Enlace aún no habilitado", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Confirmación del comprador", exact: true }).click();
    await page.getByRole("button", { name: "Obtener enlace", exact: true }).click();
    await browserExpect(page.getByText("Pendiente de confirmación", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Copiar enlace", exact: true }).click();
    await browserExpect(page.getByText("Enlace copiado", { exact: true })).toBeVisible();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toBe(`http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/checkout/${tenant}/${id}`);
    const buyer = await buyerContext.newPage();
    await buyer.goto(url);
    await buyer.getByLabel("Nombre", { exact: true }).fill("Ana");
    await buyer.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await buyer.getByLabel("Forma de entrega", { exact: true }).selectOption("store");
    await buyer.getByLabel("Nombre del destinatario", { exact: true }).fill("Ana");
    await buyer.getByLabel("Teléfono del destinatario", { exact: true }).fill("+51987654321");
    await buyer.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(buyer.getByRole("region", { name: "Pago del pedido", exact: true })).toBeVisible();
    await page.reload();
    await browserExpect(page.getByText("Confirmado por el comprador", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Ana", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Saldo pendiente", { exact: true })).toBeVisible();
    const pending = randomUUID();
    const cancelled = randomUUID();
    for (const other of [pending, cancelled]) {
      expect((await page.request.post(`http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/api/orders`, { data: { id: other, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
      expect((await page.request.post(`http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/api/orders/${other}/checkout-link`)).status()).toBe(200);
    }
    expect((await page.request.post(`http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/api/orders/${cancelled}/cancel`)).status()).toBe(200);
    await page.goto(`${mobile.origin}/orders`);
    await browserExpect(page.getByRole("button").filter({ hasText: /#10000 ·/ }).getByText("Confirmado por el comprador", { exact: true })).toBeVisible();
    await browserExpect(page.getByText(/#9999 ·/)).toBeVisible();
    await browserExpect(page.getByRole("button").filter({ hasText: /#10001 ·/ }).getByText("Pendiente de confirmación", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button").filter({ hasText: /#10002 ·/ }).getByText("Pedido cancelado", { exact: true })).toBeVisible();
    await page.goto(`${mobile.origin}/orders/${historical}`);
    await browserExpect(page.getByText("Enlace aún no habilitado", { exact: true })).toBeVisible();
    await page.goto(`${mobile.origin}/orders/${cancelled}`);
    await browserExpect(page.getByText("Pedido cancelado", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Obtener enlace", exact: true })).toHaveCount(0);
  } finally {
    await buyerContext.close();
    await mobile.close();
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
}, 180000);
