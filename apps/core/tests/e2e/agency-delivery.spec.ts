import { mkdir } from "node:fs/promises";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { orderAggregateSchema } from "@shared/contracts/orders";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

test("rated agency requires a document, preserves its snapshot and recovers concurrent deactivation", async ({ page }) => {
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
    await browserExpect(page.getByRole("status").filter({ hasText: "Configuración guardada." })).toHaveText("Configuración guardada.");
    const config = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    const courier = config.couriers.find(courier => courier.name === "Courier original");
    const alternate = config.couriers.find(courier => courier.name === "Courier alternativo");
    if (!courier || !alternate) throw new Error("Expected configured couriers");
    expect((await page.request.put("/api/delivery-settings/zones", { data: { method: "agency", expectedVersion: config.version,
      zones: [{ kind: "new", name: "Agency", enabled: true, districtCodes: ["040110"], price: { amount: 3, currency: "PEN" } }] } })).ok()).toBe(true);
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByLabel("Modalidad de entrega")).toBeHidden();
    await page.getByRole("button", { name: "Asignar entrega", exact: true }).focus();
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("button", { name: "Cerrar edición" })).toHaveAttribute("aria-expanded", "true");
    await browserExpect(page.getByLabel("Modalidad de entrega")).toHaveValue("agency");
    await browserExpect(page.getByLabel("Courier", { exact: true })).toHaveCount(0);
    await browserExpect(page.getByLabel("Agencia de destino")).toHaveCount(0);
    await page.getByLabel("Nombre del destinatario").fill("Destinataria");
    await page.getByLabel("Teléfono del destinatario").fill("00123");
    await page.getByLabel("Departamento", { exact: true }).selectOption("04");
    await page.getByLabel("Provincia", { exact: true }).selectOption("0401");
    await page.getByLabel("Distrito", { exact: true }).selectOption("040110");
    const tariff = page.getByLabel("Tarifa de entrega", { exact: true });
    const chooseRate = async () => {
      await browserExpect(tariff.locator("option")).toHaveCount(2);
      const rateId = await tariff.locator("option").nth(1).getAttribute("value");
      if (!rateId) throw new Error("Expected agency rate");
      await tariff.selectOption(rateId);
    };
    await chooseRate();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toBeDisabled();
    await page.getByLabel("Documento de identidad (obligatorio)").selectOption("passport");
    await page.getByLabel("Número de documento").fill("00-A-001");
    await page.getByRole("button", { name: "Cerrar edición" }).click();
    await page.getByRole("button", { name: "Asignar entrega", exact: true }).click();
    await browserExpect(page.getByLabel("Número de documento")).toHaveValue("00-A-001");
    await chooseRate();
    const save = async () => {
      const response = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname.includes(`/orders/${orderId}`));
      await page.getByRole("button", { name: "Guardar entrega" }).click();
      await response;
    };
    await save();
    await browserExpect(page.getByRole("status").filter({ hasText: "Entrega guardada." })).toBeVisible();
    const assigned = orderAggregateSchema.parse(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json());
    expect(assigned).toMatchObject({ delivery: { method: "agency", courier: null, agency: null, destination: { districtCode: "040110" },
      recipient: { name: "Destinataria", phone: "00123", identity: { documentType: "passport", document: "00-A-001" } }, recordedBy: { kind: "seller", userId: sellerId } },
      deliveryCost: { amount: 3 }, deliveryCharge: { amount: 3 }, total: { amount: 13 }, stockDeducted: false });
    await chooseRate();
    await page.getByLabel("Nombre del destinatario").fill("Preserved recipient");
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: config.version + 1, home: config.home, store: config.store, agency: { enabled: false },
      couriers: config.couriers.map(value => ({ ...value, kind: "existing", enabled: false })) } })).ok()).toBe(true);
    await save();
    await browserExpect(page.getByRole("alert")).toContainText("La tarifa ya no está disponible");
    await browserExpect(page.getByLabel("Número de documento")).toHaveValue("00-A-001");
    await browserExpect(page.getByLabel("Nombre del destinatario")).toHaveValue("Preserved recipient");
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toBeDisabled();
    expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toEqual(assigned);
    await page.reload();
    await browserExpect(page.getByText("Courier y agencia pendientes de asignación", { exact: true })).toBeVisible();
    expect((await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId: crypto.randomUUID(), amount: { amount: 13, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } })).ok()).toBe(true);
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(2n);
    await page.goto(`/pt-BR/orders/${orderId}`);
    await browserExpect(page.getByText("Transportadora e agência pendentes de atribuição", { exact: true })).toBeVisible();
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
    expect((await page.request.post(`/api/orders/${orderId}/ship`)).ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Courier y agencia pendientes de asignación", { exact: true })).toBeVisible();
    expect((await page.request.post(`/api/orders/${orderId}/deliver`)).ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Courier y agencia pendientes de asignación", { exact: true })).toBeVisible();
    const cancelledId = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id: cancelledId, contactId: null, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    expect((await page.request.post(`/api/orders/${cancelledId}/cancel`)).ok()).toBe(true);
    await page.goto(`/es-PE/orders/${cancelledId}`);
    await browserExpect(page.getByText("Orden cancelada", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Entrega por definir", { exact: true })).toHaveCount(0);
  } finally {
    await page.goto("/");
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
