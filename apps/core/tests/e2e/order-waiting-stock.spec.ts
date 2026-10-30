import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

test("the seller approves a report with short stock and sees the order waiting for stock", async ({ page }) => {
  const email = `waiting-stock-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Vendedora", companyName: "Tienda", country: "PE" });
    const tenantId = companyId;
    const seeded = await withTenantIsolation(tenantId, () => seedProduct({ name: "Camisa", variants: [{ attributes: { Talla: "M" }, sku: "CAM-M", salePrice: 30, stock: 3 }] }));
    const [variantId] = seeded.variantIds;
    if (!variantId) throw new Error("Product setup failed");
    const orderId = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id: orderId, items: [{ variantId, quantity: 4 }] } })).status()).toBe(201);
    // S/ 40.00 paid of S/ 120.00 is not enough to deduct; the buyer's report for the remaining S/ 80.00 will cover the total.
    expect((await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId: crypto.randomUUID(),
      amount: { amount: 40, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } })).ok()).toBe(true);
    const imageId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => {
      await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } });
      await prisma.payment.create({ data: { id: crypto.randomUUID(), orderId, status: "reported", currency: "PEN", amount: null, method: null,
        data: { receiptImageId: imageId, reportedAt: new Date().toISOString() } } });
    });

    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toBeEnabled();
    await browserExpect(page.getByRole("heading", { name: "Esperando stock" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Aprobar pago reportado el/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Importe recibido").fill("80");
    await dialog.getByRole("button", { name: "Aprobar pago S/ 80.00" }).click();

    await browserExpect(dialog).toHaveCount(0);
    await browserExpect(page.getByText("Pago registrado. El pedido queda esperando stock.")).toBeVisible();
    await browserExpect(page.getByRole("heading", { name: "Esperando stock" })).toBeVisible();
    await browserExpect(page.getByText("Camisa (M): 4 en el pedido, hay 3.")).toBeVisible();
    expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toMatchObject({ paymentStatus: "paid", stockDeducted: false,
      stockDue: { kind: "waiting", shortItems: [{ variantId, available: 3 }] } });
    await browserExpect(page.getByRole("button", { name: "Marcar enviado", exact: true })).toBeDisabled();
    await browserExpect(page.getByRole("button", { name: "Marcar entregado", exact: true })).toBeDisabled();
    await browserExpect(page.getByText("Para despachar falta stock de Camisa (M).")).toBeVisible();
    await browserExpect(page.getByText("Para entregar falta stock de Camisa (M).")).toBeVisible();
    await page.getByText("Detalles internos").click();
    await browserExpect(page.getByText("Esperando stock", { exact: true }).last()).toBeVisible();

    const order = await withTenantIsolation(tenantId, async () => await prisma.order.findUniqueOrThrow({ where: { id: orderId } }));
    expect(order.stockDeducted).toBe(false);
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(3n);
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId, status: "confirmed" } }))).toBe(2);
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.image.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId! } });
    });
  }
});
