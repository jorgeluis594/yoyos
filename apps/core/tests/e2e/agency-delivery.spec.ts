import { mkdir } from "node:fs/promises";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { orderAggregateSchema } from "@shared/contracts/orders";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

test("agency assignment requires a document, preserves historical courier names and recovers concurrent deactivation", async ({ page }) => {
  const email = `agency-order-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Agency orders", country: "PE" });
    const tenantId = companyId;
    const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
    const orderId = crypto.randomUUID();
    const variantId = await withTenantIsolation(tenantId, async () => {
      const created = await products.create({ name: "Agency product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!created.success) throw new Error("Expected product");
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: created.data } });
      expect(await orders.create({ id: orderId as OrderId, contactId: null, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] },
        { companyId: tenantId as CompanyId, userId: sellerId as UserId })).toMatchObject({ success: true });
      return variant.id;
    });
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByRole("link", { name: "Configurar modalidades de entrega" }).click();
    await page.getByRole("tab", { name: "Agencia", exact: false }).click();
    await page.getByLabel("Ofrecer envío a agencia").check();
    for (const [index, name] of ["Courier original", "Courier alternativo", "Courier inactivo"].entries()) {
      await page.getByRole("button", { name: "Agregar courier" }).click();
      await page.getByLabel(`Nombre del courier ${index + 1}`, { exact: true }).fill(name);
    }
    await page.getByLabel("Habilitar courier 3", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await browserExpect(page.getByRole("status")).toHaveText("Configuración guardada.");
    const config = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    const courier = config.couriers.find(courier => courier.name === "Courier original");
    const alternate = config.couriers.find(courier => courier.name === "Courier alternativo");
    if (!courier || !alternate) throw new Error("Expected configured couriers");
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByLabel("Modalidad de entrega")).toBeHidden();
    await page.getByRole("button", { name: "Asignar entrega", exact: true }).focus();
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("button", { name: "Cerrar edición" })).toHaveAttribute("aria-expanded", "true");
    await browserExpect(page.getByLabel("Modalidad de entrega")).toHaveValue("agency");
    expect(await page.getByLabel("Courier", { exact: true }).locator("option").allTextContents()).toEqual(expect.arrayContaining(["Selecciona un courier", "Courier original", "Courier alternativo"]));
    await browserExpect(page.getByLabel("Courier", { exact: true }).locator("option")).toHaveCount(3);
    await page.getByLabel("Courier", { exact: true }).selectOption(courier.id);
    await page.getByLabel("Agencia de destino").fill("Agencia Lima");
    await page.getByLabel("Nombre del destinatario").fill("Unavailable");
    await page.getByLabel("Teléfono del destinatario").fill("00123");
    await page.getByRole("button", { name: "Cerrar edición" }).click();
    await browserExpect(page.getByLabel("Agencia de destino")).toBeHidden();
    await page.getByRole("button", { name: "Asignar entrega", exact: true }).click();
    await browserExpect(page.getByLabel("Agencia de destino")).toHaveValue("Agencia Lima");
    await page.getByRole("button", { name: "Guardar entrega" }).click();
    expect(await page.getByLabel("Documento de identidad (obligatorio)").evaluate(element => (element as HTMLSelectElement).validity.valueMissing)).toBe(true);
    expect(orderAggregateSchema.parse(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).delivery).toBeNull();
    await page.getByLabel("Documento de identidad (obligatorio)").selectOption("passport");
    await page.getByRole("button", { name: "Guardar entrega" }).click();
    expect(await page.getByLabel("Número de documento").evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
    await page.getByLabel("Número de documento").fill("00-A-001");
    const save = async () => {
      const response = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname.includes(`/orders/${orderId}`));
      await page.getByRole("button", { name: "Guardar entrega" }).click();
      await response;
    };
    await save();
    await browserExpect(page.getByRole("alert")).toContainText("No se pudo confirmar");
    await browserExpect(page.getByLabel("Agencia de destino")).toHaveValue("Agencia Lima");
    await browserExpect(page.getByLabel("Número de documento")).toHaveValue("00-A-001");
    expect(orderAggregateSchema.parse(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).delivery).toBeNull();
    await page.getByLabel("Nombre del destinatario").fill("Destinataria");
    await page.getByLabel("Cobrar la entrega al cliente").check();
    await save();
    await browserExpect(page.getByRole("status")).toHaveText("Entrega guardada.");
    const assigned = orderAggregateSchema.parse(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json());
    expect(assigned).toMatchObject({ delivery: { method: "agency", courier: { id: courier.id, name: "Courier original" }, agency: "Agencia Lima",
      recipient: { name: "Destinataria", phone: "00123", identity: { documentType: "passport", document: "00-A-001" } }, recordedBy: { kind: "seller", userId: sellerId } },
      deliveryCost: { amount: 3 }, deliveryCharge: { amount: 3 }, total: { amount: 13 }, stockDeducted: false });
    await page.getByLabel("Agencia de destino").fill("Mi agencia editada");
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: config.version, home: config.home, store: config.store, agency: config.agency,
      couriers: config.couriers.map(value => ({ ...value, kind: "existing", ...(value.id === courier.id ? { name: "Courier renombrado", enabled: false } : {}) })) } })).ok()).toBe(true);
    await save();
    await browserExpect(page.getByRole("alert")).toContainText("El courier ya no está disponible");
    await browserExpect(page.getByLabel("Agencia de destino")).toHaveValue("Mi agencia editada");
    await browserExpect(page.getByLabel("Número de documento")).toHaveValue("00-A-001");
    await browserExpect(page.getByLabel("Nombre del destinatario")).toHaveValue("Destinataria");
    await browserExpect(page.getByLabel("Courier", { exact: true }).locator("option")).toHaveText(["Selecciona un courier", "Courier alternativo"]);
    expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toEqual(assigned);
    await page.reload();
    await browserExpect(page.getByRole("heading", { name: "Envío a agencia", exact: true }).locator("..").getByText("Courier original", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Editar entrega", exact: true }).click();
    await browserExpect(page.getByLabel("Agencia de destino")).toHaveValue("Agencia Lima");
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toBeDisabled();
    expect((await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId: crypto.randomUUID(), amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } })).ok()).toBe(true);
    await page.getByLabel("Courier", { exact: true }).selectOption(alternate.id);
    await page.getByLabel("Agencia de destino").fill("Agencia Arequipa");
    await page.getByLabel("Cobrar la entrega al cliente").uncheck();
    await save();
    const replaced = orderAggregateSchema.parse(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json());
    expect(replaced).toMatchObject({ delivery: { courier: { id: alternate.id, name: "Courier alternativo" }, agency: "Agencia Arequipa", recipient: { identity: { document: "00-A-001" } } },
      total: { amount: 10 }, paidAmount: { amount: 10 }, deliveryCost: { amount: 3 }, deliveryCharge: { amount: 0 }, stockDeducted: true });
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(2n);
    await page.reload();
    await browserExpect(page.getByLabel("Número de documento")).toHaveValue("00-A-001");
    await page.goto(`/pt-BR/orders/${orderId}`);
    await page.getByRole("button", { name: "Editar entrega", exact: true }).click();
    await browserExpect(page.getByLabel("Agência de destino")).toHaveValue("Agencia Arequipa");
    await browserExpect(page.getByLabel("Documento de identidade (obrigatório)")).toHaveValue("passport");
    await page.goto(`/es-PE/orders/${orderId}`);
    await mkdir("../../.impeccable/review", { recursive: true });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await browserExpect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^$/);
      for (const [width, height, name] of [[1504, 1045, "wide"], [1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
        await page.setViewportSize({ width, height });
        await browserExpect(page.getByRole("region", { name: "Productos", exact: true })).toBeVisible();
        await browserExpect(page.getByLabel("Nombre del destinatario")).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `../../.impeccable/review/order-redesign-${name}-${theme}.png`, fullPage: true, animations: "disabled" });
      }
    }
    await page.getByRole("button", { name: "Editar entrega", exact: true }).click();
    await page.getByLabel("Nombre del destinatario").fill("n".repeat(150));
    await page.getByLabel("Número de documento").fill("00-" + "A".repeat(140));
    await save();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "../../.impeccable/review/order-redesign-editor-mobile.png", fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(2n);
    expect((await page.request.post(`/api/orders/${orderId}/ship`)).ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Agencia Arequipa", { exact: true })).toBeVisible();
    expect((await page.request.post(`/api/orders/${orderId}/deliver`)).ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Agencia Arequipa", { exact: true })).toBeVisible();
    const cancelledId = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id: cancelledId, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    expect((await page.request.post(`/api/orders/${cancelledId}/cancel`)).ok()).toBe(true);
    await page.goto(`/es-PE/orders/${cancelledId}`);
    await browserExpect(page.getByText("Orden cancelada", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Entrega por definir", { exact: true })).toHaveCount(0);
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
