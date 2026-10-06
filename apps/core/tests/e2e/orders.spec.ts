import { formatCurrency } from "@core/app/format-currency";
import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { CompanyId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

test("seller completes a wallet sale and sees backend totals and stock", async ({ page, request }) => {
  const email = `orders-${crypto.randomUUID()}@example.test`;
  const otherEmail = `orders-other-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    expect((await request.get("/es-PE/orders/new", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get("/es-PE/orders", { maxRedirects: 0 })).status()).toBe(302);
    expect((await request.get(`/es-PE/orders/${crypto.randomUUID()}`, { maxRedirects: 0 })).status()).toBe(302);
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller Orders", companyName: "Orders company", country: "PE" });
    await page.goto("/es-PE/dashboard");
    await browserExpect(page).toHaveURL(/\/es-PE\/dashboard$/);
    const tenantId = companyId;
    const created = await withTenantIsolation(tenantId, () => products.create({ name: "Cuaderno POS", currency: "PEN",
      variants: [{ attributes: { Size: "M" }, sku: "POS-M", salePrice: 0.29, initialStock: 3 }] }));
    expect(created.success).toBe(true);

    await page.getByRole("complementary").getByRole("link", { name: "Ventas" }).click();
    await page.getByRole("link", { name: "Nueva venta" }).click();
    await browserExpect(page.getByRole("heading", { name: "Nueva venta" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Buscar productos por nombre" }).fill("cuad");
    await page.getByRole("button", { name: "Buscar", exact: true }).first().click();
    await browserExpect(page.getByText("Cuaderno POS")).toBeVisible();
    await page.getByRole("button", { name: "Agregar Cuaderno POS" }).click();
    await browserExpect(page.locator("#resumen strong")).toHaveText(formatCurrency(0.29, "PEN", "es"));
    await page.setViewportSize({ width: 390, height: 844 });
    await browserExpect(page.getByRole("link", { name: "Revisar venta" })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 390, height: 500 });
    await page.getByRole("link", { name: "Revisar venta" }).click();
    await browserExpect(page.locator("#resumen")).toBeInViewport();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await browserExpect(page.getByText("Agrega productos para comenzar.")).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(0);
    await page.getByRole("button", { name: "Agregar Cuaderno POS" }).click();
    await page.getByRole("button", { name: "Agregar Cuaderno POS" }).click();
    await browserExpect(page.locator("#resumen strong")).toHaveText(formatCurrency(0.58, "PEN", "es"));
    await page.getByRole("button", { name: "Agregar pago" }).click();
    await page.getByLabel("Importe recibido").fill("0.58");
    await page.getByLabel("Marcar como entregado al guardar").check();
    await page.getByRole("button", { name: "Guardar pedido" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByText("Venta completada", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Entrega por definir", { exact: true })).toHaveCount(0);
    await browserExpect(page.getByRole("button", { name: "Guardar entrega" })).toHaveCount(0);
    await browserExpect(page.getByText("Público general")).toBeVisible();
    await browserExpect(page.getByText(`Total: ${formatCurrency(0.58, "PEN", "es")}`)).toBeVisible();
    await page.getByRole("link", { name: "Ver ventas" }).click();
    await browserExpect(page.getByRole("heading", { name: /Ventas/ }).locator('[data-slot="page-header-count"]')).toHaveText("1");
    const stock = await withTenantIsolation(tenantId, async () => await prisma.productStock.findFirstOrThrow());
    expect(stock.quantity).toBe(1n);

    const contactId = crypto.randomUUID();
    await withTenantIsolation(tenantId, async () => await prisma.contact.create({ data: { id: contactId, phone: "+51912345678", name: null } }));
    await page.getByRole("link", { name: "Nueva venta" }).click();
    await browserExpect(page.getByText(/Stock: 1/)).toBeVisible();
    await page.getByRole("button", { name: "Agregar Cuaderno POS" }).click();
    await page.getByRole("button", { name: "Agregar Cuaderno POS" }).click();
    await page.getByRole("button", { name: "Cambiar" }).click();
    await page.getByRole("button", { name: "Seleccionar" }).click();
    await page.getByRole("button", { name: "Agregar pago" }).click();
    await page.getByLabel("Importe recibido").fill("0.58");
    await page.getByLabel("Marcar como entregado al guardar").check();
    await page.getByRole("button", { name: "Guardar pedido" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("No hay stock suficiente");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(1);
    await page.getByLabel("Cantidad").fill("1");
    await page.getByLabel("Importe recibido").fill("0.30");
    await withTenantIsolation(tenantId, async () => await prisma.productVariant.update({ where: { id: stock.variantId }, data: { salePrice: 0.3 } }));
    await browserExpect(page.locator("#resumen strong")).toHaveText(formatCurrency(0.29, "PEN", "es"));
    await page.getByRole("button", { name: "Guardar pedido" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByText("Teléfono al vender")).toBeVisible();
    await browserExpect(page.getByText("+51912345678", { exact: true }).first()).toBeVisible();
    await browserExpect(page.getByText(`Total: ${formatCurrency(0.30, "PEN", "es")}`)).toBeVisible();
    const completedUrl = page.url();
    await page.getByRole("link", { name: "Ver ventas" }).click();
    await page.getByRole("button", { name: "Filtros" }).click();
    await browserExpect(page.getByRole("dialog", { name: "Filtros de ventas" })).toBeVisible();
    await page.getByLabel("Cliente", { exact: true }).selectOption("contact");
    await page.getByLabel("Contacto", { exact: true }).selectOption(contactId);
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await browserExpect(page.getByRole("heading", { name: /Ventas/ }).locator('[data-slot="page-header-count"]')).toHaveText("1");
    await page.getByRole("searchbox", { name: "Buscar contacto para filtrar" }).fill("912345678");
    await page.getByRole("button", { name: "Buscar contacto" }).click();
    await browserExpect(page).toHaveURL(/customerSearch=912345678/);
    await browserExpect(page).toHaveURL(new RegExp(`customer=contact.*contactId=${contactId}`));
    const tampered = await page.request.post("/es-PE/orders/new", { form: { order: JSON.stringify({ id: crypto.randomUUID(),
      companyId: crypto.randomUUID(), sellerId: crypto.randomUUID(), total: 0.01, contactId: null,
      items: [{ variantId: stock.variantId, quantity: 1 }] }) } });
    expect(await tampered.text()).toContain("Revisa los datos de la venta.");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(2);

    await withTenantIsolation(tenantId, async () => await prisma.productStock.update({ where: { variantId: stock.variantId }, data: { quantity: 1n } }));
    await page.goto("/es-PE/orders/new");
    await page.getByRole("button", { name: "Agregar Cuaderno POS" }).click();
    await page.getByRole("button", { name: "Agregar pago" }).click();
    await page.getByLabel("Importe recibido").fill("0.30");
    await page.getByLabel("Marcar como entregado al guardar").check();
    const adminUrl = new URL(process.env.DATABASE_URL!);
    adminUrl.username = "core";
    adminUrl.password = "core";
    const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
    const triggerName = `reject_browser_sale_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await admin.$executeRawUnsafe(`CREATE FUNCTION public.${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."companyId" = '${tenantId}'::uuid THEN RAISE EXCEPTION 'test stock outage'; END IF; RETURN NEW; END $$`);
      await admin.$executeRawUnsafe(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON "ProductStock" FOR EACH ROW EXECUTE FUNCTION public.${triggerName}()`);
      await page.getByRole("button", { name: "Guardar pedido" }).click();
      await browserExpect(page.getByRole("alert")).toContainText("No se pudo completar la venta");
      expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(2);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "ProductStock"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${triggerName}()`);
      await admin.$disconnect();
    }
    await page.getByRole("button", { name: "Guardar pedido" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    const recoveredId = page.url().split("/").at(-1)!;
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(3);
    const duplicate = await page.request.post("/es-PE/orders/new", { form: { order: JSON.stringify({ id: recoveredId, contactId: null,
      items: [{ variantId: stock.variantId, quantity: 1 }] }) } });
    expect(await duplicate.text()).toContain("Esta venta ya se registró");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(3);

    await withTenantIsolation(tenantId, async () => {
      await prisma.productStock.update({ where: { variantId: stock.variantId }, data: { quantity: 25n } });
      const sellerId = (await systemPrisma.user.findUniqueOrThrow({ where: { email } })).id;
      for (let index = 0; index < 21; index++) {
        expect(await orders.registerImmediateSale({ id: crypto.randomUUID() as OrderId, contactId: null,
          items: [{ variantId: stock.variantId as VariantId, quantity: 1 as PositiveInteger }] },
        { companyId: tenantId as CompanyId, userId: sellerId as UserId })).toMatchObject({ success: true });
      }
    });
    await page.goto("/es-PE/orders");
    await browserExpect(page.getByRole("table", { name: "Órdenes" }).getByRole("row")).toHaveCount(21);
    await page.getByRole("navigation", { name: "Páginas de ventas" }).getByRole("link", { name: "Siguiente" }).click();
    await browserExpect(page).toHaveURL(/page=2/);
    await browserExpect(page.getByRole("table", { name: "Órdenes" }).getByRole("row")).toHaveCount(5);
    await page.setViewportSize({ width: 390, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await browserExpect(page.getByRole("searchbox", { name: "Buscar contacto para filtrar" })).toBeVisible();
    await page.getByRole("button", { name: "Filtros" }).click();
    await page.getByLabel("Desde").fill("2020-01-01");
    await page.getByLabel("Antes de").fill("2020-01-02");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await browserExpect(page.getByText("No hay órdenes para estos filtros.")).toBeVisible();
    await page.getByRole("button", { name: /filtros activos/ }).click();
    await page.getByRole("link", { name: "Limpiar" }).click();
    await browserExpect(page).toHaveURL("/es-PE/orders");
    await browserExpect(page.getByRole("button", { name: "Filtros", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await browserExpect(page).toHaveURL(/\/login$/);
    await prepareVerifiedCompany(page, { email: otherEmail, name: "Other seller", companyName: "Other orders company", country: "US" });
    await page.goto("/es-US/dashboard");
    await browserExpect(page).toHaveURL(/\/es-US\/dashboard$/);
    await page.goto(completedUrl);
    await browserExpect(page).toHaveURL(/\/es-US\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByRole("heading", { name: "Venta no encontrada" })).toBeVisible();
  } finally {
    for (const accountEmail of [email, otherEmail]) {
      const user = await systemPrisma.user.findUnique({ where: { email: accountEmail }, select: { companyId: true } });
      if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
        await prisma.payment.deleteMany();
        await prisma.orderItem.deleteMany();
        await prisma.order.deleteMany();
        await prisma.contact.deleteMany();
        await prisma.productStock.deleteMany();
        await prisma.productVariant.deleteMany();
        await prisma.product.deleteMany();
      });
      await systemPrisma.user.deleteMany({ where: { email: accountEmail } });
      if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
    }
  }
});

test("pending order remains active when paid before delivery", async ({ page }) => {
  const email = `orders-pending-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Pending Seller", companyName: "Pending company", country: "PE" });
    const tenantId = companyId;
    const product = await withTenantIsolation(tenantId, () => products.create({ name: "Producto pendiente", currency: "PEN",
      variants: [{ attributes: {}, sku: "PENDING", salePrice: 10, initialStock: 2 }] }));
    expect(product.success).toBe(true);
    if (!product.success) return;
    const variantId = await withTenantIsolation(tenantId, async () => (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id);
    await page.goto("/es-PE/orders/new");
    await page.getByRole("button", { name: "Agregar Producto pendiente" }).click();
    await page.getByRole("button", { name: "Guardar pedido" }).click();
    await browserExpect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
    const orderId = page.url().split("/").at(-1)!;
    await page.goto("/es-PE/orders");
    await browserExpect(page.getByRole("table", { name: "Órdenes" }).getByText("Activa")).toBeVisible();
    await page.getByRole("table", { name: "Órdenes" }).getByRole("link", { name: "Público general" }).click();
    await browserExpect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    await browserExpect(page.getByText("Orden activa", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Saldo pendiente", { exact: true }).locator("..").getByText(formatCurrency(10, "PEN", "es"), { exact: true })).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(2n);
    const paymentId = crypto.randomUUID();
    const paid = await page.request.post(`/api/orders/${orderId}/payments`, { data: { paymentId,
      amount: { amount: 10, currency: "PEN" }, method: "digital_wallet", deductStockIfPartial: false } });
    expect(paid.status()).toBe(200);
    await page.reload();
    await browserExpect(page.getByText("Orden activa", { exact: true })).toBeVisible();
    await browserExpect(page.getByText("Cubierto")).toBeVisible();
    await browserExpect(page.getByText("Entrega: Pendiente", { exact: true })).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(1n);
    expect(await withTenantIsolation(tenantId, async () => await prisma.payment.count({ where: { orderId } }))).toBe(1);
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.payment.deleteMany();
      await prisma.orderItem.deleteMany();
      await prisma.order.deleteMany();
      await prisma.productStock.deleteMany();
      await prisma.productVariant.deleteMany();
      await prisma.product.deleteMany();
    });
    await systemPrisma.user.deleteMany({ where: { email } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
  }
});

test("new order saves partial payments, paid pending delivery and configured delivery without partial writes", async ({ page }) => {
  const email = `orders-complete-${crypto.randomUUID()}@example.test`;
  try {
    const companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Complete orders", country: "PE" });
    const product = await withTenantIsolation(companyId, () => products.create({ name: "Agenda", currency: "PEN",
      variants: [{ attributes: {}, sku: "AGENDA", salePrice: 10, initialStock: 5 }] }));
    expect(product.success).toBe(true);
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, home: { enabled: true },
      store: { enabled: false, pickupPoint: null }, agency: { enabled: false }, couriers: [] } })).ok()).toBe(true);
    for (const scenario of ["partial", "paid", "delivery", "no-stock"] as const) {
      if (scenario === "no-stock") await withTenantIsolation(companyId, async () => await prisma.productStock.updateMany({ data: { quantity: 0n } }));
      await page.goto("/es-PE/orders/new");
      await page.getByRole("button", { name: "Agregar Agenda" }).click();
      if (scenario !== "no-stock") {
        await page.getByRole("button", { name: "Agregar pago" }).click();
        await page.getByLabel("Importe recibido").fill(scenario === "partial" ? "5" : "10");
      } else await browserExpect(page.getByText(/Disponible: 0/)).toBeVisible();
      if (scenario === "delivery") {
        await page.getByRole("button", { name: "Agregar pago" }).click();
        await page.getByLabel("Importe recibido").nth(1).fill("3");
        await page.getByLabel("Configurar datos de entrega").check();
        await page.locator("#delivery-address").fill("Av. Lima 123");
        await page.locator("#delivery-district").fill("Lima");
        await page.locator("#delivery-instructions").fill("Puerta 2");
        await page.locator("#recipient-name").fill("Unavailable");
        await page.locator("#recipient-phone").fill("999001");
        await page.getByRole("checkbox", { name: /cobrar|cargar/i }).check();
        const countBefore = await withTenantIsolation(companyId, async () => await prisma.order.count());
        await page.getByRole("button", { name: "Guardar pedido" }).click();
        await browserExpect(page.getByRole("alert")).toBeVisible();
        expect(await withTenantIsolation(companyId, async () => await prisma.order.count())).toBe(countBefore);
        await browserExpect(page.locator("#delivery-address")).toHaveValue("Av. Lima 123");
        await browserExpect(page.getByLabel("Importe recibido").nth(1)).toHaveValue("3");
        await page.locator("#recipient-name").fill("Ana");
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: "test-results/order-new-desktop.png", fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: "test-results/order-new-mobile.png", fullPage: true });
      }
      await page.getByRole("button", { name: "Guardar pedido" }).click();
      await browserExpect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
      const id = page.url().split("/").at(-1)!;
      const order = await (await page.request.get(`/api/orders/${id}/aggregate`)).json();
      expect(order).toMatchObject({ deliveryStatus: "pending", completedAt: null,
        stockDeducted: scenario === "paid" || scenario === "delivery",
        paymentStatus: scenario === "paid" || scenario === "delivery" ? "paid" : "pending",
        balanceDue: { amount: scenario === "partial" ? 5 : scenario === "no-stock" ? 10 : 0 } });
      if (scenario === "delivery") expect(order).toMatchObject({ total: { amount: 13 }, deliveryCharge: { amount: 3 },
        payments: [{ amount: { amount: 10 } }, { amount: { amount: 3 } }],
        delivery: { recipient: { name: "Ana", phone: "999001" }, destination: { address: "Av. Lima 123", district: "Lima", instructions: "Puerta 2" } } });
      if (scenario === "no-stock") expect(await withTenantIsolation(companyId, async () => await prisma.productStock.findFirst())).toMatchObject({ quantity: 0n });
    }
  } finally {
    const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.companyDeliverySettings.deleteMany();
    });
    await systemPrisma.user.deleteMany({ where: { email } });
    if (user?.companyId) await withTenantIsolation(user.companyId, async () => await prisma.company.delete({ where: { id: user.companyId! } }));
  }
});
