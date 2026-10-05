import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { formatCurrency } from "@core/app/format-currency";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");

test("buyer reports a receipt and sees the seller confirmed balance", async ({ page, request }) => {
  const email = `buyer-payment-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Vendedora", companyName: "Tienda", country: "PE" });
    const tenantId = companyId;
    const product = await withTenantIsolation(tenantId, () => products.create({ name: "Cuaderno", currency: "PEN",
      variants: [{ attributes: {}, sku: `PAY-${crypto.randomUUID()}`, salePrice: 12.5, initialStock: 2 }] }));
    expect(product.success).toBe(true);
    if (!product.success) return;
    const variantId = await withTenantIsolation(tenantId, async () => (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id);
    await page.goto("/es-PE/settings/payments");
    await browserExpect(page.getByRole("heading", { name: "Medios de cobro" })).toBeVisible();
    await page.getByLabel("Ofrecer billetera digital").check();
    await page.getByLabel("Proveedor").fill("Yape");
    await page.getByLabel("Titular").first().fill("Tienda");
    const walletImageId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => await prisma.image.create({ data: { id: walletImageId, storageKey: `test/${walletImageId}` } }));
    await page.route("**/test-images/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
    await page.route("**/api/images", (route) => route.fulfill({ status: 201, contentType: "application/json",
      body: JSON.stringify({ id: walletImageId, url: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/test-images/test%2F${walletImageId}` }) }));
    await page.getByLabel("Imagen opcional").first().setInputFiles({ name: "yape.png", mimeType: "image/png", buffer: png });
    await browserExpect(page.getByRole("img", { name: "Imagen de instrucciones de pago" })).toBeVisible();
    await page.getByLabel("Ofrecer transferencia bancaria").check();
    await page.getByLabel("Banco", { exact: true }).fill("BCP");
    await page.getByLabel("Titular").last().fill("Tienda");
    await page.getByLabel("CCI").fill("00200000000000000001");
    await page.getByRole("button", { name: "Guardar medios de cobro" }).click();
    await browserExpect(page.getByText("Medios de cobro guardados.")).toBeVisible();
    const orderId = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id: orderId, contactId: null,
      items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    expect((await request.get(`/pago/${crypto.randomUUID()}`)).status()).toBe(404);
    const opened = await page.goto(`/pago/${orderId}`);
    expect(opened?.status()).toBe(200);
    await browserExpect(page.getByRole("heading", { name: "Pago del pedido" })).toBeVisible();
    await browserExpect(page.getByText("Yape")).toBeVisible();
    await browserExpect(page.getByText("BCP")).toBeVisible();
    await browserExpect(page.getByRole("img", { name: "Instrucciones de billetera digital" })).toBeVisible();
    await browserExpect(page.getByText(formatCurrency(12.5, "PEN", "es")).first()).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Ya pagué" })).toBeDisabled();
    const imageId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => await prisma.image.create({ data: { id: imageId, storageKey: `test/${imageId}` } }));
    await page.route(`**/api/buyer/orders/${orderId}/images`, (route) => route.fulfill({ status: 201, contentType: "application/json",
      body: JSON.stringify({ id: imageId, url: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}/test-images/test%2F${imageId}` }) }));
    await page.getByLabel("Captura del pago").setInputFiles({ name: "pago.png", mimeType: "image/png", buffer: png });
    await browserExpect(page.getByText("Captura lista para enviar.")).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId } }))).toBe(0);
    await page.getByRole("button", { name: "Ya pagué" }).click();
    await browserExpect(page.getByRole("heading", { name: "Pago pendiente de revisión" })).toBeVisible();
    const payment = await withTenantIsolation(tenantId, async () => await prisma.payment.findFirstOrThrow({ where: { orderId } }));
    expect(payment.status).toBe("reported");
    expect(payment.amount).toBeNull();
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("link", { name: "Ver captura" })).toBeVisible();
    const report = page.getByRole("listitem").filter({ hasText: "Pago reportado, pendiente de revisión" });
    await report.getByLabel("Medio de pago").selectOption("bank_transfer");
    await report.getByRole("button", { name: "Confirmar pago" }).click();
    await browserExpect(page.getByText("Pago actualizado.")).toBeVisible();
    expect((await withTenantIsolation(tenantId, async () => await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))).status).toBe("confirmed");
    await page.goto(`/pago/${orderId}`);
    await browserExpect(page.getByRole("heading", { name: "Pedido pagado" })).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByRole("button", { name: "Anular pago" }).click();
    await browserExpect(page.getByText("Pago anulado", { exact: false })).toBeVisible();
    expect((await withTenantIsolation(tenantId, async () => await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))).status).toBe("voided");
    const manual = page.getByRole("heading", { name: "Registrar pago manual" }).locator("..");
    const manualResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes(`/orders/${orderId}`));
    await manual.getByRole("button", { name: "Confirmar pago" }).click();
    await manualResponse;
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId, status: "confirmed" } }))).toBe(1);
    await browserExpect(page.getByText("Pago actualizado.")).toBeVisible();
    await page.goto(`/pago/${orderId}`);
    await browserExpect(page.getByRole("heading", { name: "Pedido pagado" })).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
      await prisma.image.deleteMany();
      await prisma.companyPaymentSettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: user.companyId! } });
    });
  }
});
