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
    const product = await withTenantIsolation(tenant, () => products.create({ name: "Producto móvil", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] }));
    if (!product.success) throw new Error("Fixture product failed");
    const variantId = await withTenantIsolation(tenant, async () => (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id);
    await withTenantIsolation(tenant, async () => { await prisma.company.update({ where: { id: tenant }, data: { nextOrderNumber: 10000n } }); });
    const id = randomUUID();
    expect((await page.request.post("/api/orders", { data: { id, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`${mobile.origin}/orders/${id}`);
    await browserExpect(page.getByText("Pedido #10000", { exact: true })).toBeVisible({ timeout: 90000 });
    await browserExpect(page.getByText("Enlace aún no habilitado", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Obtener enlace", exact: true }).click();
    await browserExpect(page.getByText("Pendiente de confirmación", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Copiar enlace", exact: true }).click();
    await browserExpect(page.getByText("Enlace copiado", { exact: true })).toBeVisible();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toBe(`http://127.0.0.1:4173/checkout/${tenant}/${id}`);
    await page.screenshot({ path: "/tmp/checkout-mobile-seller.png" });
    const buyer = await buyerContext.newPage();
    await buyer.goto(url);
    await buyer.getByLabel("Nombre", { exact: true }).fill("Ana");
    await buyer.getByLabel("Teléfono", { exact: true }).fill("+51987654321");
    await buyer.getByRole("button", { name: "Confirmar pedido", exact: true }).click();
    await browserExpect(buyer.getByRole("heading", { name: "Pedido confirmado", exact: true })).toBeVisible();
    await page.reload();
    await browserExpect(page.getByText("Confirmado por el comprador", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Ana", { exact: true })).toBeVisible();
    await browserExpect(page.getByText(/Saldo pendiente:/)).toBeVisible();
    await page.goto(`${mobile.origin}/orders`);
    await browserExpect(page.getByText(/Pedido #10000 · Confirmado por el comprador/)).toBeVisible();
  } finally {
    await page.screenshot({ path: "/tmp/checkout-mobile-final.png" });
    await buyerContext.close();
    await mobile.close();
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
}, 180000);
