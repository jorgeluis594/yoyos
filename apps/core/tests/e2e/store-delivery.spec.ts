import { mkdir } from "node:fs/promises";
import { browserExpect, expect, openOptions, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { productEditing } from "@core/src/features/products/product-editing";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { formatCurrency } from "@core/app/format-currency";
import { chooseDistrict } from "@core/tests/e2e/district-combobox";
import { orderTotal } from "@core/tests/e2e/order-view-helpers";

test("rated pickup freezes its point, a recipient correction records the editor and a method change replaces it keeping stock deduction", async ({ page }) => {
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
      await page.getByRole("button", { name: "Guardar cambios" }).first().click();
      await response;
      await browserExpect(page.getByRole("status").filter({ hasText: "Cambios guardados." })).toBeVisible();
    };
    const variantId = await withTenantIsolation(tenantId, async () => {
      const created = await productEditing.create({ name: "Pickup product", currency: "PEN", options: [], variants: [{ values: [], salePrice: 10, initialStock: 3 }] });
      if (!created.success) throw new Error("Expected product");
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: created.data } });
      expect(await orders.create({ id: orderId as OrderId, 
        items: [{ variantId: variant.id as VariantId, quantity: 2 as PositiveInteger }] },
      { companyId: tenantId as CompanyId, userId: sellerId as UserId })).toMatchObject({ success: true });
      return variant.id;
    });
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByRole("link", { name: "Configurar modalidades de entrega" })).toBeVisible();
    await page.getByRole("link", { name: "Configurar modalidades de entrega" }).click();
    await page.getByLabel("Ofrecer recojo en tienda").click();
    await page.getByLabel("Nombre del punto de recojo").fill("Tienda original");
    await page.getByLabel("Dirección", { exact: true }).fill("Av. Original 123");
    await page.getByLabel("Dirección", { exact: true }).blur();
    await browserExpect(page.getByText("Guardado", { exact: true })).toBeVisible();
    await browserExpect(page.getByLabel("Ofrecer recojo en tienda")).toBeChecked();
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByRole("tab", { name: "Recojo en tienda" }).click();
    await page.getByLabel("Teléfono del destinatario").fill("999123456");
    await page.getByLabel("Nombre del destinatario").fill("Ana");
    await saveDelivery();
    await browserExpect(orderTotal(page)).toHaveText(formatCurrency(20, "PEN", "es"));
    const assigned = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(assigned).toMatchObject({ delivery: { method: "store", pickupPoint: { address: "Av. Original 123" }, recordedBy: { kind: "seller", userId: sellerId } }, deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 }, stockDeducted: false });
    const apiAssigned = await page.request.put(`/api/orders/${orderId}/delivery`, { data: {
      delivery: { method: "store", recipient: { name: "Ana", phone: "999123456", identity: { kind: "absent" } } },
      expectedPrice: { amount: 0, currency: "PEN" },
    } });
    expect(apiAssigned.ok()).toBe(true);
    expect(await apiAssigned.json()).toEqual(assigned);
    const changed = await page.request.put("/api/delivery-settings", { data: { expectedVersion: 1,
      agency: { enabled: false }, home: { enabled: false }, store: { enabled: true, pickupPoint: { name: "Tienda nueva", address: "Av. Nueva 456", instructions: null } } } });
    expect(changed.ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByText("Tienda original · Av. Original 123", { exact: true })).toBeVisible();
    const paid = await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId: crypto.randomUUID(), amount: { amount: 20, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } });
    expect(paid.ok()).toBe(true);
    const signup = await page.request.post("/api/auth/sign-up/email", { data: { name: "Other seller", email: otherEmail, password: "test-password-123" } });
    expect(signup.ok()).toBe(true);
    const editor = await systemPrisma.user.update({ where: { email: otherEmail }, data: { emailVerified: true, companyId: tenantId } });
    expect((await page.request.post("/api/auth/sign-in/email", { data: { email: otherEmail, password: "test-password-123" } })).ok()).toBe(true);
    await page.goto(`/es-PE/orders/${orderId}`);
    // The open card shows the frozen point; the second seller corrects the recipient, which keeps the point and its price and records them as the author.
    await browserExpect(page.getByText("Tienda original · Av. Original 123", { exact: true })).toBeVisible();
    await page.getByLabel("Nombre del destinatario").fill("Ana María");
    await saveDelivery();
    await browserExpect(orderTotal(page)).toHaveText(formatCurrency(20, "PEN", "es"));
    const replaced = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(replaced).toMatchObject({ delivery: { pickupPoint: { address: "Av. Original 123" }, recipient: { name: "Ana María" }, recordedBy: { kind: "seller", userId: editor.id } }, deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 }, stockDeducted: true, paidAmount: { amount: 20 } });
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
    // Nothing differs from the saved order any more: there is nothing to save or discard.
    await browserExpect(page.getByRole("button", { name: "Guardar cambios" }).first()).toBeDisabled();
    await mkdir("../../.impeccable/review", { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: "../../.impeccable/review/order-redesign-store-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: "../../.impeccable/review/order-redesign-store-mobile.png", fullPage: true });
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 2, agency: { enabled: false }, home: { enabled: true },
      store: { enabled: true, pickupPoint: { name: "Tienda nueva", address: "Av. Nueva 456", instructions: null } } } })).ok()).toBe(true);
    await page.reload();
    await page.getByRole("tab", { name: "Domicilio" }).click();
    await page.getByLabel("Dirección de entrega", { exact: true }).fill("Calle Destino 789");
    // Saving is not disabled by the missing district and rate: it refuses, marks the fields and sends nothing.
    await page.getByRole("button", { name: "Guardar cambios" }).first().click();
    await browserExpect(page.getByText("No se guardó: revisa", { exact: false })).toBeVisible();
    await browserExpect(page.getByText("Completa la entrega o descarta sus cambios.")).toBeVisible();
    expect((await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).delivery.method).toBe("store");
    expect((await page.request.put("/api/delivery-settings/zones", { data: { expectedVersion: 3,
      zones: [{ kind: "new", name: "Free home", enabled: true, districtCodes: ["040110"], options: [{ kind: "new", method: "home", name: "Home", enabled: true, price: { amount: 0, currency: "PEN" } }] }] } })).ok()).toBe(true);
    await chooseDistrict(page, "040110");
    const rates = await openOptions(page, "Tarifa de entrega");
    await browserExpect(rates).toHaveCount(1);
    await browserExpect(rates.first()).toContainText("Entrega gratis");
    await rates.first().click();
    await browserExpect(page.getByText("Costo de entrega (interno): Entrega gratis")).toBeVisible();
    await page.getByLabel("Indicaciones de entrega (opcional)").fill("Puerta verde");
    await saveDelivery();
    const home = await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json();
    expect(home).toMatchObject({ delivery: { method: "home", destination: { address: "Calle Destino 789", district: "MIRAFLORES", instructions: "Puerta verde" },
      recordedBy: { kind: "seller", userId: editor.id } }, total: { amount: 20 }, deliveryCost: { amount: 0 }, deliveryCharge: { amount: 0 }, stockDeducted: true });
    expect(home.delivery).not.toHaveProperty("pickupPoint");
    await page.reload();
    await browserExpect(page.getByLabel("Dirección de entrega", { exact: true })).toHaveValue("Calle Destino 789");
    await browserExpect(page.getByText("MIRAFLORES", { exact: false }).first()).toBeVisible();
    await page.goto(`/pt-BR/orders/${orderId}`);
    await browserExpect(page.getByLabel("Endereço de entrega", { exact: true })).toHaveValue("Calle Destino 789");
    await browserExpect(page.getByRole("tab", { name: "Domicílio" })).toBeVisible();
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: "../../.impeccable/review/order-redesign-home-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "../../.impeccable/review/order-redesign-home-mobile.png", fullPage: true });
    expect((await page.request.post(`/api/orders/${orderId}/ship`)).ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByRole("tab", { name: "Domicilio" })).toBeDisabled();
    await browserExpect(page.getByLabel("Dirección de entrega", { exact: true })).toHaveValue("Calle Destino 789");
    await browserExpect(page.getByText("La entrega ya salió; no se puede cambiar.")).toBeVisible();
  } finally {
    await page.goto("about:blank");
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryOptionAgency.deleteMany(); await prisma.deliveryOption.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
