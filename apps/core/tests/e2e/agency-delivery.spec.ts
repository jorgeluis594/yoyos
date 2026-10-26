import { mkdir } from "node:fs/promises";
import { browserExpect, chooseOption, expect, openOptions, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { deliverySettingsSchema } from "@shared/contracts/delivery-settings";
import { orderAggregateSchema } from "@shared/contracts/orders";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { deleteAgencies, insertAgency, seededCourier, withCatalogAdmin } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { chooseDistrict } from "@core/tests/e2e/district-combobox";

test("rated agency requires a document and a catalog agency, preserves its snapshot and recovers concurrent deactivation", async ({ page }) => {
  const email = `agency-order-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  const agencyIds: string[] = [];
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Agency orders", country: "PE" });
    const tenantId = companyId;
    const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
    const orderId = crypto.randomUUID();
    const variantId = await withTenantIsolation(tenantId, async () => {
      const created = await products.create({ name: "Agency product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 3 }] });
      if (!created.success) throw new Error("Expected product");
      const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: created.data } });
      expect(await orders.create({ id: orderId as OrderId, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] },
        { companyId: tenantId as CompanyId, userId: sellerId as UserId })).toMatchObject({ success: true });
      return variant.id;
    });
    await page.goto(`/es-PE/orders/${orderId}`);
    await page.getByRole("link", { name: "Configurar modalidades de entrega" }).click();
    await page.getByLabel("Ofrecer envío a agencia").check();
    await browserExpect(page.getByText("Guardado", { exact: true })).toBeVisible();
    const initial = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    expect(initial).toMatchObject({ agency: { enabled: true }, couriers: [] });
    const shalom = await seededCourier("shalom");
    agencyIds.push(await insertAgency({ courierId: shalom.id, name: "Sucursal Arequipa", districtCode: "040110" }),
      await insertAgency({ courierId: shalom.id, name: "Sucursal Cercado", districtCode: "040110" }));
    expect((await page.request.put("/api/delivery-settings/zones", { data: { expectedVersion: initial.version, zones: [{ kind: "new", name: "Agency", enabled: true,
      districtCodes: ["040110"], options: [{ kind: "new", method: "agency", name: "Agency", enabled: true, price: { amount: 3, currency: "PEN" }, agencyIds }] }] } })).ok()).toBe(true);
    // Choosing Shalom agencies is what enables Shalom for the company.
    const config = deliverySettingsSchema.parse(await (await page.request.get("/api/delivery-settings")).json());
    expect(config.couriers).toMatchObject([{ name: "Shalom", enabled: true }]);
    await page.goto(`/es-PE/orders/${orderId}`);
    await browserExpect(page.getByLabel("Modalidad de entrega")).toBeHidden();
    await page.getByRole("button", { name: "Asignar entrega", exact: true }).focus();
    await page.keyboard.press("Enter");
    await browserExpect(page.getByRole("button", { name: "Cerrar edición" })).toHaveAttribute("aria-expanded", "true");
    await browserExpect(page.getByRole("combobox", { name: "Modalidad de entrega" })).toContainText("Envío a agencia");
    await browserExpect(page.getByLabel("Courier", { exact: true })).toHaveCount(0);
    await page.getByLabel("Nombre del destinatario").fill("Destinataria");
    await page.getByLabel("Teléfono del destinatario").fill("00123");
    await chooseDistrict(page, "040110");
    const chooseRate = async () => {
      const rates = await openOptions(page, "Tarifa de entrega");
      await browserExpect(rates).toHaveCount(1);
      await rates.first().click();
    };
    await chooseRate();
    await browserExpect(await openOptions(page, "Agencia de destino")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toBeDisabled();
    await chooseOption(page, "Documento de identidad (obligatorio)", "Pasaporte");
    await page.getByLabel("Número de documento").fill("00-A-001");
    await page.getByRole("button", { name: "Cerrar edición" }).click();
    await page.getByRole("button", { name: "Asignar entrega", exact: true }).click();
    await browserExpect(page.getByLabel("Número de documento")).toHaveValue("00-A-001");
    await chooseRate();
    await chooseOption(page, "Agencia de destino", "Sucursal Arequipa");
    const save = async () => {
      const response = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname.includes(`/orders/${orderId}`));
      await page.getByRole("button", { name: "Guardar entrega" }).click();
      await response;
    };
    await save();
    await browserExpect(page.getByRole("status").filter({ hasText: "Entrega guardada." })).toBeVisible();
    const assigned = orderAggregateSchema.parse(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json());
    expect(assigned).toMatchObject({ delivery: { method: "agency", courier: { name: "Shalom" }, agency: { id: agencyIds[0], name: "Sucursal Arequipa", location: { districtCode: "040110" } }, destination: { districtCode: "040110" },
      recipient: { name: "Destinataria", phone: "00123", identity: { documentType: "passport", document: "00-A-001" } }, recordedBy: { kind: "seller", userId: sellerId } },
      deliveryCost: { amount: 3 }, deliveryCharge: { amount: 3 }, total: { amount: 13 }, stockDeducted: false });
    await chooseRate();
    await chooseOption(page, "Agencia de destino", "Sucursal Cercado");
    await page.getByLabel("Nombre del destinatario").fill("Preserved recipient");
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: config.version, home: config.home, store: config.store, agency: { enabled: false } } })).ok()).toBe(true);
    await withCatalogAdmin(query => query('UPDATE "DeliveryAgency" SET enabled = false WHERE id = $1', [agencyIds[1]]));
    await save();
    await browserExpect(page.getByRole("alert")).toContainText("La tarifa ya no está disponible");
    await browserExpect(page.getByLabel("Número de documento")).toHaveValue("00-A-001");
    await browserExpect(page.getByLabel("Nombre del destinatario")).toHaveValue("Preserved recipient");
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toBeDisabled();
    expect(await (await page.request.get(`/api/orders/${orderId}/aggregate`)).json()).toEqual(assigned);
    await page.reload();
    await browserExpect(page.getByText("Sucursal Arequipa", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Shalom", { exact: true })).toBeVisible();
    expect((await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId: crypto.randomUUID(), amount: { amount: 13, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } })).ok()).toBe(true);
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(2n);
    await page.goto(`/pt-BR/orders/${orderId}`);
    await browserExpect(page.getByText("Sucursal Arequipa", { exact: true })).toBeVisible();
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
    await browserExpect(page.getByText("Sucursal Arequipa", { exact: true })).toBeVisible();
    expect((await page.request.post(`/api/orders/${orderId}/deliver`)).ok()).toBe(true);
    await page.reload();
    await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Sucursal Arequipa", { exact: true })).toBeVisible();
    const cancelledId = crypto.randomUUID();
    expect((await page.request.post("/api/orders/pending", { data: { id: cancelledId, items: [{ variantId, quantity: 1 }] } })).status()).toBe(201);
    expect((await page.request.post(`/api/orders/${cancelledId}/cancel`)).ok()).toBe(true);
    await page.goto(`/es-PE/orders/${cancelledId}`);
    await browserExpect(page.getByText("Orden cancelada", { exact: true })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Entrega por definir", { exact: true })).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryOptionAgency.deleteMany(); await prisma.deliveryOption.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
    await deleteAgencies(agencyIds);
  }
});
