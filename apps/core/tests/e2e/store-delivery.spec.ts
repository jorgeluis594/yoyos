import { mkdir } from "node:fs/promises";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { formatCurrency } from "@core/app/format-currency";

test("store assignment preserves unavailable delivery, freezes its point and atomically replaces charge and author", async ({ page }) => {
  const email = `store-order-${crypto.randomUUID()}@example.test`;
  const otherEmail = `store-editor-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "First seller", companyName: "Pickup orders", country: "PE" });
    const tenantId = companyId;
    const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
    const orderId = crypto.randomUUID();
    const saveDelivery = async () => {
      const response = page.waitForResponse(value => value.request().method() === "POST" && value.url().includes(`/orders/${orderId}`));
      await page.getByRole("button", { name: "Guardar entrega" }).click();
      await response;
      await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toBeEnabled();
    };
    const variantId = await withTenantIsolation(tenantId, async () => {
      const created = await products.create({ name: "Pickup product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!created.success) throw new Error("Expected product");
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: created.data } });
      expect(await orders.create({ id: orderId as OrderId, contactId: null,
        items: [{ variantId: variant.id as VariantId, quantity: 2 as PositiveInteger }] },
      { companyId: tenantId as CompanyId, userId: sellerId as UserId })).toMatchObject({ success: true });
      return variant.id;
    });
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("link", { name: "Configurar modalidades de entrega" })).toBeVisible();
    await page.getByRole("link", { name: "Configurar modalidades de entrega" }).click();
    await page.getByLabel("Ofrecer recojo en tienda").check();
    await page.getByLabel("Nombre del punto de recojo").fill("Tienda original");
    await page.getByLabel("Dirección", { exact: true }).fill("Av. Original 123");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("status")).toHaveText("Configuración guardada.");
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByLabel("Nombre del destinatario").fill("Unavailable");
    await page.getByLabel("Teléfono del destinatario").fill("999123456");
    await saveDelivery();
    await browserExpect(page.getByRole("alert")).toContainText("No se pudo confirmar");
    await browserExpect(page.getByLabel("Nombre del destinatario")).toHaveValue("Unavailable");
    const unchanged = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(unchanged).toMatchObject({ delivery: null, total: { amount: 20 }, stockDeducted: false });
    await page.getByLabel("Nombre del destinatario").fill("Ana");
    await page.getByLabel("Cobrar la entrega al cliente").check();
    await saveDelivery();
    await browserExpect(page.getByRole("status")).toHaveText("Entrega guardada.");
    await browserExpect(page.getByText(`Total: ${formatCurrency(23, "PEN", "es")}`, { exact: true })).toBeVisible();
    const assigned = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(assigned).toMatchObject({ delivery: { method: "store", pickupPoint: { address: "Av. Original 123" }, recordedBy: { kind: "seller", userId: sellerId } }, deliveryCost: { amount: 3 }, deliveryCharge: { amount: 3 }, stockDeducted: false });
    const changed = await page.request.put("/api/delivery-settings", { data: { expectedVersion: 1,
      home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Tienda nueva", address: "Av. Nueva 456", instructions: null } } } });
    expect(changed.ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByText("Av. Original 123", { exact: true })).toBeVisible();
    const paid = await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId: crypto.randomUUID(), amount: { amount: 20, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } });
    expect(paid.ok()).toBe(true);
    const signup = await page.request.post("/api/auth/sign-up/email", { data: { name: "Other seller", email: otherEmail, password: "test-password-123" } });
    expect(signup.ok()).toBe(true);
    const editor = await systemPrisma.user.update({ where: { email: otherEmail }, data: { emailVerified: true, companyId: tenantId } });
    expect((await page.request.post("/api/auth/sign-in/email", { data: { email: otherEmail, password: "test-password-123" } })).ok()).toBe(true);
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByLabel("Cobrar la entrega al cliente").uncheck();
    await saveDelivery();
    await browserExpect(page.getByRole("status")).toHaveText("Entrega guardada.");
    await browserExpect(page.getByText(`Total: ${formatCurrency(20, "PEN", "es")}`, { exact: true })).toBeVisible();
    const replaced = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(replaced).toMatchObject({ delivery: { pickupPoint: { address: "Av. Nueva 456" }, recordedBy: { kind: "seller", userId: editor.id } }, deliveryCost: { amount: 3 }, deliveryCharge: { amount: 0 }, stockDeducted: true, paidAmount: { amount: 20 } });
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
    await saveDelivery();
    await browserExpect(page.getByRole("status")).toHaveText("Entrega guardada.");
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toBeEnabled();
    await mkdir("../../.impeccable/review", { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: "../../.impeccable/review/store-order-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: "../../.impeccable/review/store-order-mobile.png", fullPage: true });
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 2, home: { enabled: true },
      store: { enabled: true, pickupPoint: { name: "Tienda nueva", address: "Av. Nueva 456", instructions: null } } } })).ok()).toBe(true);
    await page.reload();
    await page.getByLabel("Modalidad de entrega").selectOption("home");
    await page.getByLabel("Dirección de entrega", { exact: true }).fill("Calle Destino 789");
    await page.getByRole("button", { name: "Guardar entrega" }).click();
    expect(await page.getByLabel("Distrito", { exact: true }).evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
    expect((await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).delivery.method).toBe("store");
    await page.getByLabel("Distrito", { exact: true }).fill("Miraflores");
    await page.getByLabel("Nombre del destinatario").fill("Unavailable");
    await saveDelivery();
    await browserExpect(page.getByRole("alert")).toContainText("No se pudo confirmar");
    await browserExpect(page.getByLabel("Dirección de entrega", { exact: true })).toHaveValue("Calle Destino 789");
    await page.getByLabel("Nombre del destinatario").fill("Ana");
    await page.getByLabel("Indicaciones de entrega (opcional)").fill("Puerta verde");
    await saveDelivery();
    const home = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(home).toMatchObject({ delivery: { method: "home", destination: { address: "Calle Destino 789", district: "Miraflores", instructions: "Puerta verde" },
      recordedBy: { kind: "seller", userId: editor.id } }, total: { amount: 20 }, deliveryCost: { amount: 3 }, deliveryCharge: { amount: 0 }, stockDeducted: true });
    expect(home.delivery).not.toHaveProperty("pickupPoint");
    await page.reload();
    await browserExpect(page.getByText("Calle Destino 789", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Miraflores", { exact: true })).toBeVisible();
    await page.goto(`/pt-BR/orders/${orderId}`);
    await browserExpect(page.getByLabel("Endereço de entrega", { exact: true })).toHaveValue("Calle Destino 789");
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: "../../.impeccable/review/home-order-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "../../.impeccable/review/home-order-mobile.png", fullPage: true });
    expect((await page.request.post(`/api/orders/${orderId}/ship`)).ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Calle Destino 789", { exact: true })).toBeVisible();
    await browserExpect(page.getByText(/La entrega no se puede cambiar/)).toBeVisible();
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
