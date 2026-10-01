import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { products } from "@core/src/features/products/composition";
import { orders } from "@core/src/features/orders/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

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
    await browserExpect(page.locator("#resumen strong")).toHaveText("0.29 PEN");
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
    await browserExpect(page.locator("#resumen strong")).toHaveText("0.58 PEN");
    await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByRole("heading", { name: "Venta completada" })).toBeVisible();
    await browserExpect(page.getByText("Público general")).toBeVisible();
    await browserExpect(page.getByText("Total: 0.58 PEN")).toBeVisible();
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
    await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
    await browserExpect(page.getByRole("alert")).toContainText("No hay stock suficiente");
    expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(1);
    await page.getByLabel("Cantidad").fill("1");
    await withTenantIsolation(tenantId, async () => await prisma.productVariant.update({ where: { id: stock.variantId }, data: { salePrice: 0.3 } }));
    await browserExpect(page.locator("#resumen strong")).toHaveText("0.29 PEN");
    await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
    await browserExpect(page).toHaveURL(/\/es-PE\/orders\/[0-9a-f-]+$/);
    await browserExpect(page.getByText("Teléfono al vender")).toBeVisible();
    await browserExpect(page.getByText("+51912345678", { exact: true }).first()).toBeVisible();
    await browserExpect(page.getByText("Total: 0.30 PEN")).toBeVisible();
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
    const adminUrl = new URL(process.env.DATABASE_URL!);
    adminUrl.username = "core";
    adminUrl.password = "core";
    const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
    const triggerName = `reject_browser_sale_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await admin.$executeRawUnsafe(`CREATE FUNCTION public.${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."companyId" = '${tenantId}'::uuid THEN RAISE EXCEPTION 'test stock outage'; END IF; RETURN NEW; END $$`);
      await admin.$executeRawUnsafe(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON "ProductStock" FOR EACH ROW EXECUTE FUNCTION public.${triggerName}()`);
      await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
      await browserExpect(page.getByRole("alert")).toContainText("No se pudo completar la venta");
      expect(await withTenantIsolation(tenantId, async () => await prisma.order.count())).toBe(2);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "ProductStock"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${triggerName}()`);
      await admin.$disconnect();
    }
    await page.getByRole("button", { name: "Confirmar cobro y completar venta" }).click();
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
        expect(await orders.createLegacy({ id: crypto.randomUUID(), contactId: null, items: [{ variantId: stock.variantId, quantity: 1 }] },
          { companyId: tenantId, sellerId })).toMatchObject({ success: true });
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

test("pending order appears in the mixed list and detail without completion claims", async ({ page }) => {
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
    const orderId = crypto.randomUUID();
    const created = await page.request.post("/api/orders/pending", { data: { id: orderId, contactId: null,
      items: [{ variantId, quantity: 1 }] } });
    expect(created.status()).toBe(201);
    await page.goto("/es-PE/orders");
    await browserExpect(page.getByRole("table", { name: "Órdenes" }).getByText("Activa")).toBeVisible();
    await page.getByRole("table", { name: "Órdenes" }).getByRole("link", { name: "Público general" }).click();
    await browserExpect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    await browserExpect(page.getByRole("heading", { name: "Orden activa" })).toBeVisible();
    await browserExpect(page.getByText("Pendiente: 10.00 PEN")).toBeVisible();
    expect(await withTenantIsolation(tenantId, async () => (await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity)).toBe(2n);
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
